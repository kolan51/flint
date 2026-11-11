import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { watch } from "node:fs";
import {
  ensureWorkspace,
  loadAgents,
  loadChats,
  loadSettings,
  saveAgents,
  saveChats,
  saveSettings,
  updateChats,
} from "./store.js";
import { getProvider, listModels, probeProvider, streamChat, completeText } from "./providers.js";
import { createFile, deletePath, languageFromPath, listTree, readFile, renamePath, writeFile } from "./workspace.js";
import { agentJobLine, agentRole, applyReplyText, runTool, toolsFor } from "./tools.js";
import { acceptPath, beginRun, commitDelete, commitFile, decideCommand, gitBranches, gitCheckout, gitCommit, gitStatus, gitSync, journalText, listJobs, listRuns, loadRules, rejectHunk, rejectPath, releaseTask, releaseWaiting, runCommand, searchWorkspace, undoRun } from "./studio.js";
import { repoMap } from "./repomap.js";
import { checkCommandFor } from "./check.js";
import { ensureLsp, lspComplete, lspProblems, lspStatus, lspSync } from "./lsp.js";
import { syntaxProblems } from "./syntax.js";
import { runTests } from "./tests.js";
import { searchIndex } from "./codeIndex.js";
import { callMcpTool, listMcpTools } from "./mcp.js";
import { closeSession, listShells, listenSession, openSession, resizeSession, writeSession } from "./shells.js";
import { appendAgentMessages } from "../src/sessions.js";
import { listMemory, queueMemory, recallMemory, removeMemory, saveMemory } from "./memory.js";
import { listSkills } from "./skills.js";
import { closeWorktree, listWorktrees, openWorktree, publishWorktree } from "./worktrees.js";
import { projectStatus, startPreview, startProject, stopProject } from "./preview.js";
import { readProject, saveProject } from "./projects.js";
import { allowBoot, apiToken, corsOptions, guardApi } from "./security.js";
import {
  approveTask,
  createTask,
  getTask,
  listTasks,
  proposeTask,
  setTaskStatus,
  updateTask,
} from "./tasks.js";
import { detectVerification, runVerification } from "./verify.js";
import { runTaskOrchestration } from "./scheduler.js";
import { routeCrew } from "./modelRouter.js";

const app = express();
app.use(cors(corsOptions()));
app.use(express.json({ limit: "16mb" }));
app.use(guardApi);

function send(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function cancelOnDisconnect(req) {
  const ac = new AbortController();
  let done = false;
  const stop = () => {
    if (!done) ac.abort();
  };
  req.on("close", stop);
  return {
    signal: ac.signal,
    finish() {
      done = true;
      req.off("close", stop);
    },
  };
}

function stopped(err, signal) {
  return signal?.aborted || err?.name === "AbortError";
}

function mergeStats(prev, next) {
  if (!next) return prev || null;
  const base = prev || { in: 0, out: 0, ms: 0, tps: 0, approx: false };
  const inn = (base.in || 0) + (next.in || 0);
  const out = (base.out || 0) + (next.out || 0);
  const ms = (base.ms || 0) + (next.ms || 0);
  const weight = (base.out || 0) + (next.out || 0);
  const tps = weight
    ? Math.round((((base.tps || 0) * (base.out || 0) + (next.tps || 0) * (next.out || 0)) / weight) * 10) / 10
    : next.tps || 0;
  return { in: inn, out, ms, tps, approx: Boolean(base.approx || next.approx) };
}

const treeClients = new Set();
let workspaceWatcher = null;
let watchedRoot = "";
let treePulse = null;

function notifyTree(filename = "") {
  const rel = String(filename || "").replaceAll("\\", "/");
  if (rel && (rel.includes("node_modules") || rel.split("/").some((part) => part.startsWith(".")))) return;
  clearTimeout(treePulse);
  treePulse = setTimeout(() => {
    const payload = `data: ${JSON.stringify({ type: "tree", path: rel })}\n\n`;
    for (const client of treeClients) {
      try {
        client.write(payload);
      } catch {
        treeClients.delete(client);
      }
    }
  }, 120);
}

function watchWorkspace(root) {
  if (!root || root === watchedRoot) return;
  workspaceWatcher?.close();
  watchedRoot = root;
  try {
    workspaceWatcher = watch(root, { recursive: true }, (_event, filename) => notifyTree(filename));
    workspaceWatcher.on("error", () => {});
  } catch {
    workspaceWatcher = null;
    watchedRoot = "";
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Flint" });
});

app.get("/api/boot", (req, res) => {
  if (!allowBoot(req)) {
    return res.status(403).json({ error: "Boot token is only for the local Flint window." });
  }
  res.json({ ok: true, token: apiToken() });
});

app.get("/api/settings", async (_req, res) => {
  try {
    const settings = await loadSettings();
    await ensureWorkspace(settings.workspace);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const settings = await saveSettings(req.body || {});
    await ensureWorkspace(settings.workspace);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/models", async (req, res) => {
  try {
    const settings = await loadSettings();
    const provider = getProvider(settings, req.query.provider);
    const models = await listModels(provider);
    res.json({ provider: provider.id, models });
  } catch (err) {
    res.status(502).json({ error: err.message, models: [] });
  }
});

app.get("/api/backends/status", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const results = await Promise.all(
      Object.values(settings.providers).map((provider) => probeProvider(getProvider(settings, provider.id)))
    );
    res.json({ backends: results });
  } catch (err) {
    res.status(500).json({ error: err.message, backends: [] });
  }
});

app.post("/api/backends/probe", async (req, res) => {
  try {
    const settings = await loadSettings();
    const body = req.body || {};
    const provider = body.baseUrl
      ? { id: body.id || "draft", name: body.name || "Draft", kind: body.kind || "openai", baseUrl: body.baseUrl, apiKey: body.apiKey || "" }
      : getProvider(settings, body.id);
    res.json(await probeProvider(provider));
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, models: [] });
  }
});

app.get("/api/agents", async (_req, res) => {
  res.json(await loadAgents());
});

app.put("/api/agents", async (req, res) => {
  const agents = Array.isArray(req.body) ? req.body : [];
  res.json(await saveAgents(agents));
});

app.get("/api/chats", async (_req, res) => {
  res.json(await loadChats());
});

app.put("/api/chats", async (req, res) => {
  res.json(await saveChats(req.body || {}));
});

