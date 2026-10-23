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

async function dirtyFiles(worktree) {
  const status = await git(worktree, ["status", "--porcelain", "-u"]);
  if (status.code !== 0) return [];
  const files = [];
  for (const line of status.out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const flag = line.slice(0, 2);
    const rel = line.slice(3).replaceAll("\\", "/").replace(/^"|"$/g, "");
    if (!rel || rel.includes("..")) continue;
    files.push({ rel, deleted: flag.includes("D") });
  }
  return files;
}

export async function publishWorktree(main, tree, run, meta, commitFile) {
  const copied = [];
  for (const file of await dirtyFiles(tree.path)) {
    if (file.deleted) continue;
    const abs = path.join(tree.path, file.rel);
    let raw;
    try {
      raw = await fs.readFile(abs);
    } catch {
      continue;
    }
    if (raw.subarray(0, 800).includes(0) || raw.length > 400_000) continue;
    const dirty = await git(main, ["status", "--porcelain", "--", file.rel]);
    if (dirty.out.trim()) {
      claim(tree, file.rel, true);
      copied.push({ path: file.rel, conflict: true });
      continue;
    }
    const saved = await commitFile(main, run, file.rel, raw.toString("utf8"), meta);
    claim(tree, file.rel, false);
    copied.push(saved);
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
