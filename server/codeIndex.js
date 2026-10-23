import fs from "node:fs/promises";
import path from "node:path";
import { listTree } from "./workspace.js";

const caches = new Map();

function tokens(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
}

function flatten(nodes, into = []) {
  for (const node of nodes || []) {
    if (node.type === "dir") flatten(node.children, into);
    else into.push(node.path);
  }
  return into;
}

async function build(root) {
  const files = flatten(await listTree(root, "", 0, 8));
  const chunks = [];
  const df = new Map();
  for (const rel of files) {
    if (chunks.length > 800) break;
    let raw = "";
    try {
      const stat = await fs.stat(path.join(root, rel));
      if (stat.size > 180000) continue;
      raw = await fs.readFile(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (raw.includes("\u0000")) continue;
    const lines = raw.split(/\r?\n/);
    for (let start = 0; start < lines.length && chunks.length < 800; start += 40) {
      const slice = lines.slice(start, start + 40);
      const text = slice.join("\n").trim();
      if (text.length < 20) continue;
      const counts = new Map();
      for (const token of tokens(text)) counts.set(token, (counts.get(token) || 0) + 1);
      for (const token of counts.keys()) df.set(token, (df.get(token) || 0) + 1);
      chunks.push({ path: rel, line: start + 1, text: slice.join(" ").replace(/\s+/g, " ").slice(0, 220), counts });
    }
  }
  return { chunks, df, docs: chunks.length, at: Date.now() };
}

async function indexFor(root) {
  const cached = caches.get(root);
  if (cached && Date.now() - cached.at < 20000) return cached;
  const next = await build(root);
  caches.set(root, next);
  return next;
}

export async function searchIndex(root, query) {
  const needle = String(query || "").trim();
  const terms = [...new Set(tokens(needle))];
  if (!terms.length) return [];
  const index = await indexFor(root);
  if (!index.docs) return [];
  const scored = [];
  for (const chunk of index.chunks) {
    let score = 0;
    for (const term of terms) {
      const freq = chunk.counts.get(term) || 0;
      if (!freq) continue;
      const idf = Math.log(1 + index.docs / (index.df.get(term) || 1));
      score += (freq / (freq + 1.2)) * idf;
    }
    if (score > 0) scored.push({ path: chunk.path, line: chunk.line, text: chunk.text, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 12).map(({ path: file, line, text }) => ({ path: file, line, text }));
}
