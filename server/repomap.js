import fs from "node:fs/promises";
import path from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "release", "build", "out", "coverage", ".next", "site"]);
const CODE = /\.(js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|kt|rb|php|cs|swift)$/i;
const SIGNATURE = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))/,
  /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*(\([^)]*\))/,
  /^\s*class\s+([A-Za-z_][\w]*)\s*[:(]/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*(\([^)]*\))/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*(\([^)]*\))/,
  /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:[\w<>\[\]]+\s+)+([A-Za-z_][\w]*)\s*(\([^)]*\))\s*\{/,
];

const caches = new Map();

function signature(line) {
  for (const pattern of SIGNATURE) {
    const match = line.match(pattern);
    if (!match) continue;
    const name = match[1];
    const args = match[2] ? match[2].replace(/\s+/g, " ").slice(0, 80) : "";
    return `${name}${args}`;
  }
  return "";
}

function wordsOf(query) {
  return [...new Set(String(query || "").toLowerCase().match(/[a-z0-9_]{3,}/g) || [])];
}

function scoreOf(file, names, words) {
  if (!words.length) return 0;
  const hay = `${file}\n${names.join("\n")}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (hay.includes(word)) score += 1;
  }
  return score;
}

async function collect(root, rel, found, budget) {
  if (budget.visits >= 900 || found.length >= 400) return;
  let entries = [];
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (budget.visits >= 900 || found.length >= 400) return;
    budget.visits += 1;
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await collect(root, next, found, budget);
      continue;
    }
    if (!CODE.test(entry.name)) continue;
    let text = "";
    try {
      const stat = await fs.stat(path.join(root, next));
      if (stat.size > 180000) continue;
      text = await fs.readFile(path.join(root, next), "utf8");
    } catch {
      continue;
    }
    const names = [];
    for (const line of text.split(/\r?\n/)) {
      const hit = signature(line);
      if (!hit || names.includes(hit)) continue;
      names.push(hit);
      if (names.length >= 12) break;
    }
    if (!names.length) continue;
    found.push({ path: next, names });
  }
}

export async function repoMap(root, query = "") {
  const folder = path.resolve(root || "");
  if (!folder) return "";
  const key = `${folder}\n${String(query || "")}`;
  const cached = caches.get(key);
  if (cached && Date.now() - cached.at < 20000) return cached.text;
  const found = [];
  await collect(folder, "", found, { visits: 0 });
  const words = wordsOf(query);
  found.sort((a, b) => {
    const diff = scoreOf(b.path, b.names, words) - scoreOf(a.path, a.names, words);
    if (diff) return diff;
    return a.path.localeCompare(b.path);
  });
  const lines = [];
  let chars = 0;
  let files = 0;
  for (const item of found) {
    if (files >= 120) break;
    const block = `${item.path}\n${item.names.map((name) => `  ${name}`).join("\n")}`;
    if (chars + block.length + 1 > 6000) break;
    lines.push(block);
    chars += block.length + 1;
    files += 1;
  }
  const text = lines.join("\n");
  caches.set(key, { at: Date.now(), text });
  return text;
}
