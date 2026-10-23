import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

let child = null;
let root = "";
let buffer = Buffer.alloc(0);
let nextId = 1;
let ready = null;
let booting = null;
const pending = new Map();
const diagnostics = new Map();
const opened = new Set();
let lastError = "";

function serverPath() {
  const name = path.join("node_modules", "pyright", "dist", "pyright-langserver.js");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(name),
    path.resolve(here, "..", name),
  ];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "app.asar.unpacked", name));
  return candidates.find((file) => fs.existsSync(file)) || "";
}

function send(payload) {
  if (!child?.stdin) return;
  const body = JSON.stringify(payload);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function request(method, params) {
  const id = nextId;
  nextId += 1;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, 20000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function takeMessages() {
  while (buffer.length) {
    const text = buffer.toString("utf8");
    const crlf = text.indexOf("\r\n\r\n");
    const lf = text.indexOf("\n\n");
    const split = crlf >= 0 && (lf < 0 || crlf <= lf) ? crlf : lf;
    const sep = split === crlf ? 4 : 2;
    if (split < 0) return;
    const match = text.slice(0, split).match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.subarray(1);
      continue;
    }
    const length = Number(match[1]);
    const head = Buffer.byteLength(text.slice(0, split + sep));
    if (buffer.length < head + length) return;
    const body = buffer.subarray(head, head + length).toString("utf8");
    buffer = buffer.subarray(head + length);
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      continue;
    }
    if (message.id != null && message.method) {
      const result = message.method === "workspace/configuration"
        ? (message.params?.items || []).map(() => ({ analysis: { diagnosticMode: "openFilesOnly", typeCheckingMode: "basic" } }))
        : null;
      send({ jsonrpc: "2.0", id: message.id, result });
    } else if (message.id != null && pending.has(message.id)) {
      const done = pending.get(message.id);
      pending.delete(message.id);
      done(message.result);
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const rel = uriToRel(message.params?.uri || "");
      if (rel) diagnostics.set(rel, message.params?.diagnostics || []);
    }
  }
}

function uriToRel(uri) {
  if (!root || !uri) return "";
  let file = uri;
  try {
    file = decodeURIComponent(new URL(uri).pathname);
  } catch {
    return "";
  }
  if (process.platform === "win32" && file.startsWith("/")) file = file.slice(1);
  const rel = path.relative(root, file).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..")) return "";
  return rel;
}

function fileUri(rel) {
  return pathToFileURL(path.join(root, rel)).href;
}

export function lspStatus() {
  return { ready: Boolean(child && ready), error: lastError, installed: Boolean(serverPath()) };
}

export function lspProblems() {
  const problems = [];
  for (const [file, items] of diagnostics) {
    for (const item of items || []) {
      problems.push({
        path: file,
        line: (item.range?.start?.line || 0) + 1,
        column: (item.range?.start?.character || 0) + 1,
        message: String(item.message || "").slice(0, 240),
        severity: item.severity === 1 ? "error" : "warning",
        source: "Pyright",
      });
    }
  }
  return problems.slice(0, 80);
}

export async function ensureLsp(folder) {
  const next = path.resolve(folder || "");
  if (!next) return lspStatus();
  if (booting && root === next) return booting;
  if (child && root === next) {
    await ready;
    return lspStatus();
  }
  stopLsp();
  root = next;
  diagnostics.clear();
  booting = startServer(next).finally(() => {
    booting = null;
  });
  return booting;
}

function startServer(next) {
  const script = serverPath();
  if (!script) {
    lastError = "Pyright is not installed.";
    return Promise.resolve(lspStatus());
  }
  lastError = "";
  const proc = spawn(process.execPath, [script, "--stdio"], {
    cwd: next,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child = proc;
  let stderr = "";
  proc.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    takeMessages();
  });
  proc.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-400);
  });
  proc.stdin?.on("error", () => {});
  proc.on("error", (err) => {
    lastError = err.message;
  });
  proc.on("exit", (code) => {
    if (!lastError && code) lastError = stderr.trim() || `Pyright stopped (${code}).`;
    if (child === proc) {
      child = null;
      ready = null;
    }
  });
  ready = request("initialize", {
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
    initializationOptions: {
      python: { analysis: { diagnosticMode: "openFilesOnly", typeCheckingMode: "basic" } },
    },
  }).then(() => {
    notify("initialized", {});
  });
  return ready.then(() => lspStatus());
}

export function stopLsp() {
  if (child) child.kill();
  child = null;
  ready = null;
  buffer = Buffer.alloc(0);
  root = "";
  opened.clear();
  diagnostics.clear();
}

export async function lspSync(folder, rel, text) {
  await ensureLsp(folder);
  if (!child) return;
  const uri = fileUri(rel);
  const body = String(text || "");
  if (opened.has(uri)) {
    notify("textDocument/didChange", {
      textDocument: { uri, version: Date.now() },
      contentChanges: [{ text: body }],
    });
    return;
  }
  opened.add(uri);
  notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "python", version: 1, text: body },
  });
}

export async function lspComplete(folder, rel, text, line, character) {
  await ensureLsp(folder);
  if (!child) return [];
  await lspSync(folder, rel, text);
  const result = await request("textDocument/completion", {
    textDocument: { uri: fileUri(rel) },
    position: { line: Math.max(0, Number(line) - 1), character: Math.max(0, Number(character) - 1) },
  });
  const items = Array.isArray(result) ? result : (result?.items || []);
  return items.slice(0, 40).map((item) => ({
    label: String(item.label || ""),
    insert: String(item.insertText || item.label || ""),
    detail: String(item.detail || item.labelDetails?.description || "").slice(0, 80),
  })).filter((item) => item.label);
}
