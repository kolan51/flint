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

async function walk(root, rel, out, budget) {
  if (out.files >= 120 || out.chars >= 6000 || budget.visits >= 900) return;
  let entries = [];
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.files >= 120 || out.chars >= 6000 || budget.visits >= 900) return;
    budget.visits += 1;
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(root, next, out, budget);
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
    const block = `${next}\n${names.map((name) => `  ${name}`).join("\n")}\n`;
    if (out.chars + block.length > 6000) return;
    out.files += 1;
    out.chars += block.length;
    out.lines.push(block.trimEnd());
  }
}

export async function repoMap(root) {
  const folder = path.resolve(root || "");
  if (!folder) return "";
  const cached = caches.get(folder);
  if (cached && Date.now() - cached.at < 20000) return cached.text;
  const out = { files: 0, chars: 0, lines: [] };
  await walk(folder, "", out, { visits: 0 });
  const text = out.lines.join("\n");
  caches.set(folder, { at: Date.now(), text });
  return text;
}