app.get("/api/projects/state", async (req, res) => {
  try {
    res.json(await readProject(String(req.query.path || "")));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/projects/state", async (req, res) => {
  try {
    const folder = String(req.body?.path || "");
    if (!folder) throw new Error("Missing folder");
    res.json(await saveProject(folder, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/workspace/tree", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    watchWorkspace(root);
    res.json({ root, tree: await listTree(root) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/workspace/events", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  try {
    const settings = await loadSettings();
    watchWorkspace(await ensureWorkspace(settings.workspace));
  } catch {
    /* the poll on the client still refreshes the list */
  }
  treeClients.add(res);
  req.on("close", () => treeClients.delete(res));
});

app.get("/api/workspace/file", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    const rel = String(req.query.path || "");
    const content = await readFile(root, rel);
    res.json({ path: rel, content, language: languageFromPath(rel) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/workspace/file", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    const { path: rel, content } = req.body || {};
    res.json(await writeFile(root, rel, content ?? ""));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/workspace/rename", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await renamePath(root, req.body?.from, req.body?.to));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/workspace/file", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await deletePath(root, req.body?.path || req.query.path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/worktrees", (_req, res) => {
  res.json({ worktrees: listWorktrees() });
});

app.get("/api/memory", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json({ notes: await listMemory(root) });
  } catch (err) {
    res.status(400).json({ error: err.message, notes: [] });
  }
});

app.put("/api/memory", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await saveMemory(root, req.body?.name, req.body?.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/memory", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    await removeMemory(root, req.body?.name || req.query.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/preview", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(startPreview(root));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/preview/project", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(startProject(root));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/preview/project", (_req, res) => {
  res.json(projectStatus());
});

app.delete("/api/preview/project", (_req, res) => {
  res.json(stopProject());
});

app.get("/api/git/branches", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await gitBranches(root));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/git/checkout", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await gitCheckout(root, req.body?.name, Boolean(req.body?.create)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/git/pull", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await gitSync(root, "pull"));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/git/push", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await gitSync(root, "push"));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/search", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    const query = req.body?.query || "";
    const [literal, indexed] = await Promise.all([
      searchWorkspace(root, query),
      searchIndex(root, query).catch(() => []),
    ]);
    const seen = new Set();
    const hits = [];
    for (const hit of [...indexed, ...literal]) {
      const key = `${hit.path}:${hit.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
      if (hits.length >= 40) break;
    }
    res.json({ hits });
  } catch (err) {
    res.status(400).json({ error: err.message, hits: [] });
  }
});

app.post("/api/terminal", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await runCommand(root, req.body?.command || "", 60000));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/terminal/shells", (_req, res) => {
  res.json({ shells: listShells() });
});

app.post("/api/terminal/session", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await openSession(root, req.body?.shell || "powershell", req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/terminal/resize", (req, res) => {
  try {
    resizeSession(req.body?.id, req.body?.cols, req.body?.rows);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/terminal/input", (req, res) => {
  try {
    writeSession(req.body?.id, req.body?.data ?? "");
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/terminal/session", (req, res) => {
  closeSession(req.body?.id || req.query?.id);
  res.json({ ok: true });
});

app.get("/api/terminal/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  let stop = () => {};
  try {
    stop = listenSession(String(req.query.id || ""), (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
    return;
  }
  req.on("close", stop);
});

app.post("/api/runs/undo", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await undoRun(root, req.body?.id || ""));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/runs", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = settings.workspace ? await ensureWorkspace(settings.workspace) : "";
    res.json({ runs: await listRuns(root) });
  } catch (err) {
    res.status(400).json({ error: err.message, runs: [] });
  }
});

app.get("/api/problems", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    const status = await ensureLsp(root);
    const syntax = await syntaxProblems(root);
    res.json({ ...status, problems: [...lspProblems(), ...syntax] });
  } catch (err) {
    res.status(400).json({ error: err.message, problems: [] });
  }
});

app.post("/api/lsp/sync", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    await lspSync(root, String(req.body?.path || ""), req.body?.text ?? "");
    res.json({ ok: true, problems: lspProblems() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/lsp/complete", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    const items = await lspComplete(
      root,
      String(req.body?.path || ""),
      req.body?.text ?? "",
      req.body?.line,
      req.body?.column,
    );
    res.json({ items, status: lspStatus() });
  } catch (err) {
    res.json({ items: [], error: err.message });
  }
});

app.post("/api/tests/run", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await runTests(root));
  } catch (err) {
    res.status(400).json({ error: err.message, failures: [] });
  }
});

app.post("/api/edits/reject", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await rejectPath(root, req.body?.runId, req.body?.path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/edits/accept", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await acceptPath(root, req.body?.runId, req.body?.path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/edits/hunk", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await rejectHunk(root, req.body?.runId, req.body?.path, req.body?.hunk));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/edits/stage", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    const agents = await loadAgents();
    const agent = agents.find((item) => item.id === req.body?.agentId) || null;
    const run = beginRun(root);
    const saved = await commitFile(root, run, req.body?.path, req.body?.content ?? "", { name: agent?.name || "You", color: agent?.color || "" });
    res.json({ runId: run.id, edit: saved.edit });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/commands/decide", async (req, res) => {
  try {
    const approved = Boolean(req.body?.approved);
    const result = decideCommand(req.body?.id, approved);
    let commands;
    if (req.body?.remember && approved && result.command) {
      const settings = await loadSettings();
      const allow = [...new Set([...(settings.commands?.allow || []), result.command])].slice(0, 40);
      const next = { ...settings, commands: { ...settings.commands, allow } };
      await saveSettings(next);
      commands = next.commands;
    }
    if (req.body?.always && approved) releaseWaiting(true);
    res.json({ ...result, commands });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/git/status", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await gitStatus(root));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/git/commit", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json(await gitCommit(root, req.body?.message || ""));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/inline", async (req, res) => {
  try {
    const settings = await loadSettings();
    const agents = await loadAgents();
    const agent = agents.find((item) => item.id === req.body?.agentId) || agents[0];
    const provider = getProvider(settings, agent?.provider);
    const model = agent?.model || settings.defaultModel;
    if (!model) throw new Error("Pick a model in Settings first.");
    const { instruction, selection, before, after, language } = req.body || {};
    const replacement = await collectText(provider, {
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "Replace the selected code. Reply with only the replacement text. No fences, no explanation.",
        },
        {
          role: "user",
          content: `Language: ${language || "text"}\nBefore:\n${before || ""}\n\nSelection:\n${selection || ""}\n\nAfter:\n${after || ""}\n\nChange: ${instruction || "Improve this."}`,
        },
      ],
    });
    res.json({ replacement: replacement.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/skills", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    res.json({ skills: await listSkills(root) });
  } catch (err) {
    res.status(400).json({ error: err.message, skills: [] });
  }
});

app.get("/api/jobs", (_req, res) => {
  res.json({ jobs: listJobs() });
});

app.get("/api/tasks", async (req, res) => {
  try {
    const settings = await loadSettings();
    const workspace = await ensureWorkspace(settings.workspace);
    res.json({ tasks: await listTasks(workspace), jobs: listJobs() });
  } catch (err) {
    res.status(400).json({ error: err.message, tasks: [], jobs: listJobs() });
  }
});

app.get("/api/tasks/:id", async (req, res) => {
  try {
    const settings = await loadSettings();
    const workspace = await ensureWorkspace(settings.workspace);
    const task = await getTask(workspace, req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found." });
    res.json({ task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/tasks/propose", async (req, res) => {
  try {
    const settings = await loadSettings();
    const workspace = await ensureWorkspace(settings.workspace);
    const map = await repoMap(workspace, req.body?.request || "").catch(() => "");
    const verification = await detectVerification(workspace);
    const task = await proposeTask(workspace, {
      request: req.body?.request || "",
      map,
      verification,
      agentId: req.body?.agentId || "",
      model: req.body?.model || "",
    });
    res.json({ task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const settings = await loadSettings();
    const workspace = await ensureWorkspace(settings.workspace);
    const task = await createTask(workspace, req.body || {});
    res.json({ task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", async (req, res) => {
  try {
    const settings = await loadSettings();
    const workspace = await ensureWorkspace(settings.workspace);
    const task = await updateTask(workspace, req.params.id, req.body || {});
    res.json({ task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/approve", async (req, res) => {
  try {
    const settings = await loadSettings();
    const workspace = await ensureWorkspace(settings.workspace);
    const task = await approveTask(workspace, req.params.id);
    res.json({ task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/status", async (req, res) => {
  try {
    const settings = await loadSettings();
    const workspace = await ensureWorkspace(settings.workspace);
    const task = await setTaskStatus(workspace, req.params.id, req.body?.status, req.body || {});
    res.json({ task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/verify", async (req, res) => {
  try {
    const settings = await loadSettings();
    const workspace = await ensureWorkspace(settings.workspace);
    const task = await getTask(workspace, req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found." });
    await setTaskStatus(workspace, task.id, "verifying");
    const report = await runVerification(workspace, {
      checks: task.verification?.checks || [],
      settings,
      allowed: settings.commands?.mode === "allow",
    });
    const next = report.failed.length
      ? "blocked"
      : report.passed.length
        ? "review"
        : "blocked";
    const updated = await setTaskStatus(workspace, task.id, next, { verificationReport: report });
    res.json({ task: updated, report });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/run", async (req, res) => {
  try {
    const settings = await loadSettings();
    const agents = await loadAgents();
    const workspace = await ensureWorkspace(settings.workspace);
    const result = await runTaskOrchestration(workspace, req.params.id, { settings, agents });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/routing", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const agents = await loadAgents();
    res.json({ routing: settings.routing || { mode: "custom" }, crew: routeCrew(settings, agents) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/memory", async (req, res) => {
  res.json({ ok: true });
  try {
    const settings = await loadSettings();
    const agents = await loadAgents();
    const agent = agents.find((item) => item.id === req.body?.agentId) || agents[0];
    const provider = getProvider(settings, agent?.provider);
    const model = agent?.model || settings.defaultModel;
    const workspace = await ensureWorkspace(settings.workspace);
    queueMemory(workspace, provider, model, req.body?.user, req.body?.assistant);
  } catch {
    /* a missed note can wait for the next turn */
  }
});

app.post("/api/complete", async (req, res) => {
  try {
    const settings = await loadSettings();
    const agents = await loadAgents();
    const agent = agents.find((item) => item.id === req.body?.agentId) || agents[0];
    const dedicated = settings.completion?.baseUrl && settings.completion?.model;
    if (!dedicated) return res.json({ text: "" });
    const provider = { kind: "openai", baseUrl: settings.completion.baseUrl, apiKey: "", name: "completion" };
    const model = settings.completion.model;
    const before = String(req.body?.before || "").slice(-600);
    const after = String(req.body?.after || "").slice(0, 240);
    if (dedicated) {
      try {
        const filled = await fetch(`${provider.baseUrl}/infill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input_prefix: before, input_suffix: after, n_predict: 48, temperature: 0.1 }),
          signal: AbortSignal.timeout(8000),
        });
        if (filled.ok) {
          const data = await filled.json();
          const line = String(data.content || "").split("\n")[0].slice(0, 160);
          if (line.trim()) return res.json({ text: line });
        }
      } catch {
        /* the chat completer below still runs */
      }
    }
    const text = await collectText(provider, {
      model,
      temperature: 0.1,
      signal: req.signal,
      messages: [
        { role: "system", content: "Continue the code at the cursor. Reply with only the next few tokens. No fences, no explanation, no repeat of the text before the cursor." },
        { role: "user", content: `Language: ${req.body?.language || "text"}\nBefore cursor:\n${before}\nAfter cursor:\n${after}` },
      ],
    });
    const line = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").split("\n")[0].slice(0, 160);
    res.json({ text: line });
  } catch (err) {
    if (err?.name === "AbortError") return res.json({ text: "" });
    res.json({ text: "" });
  }
});

