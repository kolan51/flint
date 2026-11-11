import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./store.js";

function git(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let out = "";
    const take = (buf) => {
      if (out.length < 20000) out += buf.toString();
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("error", () => resolve({ code: 1, out }));
    child.on("close", (code) => resolve({ code, out }));
  });
}

let gate = Promise.resolve();

function queue(work) {
  const run = gate.then(work, work);
  gate = run.then(() => {}, () => {});
  return run;
}

const liveTrees = new Map();

export function listWorktrees() {
  return [...liveTrees.values()].map((tree) => ({
    id: tree.id,
    agent: tree.agent || "",
    agentId: tree.agentId || "",
    color: tree.color || "",
    files: tree.files || [],
    conflicts: tree.conflicts || [],
  }));
}

export function openWorktree(main, meta = {}) {
  return queue(() => createWorktree(main, meta));
}

function claim(tree, rel, conflict) {
  const live = liveTrees.get(tree?.id);
  if (!live || !rel) return;
  if (conflict) {
    if (!live.conflicts.includes(rel)) live.conflicts.push(rel);
    return;
  }
  if (!live.files.includes(rel)) live.files.push(rel);
}

async function createWorktree(main, meta = {}) {
  const check = await git(main, ["rev-parse", "--is-inside-work-tree"]);
  if (check.code !== 0 || !/true/.test(check.out)) return null;
  const id = `wt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(paths.dataDir, "worktrees", id);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const added = await git(main, ["worktree", "add", "--detach", dir, "HEAD"]);
  if (added.code !== 0) {
    await fs.rm(dir, { recursive: true, force: true });
    return null;
  }
  liveTrees.set(id, {
    id,
    path: dir,
    agent: meta.name || "",
    agentId: meta.id || "",
    color: meta.color || "",
    files: [],
    conflicts: [],
  });
  return { id, path: dir };
}

function cleanRel(raw) {
  let rel = String(raw || "").replaceAll("\\", "/").replace(/^"|"$/g, "").trim();
  if (rel.startsWith("./")) rel = rel.slice(2);
  if (!rel || rel.split("/").includes("..") || path.isAbsolute(rel)) return "";
  return rel;
}

export function parsePorcelain(statusText) {
  const files = [];
  for (const line of String(statusText || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const flag = line.slice(0, 2);
    let rest = line.slice(3);
    if (rest.includes(" -> ")) {
      const [fromRaw, toRaw] = rest.split(" -> ");
      const from = cleanRel(fromRaw);
      const to = cleanRel(toRaw);
      if (from) files.push({ rel: from, deleted: true, renamedTo: to || "" });
      if (to) files.push({ rel: to, deleted: false, renamedFrom: from || "" });
      continue;
    }
    const rel = cleanRel(rest);
    if (!rel) continue;
    const deleted = flag[0] === "D" || flag[1] === "D";
    files.push({ rel, deleted });
  }
  return files;
}

async function dirtyFiles(worktree) {
  const status = await git(worktree, ["status", "--porcelain", "-u"]);
  if (status.code !== 0) return [];
  const files = parsePorcelain(status.out);
  for (const file of files) {
    if (file.deleted) continue;
    try {
      await fs.access(path.join(worktree, file.rel));
    } catch {
      file.deleted = true;
    }
  }
  return files;
}

async function mainConflict(main, rel) {
  const dirty = await git(main, ["status", "--porcelain", "--", rel]);
  return Boolean(dirty.out.trim());
}

export async function publishWorktree(main, tree, run, meta, commitFile, commitDelete) {
  const copied = [];
  const seen = new Set();
  for (const file of await dirtyFiles(tree.path)) {
    if (!file.rel || seen.has(file.rel)) continue;
    seen.add(file.rel);
    if (await mainConflict(main, file.rel)) {
      claim(tree, file.rel, true);
      copied.push({ path: file.rel, conflict: true });
      continue;
    }
    if (file.deleted) {
      if (!commitDelete) {
        claim(tree, file.rel, true);
        copied.push({ path: file.rel, conflict: true, reason: "delete-unsupported" });
        continue;
      }
      try {
        const saved = await commitDelete(main, run, file.rel, meta);
        claim(tree, file.rel, false);
        copied.push(saved);
      } catch (err) {
        claim(tree, file.rel, true);
        copied.push({ path: file.rel, conflict: true, reason: err.message });
      }
      continue;
    }
    const abs = path.join(tree.path, file.rel);
    let raw;
    try {
      raw = await fs.readFile(abs);
    } catch {
      continue;
    }
    if (raw.length > 1_500_000) {
      claim(tree, file.rel, true);
      copied.push({ path: file.rel, conflict: true, reason: "too-large" });
      continue;
    }
    const binary = raw.subarray(0, 800).includes(0);
    try {
      const saved = await commitFile(main, run, file.rel, binary ? raw : raw.toString("utf8"), meta);
      claim(tree, file.rel, false);
      copied.push(saved);
    } catch (err) {
      claim(tree, file.rel, true);
      copied.push({ path: file.rel, conflict: true, reason: err.message });
    }
  }
  return copied;
}

export function closeWorktree(main, tree) {
  return queue(() => removeWorktree(main, tree));
}

async function removeWorktree(main, tree) {
  if (!tree?.path) return;
  liveTrees.delete(tree.id);
  await git(main, ["worktree", "remove", "--force", tree.path]);
  await fs.rm(tree.path, { recursive: true, force: true });
  await git(main, ["worktree", "prune"]);
}
