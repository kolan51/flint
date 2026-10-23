import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./store.js";
import { readFile, resolveSafe, writeFile } from "./workspace.js";

const SKIP = new Set(["node_modules", ".git", "dist", "data", ".venv", "venv", "__pycache__", "build", "coverage"]);
const TEXT = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".md", ".json", ".css", ".html", ".rs", ".go",
  ".java", ".yml", ".yaml", ".toml", ".txt", ".c", ".cpp", ".h", ".cs", ".rb", ".php", ".sh", ".ps1",
  ".sql", ".xml", ".vue", ".svelte", ".ini", ".cfg",
]);
const NAMES = new Set(["makefile", "dockerfile", "license", "readme", "agents.md"]);

const runs = new Map();
const order = [];
const runsFile = path.join(paths.dataDir, "runs.json");
const journalFile = path.join(paths.dataDir, "journal.json");
const journals = new Map();
const leases = new Map();
const pendingCommands = new Map();
const commandQueue = [];
let activeCommand = null;
let saveTimer = null;
let hydrated = false;

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = JSON.parse(await fs.readFile(runsFile, "utf8"));
    for (const id of raw.order || []) {
      if (!raw.runs?.[id]) continue;
      runs.set(id, raw.runs[id]);
      order.push(id);
    }
  } catch {
    /* no saved runs yet */
  }
  try {
    const raw = JSON.parse(await fs.readFile(journalFile, "utf8"));
    for (const [key, lines] of Object.entries(raw || {})) journals.set(key, lines);
  } catch {
    /* no journal yet */
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload = { order: [...order], runs: {} };
    for (const id of order) {
      const run = runs.get(id);
      if (run) payload.runs[id] = { id: run.id, files: run.files, edits: run.edits };
    }
    fs.mkdir(paths.dataDir, { recursive: true })
      .then(() => fs.writeFile(runsFile, JSON.stringify(payload)))
      .catch(() => {});
  }, 200);
}

export function beginRun(root) {
  const run = {
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    root: root ? path.resolve(root) : "",
    files: {},
    edits: [],
  };
  runs.set(run.id, run);
  order.push(run.id);
  while (order.length > 8) {
    const old = order.shift();
    runs.delete(old);
  }
  scheduleSave();
  return run;
}

export function noteJournal(workspace, line) {
  const key = String(workspace || "");
  const list = journals.get(key) || [];
  list.push(String(line || "").slice(0, 240));
  while (list.length > 40) list.shift();
  journals.set(key, list);
  const payload = Object.fromEntries(journals);
  fs.mkdir(paths.dataDir, { recursive: true })
    .then(() => fs.writeFile(journalFile, JSON.stringify(payload)))
    .catch(() => {});
}

export function journalText(workspace) {
  return (journals.get(String(workspace || "")) || []).join("\n");
}

export function leasePath(rel, owner) {
  leases.set(String(rel || "").replaceAll("\\", "/"), owner);
}

export function releaseTask(taskId) {
  for (const [key, owner] of leases) {
    if (owner.taskId === taskId) leases.delete(key);
  }
}

export function assertLease(rel, agentId) {
  const key = String(rel || "").replaceAll("\\", "/");
  const owner = leases.get(key);
  if (owner && owner.agentId && owner.agentId !== agentId) {
    throw new Error(`${owner.name} owns ${key} until that task finishes.`);
  }
}

