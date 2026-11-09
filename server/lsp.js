import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function bundled(name) {
  const candidates = [
    path.resolve(name),
    path.resolve(here, "..", name),
  ];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "app.asar.unpacked", name));
  return candidates.find((file) => fs.existsSync(file)) || "";
}

function pyrightPath() {
  return bundled(path.join("node_modules", "pyright", "dist", "pyright-langserver.js"));
}

function scriptPath() {
  return bundled(path.join("node_modules", "typescript-language-server", "lib", "cli.mjs"));
}

export function languageIdFor(rel) {
  const ext = path.extname(String(rel || "")).toLowerCase();
  if (ext === ".py") return "python";
  if (ext === ".tsx") return "typescriptreact";
  if (ext === ".ts") return "typescript";
  if (ext === ".jsx") return "javascriptreact";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
  return "";
}

function session(label, source, scriptOf, configure) {
  return {
    label,
    source,
    scriptOf,
    configure,
    child: null,
    root: "",
    buffer: Buffer.alloc(0),
    nextId: 1,
    ready: null,
    booting: null,
    pending: new Map(),
    diagnostics: new Map(),
    opened: new Set(),
    lastError: "",
  };
}

const python = session("Pyright", "Pyright", pyrightPath, () => ({ analysis: { diagnosticMode: "openFilesOnly", typeCheckingMode: "basic" } }));
const script = session("TypeScript", "TypeScript", scriptPath, () => null);

function send(state, payload) {
  if (!state.child?.stdin) return;
  const body = JSON.stringify(payload);
  state.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function request(state, method, params) {
  const id = state.nextId;
  state.nextId += 1;
  send(state, { jsonrpc: "2.0", id, method, params });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      resolve(null);
    }, 20000);
    state.pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function notify(state, method, params) {
  send(state, { jsonrpc: "2.0", method, params });
}

function uriToRel(state, uri) {
  if (!state.root || !uri) return "";
  let file = uri;
  try {
    file = decodeURIComponent(new URL(uri).pathname);
  } catch {
    return "";
  }
  if (process.platform === "win32" && file.startsWith("/")) file = file.slice(1);
  const rel = path.relative(state.root, file).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..")) return "";
  return rel;
}

function fileUri(state, rel) {
  return pathToFileURL(path.join(state.root, rel)).href;
}

function takeMessages(state) {
  while (state.buffer.length) {
    const text = state.buffer.toString("utf8");
    const crlf = text.indexOf("\r\n\r\n");
    const lf = text.indexOf("\n\n");
    const split = crlf >= 0 && (lf < 0 || crlf <= lf) ? crlf : lf;
    const sep = split === crlf ? 4 : 2;
    if (split < 0) return;
    const match = text.slice(0, split).match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      state.buffer = state.buffer.subarray(1);
      continue;
    }
    const length = Number(match[1]);
    const head = Buffer.byteLength(text.slice(0, split + sep));
    if (state.buffer.length < head + length) return;
    const body = state.buffer.subarray(head, head + length).toString("utf8");
    state.buffer = state.buffer.subarray(head + length);
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      continue;
    }
    if (message.id != null && message.method) {
      const result = message.method === "workspace/configuration"
        ? (message.params?.items || []).map(() => state.configure())
        : null;
      send(state, { jsonrpc: "2.0", id: message.id, result });
    } else if (message.id != null && state.pending.has(message.id)) {
      const done = state.pending.get(message.id);
      state.pending.delete(message.id);
      done(message.result ?? message.error ?? null);
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const rel = uriToRel(state, message.params?.uri || "");
      if (rel) state.diagnostics.set(rel, message.params?.diagnostics || []);
    }
  }
}

function stopOne(state) {
  if (state.child) state.child.kill();
  state.child = null;
  state.ready = null;
  state.buffer = Buffer.alloc(0);
  state.root = "";
  state.opened.clear();
  state.diagnostics.clear();
  state.pending.clear();
}

