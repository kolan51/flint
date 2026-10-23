import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.FLINT_DATA ? path.resolve(process.env.FLINT_DATA) : path.join(root, "data");

export const paths = {
  root,
  dataDir,
  settings: path.join(dataDir, "settings.json"),
  agents: path.join(dataDir, "agents.json"),
  chats: path.join(dataDir, "chats.json"),
  defaultWorkspace: path.join(root, "workspace"),
};

export const defaultSettings = {
  workspace: paths.defaultWorkspace,
  activeProvider: "",
  providers: {},
  defaultModel: "",
  followMe: {
    enabled: false,
    agentId: "grok",
    debounceMs: 1600,
  },
  search: {
    provider: "duckduckgo",
    braveKey: "",
  },
  commands: {
    mode: "ask",
    allow: [],
  },
  updates: {
    check: true,
    repo: "kolan51/flint",
  },
  completion: {
    enabled: true,
  },
  crew: {
    baseUrl: "",
    model: "",
  },
  recent: [],
  mcp: [],
};

const builtinAgentIds = new Set(["grok", "architect", "reviewer", "debugger"]);

export const defaultAgents = [
  {
    id: "agent",
    name: "Agent",
    color: "#f4b860",
    provider: "",
    model: "",
    temperature: 0.6,
    followMe: true,
    systemPrompt: "You are a coding agent on the user's machine. Be direct. Prefer working code. Use tools to read and write files in the workspace.",
  },
];

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

function normalizeMcp(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && item.command)
    .map((item) => ({
      id: String(item.id || item.name || item.command).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "mcp",
      name: item.name || item.command,
      command: String(item.command),
      args: String(item.args || ""),
    }));
}

function normalizeCommands(raw) {
  const allow = Array.isArray(raw?.allow)
    ? [...new Set(raw.allow.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 40)
    : [];
  return { mode: raw?.mode === "allow" ? "allow" : "ask", allow };
}

function normalizeUpdates(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const repo = String(source.repo || defaultSettings.updates.repo).trim();
  return {
    check: source.check !== false,
    repo: /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : defaultSettings.updates.repo,
  };
}

function normalizePair(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    baseUrl: String(source.baseUrl || "").trim().replace(/\/$/, ""),
    model: String(source.model || "").trim(),
  };
}

function normalizeCompletion(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return { enabled: source.enabled !== false };
}

function normalizeSearch(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    provider: source.provider === "brave" ? "brave" : "duckduckgo",
    braveKey: String(source.braveKey || ""),
  };
}

function normalizeRecent(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const folder = String(item || "").trim();
    const id = folder.toLowerCase();
    if (!folder || seen.has(id)) continue;
    seen.add(id);
    out.push(folder);
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeProviders(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const [id, value] of Object.entries(source)) {
    if (!value) continue;
    out[id] = {
      id,
      name: value.name || id,
      kind: value.kind === "ollama" ? "ollama" : value.kind === "anthropic" ? "anthropic" : "openai",
      baseUrl: value.baseUrl || "http://127.0.0.1:11434",
      apiKey: value.apiKey || "",
      vendor: String(value.vendor || ""),
      notes: value.notes || "",
    };
  }
  return out;
}

export async function loadSettings() {
  const saved = await readJson(paths.settings, defaultSettings);
  const providers = normalizeProviders(saved.providers);
  const activeProvider = providers[saved.activeProvider] ? saved.activeProvider : Object.keys(providers)[0] || "";
  return {
    ...defaultSettings,
    ...saved,
    providers,
    activeProvider,
    followMe: { ...defaultSettings.followMe, ...(saved.followMe || {}) },
    search: normalizeSearch(saved.search),
    commands: normalizeCommands(saved.commands),
    updates: normalizeUpdates(saved.updates),
    completion: normalizeCompletion(saved.completion),
    crew: normalizePair(saved.crew),
    recent: normalizeRecent(saved.recent),
    mcp: normalizeMcp(saved.mcp),
  };
}

export async function saveSettings(next) {
  const providers = normalizeProviders(next.providers);
  const activeProvider = providers[next.activeProvider] ? next.activeProvider : Object.keys(providers)[0] || "";
  const merged = {
    ...defaultSettings,
    ...next,
    providers,
    activeProvider,
    followMe: { ...defaultSettings.followMe, ...(next.followMe || {}) },
    search: normalizeSearch(next.search),
    commands: normalizeCommands(next.commands),
    updates: normalizeUpdates(next.updates),
    completion: normalizeCompletion(next.completion),
    crew: normalizePair(next.crew),
    recent: normalizeRecent(next.recent),
    mcp: normalizeMcp(next.mcp),
  };
  await writeJson(paths.settings, merged);
  return merged;
}

export async function loadAgents() {
  const saved = await readJson(paths.agents, defaultAgents);
  const onlyBuiltin = Array.isArray(saved) && saved.length > 0 && saved.every((agent) => builtinAgentIds.has(agent.id));
  if (!Array.isArray(saved) || saved.length === 0 || onlyBuiltin) {
    const fresh = structuredClone(defaultAgents);
    await writeJson(paths.agents, fresh);
    return fresh;
  }
  return saved;
}

export async function saveAgents(agents) {
  await writeJson(paths.agents, agents);
  return agents;
}

export async function loadChats() {
  return readJson(paths.chats, {});
}

export async function saveChats(chats) {
  await writeJson(paths.chats, chats);
  return chats;
}

export async function ensureWorkspace(workspace) {
  const dir = workspace || paths.defaultWorkspace;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