export function proposeCommand(command) {
  const id = `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  let resolve;
  let show;
  const promise = new Promise((done) => {
    resolve = done;
  });
  const shown = new Promise((done) => {
    show = done;
  });
  const item = { id, command, resolve, show, opened: false };
  commandQueue.push(item);
  pendingCommands.set(id, item);
  openNextCommand();
  return { id, promise, shown };
}

function openNextCommand() {
  if (activeCommand) return;
  const item = commandQueue[0];
  if (!item) return;
  activeCommand = item;
  item.opened = true;
  item.show({ skip: false });
}

export function decideCommand(id, approved) {
  const item = pendingCommands.get(id);
  if (!item) throw new Error("That command is no longer waiting.");
  pendingCommands.delete(id);
  const at = commandQueue.indexOf(item);
  if (at >= 0) commandQueue.splice(at, 1);
  if (activeCommand === item) activeCommand = null;
  item.resolve({ approved: Boolean(approved) });
  openNextCommand();
  return { id, approved: Boolean(approved), command: item.command || "" };
}

export function releaseWaiting(approved = true) {
  const rest = commandQueue.splice(0);
  activeCommand = null;
  for (const item of rest) {
    pendingCommands.delete(item.id);
    if (!item.opened) item.show({ skip: true });
    item.resolve({ approved: Boolean(approved) });
  }
}

async function remember(root, run, rel) {
  const key = String(rel || "").replaceAll("\\", "/");
  if (run.files[key]) return run.files[key];
  try {
    const before = await readFile(root, key);
    run.files[key] = before.length > 400_000
      ? { before: null, created: false, tooBig: true }
      : { before, created: false };
  } catch {
    run.files[key] = { before: null, created: true };
  }
  return run.files[key];
}

export async function commitFile(root, run, rel, content, meta = {}) {
  const key = String(rel || "").replaceAll("\\", "/");
  const snap = run ? await remember(root, run, key) : { before: "", created: false };
  const written = await writeFile(root, key, content);
  const original = snap.created ? "" : (snap.before ?? "");
  const edit = {
    id: `edit_${Math.random().toString(36).slice(2, 8)}`,
    runId: run?.id || "",
    path: written.path,
    patch: unifiedDiff(original, content, written.path),
    hunks: hunkTexts(original, content),
    created: Boolean(snap.created),
    agent: meta.name || "",
    color: meta.color || "",
  };
  run?.edits.push(edit);
  scheduleSave();
  return { path: written.path, bytes: written.bytes, edit };
}

export async function rejectPath(root, runId, rel) {
  const run = runs.get(runId);
  if (!run) throw new Error("That edit is no longer available.");
  const key = String(rel || "").replaceAll("\\", "/");
  const snap = run.files[key];
  if (!snap) throw new Error("No snapshot for that file.");
  if (snap.created) await fs.rm(resolveSafe(root, key), { force: true });
  else await writeFile(root, key, snap.before ?? "");
  snap.rejected = true;
  scheduleSave();
  return { path: key, created: snap.created };
}

export function acceptPath(runId, rel) {
  const run = runs.get(runId);
  const key = String(rel || "").replaceAll("\\", "/");
  if (run?.files[key]) run.files[key].accepted = true;
  return { path: key };
}

export async function undoRun(root, id) {
  let run = id ? runs.get(id) : null;
  if (!run || !Object.keys(run.files).length) {
    run = null;
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const candidate = runs.get(order[i]);
      if (candidate && Object.keys(candidate.files).length) {
        run = candidate;
        break;
      }
    }
  }
  if (!run) throw new Error("Nothing to undo.");
  if (run.root && root && path.resolve(run.root).toLowerCase() !== path.resolve(root).toLowerCase()) {
    throw new Error("That run belongs to another folder.");
  }
  const restored = [];
  for (const [rel, snap] of Object.entries(run.files)) {
    if (snap.created) await fs.rm(resolveSafe(root, rel), { force: true });
    else await writeFile(root, rel, snap.before ?? "");
    restored.push({ path: rel, created: snap.created });
  }
  runs.delete(run.id);
  const at = order.indexOf(run.id);
  if (at >= 0) order.splice(at, 1);
  scheduleSave();
  return { id: run.id, restored };
}

export async function listRuns(root) {
  const here = root ? path.resolve(root).toLowerCase() : "";
  const listed = [];
  for (const id of [...order].reverse()) {
    const run = runs.get(id);
    const files = Object.keys(run?.files || {});
    if (!files.length) continue;
    if (run.root) {
      if (here && path.resolve(run.root).toLowerCase() !== here) continue;
    } else if (here) {
      let seen = false;
      for (const rel of files) {
        try {
          await fs.access(resolveSafe(root, rel));
          seen = true;
          break;
        } catch {
          /* this folder does not have that file */
        }
      }
      if (!seen) continue;
    }
    listed.push({ id, files, count: files.length });
  }
  return listed;
}

export async function rejectHunk(root, runId, rel, hunkIndex) {
  const run = runs.get(runId);
  if (!run) throw new Error("That edit is no longer available.");
  const key = String(rel || "").replaceAll("\\", "/");
  const snap = run.files[key];
  if (!snap) throw new Error("No snapshot for that file.");
  const original = snap.created ? "" : (snap.before ?? "");
  const current = snap.created ? await readFile(root, key).catch(() => "") : await readFile(root, key);
  const next = withoutHunk(original, current, Number(hunkIndex));
  if (snap.created && !next.trim()) await fs.rm(resolveSafe(root, key), { force: true });
  else await writeFile(root, key, next);
  scheduleSave();
  return {
    path: key,
    created: snap.created && !next.trim(),
    patch: unifiedDiff(original, next, key),
    hunks: hunkTexts(original, next),
  };
}

export async function loadRules(root) {
  const found = [];
  async function walk(rel, depth) {
    if (depth > 5 || found.length >= 8) return;
    let entries = [];
    try {
      entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === "AGENTS.md")) {
      const relPath = rel ? `${rel}/AGENTS.md` : "AGENTS.md";
      try {
        const text = await fs.readFile(path.join(root, relPath), "utf8");
        found.push({ path: relPath.replaceAll("\\", "/"), text: text.slice(0, 4000) });
      } catch {
        /* unreadable rules file */
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(rel ? path.join(rel, entry.name) : entry.name, depth + 1);
    }
  }
  await walk("", 0);
  found.sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  let budget = 12000;
  const parts = [];
  for (const file of found) {
    if (budget <= 0) break;
    const chunk = file.text.slice(0, budget);
    parts.push(`# ${file.path}\n${chunk}`);
    budget -= chunk.length;
  }
  return parts.join("\n\n");
}

