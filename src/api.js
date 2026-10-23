async function json(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  health: () => json("/api/health"),
  settings: () => json("/api/settings"),
  saveSettings: (body) => json("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  models: (provider) => json(`/api/models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
  backendStatus: () => json("/api/backends/status"),
  probeBackend: (body) => json("/api/backends/probe", { method: "POST", body: JSON.stringify(body) }),
  agents: () => json("/api/agents"),
  saveAgents: (body) => json("/api/agents", { method: "PUT", body: JSON.stringify(body) }),
  chats: () => json("/api/chats"),
  saveChats: (body) => json("/api/chats", { method: "PUT", body: JSON.stringify(body) }),
  projectState: (path) => json(`/api/projects/state?path=${encodeURIComponent(path)}`),
  saveProject: (path, body) => json("/api/projects/state", { method: "PUT", body: JSON.stringify({ path, ...body }) }),
  tree: () => json("/api/workspace/tree"),
  readFile: (path) => json(`/api/workspace/file?path=${encodeURIComponent(path)}`),
  writeFile: (path, content) =>
    json("/api/workspace/file", { method: "PUT", body: JSON.stringify({ path, content }) }),
  newFile: (path, type) =>
    json("/api/workspace/new", { method: "POST", body: JSON.stringify({ path, type }) }),
  search: (query) => json("/api/search", { method: "POST", body: JSON.stringify({ query }) }),
  terminal: (command) => json("/api/terminal", { method: "POST", body: JSON.stringify({ command }) }),
  undoRun: (id) => json("/api/runs/undo", { method: "POST", body: JSON.stringify({ id }) }),
  runs: () => json("/api/runs"),
  problems: () => json("/api/problems"),
  lspSync: (body) => json("/api/lsp/sync", { method: "POST", body: JSON.stringify(body) }),
  lspComplete: (body) => json("/api/lsp/complete", { method: "POST", body: JSON.stringify(body) }),
  runTests: () => json("/api/tests/run", { method: "POST", body: "{}" }),
  rejectEdit: (runId, path) => json("/api/edits/reject", { method: "POST", body: JSON.stringify({ runId, path }) }),
  acceptEdit: (runId, path) => json("/api/edits/accept", { method: "POST", body: JSON.stringify({ runId, path }) }),
  rejectHunk: (runId, path, hunk) => json("/api/edits/hunk", { method: "POST", body: JSON.stringify({ runId, path, hunk }) }),
  stageEdit: (path, content, agentId) => json("/api/edits/stage", { method: "POST", body: JSON.stringify({ path, content, agentId }) }),
  decideCommand: (id, approved, always = false, remember = false) => json("/api/commands/decide", { method: "POST", body: JSON.stringify({ id, approved, always, remember }) }),
  shells: () => json("/api/terminal/shells"),
  openShell: (shell) => json("/api/terminal/session", { method: "POST", body: JSON.stringify({ shell }) }),
  shellInput: (id, data) => json("/api/terminal/input", { method: "POST", body: JSON.stringify({ id, data }) }),
  resizeShell: (id, cols, rows) => json("/api/terminal/resize", { method: "POST", body: JSON.stringify({ id, cols, rows }) }),
  complete: (body, signal) => json("/api/complete", { method: "POST", body: JSON.stringify(body), signal }),
  skills: () => json("/api/skills"),
  tasks: () => json("/api/tasks"),
  remember: (body) => json("/api/memory", { method: "POST", body: JSON.stringify(body) }),
  notes: () => json("/api/memory"),
  saveNote: (name, body) => json("/api/memory", { method: "PUT", body: JSON.stringify({ name, body }) }),
  deleteNote: (name) => json("/api/memory", { method: "DELETE", body: JSON.stringify({ name }) }),
  renameFile: (from, to) => json("/api/workspace/rename", { method: "POST", body: JSON.stringify({ from, to }) }),
  deleteFile: (path) => json("/api/workspace/file", { method: "DELETE", body: JSON.stringify({ path }) }),
  branches: () => json("/api/git/branches"),
  checkout: (name, create = false) => json("/api/git/checkout", { method: "POST", body: JSON.stringify({ name, create }) }),
  pull: () => json("/api/git/pull", { method: "POST", body: "{}" }),
  push: () => json("/api/git/push", { method: "POST", body: "{}" }),
  worktrees: () => json("/api/worktrees"),
  startPreview: () => json("/api/preview", { method: "POST", body: "{}" }),
  startProject: () => json("/api/preview/project", { method: "POST", body: "{}" }),
  projectStatus: () => json("/api/preview/project"),
  stopProject: () => json("/api/preview/project", { method: "DELETE" }),
  closeShell: (id) => json("/api/terminal/session", { method: "DELETE", body: JSON.stringify({ id }) }),
  gitStatus: () => json("/api/git/status"),
  gitCommit: (message) => json("/api/git/commit", { method: "POST", body: JSON.stringify({ message }) }),
  inline: (body) => json("/api/inline", { method: "POST", body: JSON.stringify(body) }),
};

export async function streamPost(path, body, onEvent, signal) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Stream failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const lines = chunk.split(/\n/).map((row) => row.replace(/^data:\s*/, "").trim()).filter((row) => row && !row.startsWith(":"));
      for (const line of lines) {
        try {
          onEvent(JSON.parse(line));
        } catch {
          /* ignore a keepalive or a partial frame */
        }
      }
    }
  }
}
