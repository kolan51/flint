import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const SKIP = new Set(["node_modules", ".git", "dist", "release", "build", "out", "coverage", ".next", "site"]);
const CODE = new Set([".js", ".mjs", ".cjs", ".json"]);
const cache = new Map();

export async function syntaxProblems(root) {
  const folder = path.resolve(root || "");
  if (!folder) return [];
  const hit = cache.get(folder);
  if (hit && Date.now() - hit.at < 4000) return hit.problems;
  const problems = [];
  await walk(folder, "", problems, { seen: 0, visits: 0 });
  const listed = problems.slice(0, 40);
  cache.set(folder, { at: Date.now(), problems: listed });
  return listed;
}

async function walk(root, rel, problems, budget) {
  if (problems.length >= 40 || budget.seen >= 400 || budget.visits >= 800) return;
  let entries = [];
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (problems.length >= 40 || budget.seen >= 400 || budget.visits >= 800) return;
    budget.visits += 1;
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(root, next, problems, budget);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!CODE.has(ext)) continue;
    budget.seen += 1;
    let text = "";
    try {
      const stat = await fs.stat(path.join(root, next));
      if (stat.size > 200_000) continue;
      text = await fs.readFile(path.join(root, next), "utf8");
    } catch {
      continue;
    }
    const found = ext === ".json" ? jsonError(text) : jsError(text);
    if (!found) continue;
    problems.push({
      path: next.replaceAll("\\", "/"),
      line: found.line,
      column: found.column,
      message: found.message,
      severity: "error",
      source: ext === ".json" ? "JSON" : "JavaScript",
    });
  }
}

function jsonError(text) {
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    const at = String(err.message || "").match(/position (\d+)/i);
    const index = at ? Number(at[1]) : 0;
    const line = text.slice(0, index).split("\n").length || 1;
    return { line, column: 1, message: String(err.message || "Invalid JSON").slice(0, 180) };
  }
}

function jsError(text) {
  try {
    new vm.Script(text, { filename: "check.js" });
    return null;
  } catch (err) {
    const message = String(err.message || "Syntax error").split("\n")[0];
    if (/import|export|await is only valid/i.test(message)) return null;
    const lineMatch = message.match(/\((\d+):(\d+)\)/) || String(err.stack || "").match(/:(\d+):(\d+)/);
    return {
      line: Number(lineMatch?.[1]) || 1,
      column: Number(lineMatch?.[2]) || 1,
      message: message.slice(0, 180),
    };
  }
}