app.post("/api/workspace/new", async (req, res) => {
  try {
    const settings = await loadSettings();
    const root = await ensureWorkspace(settings.workspace);
    const { path: rel, type } = req.body || {};
    res.json(await createFile(root, rel, type === "dir"));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const settings = await loadSettings();
    const agents = await loadAgents();
    const {
      agentId,
      messages = [],
      model,
      provider: providerId,
      tools: useTools = true,
      mode: requestedMode,
    } = req.body || {};

    const agent = agents.find((a) => a.id === agentId) || agents[0];
    const provider = getProvider(settings, providerId || agent?.provider);
    const chosenModel = model || agent?.model || settings.defaultModel;
    if (!chosenModel) throw new Error("Pick a model in Settings first.");

    const workspace = await ensureWorkspace(settings.workspace);
    const mode = requestedMode === "plan" ? "plan" : "act";
    const rules = await loadRules(workspace);
    const journal = journalText(workspace);
    const cancel = cancelOnDisconnect(req);
    const viewed = modelView(messages);
    const rows = (messages || []).filter((message) => message.role !== "system");
    const behind = Math.max(0, rows.length - 20) > Math.max(0, Number(req.body?.covered) || 0);
    if (behind) send(res, { type: "status", agentId: agent?.id, text: "Catching up" });
    const folded = await foldSummary(provider, chosenModel, messages, req.body?.summary, req.body?.covered, cancel.signal);
    if (folded.summary && (folded.summary !== String(req.body?.summary || "") || folded.covered !== Number(req.body?.covered || 0))) {
      send(res, { type: "summary", summary: folded.summary, covered: folded.covered });
    }
    const lastUser = [...viewed.messages].reverse().find((item) => item.role === "user");
    const memory = await recallMemory(workspace, lastUser?.content || "");
    const map = await repoMap(workspace, lastUser?.content || "").catch(() => "");
    let mcp = { tools: [], map: new Map() };
    try {
      mcp = await listMcpTools(settings.mcp || []);
    } catch {
      mcp = { tools: [], map: new Map() };
    }
    const ask = [...(messages || [])].reverse().find((item) => item.role === "user");
    const run = beginRun(workspace, ask?.content || "");
    send(res, { type: "run", id: run.id });
    const history = [
      { role: "system", content: systemFor(agent, agents, settings, { rules, mode, journal, memory, map, earlier: viewed.earlier, summary: folded.summary, messages: viewed.messages }) },
      ...viewed.messages,
    ];

    const convo = await runAgentLoop({
      settings,
      agents,
      agent,
      provider,
      model: chosenModel,
      temperature: agent?.temperature ?? 0.6,
      messages: history,
      workspace,
      tools: useTools ? toolsOf(mode, agent, agents, { allowPass: true, mcp }) : undefined,
      mcp,
      allowPass: true,
      mode,
      run,
      rules,
      signal: cancel.signal,
      emit: (event) => send(res, event),
    });
    if (!cancel.signal.aborted && useTools) {
      await settleCheck({
        settings,
        agents,
        agent,
        provider,
        model: chosenModel,
        temperature: agent?.temperature ?? 0.6,
        messages: convo,
        workspace,
        tools: toolsOf(mode, agent, agents, { allowPass: true, mcp }),
        mcp,
        allowPass: true,
        mode,
        run,
        rules,
        signal: cancel.signal,
        emit: (event) => send(res, event),
      });
    }
    cancel.finish();
    if (!res.writableEnded) {
      send(res, { type: "done" });
      res.end();
    }
  } catch (err) {
    if (stopped(err)) {
      if (!res.writableEnded) {
        send(res, { type: "done", stopped: true });
        res.end();
      }
      return;
    }
    send(res, { type: "error", error: err.message });
    res.end();
  }
});