function startOne(state, next) {
  state.root = next;
  const file = state.scriptOf();
  if (!file) {
    state.lastError = "";
    return Promise.resolve();
  }
  state.lastError = "";
  const proc = spawn(process.execPath, [file, "--stdio"], {
    cwd: next,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  state.child = proc;
  let stderr = "";
  proc.stdout.on("data", (chunk) => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    takeMessages(state);
  });
  proc.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-400);
  });
  proc.stdin?.on("error", () => {});
  proc.on("error", (err) => {
    state.lastError = err.message;
  });
  proc.on("exit", (code) => {
    if (!state.lastError && code) state.lastError = stderr.trim() || `${state.label} stopped (${code}).`;
    if (state.child === proc) {
      state.child = null;
      state.ready = null;
    }
  });
  const init = {
    processId: process.pid,
    rootUri: pathToFileURL(next).href,
    workspaceFolders: [{ uri: pathToFileURL(next).href, name: path.basename(next) }],
    capabilities: {
      textDocument: {
        synchronization: { didSave: true },
        completion: { completionItem: { snippetSupport: false } },
        publishDiagnostics: { relatedInformation: false },
      },
    },
  };
  if (state === python) {
    init.initializationOptions = { python: { analysis: { diagnosticMode: "openFilesOnly", typeCheckingMode: "basic" } } };
  }
  state.ready = request(state, "initialize", init).then(() => {
    notify(state, "initialized", {});
  });
  return state.ready;
}

function statusOf() {
  const running = Boolean((python.child && python.ready) || (script.child && script.ready));
  return {
    ready: running,
    error: [python.lastError, script.lastError].filter(Boolean).join(" "),
    installed: Boolean(pyrightPath() || scriptPath()),
  };
}

export function lspStatus() {
  return statusOf();
}

function problemsOf(state) {
  const problems = [];
  for (const [file, items] of state.diagnostics) {
    for (const item of items || []) {
      problems.push({
        path: file,
        line: (item.range?.start?.line || 0) + 1,
        column: (item.range?.start?.character || 0) + 1,
        message: String(item.message || "").slice(0, 240),
        severity: item.severity === 1 ? "error" : "warning",
        source: state.source,
      });
    }
  }
  return problems;
}

export function lspProblems() {
  return [...problemsOf(python), ...problemsOf(script)].slice(0, 80);
}

function owner(rel) {
  const id = languageIdFor(rel);
  if (id === "python") return python;
  if (id) return script;
  return null;
}

export async function ensureLsp(folder) {
  const next = path.resolve(folder || "");
  if (!next) return statusOf();
  const sameFolder = python.root === next && script.root === next;
  const pythonUp = !pyrightPath() || python.child || python.booting;
  const scriptUp = !scriptPath() || script.child || script.booting;
  if (sameFolder && pythonUp && scriptUp) {
    await Promise.all([python.booting, script.booting].filter(Boolean));
    return statusOf();
  }
  stopLsp();
  python.booting = startOne(python, next).finally(() => {
    python.booting = null;
  });
  script.booting = startOne(script, next).finally(() => {
    script.booting = null;
  });
  await Promise.all([python.booting, script.booting]);
  return statusOf();
}

export function stopLsp() {
  stopOne(python);
  stopOne(script);
}

export async function lspSync(folder, rel, text) {
  const state = owner(rel);
  if (!state) return;
  await ensureLsp(folder);
  if (!state.child) return;
  const uri = fileUri(state, rel);
  const body = String(text || "");
  const languageId = languageIdFor(rel);
  if (state.opened.has(uri)) {
    notify(state, "textDocument/didChange", {
      textDocument: { uri, version: Date.now() },
      contentChanges: [{ text: body }],
    });
    return;
  }
  state.opened.add(uri);
  notify(state, "textDocument/didOpen", {
    textDocument: { uri, languageId, version: 1, text: body },
  });
}

export async function lspComplete(folder, rel, text, line, character) {
  const state = owner(rel);
  if (!state) return [];
  await ensureLsp(folder);
  if (!state.child) return [];
  await lspSync(folder, rel, text);
  const result = await request(state, "textDocument/completion", {
    textDocument: { uri: fileUri(state, rel) },
    position: { line: Math.max(0, Number(line) - 1), character: Math.max(0, Number(character) - 1) },
  });
  const items = Array.isArray(result) ? result : (result?.items || []);
  return items.slice(0, 40).map((item) => ({
    label: String(item.label || ""),
    insert: String(item.insertText || item.label || ""),
    detail: String(item.detail || item.labelDetails?.description || "").slice(0, 80),
  })).filter((item) => item.label);
}
