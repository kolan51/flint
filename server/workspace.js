import fs from "node:fs/promises";
import path from "node:path";

const IGNORE = new Set(["node_modules", ".git", "dist", "data", ".DS_Store", "__pycache__", ".pytest_cache", ".venv", "venv"]);
const SKIP_EXT = new Set([".pyc", ".pyo", ".pyd"]);

export function resolveSafe(root, rel = "") {
  const base = path.resolve(root);
  const target = path.resolve(base, rel || ".");
  const relToBase = path.relative(base, target);
  if (relToBase.startsWith("..") || path.isAbsolute(relToBase)) {
    throw new Error("Path escapes the workspace");
  }
  return target;
}

export async function listTree(root, rel = "", depth = 0, maxDepth = 4) {
  const dir = resolveSafe(root, rel);
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
    if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: childRel.replaceAll("\\", "/"),
        type: "dir",
        children: depth < maxDepth ? await listTree(root, childRel, depth + 1, maxDepth) : [],
      });
    } else {
      nodes.push({
        name: entry.name,
        path: childRel.replaceAll("\\", "/"),
        type: "file",
      });
    }
  }
  return nodes;
}

export async function readFile(root, rel) {
  const file = resolveSafe(root, rel);
  const stat = await fs.stat(file);
  if (stat.size > 1_500_000) throw new Error("File is too large to open in the editor");
  return fs.readFile(file, "utf8");
}

export async function writeFile(root, rel, content) {
  const file = resolveSafe(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
  return { path: rel.replaceAll("\\", "/"), bytes: Buffer.byteLength(content) };
}

export async function renamePath(root, from, to) {
  const source = resolveSafe(root, from);
  const target = resolveSafe(root, to);
  if (source === path.resolve(root) || target === path.resolve(root)) throw new Error("That path is the folder itself.");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
  return { from: String(from).replaceAll("\\", "/"), to: String(to).replaceAll("\\", "/") };
}

export async function deletePath(root, rel) {
  const target = resolveSafe(root, rel);
  if (target === path.resolve(root)) throw new Error("Refusing to delete the folder itself.");
  const stat = await fs.stat(target);
  await fs.rm(target, { recursive: stat.isDirectory(), force: true });
  return { path: String(rel).replaceAll("\\", "/") };
}

export async function createFile(root, rel, isDir = false) {
  const target = resolveSafe(root, rel);
  if (isDir) {
    await fs.mkdir(target, { recursive: true });
    return { path: rel.replaceAll("\\", "/"), type: "dir" };
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "", { flag: "wx" }).catch(async (err) => {
    if (err.code !== "EEXIST") throw err;
  });
  return { path: rel.replaceAll("\\", "/"), type: "file" };
}

export function languageFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".js": "javascript",
      ".jsx": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".json": "json",
      ".css": "css",
      ".html": "html",
      ".md": "markdown",
      ".py": "python",
      ".rs": "rust",
      ".go": "go",
      ".java": "java",
      ".yml": "yaml",
      ".yaml": "yaml",
    }[ext] || "plaintext"
  );
}