export async function searchWorkspace(root, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  const hits = [];
  await walk(root, "", needle, hits, { seen: 0 });
  return hits;
}

async function walk(root, rel, needle, hits, state) {
  if (hits.length >= 40 || state.seen > 4000) return;
  let entries = [];
  try {
    entries = await fs.readdir(resolveSafe(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (hits.length >= 40 || state.seen > 4000) return;
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, child, needle, hits, state);
    else if (entry.isFile()) await scanFile(root, child, needle, hits, state);
  }
}

function textFile(name) {
  const lower = name.toLowerCase();
  if (NAMES.has(lower)) return true;
  const ext = path.extname(lower);
  if (!ext) return true;
  return TEXT.has(ext);
}

async function scanFile(root, rel, needle, hits, state) {
  if (!textFile(path.basename(rel))) return;
  state.seen += 1;
  const file = resolveSafe(root, rel);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return;
  }
  if (!stat.isFile() || stat.size > 400_000) return;
  const raw = await fs.readFile(file);
  if (raw.subarray(0, 800).includes(0)) return;
  const text = raw.toString("utf8");
  const lines = text.split(/\r?\n/);
  const key = rel.replaceAll("\\", "/");
  if (key.toLowerCase().includes(needle)) {
    hits.push({ path: key, line: 1, text: "(filename)" });
  }
  for (let i = 0; i < lines.length && hits.length < 40; i += 1) {
    if (lines[i].toLowerCase().includes(needle)) {
      hits.push({ path: key, line: i + 1, text: lines[i].trim().slice(0, 180) });
    }
  }
}

const jobs = new Map();

export function listJobs() {
  return [...jobs.values()].map((job) => ({
    id: job.id,
    command: job.command,
    output: job.output.slice(-4000),
    code: job.code,
    done: job.done,
  }));
}

export function startJob(cwd, command) {
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("The command is empty.");
  if (cmd.length > 500) throw new Error("The command is too long.");
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const child = spawn(cmd, { cwd, shell: true, windowsHide: true });
  const job = { id, command: cmd, output: "", code: null, done: false, child };
  jobs.set(id, job);
  while (jobs.size > 12) jobs.delete(jobs.keys().next().value);
  const take = (buf) => {
    job.output = (job.output + buf.toString()).slice(-20000);
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  child.on("error", (err) => {
    job.output += `\n${err.message}`;
    job.code = 1;
    job.done = true;
  });
  child.on("close", (code) => {
    job.code = code;
    job.done = true;
  });
  return { id, command: cmd };
}

export function runCommand(cwd, command, timeoutMs = 25000, onData) {
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("The command is empty.");
  if (cmd.length > 500) throw new Error("The command is too long.");
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, windowsHide: true });
    let out = "";
    const take = (buf) => {
      const text = buf.toString();
      if (out.length < 20000) out += text;
      onData?.(text);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = timeoutMs > 0 ? setTimeout(() => {
      child.kill();
      resolve({ code: null, output: `${out.slice(-12000)}\n(timed out after ${Math.round(timeoutMs / 1000)}s)` });
    }, timeoutMs) : null;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 1, output: err.message });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, output: out.slice(-12000) || "(no output)" });
    });
  });
}