app.post("/api/follow", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const settings = await loadSettings();
    const agents = await loadAgents();
    const { agentId, snapshot } = req.body || {};
    const agent = agents.find((a) => a.id === (agentId || settings.followMe.agentId)) || agents[0];
    const provider = getProvider(settings, agent?.provider);
    const model = agent?.model || settings.defaultModel;
    if (!model) throw new Error("Pick a model in Settings first.");

    const prompt = [
      {
        role: "system",
        content: `${agent?.systemPrompt || "You are a pair programmer."}

You are in Follow Me mode. The user is coding in their editor. You receive a live snapshot: file, cursor, selection, and the recent change. Reply in 2-6 short sentences. Do not dump a full rewrite unless the change is clearly broken. Point at the exact issue or next move. No tools.`,
      },
      {
        role: "user",
        content: formatSnapshot(snapshot),
      },
    ];

    for await (const event of streamChat(provider, {
      model,
      messages: prompt,
      temperature: Math.min(agent?.temperature ?? 0.5, 0.5),
    })) {
      send(res, event);
    }
    res.end();
  } catch (err) {
    send(res, { type: "error", error: err.message });
    res.end();
  }
});

function formatSnapshot(snapshot = {}) {
  const lines = [
    `File: ${snapshot.path || "(untitled)"}`,
    `Language: ${snapshot.language || "plaintext"}`,
    `Cursor: line ${snapshot.line ?? "?"}, column ${snapshot.column ?? "?"}`,
  ];
  if (snapshot.selection) lines.push(`Selection:\n${snapshot.selection}`);
  if (snapshot.change) lines.push(`Recent change:\n${snapshot.change}`);
  lines.push(`Nearby code:\n${snapshot.nearby || "(empty file)"}`);
  return lines.join("\n\n");
}

function shortModel(model) {
  if (!model) return "";
  return String(model).split(/[/\\]/).pop().replace(/\.gguf$/i, "").replace(/_/g, " ");
}

function whoLabel(settings, agent) {
  const providerId = agent?.provider || settings.activeProvider;
  const providerName = settings.providers?.[providerId]?.name || "";
  return [providerName, shortModel(agent?.model || settings.defaultModel)].filter(Boolean).join(" · ");
}

function instructions(mode) {
  const shared = `Find code with search_code before guessing a path.
Use web_search for documentation, error strings, and library APIs. Flint runs that search, then web_fetch reads one page. The model server has no internet.`;
  if (mode === "plan") {
    return `${shared}
Plan mode is on. Search and read, then answer with the plan. You cannot edit files or run commands.`;
  }
  return `${shared}
Change code with edit_file. Copy the span from the file. A unique span still matches if only the indentation or spacing differs. new may be a unified diff instead.
Use write_file only to create a file.
Use run_command to run tests or the project, read the output, and fix failures. If this folder has a check command, Flint runs it after an edit and sends a failure back to you.
The user can reject a file change, one hunk, or undo the whole run. Commands wait until the user runs them.
Use git_status and git_diff to see what changed. Keeping a file commits that file. Do not run git commit yourself.`;
}

function rulesBlock(rules) {
  return rules.trim()
    ? `Project rules from AGENTS.md, including files closer to the code. Follow them on every task, including work passed from another agent.\n${rules.trim()}`
    : "This project has no AGENTS.md.";
}

