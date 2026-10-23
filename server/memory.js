import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "./store.js";
import { chatCompletionsUrl } from "./providers.js";

function dirFor(workspace) {
  const hash = crypto.createHash("sha1").update(String(workspace || "")).digest("hex").slice(0, 12);
  return path.join(paths.dataDir, "memory", hash);
}

function slug(title) {
  return String(title || "note").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "note";
}

function tokens(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
}

async function readNotes(workspace) {
  const dir = dirFor(workspace);
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const notes = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    try {
      const text = await fs.readFile(path.join(dir, name), "utf8");
      const stat = await fs.stat(path.join(dir, name));
      notes.push({ name, text: text.slice(0, 2000), mtime: stat.mtimeMs });
    } catch {
      /* skip a note that disappeared */
    }
  }
  return notes;
}

export async function recallMemory(workspace, query) {
  const notes = await readNotes(workspace);
  if (!notes.length) return "";
  const want = new Set(tokens(query));
  const ranked = notes.map((note) => {
    const have = tokens(note.text);
    let score = 0;
    for (const token of have) if (want.has(token)) score += 1;
    return { ...note, score };
  }).sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  const picked = (ranked[0]?.score ? ranked.filter((note) => note.score > 0) : ranked).slice(0, 4);
  return picked.map((note) => note.text.trim()).join("\n\n").slice(0, 2500);
}

function parseNotes(raw) {
  const text = String(raw || "").trim();
  if (!text || /^none$/i.test(text)) return [];
  const chunks = text.split(/\n(?=# )/).map((chunk) => chunk.trim()).filter((chunk) => chunk.startsWith("# "));
  return chunks.map((chunk) => {
    const [head, ...rest] = chunk.split("\n");
    return { title: head.replace(/^#\s*/, "").trim(), body: rest.join("\n").trim() };
  }).filter((note) => note.title && note.body);
}

async function writeNotes(workspace, notes) {
  if (!notes.length) return;
  const dir = dirFor(workspace);
  await fs.mkdir(dir, { recursive: true });
  for (const note of notes.slice(0, 4)) {
    const file = path.join(dir, `${slug(note.title)}.md`);
    await fs.writeFile(file, `# ${note.title}\n${note.body}\n`, "utf8");
  }
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".md"));
  if (names.length <= 40) return;
  const stats = await Promise.all(names.map(async (name) => ({ name, mtime: (await fs.stat(path.join(dir, name))).mtimeMs })));
  stats.sort((a, b) => a.mtime - b.mtime);
  for (const old of stats.slice(0, stats.length - 40)) {
    await fs.rm(path.join(dir, old.name), { force: true });
  }
}

async function ask(provider, model, user, assistant) {
  const messages = [
    {
      role: "system",
      content: "You keep project memory for a local coding studio. From this turn, write durable notes: conventions, decisions, and facts about where things live. Reply with notes in this shape, or NONE.\n\n# short topic\none or two sentences\n\nSkip task status, secrets, and code that is already in the files.",
    },
    {
      role: "user",
      content: `User:\n${String(user || "").slice(0, 3000)}\n\nAssistant:\n${String(assistant || "").slice(0, 4000)}`,
    },
  ];
  const base = String(provider.baseUrl || "").replace(/\/$/, "");
  if (provider.kind === "ollama") {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.2 } }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return data.message?.content || "";
  }
  if (provider.kind === "anthropic") {
    if (!provider.apiKey) return "";
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        temperature: 0.2,
        system: messages[0].content,
        messages: [{ role: "user", content: messages[1].content }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return (data.content || []).map((part) => part.text || "").join("");
  }
  const res = await fetch(chatCompletionsUrl(base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.2, stream: false }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

export async function listMemory(workspace) {
  return (await readNotes(workspace)).map((note) => {
    const lines = note.text.split(/\r?\n/);
    const title = lines[0]?.replace(/^#\s*/, "").trim() || note.name.replace(/\.md$/, "");
    return { name: note.name.replace(/\.md$/, ""), title, body: note.text };
  });
}

export async function saveMemory(workspace, name, body) {
  const dir = dirFor(workspace);
  await fs.mkdir(dir, { recursive: true });
  const title = slug(name);
  const text = String(body || "").trim();
  const file = text.startsWith("#") ? `${text}\n` : `# ${name}\n${text}\n`;
  await fs.writeFile(path.join(dir, `${title}.md`), file, "utf8");
  return { name: title };
}

export async function removeMemory(workspace, name) {
  await fs.rm(path.join(dirFor(workspace), `${slug(name)}.md`), { force: true });
}

let writing = false;

export function queueMemory(workspace, provider, model, user, assistant) {
  if (writing || !provider || !model) return;
  if (String(assistant || "").trim().length < 80) return;
  writing = true;
  ask(provider, model, user, assistant)
    .then((text) => writeNotes(workspace, parseNotes(text)))
    .catch(() => {})
    .finally(() => {
      writing = false;
    });
}