export async function webSearch(query, search = {}) {
  const q = String(query || "").trim();
  if (!q) throw new Error("The search query is empty.");
  if (search.provider === "brave" && search.braveKey) return braveSearch(q, search.braveKey);
  return duckSearch(q);
}

async function braveSearch(q, key) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Brave search failed (${res.status}).`);
  const data = await res.json();
  const rows = data.web?.results || [];
  if (!rows.length) return { text: "No web results.", sources: [] };
  const picked = rows.slice(0, 5);
  return {
    text: picked.map((row, i) => formatHit(i, row.title, row.url, row.description)).join("\n\n"),
    sources: picked.map((row) => ({ title: row.title || row.url, url: row.url })),
  };
}

async function duckSearch(q) {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    body: `q=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Web search failed (${res.status}).`);
  const html = await res.text();
  const hits = parseDuck(html);
  if (!hits.length) throw new Error("Web search returned nothing. Add a Brave key under Models if this keeps happening.");
  const picked = hits.slice(0, 5);
  return {
    text: picked.map((hit, i) => formatHit(i, hit.title, hit.url, hit.snippet)).join("\n\n"),
    sources: picked.map((hit) => ({ title: hit.title || hit.url, url: hit.url })),
  };
}

function parseDuck(html) {
  const hits = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...html.matchAll(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//gi)].map((m) => clean(m[1]));
  let match;
  let i = 0;
  while ((match = re.exec(html)) && hits.length < 5) {
    const url = unwrapDuck(match[1]);
    if (!url.startsWith("http")) continue;
    hits.push({ url, title: clean(match[2]) || url, snippet: snippets[i] || "" });
    i += 1;
  }
  return hits;
}

function unwrapDuck(href) {
  const text = href.replaceAll("&amp;", "&");
  try {
    const url = new URL(text, "https://duckduckgo.com");
    return url.searchParams.get("uddg") || (text.startsWith("//") ? `https:${text}` : text);
  } catch {
    return text.startsWith("//") ? `https:${text}` : text;
  }
}

function formatHit(index, title, url, snippet) {
  return `${index + 1}. ${clean(title)}\n${url}\n${clean(snippet)}`;
}

function clean(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function webFetch(target) {
  let url;
  try {
    url = new URL(String(target || ""));
  } catch {
    throw new Error("That is not a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https pages can be opened.");
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Flint" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url.href}`);
  const type = res.headers.get("content-type") || "";
  if (/image|audio|video|pdf|octet-stream/i.test(type)) throw new Error("That URL is not a text page.");
  const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 500_000);
  const text = htmlToText(buf.toString("utf8")).slice(0, 8000);
  if (!text) throw new Error("The page had no readable text.");
  return text;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function unifiedDiff(before, after, file = "file") {
  const ops = lineDiff(String(before ?? "").split("\n"), String(after ?? "").split("\n"));
  const show = ops.map((op) => op.t !== " ");
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i].t === " ") continue;
    for (let j = Math.max(0, i - 2); j <= Math.min(ops.length - 1, i + 2); j += 1) show[j] = true;
  }
  const body = [];
  let hidden = false;
  for (let i = 0; i < ops.length; i += 1) {
    if (!show[i]) {
      hidden = true;
      continue;
    }
    if (hidden) {
      body.push("…");
      hidden = false;
    }
    body.push(`${ops[i].t}${ops[i].s}`);
    if (body.length > 160) {
      body.push("…");
      break;
    }
  }
  if (!body.some((line) => line.startsWith("+") || line.startsWith("-"))) return "(no visible changes)";
  return [`--- ${file}`, `+++ ${file}`, ...body].join("\n").slice(0, 8000);
}

