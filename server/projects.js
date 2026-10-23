import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "./store.js";

const file = path.join(paths.dataDir, "projects.json");

function folderKey(folder) {
  return path.resolve(String(folder || ""));
}

async function readAll() {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function writeAll(all) {
  const entries = Object.entries(all)
    .sort((a, b) => (b[1]?.opened || 0) - (a[1]?.opened || 0))
    .slice(0, 12);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(Object.fromEntries(entries)), "utf8");
}

export async function folderExists(folder) {
  try {
    const stat = await fs.stat(folderKey(folder));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function readProject(folder) {
  const all = await readAll();
  const item = all[folderKey(folder)] || {};
  return {
    exists: await folderExists(folder),
    chats: item.chats && typeof item.chats === "object" ? item.chats : null,
    tabs: Array.isArray(item.tabs) ? item.tabs.map(String).filter(Boolean).slice(0, 20) : [],
  };
}

export async function saveProject(folder, { chats, tabs } = {}) {
  const id = folderKey(folder);
  const all = await readAll();
  const prev = all[id] || {};
  all[id] = {
    opened: Date.now(),
    chats: chats && typeof chats === "object" ? chats : (prev.chats || {}),
    tabs: Array.isArray(tabs) ? tabs.map(String).filter(Boolean).slice(0, 20) : (prev.tabs || []),
  };
  await writeAll(all);
  return { ok: true };
}
