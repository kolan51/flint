import fs from "node:fs/promises";
import path from "node:path";

function parseSkill(id, raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const body = (match ? match[2] : text).trim();
  let description = "";
  if (match) {
    const line = match[1].split(/\r?\n/).find((row) => /^description\s*:/i.test(row));
    description = line ? line.replace(/^description\s*:/i, "").trim() : "";
  }
  if (!description) description = body.split("\n").map((row) => row.trim()).find(Boolean) || id;
  return {
    id,
    label: description.slice(0, 80),
    prompt: body.slice(0, 4000),
  };
}

async function readDir(root, rel) {
  const skills = [];
  let names = [];
  try {
    names = await fs.readdir(path.join(root, rel));
  } catch {
    return skills;
  }
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    const id = name.replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    if (!id) continue;
    try {
      const raw = await fs.readFile(path.join(root, rel, name), "utf8");
      skills.push(parseSkill(id, raw));
    } catch {
      /* skip an unreadable skill */
    }
  }
  return skills;
}

async function pluginSkills(root) {
  const base = path.join(root, ".flint", "plugins");
  let names = [];
  try {
    names = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    skills.push(...await readDir(root, path.join(".flint", "plugins", entry.name)));
  }
  return skills;
}

export async function listSkills(root) {
  const found = [
    ...await readDir(root, "skills"),
    ...await readDir(root, path.join(".flint", "skills")),
    ...await pluginSkills(root),
  ];
  const seen = new Set();
  return found.filter((skill) => {
    if (seen.has(skill.id)) return false;
    seen.add(skill.id);
    return true;
  });
}