function lineDiff(a, b) {
  if (a.length * b.length > 300_000) return coarseDiff(a, b);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: " ", s: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ t: "-", s: a[i] });
      i += 1;
    } else {
      out.push({ t: "+", s: b[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ t: "-", s: a[i++] });
  while (j < m) out.push({ t: "+", s: b[j++] });
  return out;
}

function hunkIds(ops) {
  const ids = [];
  let hunk = -1;
  let open = false;
  for (const op of ops) {
    if (op.t === " ") {
      ids.push(-1);
      open = false;
      continue;
    }
    if (!open) {
      hunk += 1;
      open = true;
    }
    ids.push(hunk);
  }
  return { ids, count: hunk + 1 };
}

export function hunkTexts(before, after) {
  const ops = lineDiff(String(before ?? "").split("\n"), String(after ?? "").split("\n"));
  const { ids, count } = hunkIds(ops);
  const groups = Array.from({ length: count }, () => ({ lines: [], line: 0 }));
  let nextLine = 1;
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    const id = ids[i];
    if (id >= 0) {
      const group = groups[id];
      if (!group.line) group.line = Math.max(1, nextLine);
      group.lines.push(`${op.t}${op.s}`);
    }
    if (op.t !== "-") nextLine += 1;
  }
  return groups.map((group, index) => ({
    index,
    line: group.line || 1,
    patch: group.lines.slice(0, 40).join("\n"),
  }));
}

function withoutHunk(before, after, hunkIndex) {
  const ops = lineDiff(String(before ?? "").split("\n"), String(after ?? "").split("\n"));
  const { ids } = hunkIds(ops);
  const out = [];
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (ids[i] === hunkIndex) {
      if (op.t !== "+") out.push(op.s);
    } else if (op.t !== "-") out.push(op.s);
  }
  return out.join("\n");
}

export function gitRun(cwd, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let out = "";
    const take = (buf) => {
      if (out.length < 14000) out += buf.toString();
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("error", (err) => resolve({ code: 1, output: err.message }));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 1, output: "Git took too long." });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: out.slice(0, 12000) || "(no output)" });
    });
  });
}

export async function gitStatus(cwd) {
  const status = await gitRun(cwd, ["status", "--short"]);
  const stat = await gitRun(cwd, ["diff", "--stat"]);
  if (/not a git repository/i.test(`${status.output}\n${stat.output}`)) {
    return { repo: false, output: "This folder is not a git repository." };
  }
  return { repo: true, output: [status.output, stat.output].filter((part) => part && part !== "(no output)").join("\n") || "Clean" };
}

export async function gitCommit(cwd, message) {
  const text = String(message || "").trim();
  if (!text) throw new Error("The commit message is empty.");
  const status = await gitStatus(cwd);
  if (!status.repo) throw new Error(status.output);
  if (!status.output || status.output === "Clean") throw new Error("Nothing to commit.");
  const added = await gitRun(cwd, ["add", "-A"]);
  if (added.code) throw new Error(added.output);
  const committed = await gitRun(cwd, ["commit", "-m", text]);
  if (committed.code) throw new Error(committed.output);
  return { output: committed.output };
}

export async function gitBranches(cwd) {
  const status = await gitStatus(cwd);
  if (!status.repo) return { repo: false, current: "", branches: [], output: status.output };
  const current = await gitRun(cwd, ["branch", "--show-current"]);
  const list = await gitRun(cwd, ["branch", "--list"]);
  const branches = list.output.split(/\r?\n/).map((line) => line.replace(/^\*\s*/, "").trim()).filter((name) => name && name !== "(no output)");
  if (current.output.trim() && !branches.includes(current.output.trim())) branches.unshift(current.output.trim());
  return { repo: true, current: current.output.trim(), branches, output: status.output };
}

export async function gitCheckout(cwd, name, create = false) {
  const branch = String(name || "").trim();
  if (!/^[\w./-]+$/.test(branch)) throw new Error("Use a simple branch name.");
  const result = await gitRun(cwd, create ? ["checkout", "-b", branch] : ["checkout", branch], 20000);
  if (result.code) throw new Error(result.output);
  return { output: result.output };
}

export async function gitSync(cwd, direction) {
  const args = direction === "push" ? ["push"] : ["pull", "--ff-only"];
  const result = await gitRun(cwd, args, 60000);
  if (result.code) throw new Error(result.output);
  return { output: result.output };
}

function coarseDiff(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  let shown = 0;
  for (let i = 0; i < n && shown < 80; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] != null) out.push({ t: "-", s: a[i] });
    if (b[i] != null) out.push({ t: "+", s: b[i] });
    shown += 1;
  }
  return out;
}

await hydrate();