export function modelView(messages) {
  const rows = (messages || []).filter((message) => message.role !== "system");
  const recent = rows.slice(-20);
  return {
    earlier: Math.max(0, rows.length - recent.length),
    messages: recent.map((message, index) => {
      const last = index === recent.length - 1;
      let content = String(message.content || "");
      if (!last && message.role === "assistant") content = content.slice(0, 4000);
      if (!last && message.role === "user") content = content.replace(/\n*\[Open file:[\s\S]*$/, "").slice(0, 2000);
      return { ...message, content };
    }),
  };
}

async function foldSummary(provider, model, messages, summary, covered, signal) {
  const rows = (messages || []).filter((message) => message.role !== "system");
  const drop = Math.max(0, rows.length - 20);
  const start = Math.max(0, Number(covered) || 0);
  const prior = String(summary || "").trim();
  if (!model || drop <= start) return { summary: prior, covered: start };
  const chunk = rows.slice(start, drop).map((message) => {
    const who = message.role === "user" ? "User" : "Assistant";
    return `${who}: ${String(message.content || "").replace(/\s+/g, " ").trim().slice(0, 700)}`;
  }).filter((line) => line.length > 8).join("\n");
  if (!chunk) return { summary: prior, covered: drop };
  try {
    const text = await completeText(provider, model, [
      {
        role: "system",
        content: "You compress a coding chat so a later turn can continue the same project. Keep decisions, file names, constraints, and unfinished work. Drop greetings and repeated command output. Plain prose, under 180 words.",
      },
      {
        role: "user",
        content: `Summary so far:\n${prior || "(none)"}\n\nNew turns:\n${chunk.slice(0, 12000)}`,
      },
    ], signal);
    const next = String(text || "").trim();
    if (!next) return { summary: prior, covered: start };
    return { summary: next.slice(0, 4000), covered: drop };
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") throw err;
    return { summary: prior, covered: start };
  }
}

function crewName(agent, settings) {
  const job = agentJobLine(agent);
  const model = whoLabel(settings, agent);
  const same = !job || job.toLowerCase() === String(agent?.name || "").toLowerCase();
  const who = same ? agent?.name || "Agent" : `${agent?.name || "Agent"}, ${job}`;
  return model ? `${who} (${model})` : who;
}

function isLead(agent) {
  const role = agentRole(agent);
  return role === "lead" || role === "architect";
}

function shapeFor(agent, agents, worker = false) {
  const role = agentRole(agent);
  if (role === "apply" || role === "implementer") return role === "implementer" ? "implement" : "apply";
  if (role === "verifier") return "verify";
  if (role === "reviewer") return "review";
  if (role === "architect") return "architect";
  if (worker) return "full";
  if ((agents || []).some((item) => {
    const seat = agentRole(item);
    return item.id !== agent?.id && (seat === "apply" || seat === "implementer");
  })) return "decide";
  return "full";
}

function toolsOf(mode, agent, agents, { allowPass = false, mcp = null, worker = false } = {}) {
  const shape = shapeFor(agent, agents, worker);
  const others = (agents || []).filter((item) => item.id !== agent?.id);
  const canPass = allowPass && shape !== "apply" && shape !== "implement" && shape !== "verify" && shape !== "review";
  const base = toolsFor(mode, canPass, others, shape);
  if (shape === "apply" || shape === "implement" || shape === "verify" || shape === "review") return base;
  return [...base, ...(mcp?.tools || [])];
}

function looksLikeJob(text) {
  if (/\b(implement|fix|build|add|create|write|change|update|refactor|split|test|bug|missing|feature)\b/i.test(text)) return true;
  return text.trim().length > 80;
}

export function delegationTargets(agent, agents, messages) {
  const last = [...messages].reverse().find((item) => item.role === "user");
  const text = String(last?.content || "");
  const others = agents.filter((item) => {
    const seat = agentRole(item);
    return item.id !== agent?.id && seat !== "apply" && seat !== "implementer" && seat !== "verifier" && seat !== "reviewer";
  });
  if (!others.length || !text.trim()) return [];
  const blob = text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const named = others.filter((item) => blob.includes(item.name.toLowerCase().replace(/[^a-z0-9]+/g, "")));
  const numberList = text.match(/workers?\s*(\d+(?:\s*(?:,|and|&)?\s*\d+)*)/i);
  const numbers = numberList ? numberList[1].match(/\d+/g) : [];
  const numbered = others.filter((item) => numbers.some((number) => item.name.toLowerCase().replace(/[^a-z0-9]+/g, "").endsWith(number)));
  const wantsAll = /\b(workers|split|delegate|divide the work|hand(?:\s+\w+){0,2}\s+off)\b/i.test(text);
  const picked = new Map();
  for (const item of [...named, ...numbered, ...(wantsAll ? others : [])]) picked.set(item.id, item);
  if (picked.size) return [...picked.values()];
  if (isLead(agent) && looksLikeJob(text)) return others;
  return [];
}

export function systemFor(agent, agents, settings, extras = {}) {
  const role = agentRole(agent);
  const compact = settings?.prompt?.compact === true;
  const others = agents.filter((item) => {
    const seat = agentRole(item);
    return item.id !== agent?.id && seat !== "apply" && seat !== "implementer";
  });
  const appliers = agents.filter((item) => {
    const seat = agentRole(item);
    return item.id !== agent?.id && (seat === "apply" || seat === "implementer");
  });
  const targets = delegationTargets(agent, agents, extras.messages || []);
  const roster = others.length
    ? `You lead ${others.map((item) => item.name).join(", ")}. For a real job, call assign_work once before you edit or run anything. Give each worker one file. The files must not overlap. They start together, so each task must stand on its own. You wait, then tell the user what each one did.
${others.map((item) => `- ${crewName(item, settings)}`).join("\n")}`
    : (appliers.length ? "" : "You are the only agent right now.");
  const nudge = targets.length
    ? `Split this job across ${targets.map((item) => item.name).join(", ")}. Call assign_work once. Give each worker one file, and do not give two workers the same file. Do not edit or run anything until they have reported back.`
    : "";
  const roleLine = role === "apply" || role === "implementer"
    ? "You apply one change. Read the file, then edit_file or write_file. Do not plan, do not delegate, and do not run commands."
    : role === "verifier"
      ? "You verify. Run the folder checks. Do not edit files to make tests pass. Report failures plainly."
      : role === "reviewer"
        ? "You review. Read the diff and the verification report. Do not edit files."
        : role === "architect"
          ? "You plan. Name files, acceptance, and risks. Hand implementation to an implementer. Do not edit files yourself when an implementer is present."
          : (appliers.length
            ? `${appliers.map((item) => crewName(item, settings)).join(", ")} writes the diff. Hand that agent the file and the change with pass_task. Do not edit the file yourself.`
            : "");
  const journal = String(extras.journal || "").trim();
  const recent = journal ? `Recent work in this folder, shared by every agent:\n${journal}` : "";
  const memory = String(extras.memory || "").trim();
  const remembered = memory ? `Notes from earlier sessions in this project:\n${memory}` : "";
  const mapped = String(extras.map || "").trim();
  const names = mapped ? `Names in this folder. Search before you read a body:\n${mapped}` : "";
  const earlier = extras.summary
    ? `Earlier in this session, already compressed:\n${extras.summary}`
    : (extras.earlier
      ? `${extras.earlier} earlier messages in this session stay saved. This turn sees the recent part.`
      : "");
  const voice = agent?.systemPrompt || (role === "apply" || role === "implementer" ? "You apply a change to one file." : "You are a local coding assistant.");
  if (role === "apply" || role === "implementer" || role === "verifier" || role === "reviewer" || (compact && !targets.length)) {
    return [voice, roleLine, names].filter(Boolean).join("\n\n");
  }
  if (compact) return [voice, roleLine, names, roster, nudge].filter(Boolean).join("\n\n");
  return [voice, rulesBlock(extras.rules || ""), instructions(extras.mode), names, remembered, recent, earlier, roster, nudge, roleLine].filter(Boolean).join("\n\n");
}

function findAgent(agents, query) {
  const key = String(query || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return agents.find((agent) => agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "") === key)
    || agents.find((agent) => agent.id.toLowerCase() === key);
}

function workerPrompt(target, extras) {
  const names = extras.map ? `Names in this folder. Search before you read a body:\n${extras.map}` : "";
  const handed = `A task was passed to you by ${extras.from?.name || "Agent"}${extras.fromModel ? ` (${extras.fromModel})` : ""}.`;
  if (agentRole(target) === "apply") {
    return [
      target.systemPrompt || "You apply a change to one file.",
      "You apply one change. Read the file, then edit_file or write_file. Do not plan, do not delegate, and do not run commands.",
      names,
      handed,
      "Reply with the path you changed.",
    ].filter(Boolean).join("\n\n");
  }
  if (extras.compact) {
    return [
      target.systemPrompt || "You are a coding agent.",
      names,
      handed,
      extras.tree ? "You have your own checkout. Finish the task here. Your file changes are copied back when you are done." : "Do the task in the shared folder.",
      `Reply with the result ${extras.from?.name || "the lead"} should show the user. Do not pass this task onward.`,
    ].filter(Boolean).join("\n\n");
  }
  return `${target.systemPrompt || "You are a coding agent."}

${rulesBlock(extras.rules || "")}

${instructions(extras.mode)}

${names}

${extras.memory ? `Notes from earlier sessions:\n${extras.memory}` : ""}

${extras.journal ? `Recent work in this folder:\n${extras.journal}` : ""}

${handed}
${extras.tree ? "You have your own checkout. Finish the task here. Your file changes are copied back when you are done." : "Do the task in the shared folder."}
Reply with the result ${extras.from?.name || "the lead"} should show the user. Do not pass this task onward.`;
}

async function passTask({ settings, agents, from, args, workspace, emit, mode, run, rules, mcp, signal }) {
  const task = String(args.task || args.message || "").trim();
  if (!task) throw new Error("The task is empty.");
  const target = findAgent(agents, args.agent || args.name);
  if (!target) {
    throw new Error(`No agent named "${args.agent || ""}". Available: ${agents.map((item) => item.name).join(", ")}`);
  }
  if (target.id === from?.id) throw new Error("Pick a different agent.");
  const model = target.model || settings.defaultModel;
  if (!model) throw new Error(`${target.name} has no model selected.`);
  const workerProvider = getProvider(settings, target.provider);

  const fromModel = whoLabel(settings, from);
  const toModel = whoLabel(settings, target);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const taskId = `task_${stamp}`;
  const userMsgId = `u_${stamp}`;
  const replyMsgId = `a_${stamp}`;
  const passedFrom = { agentId: from?.id || "", name: from?.name || "Agent", model: fromModel, color: from?.color || "", avatar: from?.avatar || "" };
  const sendEvent = emit;
  emit({
    type: "task_start",
    taskId,
    userMsgId,
    replyMsgId,
    task,
    from: { ...passedFrom, color: from?.color || "" },
    to: { id: target.id, name: target.name, model: toModel, color: target.color || "", avatar: target.avatar || "" },
  });

  let reply = "";
  let thinking = "";
  let workerStats = null;
  const touched = [];
  const rememberPath = (filePath) => {
    const file = String(filePath || "").replaceAll("\\", "/").replace(/^\.\//, "");
    if (file && !touched.includes(file)) touched.push(file);
  };
  const tree = await openWorktree(workspace, { id: target.id, name: target.name, color: target.color || "" });
  sendEvent({ type: "worktrees", trees: listWorktrees() });
  const root = tree?.path || workspace;
  const localRules = tree ? await loadRules(root) : rules;
  const memory = await recallMemory(workspace, task);
  const map = await repoMap(root, task).catch(() => "");
  const scratch = tree ? { id: run?.id || "", files: {}, edits: [] } : run;
  emit({ type: "task_status", taskId, agentId: target.id, replyMsgId, text: "Waiting for the model" });
  try {
  await runAgentLoop({
    settings,
    agents,
    agent: target,
    provider: workerProvider,
    model,
    temperature: target.temperature ?? 0.6,
    workspace: root,
    tools: toolsOf(mode, target, agents, { allowPass: false, mcp, worker: true }),
    allowPass: false,
    mode,
    run: scratch,
    rules: localRules,
    mcp,
    leaseTask: taskId,
    signal,
    messages: [
      {
        role: "system",
        content: workerPrompt(target, { rules: localRules, mode, map, memory, journal: journalText(workspace), from: passedFrom, fromModel, tree, compact: settings?.prompt?.compact === true }),
      },
      { role: "user", content: task },
    ],
    emit(event) {
      if (event.type === "delta") {
        reply += event.text;
        sendEvent({ type: "task_delta", taskId, agentId: target.id, replyMsgId, text: event.text });
      } else if (event.type === "think") {
        thinking += event.text;
        sendEvent({ type: "task_think", taskId, agentId: target.id, replyMsgId, text: event.text });
      } else if (event.type === "stats") {
        if (event.live) {
          sendEvent({ type: "task_stats", taskId, replyMsgId, stats: event.stats, live: true });
        } else {
          workerStats = mergeStats(workerStats, event.stats);
          sendEvent({ type: "task_stats", taskId, replyMsgId, stats: workerStats });
        }
      } else if (event.type === "status") {
        sendEvent({ type: "task_status", taskId, agentId: target.id, replyMsgId, text: event.text });
      } else if (event.type === "command_output" || event.type === "sources") {
        sendEvent(event);
      } else if (event.type === "command" || event.type === "focus") {
        sendEvent(event.type === "command" ? { ...event, agentId: event.agentId || target.id } : event);
      } else if (!tree && (event.type === "file_changed" || event.type === "edit")) {
        rememberPath(event.path);
        sendEvent(event);
      }
    },
  });
  } catch (err) {
    if (err?.name === "AbortError" || signal?.aborted) throw err;
    sendEvent({ type: "task_done", taskId, agentId: target.id, replyMsgId, error: err.message, files: touched });
    throw err;
  } finally {
    if (tree) {
      try {
        if (!signal?.aborted) {
          const copied = await publishWorktree(workspace, tree, run, { name: target.name, color: target.color }, commitFile, commitDelete);
          for (const saved of copied) {
            if (saved.conflict) {
              sendEvent({ type: "worktree", conflict: saved.path, agentId: target.id, agent: target.name, trees: listWorktrees() });
              continue;
            }
            rememberPath(saved.path);
            if (saved.edit) sendEvent({ type: "edit", ...saved.edit, agentId: target.id });
            sendEvent({ type: "file_changed", path: saved.path, agentId: target.id });
          }
        }
        sendEvent({ type: "worktrees", trees: listWorktrees() });
      } catch {
        /* the shared folder stays as it was */
      }
      await closeWorktree(workspace, tree);
      sendEvent({ type: "worktrees", trees: listWorktrees() });
    }
    releaseTask(taskId);
  }

  await updateChats((current) => appendAgentMessages(current, target.id, [
    { id: userMsgId, role: "user", content: task, passedFrom },
    { id: replyMsgId, role: "assistant", content: reply.trim(), thinking: thinking.trim(), stats: workerStats },
  ]));
  sendEvent({ type: "task_done", taskId, agentId: target.id, replyMsgId, reply: reply.trim(), thinking: thinking.trim(), stats: workerStats, files: touched });
  return `${target.name} (${toModel || "model"}) finished the task you passed.\n\nResult:\n${reply.trim() || "(no reply)"}`;
}

function actionText(call) {
  let args = {};
  try {
    args = JSON.parse(call?.function?.arguments || "{}");
  } catch {
    args = {};
  }
  const name = call?.function?.name || "";
  const file = String(args.path || "").replaceAll("\\", "/").split("/").filter(Boolean).pop();
  if (name === "read_file") return file ? `Reading ${file}` : "Reading a file";
  if (name === "list_dir") return "Looking through files";
  if (name === "search_code") return "Searching the folder";
  if (name === "edit_file" || name === "write_file") return file ? `Editing ${file}` : "Editing a file";
  if (name === "run_command") return "Waiting to run a command";
  if (name === "assign_work") return "Splitting the job";
  if (name === "pass_task" || name === "ask_agent") return `Passing to ${args.agent || "a worker"}`;
  if (name === "web_search") return "Searching the web";
  if (name === "web_fetch") return "Opening a page";
  if (name === "git_status" || name === "git_diff") return "Checking git";
  return "Working";
}

function toolPath(call) {
  if (!["read_file", "edit_file", "write_file"].includes(call?.function?.name)) return "";
  try {
    return String(JSON.parse(call.function.arguments || "{}").path || "");
  } catch {
    return "";
  }
}

async function settleCheck(ctx) {
  const command = checkCommandFor(ctx.settings, ctx.workspace);
  if (ctx.mode === "plan" || !command || !ctx.run?.edits?.length) return;
  let convo = ctx.messages || [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (ctx.signal?.aborted) return;
    ctx.emit?.({ type: "status", agentId: ctx.agent?.id || "", text: "Running the folder check" });
    ctx.emit?.({ type: "command_output", text: `\n$ ${command}\n` });
    const result = await runCommand(ctx.workspace, command, 120000, (text) => {
      ctx.emit?.({ type: "command_output", text });
    });
    if ((result.code ?? 1) === 0) {
      ctx.emit?.({ type: "status", agentId: ctx.agent?.id || "", text: "Check passed" });
      return;
    }
    const tail = result.output.length > 4000 ? result.output.slice(-4000) : result.output;
    if (attempt === 1) {
      ctx.emit?.({ type: "status", agentId: ctx.agent?.id || "", text: "Check still failing" });
      return;
    }
    const applier = (ctx.agents || []).find((item) => item.id !== ctx.agent?.id && agentRole(item) === "apply");
    if (applier && agentRole(ctx.agent) !== "apply") {
      try {
        await passTask({
          settings: ctx.settings,
          agents: ctx.agents,
          from: ctx.agent,
          args: { agent: applier.name, task: `The folder check failed. Fix the failure in the files already changed.\n\n$ ${command}\nexit ${result.code ?? "?"}\n${tail}` },
          workspace: ctx.workspace,
          emit: ctx.emit,
          mode: ctx.mode,
          run: ctx.run,
          rules: ctx.rules,
          mcp: ctx.mcp,
          signal: ctx.signal,
        });
      } catch (err) {
        if (err?.name === "AbortError" || ctx.signal?.aborted) return;
        ctx.emit?.({ type: "status", agentId: ctx.agent?.id || "", text: err.message });
      }
      continue;
    }
    convo = await runAgentLoop({
      ...ctx,
      messages: [...convo, {
        role: "user",
        content: `The folder check failed. Fix the failure in the files you already changed.\n\n$ ${command}\nexit ${result.code ?? "?"}\n${tail}`,
      }],
    });
  }
}

async function runAgentLoop({ settings, agents, agent, provider, model, temperature, messages, workspace, tools, allowPass, emit, mode = "act", run, rules, mcp, leaseTask, signal }) {
  const convo = [...messages];
  const handoff = new Set(delegationTargets(agent, agents, messages).map((item) => item.name.toLowerCase()));
  const passed = new Set();
  let turns = 0;

  while (turns < 8) {
    if (signal?.aborted) return convo;
    turns += 1;
    let sawTools = false;
    let reply = "";

    const landReply = async () => {
      if (mode !== "act") return;
      const landed = await applyReplyText(workspace, reply, { mode, run, agent, emit, leaseTask }).catch(() => []);
      for (const saved of landed) {
        if (saved.edit) emit({ type: "edit", ...saved.edit, agentId: agent.id });
        if (saved.path) emit({ type: "file_changed", path: saved.path, agentId: agent.id });
      }
    };

    let toolCalls = null;
    for await (const event of streamChat(provider, {
      model,
      messages: convo,
      temperature,
      tools,
      signal,
    })) {
      if (signal?.aborted) return convo;
      if (event.type === "delta") reply += event.text || "";
      if (event.type === "delta" || event.type === "think" || event.type === "stats") emit(event);
      if (event.type === "tool_calls") {
        sawTools = true;
        toolCalls = event.tool_calls;
      }
      if (event.type === "done" && !sawTools) {
        await landReply();
        return convo;
      }
    }

    if (toolCalls) {
      emit({ type: "status", agentId: agent.id, text: actionText(toolCalls[0]) });
      convo.push({
        role: "assistant",
        content: "",
        tool_calls: toolCalls,
      });
      for (const call of toolCalls) {
          if (signal?.aborted) return convo;
          let result;
          try {
            if (call.function.name === "assign_work") {
              if (!allowPass) throw new Error("This task stays with you. Finish it and reply.");
              const args = JSON.parse(call.function.arguments || "{}");
              const list = Array.isArray(args.assignments) ? args.assignments : [];
              if (!list.length) throw new Error("Give each worker a task in assignments.");
              const crew = list.map((item) => {
                const target = findAgent(agents, item.agent);
                return target ? { id: target.id, name: target.name, task: String(item.task || "") } : null;
              }).filter(Boolean);
              if (crew.length) emit({ type: "crew", tasks: crew });
              const settled = await Promise.allSettled(list.map(async (item) => {
                if (signal?.aborted) return "";
                const part = await passTask({ settings, agents, from: agent, args: item, workspace, emit, mode, run, rules, mcp, signal });
                const who = String(item.agent || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
                for (const name of handoff) {
                  if (who && name.replace(/[^a-z0-9]+/g, "") === who) passed.add(name);
                }
                return part;
              }));
              if (signal?.aborted) return convo;
              const parts = settled.map((item) => (
                item.status === "fulfilled" ? item.value : `Tool error: ${item.reason?.message || "The worker failed."}`
              ));
              const waiting = [...handoff].filter((name) => !passed.has(name));
              result = parts.filter(Boolean).join("\n\n");
              if (waiting.length) result += `\n\nStill unassigned: ${waiting.join(", ")}.`;
            } else if (call.function.name === "pass_task" || call.function.name === "ask_agent") {
              if (!allowPass) throw new Error("This task stays with you. Finish it and reply.");
              const args = JSON.parse(call.function.arguments || "{}");
              emit({ type: "status", text: `Passing to ${args.agent || "agent"}…` });
              result = await passTask({ settings, agents, from: agent, args, workspace, emit, mode, run, rules, mcp, signal });
              const who = String(args.agent || args.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
              for (const name of handoff) {
                if (who && name.replace(/[^a-z0-9]+/g, "") === who) passed.add(name);
              }
            } else if (handoff.size && ["edit_file", "write_file", "run_command", "read_file", "search_code"].includes(call.function.name) && passed.size < handoff.size) {
              const waiting = [...handoff].filter((name) => !passed.has(name));
              result = `Do not do this yourself. Call assign_work first for ${waiting.join(", ")}. Give each worker one file. The files must not overlap.`;
            } else {
              const focus = toolPath(call);
              if (focus) emit({ type: "focus", path: focus, agentId: agent.id });
              const outcome = await runTool(workspace, call.function.name, call.function.arguments, {
                mode,
                run,
                search: settings.search,
                agent,
                emit,
                confirmCommand: true,
                leaseTask,
                mcpCall: mcp?.map ? (toolName, toolArgs) => {
                  const hit = mcp.map.get(toolName);
                  if (!hit?.server) throw new Error("That MCP tool is not connected.");
                  return callMcpTool(hit.server, hit.tool, toolArgs);
                } : null,
              });
              if (outcome && typeof outcome === "object") {
                result = outcome.content;
                if (outcome.edit) emit({ type: "edit", ...outcome.edit, agentId: agent.id });
                if (outcome.changed) emit({ type: "file_changed", path: outcome.changed, agentId: agent.id });
              } else {
                result = outcome;
              }
            }
          } catch (err) {
            result = `Tool error: ${err.message}`;
          }
          emit({
            type: "tool_result",
            name: call.function.name,
            result: String(result).slice(0, 4000),
          });
          convo.push({
            role: "tool",
            tool_call_id: call.id,
            content: String(result).slice(0, 12000),
          });
        }
    }

    if (!sawTools) {
      await landReply();
      return convo;
    }
  }
  return convo;
}

async function collectText(provider, opts) {
  let text = "";
  for await (const event of streamChat(provider, opts)) {
    if (event.type === "delta") text += event.text;
  }
  return text.trim();
}

app.post("/api/pass", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  try {
    const settings = await loadSettings();
    const agents = await loadAgents();
    const from = agents.find((item) => item.id === req.body?.fromId) || agents[0];
    const workspace = await ensureWorkspace(settings.workspace);
    const run = beginRun(workspace, req.body?.task || "");
    send(res, { type: "run", id: run.id });
    const cancel = cancelOnDisconnect(req);
    await passTask({
      settings,
      agents,
      from,
      args: { agent: req.body?.to, task: req.body?.task },
      workspace,
      emit: (event) => send(res, event),
      mode: "act",
      run,
      rules: await loadRules(workspace),
      signal: cancel.signal,
    });
    cancel.finish();
    if (!res.writableEnded) {
      send(res, { type: "done" });
      res.end();
    }
  } catch (err) {
    if (stopped(err)) {
      if (!res.writableEnded) {
        send(res, { type: "done", stopped: true });
        res.end();
      }
      return;
    }
    send(res, { type: "error", error: err.message });
    res.end();
  }
});

function mountUi() {
  const dist = process.env.FLINT_DIST;
  if (!dist || !fs.existsSync(path.join(dist, "index.html"))) return;
  app.use(express.static(dist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

export function startServer(port = Number(process.env.PORT || 8787)) {
  mountUi();
  apiToken();
  return new Promise((resolve, reject) => {
  const server = app.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = address && typeof address === "object" ? address.port : port;
      console.log(`Flint API on http://127.0.0.1:${actual}`);
      resolve({ server, port: actual });
    });
    server.on("error", reject);
  });
}

if (!process.versions.electron && !process.env.FLINT_NO_LISTEN) {
  startServer();
}
