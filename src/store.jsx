import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { api, streamPost } from "./api.js";
import { desktop, dirname, relativeTo } from "./desktop.js";
import { checkRelease, DEFAULT_RELEASE_REPO } from "./updates.js";
import { claimStarterTitle, packChats, renameSharedChapters, sessionTitle, shareCrewTitles, tidyChapters, unpackChats } from "./sessions.js";

const AppContext = createContext(null);

if (localStorage.getItem("flint-theme") === "light") {
  document.documentElement.dataset.theme = "light";
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function pathEqual(a, b) {
  return String(a || "").replace(/[\\/]+$/g, "").toLowerCase() === String(b || "").replace(/[\\/]+$/g, "").toLowerCase();
}

function rememberRecent(list, folder) {
  const next = String(folder || "").trim();
  if (!next) return Array.isArray(list) ? list : [];
  return [next, ...(list || []).filter((item) => !pathEqual(item, next))].slice(0, 12);
}

const TREE_SKIP = new Set(["__pycache__", ".pytest_cache", ".venv", "venv", "node_modules", "dist"]);

function tidyTree(nodes) {
  return (nodes || []).flatMap((node) => {
    if (!node || TREE_SKIP.has(node.name) || node.name.startsWith(".")) return [];
    if (/\.(pyc|pyo|pyd)$/i.test(node.name)) return [];
    if (node.type === "dir") return [{ ...node, children: tidyTree(node.children) }];
    return [node];
  });
}

function mergeReplyStats(prev, next) {
  if (!next) return prev || null;
  const base = prev || { in: 0, out: 0, ms: 0, tps: 0, approx: false };
  const inn = (base.in || 0) + (next.in || 0);
  const out = (base.out || 0) + (next.out || 0);
  const ms = (base.ms || 0) + (next.ms || 0);
  const weight = (base.out || 0) + (next.out || 0);
  return {
    in: inn,
    out,
    ms,
    tps: weight
      ? Math.round((((base.tps || 0) * (base.out || 0) + (next.tps || 0) * (next.out || 0)) / weight) * 10) / 10
      : next.tps || 0,
    approx: Boolean(base.approx || next.approx),
  };
}

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [agents, setAgents] = useState([]);
  const [chats, setChats] = useState({});
  const [sessionBooks, setSessionBooks] = useState({});
  const [skills, setSkills] = useState([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const booksRef = useRef({});
  const chatsRef = useRef({});
  const tabsRef = useRef([]);
  const workspaceRef = useRef("");
  const readyRef = useRef(false);
  const settingsRef = useRef(null);
  const [models, setModels] = useState([]);
  const [modelError, setModelError] = useState("");
  const [tree, setTree] = useState([]);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState("");
  const [activeAgentId, setActiveAgentId] = useState("agent");
  const [rightPanel, setRightPanel] = useState("chat");
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState("");
  const [bootError, setBootError] = useState("");
  const [booted, setBooted] = useState(false);
  const [backendStatus, setBackendStatus] = useState({});
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [chatFocus, setChatFocus] = useState(false);
  const [mobileView, setMobileView] = useState("editor");
  const [narrow, setNarrow] = useState(false);
  const [theme, setTheme] = useState(() => (localStorage.getItem("flint-theme") === "light" ? "light" : "dark"));
  const [mode, setModeState] = useState(() => (localStorage.getItem("flint-mode") === "plan" ? "plan" : "act"));
  const [dock, setDock] = useState("");
  const [reviews, setReviews] = useState([]);
  const [lastRunId, setLastRunId] = useState("");
  const [termLog, setTermLog] = useState("");
  const [searchHits, setSearchHits] = useState([]);
  const [dockNote, setDockNote] = useState("");
  const [pendingLine, setPendingLine] = useState(null);
  const [commands, setCommands] = useState([]);
  const [gitText, setGitText] = useState("");
  const [busyAgent, setBusyAgent] = useState("");
  const [activity, setActivity] = useState({});
  const [tasks, setTasks] = useState({});
  const [faults, setFaults] = useState({});
  const [updateInfo, setUpdateInfo] = useState(null);
  const [followed, setFollowed] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("flint-followed") || "null");
      if (!raw || typeof raw !== "object") return {};
      const on = Object.keys(raw).find((key) => raw[key] === true);
      return on ? { [on]: true } : {};
    } catch {
      return {};
    }
  });
  const taskOwner = useRef({});
  const taskTitles = useRef({});
  const chatAbort = useRef(null);
  const followedRef = useRef(followed);
  followedRef.current = followed;
  const activeAgentRef = useRef(activeAgentId);
  activeAgentRef.current = activeAgentId;
  const [touches, setTouches] = useState({});
  const [checkouts, setCheckouts] = useState([]);
  const [askBox, setAskBox] = useState(null);
  const askWait = useRef(null);

  function ask(options) {
    return new Promise((resolve) => {
      askWait.current = resolve;
      setAskBox(options || {});
    });
  }

  function finishAsk(value) {
    const resolve = askWait.current;
    askWait.current = null;
    setAskBox(null);
    if (resolve) resolve(value);
  }
  const touchesRef = useRef(touches);
  touchesRef.current = touches;

  function setAgentActivity(id, text) {
    if (!id) return;
    const next = String(text || "").trim();
    setActivity((prev) => {
      if (!next) {
        if (!prev[id]) return prev;
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      if (prev[id] === next) return prev;
      return { ...prev, [id]: next };
    });
  }

  function watchActivity(leadId, event) {
    const workerId = event.agentId || taskOwner.current[event.taskId] || "";
    if (event.type === "think" || event.type === "delta" || event.type === "status" || event.type === "task_start") {
      setActivity((prev) => {
        const next = { ...prev };
        for (const agent of agents) {
          if (agent.id !== leadId && !next[agent.id] && !taskTitles.current[agent.id]) next[agent.id] = "Waiting";
        }
        return next;
      });
    }
    if (event.type === "think" || event.type === "task_think") setAgentActivity(event.agentId || leadId, "Thinking");
    if (event.type === "delta" || event.type === "task_delta") noteWriting(event.agentId || leadId);
    if (event.type === "status") setAgentActivity(event.agentId || leadId, event.text);
    if (event.type === "focus" && event.path) {
      const file = fileName(event.path);
      if (file) setAgentActivity(event.agentId || leadId, `Reading ${file}`);
    }
    if ((event.type === "edit" || event.type === "file_changed") && event.path) {
      const file = fileName(event.path);
      if (file) setAgentActivity(event.agentId || taskOwner.current.live || leadId, `Editing ${file}`);
    }
    if (event.type === "task_start") {
      taskOwner.current[event.taskId] = event.to?.id || "";
      taskOwner.current.live = event.to?.id || "";
      rememberTask(event.to?.id, event.task);
      setAgentActivity(event.to?.id, "Waiting for the model");
      setActivity((prev) => (
        String(prev[leadId] || "").startsWith("Waiting on")
          ? prev
          : { ...prev, [leadId]: `Waiting on ${event.to?.name || "a worker"}` }
      ));
    }
    if (event.type === "task_status") {
      const concrete = String(event.text || "");
      if (concrete && !/^(Thinking|Writing|Working)$/i.test(concrete)) setAgentActivity(workerId, concrete);
    }
    if (event.type === "task_done") {
      if (taskOwner.current.live === workerId) taskOwner.current.live = "";
      const reason = String(event.error || "").replace(/\s+/g, " ").trim();
      setAgentActivity(workerId, reason ? "Failed" : "Done");
      if (workerId && reason) {
        setFaults((prev) => ({ ...prev, [workerId]: reason.length > 90 ? `${reason.slice(0, 88)}…` : reason }));
      }
    }
    if (event.type === "command") setAgentActivity(event.agentId || taskOwner.current.live || leadId, "Waiting for you");
    if (event.type === "crew") {
      const tasks = Array.isArray(event.tasks) ? event.tasks : [];
      if (tasks.length) setAgentActivity(leadId, tasks.length > 1 ? `Waiting on ${tasks.length} workers` : "Waiting on workers");
      for (const task of tasks) {
        rememberTask(task.id, task.task);
        setAgentActivity(task.id, "Waiting for the model");
      }
    }
  }

  function fileName(path) {
    return String(path || "").split(/[/\\]/).filter(Boolean).pop() || "";
  }

  function finishHandoff(handoff, event) {
    if (handoff.id !== event.taskId) return handoff;
    if (event.agentId && handoff.agentId && handoff.agentId !== event.agentId) return handoff;
    const paths = Array.isArray(event.files) ? event.files.filter(Boolean) : [];
    const files = paths.map((path) => ({
      path,
      agentId: event.agentId || handoff.agentId || "",
      name: handoff.name,
      color: handoff.color,
      kind: "edit",
    }));
    return {
      ...handoff,
      status: event.error ? "error" : "done",
      note: event.error || "",
      reply: event.reply ?? handoff.reply,
      thinking: event.thinking ?? handoff.thinking,
      stats: event.stats || handoff.stats,
      files: files.length ? files : handoff.files,
    };
  }

  function rememberFile(message, file) {
    const files = message.files || [];
    const known = files.some((item) => item.path === file.path && item.agentId === file.agentId);
    const handoffs = (message.handoffs || []).map((handoff) => {
      const byId = file.agentId && handoff.agentId === file.agentId;
      const byName = !handoff.agentId && file.name && handoff.name === file.name;
      if (!byId && !byName) return handoff;
      const owned = handoff.files || [];
      if (owned.some((item) => item.path === file.path)) return handoff;
      return { ...handoff, files: [...owned, file].slice(-8) };
    });
    return {
      ...message,
      files: known ? files : [...files, file].slice(-16),
      handoffs,
    };
  }

  function noteWriting(id) {
    if (!id) return;
    setActivity((prev) => {
      const current = String(prev[id] || "");
      if (current && !/^(Thinking|Waiting|Queued|Writing)/.test(current)) return prev;
      const next = current.startsWith("Writing") ? current : "Writing";
      return current === next ? prev : { ...prev, [id]: next };
    });
  }

  function rememberTask(id, task) {
    if (!id) return;
    const title = taskLabel(task);
    taskTitles.current[id] = title;
    setTasks((prev) => (prev[id] === title ? prev : { ...prev, [id]: title }));
    setActivity((prev) => {
      if (prev[id] !== "Waiting" && prev[id] !== "Queued") return prev;
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }

  function taskLabel(task) {
    const line = String(task || "")
      .split(/\r?\n/)
      .map((row) => row.replace(/^[#>*\-\d.)\s]+/, "").trim())
      .find((row) => row && !/^(objective|files|requirements|acceptance|commands|you are|project goal|worker\s*\d*)\b/i.test(row));
    const text = (line || "Working").replace(/:$/, "").replace(/\s+/g, " ");
    return text.length > 64 ? `${text.slice(0, 62)}…` : text;
  }

  function isFollowing(id) {
    return followedRef.current[id] === true;
  }

  function noteTouch(agentId, path) {
    const id = agentId || "";
    const file = String(path || "").trim();
    if (!id || !file) return;
    const current = touchesRef.current[id] || [];
    if (current[0] !== file) {
      const next = { ...touchesRef.current, [id]: [file, ...current.filter((item) => item !== file)].slice(0, 8) };
      touchesRef.current = next;
      setTouches(next);
    }
    if (isFollowing(id) && id === activeAgentRef.current) openFile(file);
  }

  function toggleFollow(id) {
    if (!id) return;
    const turningOn = followedRef.current[id] !== true;
    const next = turningOn ? { [id]: true } : {};
    followedRef.current = next;
    localStorage.setItem("flint-followed", JSON.stringify(next));
    setFollowed(next);
    if (turningOn) {
      const file = touchesRef.current[id]?.[0];
      if (file) openFile(file);
    }
  }

  function stopOpenWork(prev) {
    let changed = false;
    const next = {};
    for (const [id, list] of Object.entries(prev)) {
      next[id] = (list || []).map((message) => {
        const handoffs = message.handoffs || [];
        const working = handoffs.some((item) => item.status === "working");
        const waiting = /^(Waiting for the model|Waiting|Queued)$/.test(message.status || "");
        if (!working && !waiting) return message;
        changed = true;
        return {
          ...message,
          status: waiting ? "" : message.status,
          handoffs: handoffs.map((item) => (
            item.status === "working" ? { ...item, status: "stopped", note: "Stopped" } : item
          )),
        };
      });
    }
    return changed ? next : prev;
  }

  function stopChat() {
    setChats((prev) => stopOpenWork(prev));
    setActivity((prev) => {
      const next = {};
      for (const [id, line] of Object.entries(prev)) {
        if (line && line !== "Done") next[id] = "Stopped";
      }
      return next;
    });
    setTasks({});
    setFaults({});
    taskTitles.current = {};
    chatAbort.current?.abort();
  }

  async function boot(attempt = 0) {
    const caption = document.getElementById("boot-caption");
    if (caption && attempt > 0) caption.textContent = "Waiting for the local service";
    try {
      const [nextSettings, nextAgents, nextChats, workspace] = await Promise.all([
        api.settings(),
        api.agents(),
        api.chats(),
        api.tree(),
      ]);
      setBootError("");
      setSettings(nextSettings);
      setAgents(nextAgents);
      setActiveAgentId(nextAgents[0]?.id || "");
      const unpacked = unpackChats(nextChats);
      const tidy = tidyChapters(unpacked.books);
      const shared = shareCrewTitles(tidy.books, unpacked.active);
      booksRef.current = shared.books;
      setSessionBooks(shared.books);
      setChats(unpacked.active);
      chatsRef.current = unpacked.active;
      if (tidy.changed || shared.changed) api.saveChats(packChats(shared.books, unpacked.active)).catch(() => {});
      setTree(tidyTree(workspace.tree));
      setWorkspaceRoot(workspace.root || "");
      workspaceRef.current = workspace.root || "";
      try {
        const state = workspace.root ? await api.projectState(workspace.root) : { tabs: [] };
        if (workspace.root) {
          await api.saveProject(workspace.root, { chats: nextChats, tabs: state.tabs || [] });
          const recent = rememberRecent(nextSettings.recent, workspace.root);
          if (!pathEqual(recent[0], nextSettings.recent?.[0])) {
            setSettings(await api.saveSettings({ ...nextSettings, recent }));
          }
        }
        readyRef.current = true;
        for (const rel of state.tabs || []) {
          try {
            await openFile(rel);
          } catch {
            /* that file is gone */
          }
        }
      } catch {
        readyRef.current = true;
      }
      setBooted(true);
      await refreshModels(nextSettings.activeProvider);
      refreshBackendStatus();
      if (nextSettings.updates?.check !== false) checkUpdates(nextSettings);
    } catch (err) {
      if (attempt < 8) {
        setTimeout(() => boot(attempt + 1), 400);
        return;
      }
      setBootError(err.message);
      setBooted(true);
    }
  }

  async function checkUpdates(source = settings) {
    const repo = source?.updates?.repo || DEFAULT_RELEASE_REPO;
    setUpdateInfo({ checking: true, current: "", repo });
    const result = await checkRelease(repo);
    setUpdateInfo(result);
    return result;
  }

  async function refreshModels(provider) {
    try {
      setModelError("");
      const data = await api.models(provider);
      setModels(data.models || []);
    } catch (err) {
      const hint = /fetch failed|ECONNREFUSED|Failed to fetch/i.test(err.message)
        ? "Could not reach the model server. Start Ollama, LM Studio, or your local API, then click Test models."
        : err.message;
      setModels([]);
      setModelError(hint);
    }
  }

  async function refreshBackendStatus() {
    try {
      const data = await api.backendStatus();
      const map = {};
      for (const row of data.backends || []) map[row.id] = row;
      setBackendStatus(map);
      const active = map[settingsRef.current?.activeProvider];
      if (active?.ok) {
        setModelError("");
        if (active.models?.length) setModels(active.models);
      } else if (active) {
        setModelError(active.error === "Timed out"
          ? "The model server did not answer in time."
          : "Could not reach the model server. Start Ollama, LM Studio, or your local API, then click Test models.");
      }
    } catch {
      setBackendStatus({});
    }
  }

  async function refreshTree() {
    const workspace = await api.tree();
    const next = tidyTree(workspace.tree);
    setTree((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setWorkspaceRoot(workspace.root || "");
  }

  async function persistSettings(next) {
    const asked = next?.completion && Object.prototype.hasOwnProperty.call(next.completion, "enabled")
      ? next.completion.enabled === true
      : null;
    const saved = await api.saveSettings(next);
    const merged = {
      ...saved,
      completion: { enabled: asked === null ? saved.completion?.enabled !== false : asked },
    };
    setSettings(merged);
    return merged;
  }

  const agentColors = ["#f4b860", "#7ec8c8", "#e07a5f", "#9b8cff"];

  async function addAgent() {
    const n = agents.length + 1;
    const id = `agent_${Math.random().toString(36).slice(2, 7)}`;
    const agent = {
      id,
      name: n === 1 ? "Agent" : `Agent ${n}`,
      color: agentColors[(n - 1) % agentColors.length],
      provider: "",
      model: "",
      temperature: 0.6,
      followMe: true,
      systemPrompt: "You are a coding agent on the user's machine. Be direct. Prefer working code. Use tools to read and write files in the workspace.",
    };
    await persistAgents([...agents, agent]);
    setActiveAgentId(id);
    setRightPanel("chat");
    setModal("agents");
  }

  async function persistAgents(next) {
    const saved = await api.saveAgents(next);
    setAgents(saved);
    return saved;
  }

  function rememberBooks(next) {
    booksRef.current = next;
    setSessionBooks(next);
  }

  async function persistChats(next) {
    chatsRef.current = next;
    setChats(next);
    const packed = packChats(booksRef.current, next);
    await api.saveChats(packed);
    const folder = workspaceRef.current;
    if (folder) {
      api.saveProject(folder, {
        chats: packed,
        tabs: tabsRef.current.map((tab) => tab.path).filter(Boolean),
      }).catch(() => {});
    }
  }

  function ensureBook(agentId, messages = []) {
    const books = booksRef.current;
    if (books[agentId]?.items?.length) return books[agentId];
    const id = uid("s");
    const book = {
      active: id,
      items: [{ id, title: sessionTitle(messages), created: Date.now(), updated: Date.now(), messages }],
    };
    rememberBooks({ ...books, [agentId]: book });
    return book;
  }

  async function newSession(agentId = activeAgentId) {
    if (!agentId) return;
    const current = ensureBook(agentId, chatsRef.current[agentId] || []);
    const saved = current.items.map((item) => (
      item.id === current.active ? { ...item, messages: chatsRef.current[agentId] || [], updated: Date.now() } : item
    ));
    const id = uid("s");
    const book = {
      active: id,
      items: [...saved, { id, title: "New session", created: Date.now(), updated: Date.now(), messages: [] }],
    };
    rememberBooks({ ...booksRef.current, [agentId]: book });
    await persistChats({ ...chatsRef.current, [agentId]: [] });
  }

  async function openSession(agentId, id) {
    const book = ensureBook(agentId, chatsRef.current[agentId] || []);
    const items = book.items.map((item) => (
      item.id === book.active ? { ...item, messages: chatsRef.current[agentId] || [], updated: Date.now() } : item
    ));
    const next = items.find((item) => item.id === id);
    if (!next) return;
    rememberBooks({ ...booksRef.current, [agentId]: { active: id, items } });
    await persistChats({ ...chatsRef.current, [agentId]: next.messages || [] });
  }

  async function deleteSession(agentId, id) {
    if (!agentId || !id) return;
    const book = ensureBook(agentId, chatsRef.current[agentId] || []);
    const saved = book.items.map((item) => (
      item.id === book.active ? { ...item, messages: chatsRef.current[agentId] || [], updated: Date.now() } : item
    ));
    const rest = saved.filter((item) => item.id !== id);
    if (!rest.length) {
      const freshId = uid("s");
      rememberBooks({
        ...booksRef.current,
        [agentId]: {
          active: freshId,
          items: [{ id: freshId, title: "New session", created: Date.now(), updated: Date.now(), messages: [] }],
        },
      });
      await persistChats({ ...chatsRef.current, [agentId]: [] });
      return;
    }
    const active = id === book.active ? rest[rest.length - 1].id : book.active;
    const chosen = rest.find((item) => item.id === active) || rest[0];
    rememberBooks({ ...booksRef.current, [agentId]: { active: chosen.id, items: rest } });
    await persistChats({
      ...chatsRef.current,
      [agentId]: id === book.active ? (chosen.messages || []) : (chatsRef.current[agentId] || []),
    });
  }

  function adoptStarterTitle(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    ensureBook(toId, chatsRef.current[toId] || []);
    const claimed = claimStarterTitle(booksRef.current, fromId, toId);
    if (!claimed.changed) return;
    rememberBooks(claimed.books);
  }

  async function patchSession(agentId, id, patch) {
    if (!agentId || !id) return;
    const book = booksRef.current[agentId];
    if (!book) return;
    const previous = book.items.find((item) => item.id === id)?.title;
    const items = book.items.map((item) => (
      item.id === id ? { ...item, ...patch, updated: Date.now() } : item
    ));
    let books = { ...booksRef.current, [agentId]: { ...book, items } };
    if (patch.title && patch.titleEdited && previous && previous !== patch.title) {
      books = renameSharedChapters(books, agentId, previous, patch.title, chatsRef.current).books;
    }
    rememberBooks(books);
    await persistChats(chatsRef.current);
  }

  async function forkSession(agentId = activeAgentId) {
    if (!agentId) return;
    const messages = chatsRef.current[agentId] || [];
    const current = ensureBook(agentId, messages);
    const saved = current.items.map((item) => (
      item.id === current.active ? { ...item, messages, updated: Date.now() } : item
    ));
    const id = uid("s");
    const copy = messages.map((message) => ({ ...message, id: uid(message.role === "user" ? "u" : "a") }));
    const book = {
      active: id,
      items: [...saved, { id, title: sessionTitle(copy, "Fork"), created: Date.now(), updated: Date.now(), messages: copy }],
    };
    rememberBooks({ ...booksRef.current, [agentId]: book });
    await persistChats({ ...chatsRef.current, [agentId]: copy });
  }

  function exportSession(agentId = activeAgentId) {
    const messages = chatsRef.current[agentId] || [];
    const book = booksRef.current[agentId];
    const title = book?.items?.find((item) => item.id === book.active)?.title || "Session";
    const body = messages.map((message) => {
      const who = message.role === "user" ? "You" : "Flint";
      return `## ${who}\n\n${message.content || ""}`;
    }).join("\n\n");
    const blob = new Blob([`# ${title}\n\n${body}\n`], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${title.replace(/[^\w.-]+/g, "-").slice(0, 40) || "session"}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function openFile(path) {
    const file = await api.readFile(path);
    setTabs((prev) => {
      if (prev.some((t) => t.path === path)) return prev;
      return [...prev, { path, content: file.content, language: file.language, dirty: false }];
    });
    setActivePath(path);
    if (window.innerWidth < 1040) setMobileView("editor");
  }

  async function renamePath(from, to) {
    const next = String(to || "").trim();
    if (!from || !next || next === from) return;
    await api.renameFile(from, next);
    setTabs((prev) => prev.map((tab) => (tab.path === from ? { ...tab, path: next } : tab)));
    setActivePath((current) => (current === from ? next : current));
    await refreshTree();
  }

  async function deletePath(target) {
    if (!target) return;
    await api.deleteFile(target);
    setTabs((prev) => prev.filter((tab) => tab.path !== target && !tab.path.startsWith(`${target}/`)));
    setActivePath((current) => (current === target || current.startsWith(`${target}/`) ? "" : current));
    await refreshTree();
  }

  async function syncAgentFile(path) {
    if (!path) return;
    refreshTree();
    try {
      const file = await api.readFile(path);
      setTabs((prev) => {
        if (!prev.some((tab) => tab.path === path)) {
          return [...prev, { path, content: file.content, language: file.language, dirty: false }];
        }
        return prev.map((tab) => {
          if (tab.path !== path) return tab;
          if (tab.dirty) return { ...tab, diskNewer: true };
          return { ...tab, content: file.content, language: file.language, dirty: false, diskNewer: false };
        });
      });
      setActivePath(path);
    } catch {
      /* the tree refresh still shows a new folder */
    }
  }

  async function setWorkspace(folder, { closeTabs = true } = {}) {
    if (!folder || !settings) return null;
    const current = workspaceRef.current || settings.workspace;
    const same = pathEqual(current, folder);
    if (!same && current) {
      await api.saveProject(current, {
        chats: packChats(booksRef.current, chatsRef.current),
        tabs: tabsRef.current.map((tab) => tab.path).filter(Boolean),
      });
    }
    const saved = await persistSettings({
      ...settings,
      workspace: folder,
      recent: rememberRecent(settings.recent, folder),
    });
    const state = same ? null : await api.projectState(folder);
    if (!same) {
      const unpacked = unpackChats(state?.chats || {});
      booksRef.current = unpacked.books;
      setSessionBooks(unpacked.books);
      chatsRef.current = unpacked.active;
      setChats(unpacked.active);
      await api.saveChats(packChats(unpacked.books, unpacked.active));
    }
    if (closeTabs) {
      setTabs([]);
      setActivePath("");
    }
    await refreshTree();
    if (!same && closeTabs) {
      for (const rel of state?.tabs || []) {
        try {
          await openFile(rel);
        } catch {
          /* that file is gone */
        }
      }
    }
    return saved;
  }

  async function openWorkspaceFolder() {
    const folder = await desktop.openFolder();
    if (folder) await setWorkspace(folder);
  }

  async function openRecent(folder) {
    if (!folder || !settings) return;
    const state = await api.projectState(folder);
    if (!state.exists) {
      await persistSettings({
        ...settings,
        recent: (settings.recent || []).filter((item) => !pathEqual(item, folder)),
      });
      return;
    }
    if (pathEqual(settings.workspace, folder)) return;
    await setWorkspace(folder);
  }

  async function openLocalFiles(filePaths) {
    const files = filePaths?.length ? filePaths : await desktop.openFiles();
    if (!files?.length || !settings) return;
    let root = settings.workspace;
    const outside = files.some((file) => relativeTo(root, file) == null);
    if (outside) {
      const saved = await setWorkspace(dirname(files[0]));
      root = saved?.workspace || dirname(files[0]);
    }
    for (const file of files) {
      const rel = relativeTo(root, file);
      if (rel) await openFile(rel);
    }
  }

  async function revealActive() {
    if (!workspaceRoot || !activePath) return;
    await desktop.reveal(`${workspaceRoot}\\${activePath.replaceAll("/", "\\")}`);
  }

  function updateTab(path, content) {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, content, dirty: true } : t)));
  }

  async function saveTab(path) {
    let content = null;
    setTabs((prev) => {
      const tab = prev.find((t) => t.path === path);
      content = tab?.content ?? null;
      return prev;
    });
    if (content == null) return;
    await api.writeFile(path, content);
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, dirty: false } : t)));
  }

  function closeTab(path) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activePath === path) setActivePath(next.at(-1)?.path || "");
      return next;
    });
  }

  async function mentionContext(text, openPath) {
    const paths = [...String(text || "").matchAll(/(?:^|\s)@(\S+)/g)].map((match) => match[1]).slice(0, 4);
    const blocks = [];
    for (const rel of paths) {
      if (!rel || rel === openPath) continue;
      try {
        const file = await api.readFile(rel);
        blocks.push(`[File: ${rel}]\n\`\`\`\n${String(file.content || "").slice(0, 4000)}\n\`\`\``);
      } catch {
        /* the name still goes to the model */
      }
    }
    return blocks.join("\n\n");
  }

  async function sendChat(text, images = []) {
    if ((!text.trim() && !images.length) || !settings) return;
    const agentId = activeAgentId;
    const history = chats[agentId] || [];
    const attached = await mentionContext(text, activeTab?.path);
    const context = [
      activeTab ? `[Open file: ${activeTab.path}]\n\`\`\`${activeTab.language}\n${activeTab.content.slice(0, 8000)}\n\`\`\`` : "",
      attached,
    ].filter(Boolean).join("\n\n");
    const book = booksRef.current[agentId];
    if (book && text.trim()) {
      const prior = chatsRef.current[agentId] || [];
      const named = prior.some((message) => message.role === "user" && message.content && !message.passedFrom);
      if (!named) {
        const items = book.items.map((item) => (
          item.id === book.active ? { ...item, title: sessionTitle([{ role: "user", content: text }]) } : item
        ));
        rememberBooks({ ...booksRef.current, [agentId]: { ...book, items } });
      }
    }
    const userMessage = { id: uid("u"), role: "user", content: text, images };
    const assistant = { id: uid("a"), role: "assistant", content: "", thinking: "", status: "", handoffs: [] };
    const nextHistory = [...history, userMessage, assistant];
    setChats((prev) => ({ ...prev, [agentId]: nextHistory }));
    setBusy("chat");
    setBusyAgent(agents.find((item) => item.id === agentId)?.name || "Agent");
    setActivity(Object.fromEntries(agents.map((agent) => [agent.id, agent.id === agentId ? "Thinking" : "Waiting"])));
    setRightPanel("chat");
    const ctrl = new AbortController();
    chatAbort.current = ctrl;

    try {
      const agent = agents.find((a) => a.id === agentId);
      await streamPost("/api/chat", {
        agentId,
        model: agent?.model || settings.defaultModel,
        provider: agent?.provider || settings.activeProvider,
        mode,
        messages: [...history, { role: "user", content: [text, context].filter(Boolean).join("\n\n"), images }].map(({ role, content, images: shots }) => ({
          role,
          content,
          images: shots || undefined,
        })),
        summary: booksRef.current[agentId]?.items?.find((item) => item.id === booksRef.current[agentId]?.active)?.summary || "",
        covered: booksRef.current[agentId]?.items?.find((item) => item.id === booksRef.current[agentId]?.active)?.covered || 0,
      }, (event) => {
        watchActivity(agentId, event);
        if (event.type === "summary" && event.summary) {
          const current = booksRef.current[agentId];
          if (current) {
            const items = current.items.map((item) => (
              item.id === current.active
                ? { ...item, summary: String(event.summary).slice(0, 4000), covered: Number(event.covered) || 0 }
                : item
            ));
            rememberBooks({ ...booksRef.current, [agentId]: { ...current, items } });
          }
        }
        if (event.type === "focus" || event.type === "edit" || event.type === "file_changed") {
          noteTouch(event.agentId || agentId, event.path);
        }
        if (event.type === "delta" || event.type === "think") {
          const key = event.type === "think" ? "thinking" : "content";
          setChats((prev) => ({
            ...prev,
            [agentId]: (prev[agentId] || []).map((m) =>
              m.id === assistant.id ? { ...m, [key]: (m[key] || "") + event.text, status: "" } : m
            ),
          }));
        }
        if (event.type === "stats") {
          setChats((prev) => ({
            ...prev,
            [agentId]: (prev[agentId] || []).map((m) => {
              if (m.id !== assistant.id) return m;
              if (event.live) return { ...m, liveStats: event.stats };
              return { ...m, stats: mergeReplyStats(m.stats, event.stats), liveStats: null };
            }),
          }));
        }
        if (event.type === "task_start") {
          const handoff = {
            id: event.taskId,
            agentId: event.to.id,
            name: event.to.name,
            model: event.to.model,
            color: event.to.color,
            avatar: event.to.avatar || "",
            task: event.task,
            reply: "",
            thinking: "",
            status: "working",
            note: "",
          };
          const incoming = {
            id: event.userMsgId,
            role: "user",
            content: event.task,
            passedFrom: event.from,
          };
          const spoken = { id: event.replyMsgId, role: "assistant", content: "", thinking: "", status: "" };
          adoptStarterTitle(agentId, event.to.id);
          setChats((prev) => ({
            ...prev,
            [agentId]: (prev[agentId] || []).map((m) =>
              m.id === assistant.id ? { ...m, handoffs: [...(m.handoffs || []), handoff], status: "" } : m
            ),
            [event.to.id]: [...(prev[event.to.id] || []), incoming, spoken],
          }));
        }
        if (event.type === "task_delta" || event.type === "task_think") {
          const key = event.type === "task_think" ? "thinking" : "reply";
          const messageKey = event.type === "task_think" ? "thinking" : "content";
          setChats((prev) => {
            const next = { ...prev };
            next[agentId] = (prev[agentId] || []).map((m) =>
              m.id === assistant.id
                ? {
                    ...m,
                    handoffs: (m.handoffs || []).map((h) =>
                      h.id === event.taskId ? { ...h, [key]: (h[key] || "") + event.text } : h
                    ),
                  }
                : m
            );
            for (const id of Object.keys(next)) {
              if (!next[id]?.some((m) => m.id === event.replyMsgId)) continue;
              next[id] = next[id].map((m) =>
                m.id === event.replyMsgId ? { ...m, [messageKey]: (m[messageKey] || "") + event.text } : m
              );
            }
            return next;
          });
        }
        if (event.type === "task_status") {
          setChats((prev) => {
            const next = { ...prev };
            next[agentId] = (prev[agentId] || []).map((m) =>
              m.id === assistant.id
                ? {
                    ...m,
                    handoffs: (m.handoffs || []).map((h) =>
                      h.id === event.taskId ? { ...h, note: event.text } : h
                    ),
                  }
                : m
            );
            if (event.replyMsgId) {
              for (const id of Object.keys(next)) {
                if (!next[id]?.some((m) => m.id === event.replyMsgId)) continue;
                next[id] = next[id].map((m) => (
                  m.id === event.replyMsgId ? { ...m, status: event.text } : m
                ));
              }
            }
            return next;
          });
        }
        if (event.type === "task_stats") {
          setChats((prev) => {
            const next = { ...prev };
            next[agentId] = (prev[agentId] || []).map((m) =>
              m.id === assistant.id
                ? {
                    ...m,
                    handoffs: (m.handoffs || []).map((h) => (
                      h.id === event.taskId
                        ? (event.live ? { ...h, liveStats: event.stats } : { ...h, stats: event.stats, liveStats: null })
                        : h
                    )),
                  }
                : m
            );
            if (event.replyMsgId) {
              for (const id of Object.keys(next)) {
                if (!next[id]?.some((m) => m.id === event.replyMsgId)) continue;
                next[id] = next[id].map((m) => (
                  m.id === event.replyMsgId
                    ? (event.live ? { ...m, liveStats: event.stats } : { ...m, stats: event.stats, liveStats: null })
                    : m
                ));
              }
            }
            return next;
          });
        }
        if (event.type === "task_done") {
          setChats((prev) => {
            const next = { ...prev };
            next[agentId] = (prev[agentId] || []).map((m) =>
              m.id === assistant.id
                ? {
                    ...m,
                    status: "",
                    handoffs: (m.handoffs || []).map((h) => finishHandoff(h, event)),
                  }
                : m
            );
            if (event.replyMsgId) {
              for (const id of Object.keys(next)) {
                if (!next[id]?.some((m) => m.id === event.replyMsgId)) continue;
                next[id] = next[id].map((m) =>
                  m.id === event.replyMsgId
                    ? { ...m, content: event.reply ?? m.content, thinking: event.thinking ?? m.thinking, stats: event.stats || m.stats }
                    : m
                );
              }
            }
            return next;
          });
        }
        if (event.type === "run") setLastRunId(event.id || "");
        if (event.type === "command") {
          const card = {
            id: event.id,
            command: event.command,
            status: "waiting",
            agentId: event.agentId || agentId,
          };
          setCommands((prev) => [...prev.filter((item) => item.id !== card.id), card]);
          setChats((prev) => ({
            ...prev,
            [agentId]: (prev[agentId] || []).map((message) => (
              message.id === assistant.id
                ? { ...message, commands: [...(message.commands || []).filter((item) => item.id !== card.id), card] }
                : message
            )),
          }));
        }
        if (event.type === "edit") {
          setReviews((prev) => [
            ...prev.filter((item) => !(item.runId === event.runId && item.path === event.path)),
            {
              id: event.id,
              runId: event.runId,
              path: event.path,
              patch: event.patch || "",
              hunks: event.hunks || [],
              created: Boolean(event.created),
              agent: event.agent || "",
              color: event.color || "",
              agentId: event.agentId || "",
              status: "open",
            },
          ]);
          setDockNote("");
        }
        if (event.type === "edit" || event.type === "file_changed") {
          const ownerId = event.agentId || agentId;
          const owner = agents.find((item) => item.id === ownerId);
          const file = {
            path: event.path,
            agentId: ownerId,
            name: event.agent || owner?.name || "",
            color: event.color || owner?.color || "",
            kind: event.type === "edit" ? "edit" : "write",
          };
          if (file.path) {
            setChats((prev) => ({
              ...prev,
              [agentId]: (prev[agentId] || []).map((message) => (
                message.id === assistant.id ? rememberFile(message, file) : message
              )),
            }));
          }
        }
        if (event.type === "file_changed") {
          if (/\.(html?|md|svg)$/i.test(event.path || "")) setPreviewOpen(true);
          syncAgentFile(event.path);
        }
        if (event.type === "sources" && event.sources?.length) {
          setChats((prev) => ({
            ...prev,
            [agentId]: (prev[agentId] || []).map((message) => (
              message.id === assistant.id
                ? { ...message, sources: [...(message.sources || []), ...event.sources].slice(0, 8) }
                : message
            )),
          }));
        }
        if (event.type === "worktrees") setCheckouts(event.trees || []);
        if (event.type === "worktree" && event.conflict) {
          setDock("git");
          setDockNote(`${event.agent || "A worker"} left ${fileName(event.conflict)} alone. This folder already has edits there.`);
          if (event.trees) setCheckouts(event.trees);
          setChats((prev) => ({
            ...prev,
            [agentId]: (prev[agentId] || []).map((message) => (
              message.id === assistant.id
                ? {
                    ...message,
                    handoffs: (message.handoffs || []).map((handoff) => (
                      handoff.agentId === event.agentId ? { ...handoff, conflict: event.conflict } : handoff
                    )),
                  }
                : message
            )),
          }));
        }
        if (event.type === "command_output") {
          setTermLog((prev) => `${prev}${event.text || ""}`.slice(-20000));
        }
        if (event.type === "status") {
          const text = String(event.text || "");
          setChats((prev) => ({
            ...prev,
            [agentId]: (prev[agentId] || []).map((m) =>
              m.id === assistant.id ? { ...m, status: text.length < 80 ? text : "Working" } : m
            ),
          }));
        }
        if (event.type === "error") throw new Error(event.error);
      }, ctrl.signal);
      const latest = await new Promise((resolve) => {
        setChats((prev) => {
          resolve(prev);
          return prev;
        });
      });
      await persistChats(latest);
      const spoken = [...(latest[agentId] || [])].reverse().find((message) => message.role === "assistant" && message.content);
      const note = spoken?.content || "";
      setTimeout(() => {
        if (chatAbort.current) return;
        api.remember({ agentId, user: text, assistant: note }).catch(() => {});
      }, 1200);
    } catch (err) {
      const stopped = err.name === "AbortError";
      setChats((prev) => {
        const base = stopped ? stopOpenWork(prev) : prev;
        return {
          ...base,
          [agentId]: (base[agentId] || []).map((m) =>
            m.id === assistant.id
              ? { ...m, content: m.content || (stopped ? "Stopped." : `Error: ${err.message}`), status: "" }
              : m
          ),
        };
      });
    } finally {
      if (chatAbort.current === ctrl) chatAbort.current = null;
      setActivity({});
      setTasks({});
      setFaults({});
      taskTitles.current = {};
      setBusy("");
      setBusyAgent("");
    }
  }

  function applyToEditor(code, suggestedPath) {
    if (suggestedPath && tabs.some((t) => t.path === suggestedPath)) {
      updateTab(suggestedPath, code);
      setActivePath(suggestedPath);
      return;
    }
    if (activePath) {
      updateTab(activePath, code);
      return;
    }
    const scratch = suggestedPath || "scratch.js";
    setTabs((prev) => [...prev, { path: scratch, content: code, language: "javascript", dirty: true }]);
    setActivePath(scratch);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("flint-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }

  function setMode(next) {
    const value = next === "plan" ? "plan" : "act";
    setModeState(value);
    localStorage.setItem("flint-mode", value);
  }

  async function openFileAt(path, line) {
    await openFile(path);
    if (line) setPendingLine({ path, line });
  }

  async function runSearch(query) {
    const text = String(query || "").trim();
    if (!text) {
      setDock("search");
      return;
    }
    setDock("search");
    setDockNote("");
    try {
      const data = await api.search(text);
      setSearchHits(data.hits || []);
      setDockNote(data.hits?.length ? "" : "No matches.");
    } catch (err) {
      setSearchHits([]);
      setDockNote(err.message);
    }
  }

  async function runTerminal(command) {
    const text = String(command || "").trim();
    setDock("term");
    if (!text) return;
    setTermLog((prev) => `${prev}$ ${text}\n`);
    try {
      const result = await api.terminal(text);
      setTermLog((prev) => `${prev}${result.output || "(no output)"}\n`);
    } catch (err) {
      setTermLog((prev) => `${prev}${err.message}\n`);
    }
  }

  async function acceptEdit(item) {
    try {
      await api.acceptEdit(item.runId, item.path);
      setReviews((prev) => prev.map((row) => (
        row.runId === item.runId && row.path === item.path ? { ...row, status: "accepted" } : row
      )));
    } catch (err) {
      setDockNote(err.message);
    }
  }

  async function rejectEdit(item) {
    try {
      await api.rejectEdit(item.runId, item.path);
      setReviews((prev) => prev.map((row) => (
        row.runId === item.runId && row.path === item.path ? { ...row, status: "rejected" } : row
      )));
      if (item.created) {
        setTabs((prev) => {
          const next = prev.filter((tab) => tab.path !== item.path);
          setActivePath((current) => (current === item.path ? next.at(-1)?.path || "" : current));
          return next;
        });
      } else {
        await syncAgentFile(item.path);
      }
      refreshTree();
    } catch (err) {
      setDockNote(err.message);
    }
  }

  async function undoLastRun(id) {
    setDock("review");
    setDockNote("");
    try {
      const result = await api.undoRun(id || lastRunId);
      const restored = result.restored || [];
      const dropped = new Set(restored.filter((file) => file.created).map((file) => file.path));
      setReviews((prev) => prev.filter((item) => item.runId !== result.id));
      setTabs((prev) => {
        const next = prev.filter((tab) => !dropped.has(tab.path));
        setActivePath((current) => (dropped.has(current) ? next.at(-1)?.path || "" : current));
        return next;
      });
      for (const file of restored) {
        if (!file.created) await syncAgentFile(file.path);
      }
      refreshTree();
      setDockNote(restored.length ? `Restored ${restored.length} ${restored.length === 1 ? "file" : "files"}.` : "Nothing changed.");
    } catch (err) {
      setDockNote(err.message);
    }
  }

  function stampCommand(commandId, status, rest = false) {
    setChats((prev) => {
      let changed = false;
      const next = {};
      for (const [agent, list] of Object.entries(prev)) {
        next[agent] = (list || []).map((message) => {
          if (!message.commands?.length) return message;
          const commands = message.commands.map((item) => {
            if (item.id === commandId || (rest && item.status === "waiting")) {
              changed = true;
              return { ...item, status };
            }
            return item;
          });
          return changed ? { ...message, commands } : message;
        });
      }
      return changed ? next : prev;
    });
  }

  async function loadCheckouts() {
    try {
      const live = await api.worktrees();
      setCheckouts(live.worktrees || []);
    } catch {
      setCheckouts([]);
    }
  }

  async function decideCommand(id, approved, always = false, remember = false) {
    const status = approved ? "ran" : "skipped";
    try {
      if (always && settings) {
        await persistSettings({ ...settings, commands: { ...settings.commands, mode: "allow" } });
      }
      const result = await api.decideCommand(id, approved, always, remember);
      if (result?.commands) setSettings((prev) => (prev ? { ...prev, commands: result.commands } : prev));
      setCommands((prev) => prev.map((item) => (
        item.id === id || (always && item.status === "waiting") ? { ...item, status: "ran" } : item
      )).map((item) => (item.id === id ? { ...item, status } : item)));
      stampCommand(id, status, always);
    } catch (err) {
      setCommands((prev) => prev.filter((item) => item.id !== id));
      stampCommand(id, "skipped");
      if (!/no longer waiting/i.test(err.message)) setDockNote(err.message);
    }
  }

  async function setCommandMode(mode) {
    if (!settings) return;
    await persistSettings({ ...settings, commands: { ...settings.commands, mode: mode === "allow" ? "allow" : "ask" } });
  }

  async function rejectHunk(item, hunk) {
    try {
      const result = await api.rejectHunk(item.runId, item.path, hunk);
      setReviews((prev) => prev.map((row) => (
        row.runId === item.runId && row.path === item.path
          ? { ...row, patch: result.patch, hunks: result.hunks || [] }
          : row
      )));
      if (result.created) {
        setTabs((prev) => prev.filter((tab) => tab.path !== item.path));
      } else {
        await syncAgentFile(item.path);
      }
      refreshTree();
    } catch (err) {
      setDockNote(err.message);
    }
  }

  async function loadGit() {
    setDock("git");
    setDockNote("");
    try {
      const data = await api.gitStatus();
      setGitText(data.output || "Clean");
    } catch (err) {
      setGitText(err.message);
    }
  }

  async function commitGit(message) {
    setDock("git");
    try {
      const data = await api.gitCommit(message);
      setGitText(data.output || "Committed");
    } catch (err) {
      setGitText(err.message);
    }
  }

  async function stageBuffer(path, content) {
    const saved = await api.stageEdit(path, content, activeAgentId);
    setLastRunId(saved.runId);
    const edit = saved.edit || {};
    setReviews((prev) => [
      ...prev.filter((item) => !(item.runId === saved.runId && item.path === edit.path)),
      { ...edit, status: "open" },
    ]);
    setDock("review");
    setTabs((prev) => prev.map((tab) => (tab.path === path ? { ...tab, content, dirty: false, diskNewer: false } : tab)));
  }

  async function passPlan(to, task) {
    const text = String(task || "").trim();
    const name = String(to || "").trim();
    if (!text || !name || !settings) return;
    const agentId = activeAgentId;
    const assistant = { id: uid("a"), role: "assistant", content: "", thinking: "", status: "", handoffs: [] };
    const userMessage = { id: uid("u"), role: "user", content: `Pass this plan to ${name}.` };
    setChats((prev) => ({ ...prev, [agentId]: [...(prev[agentId] || []), userMessage, assistant] }));
    setBusy("chat");
    setBusyAgent(agents.find((item) => item.id === agentId)?.name || "Agent");
    setActivity(Object.fromEntries(agents.map((agent) => [agent.id, agent.id === agentId ? "Thinking" : "Waiting"])));
    const ctrl = new AbortController();
    chatAbort.current = ctrl;
    try {
      await streamPost("/api/pass", { fromId: agentId, to: name, task: text }, (event) => {
        watchActivity(agentId, event);
        if (event.type === "run") setLastRunId(event.id || "");
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "task_start") {
          const handoff = {
            id: event.taskId,
            agentId: event.to.id,
            name: event.to.name,
            model: event.to.model,
            color: event.to.color,
            avatar: event.to.avatar || "",
            task: event.task,
            reply: "",
            thinking: "",
            status: "working",
            note: "",
          };
          adoptStarterTitle(agentId, event.to.id);
          setChats((prev) => ({
            ...prev,
            [agentId]: (prev[agentId] || []).map((m) => (
              m.id === assistant.id ? { ...m, handoffs: [...(m.handoffs || []), handoff] } : m
            )),
            [event.to.id]: [...(prev[event.to.id] || []), { id: event.userMsgId, role: "user", content: event.task, passedFrom: event.from }, { id: event.replyMsgId, role: "assistant", content: "", thinking: "" }],
          }));
        }
        if (event.type === "task_done") {
          setChats((prev) => ({
            ...prev,
            [agentId]: (prev[agentId] || []).map((m) => (
              m.id === assistant.id
                ? { ...m, handoffs: (m.handoffs || []).map((h) => finishHandoff(h, event)) }
                : m
            )),
          }));
        }
        if (event.type === "edit") {
          setReviews((prev) => [...prev.filter((item) => !(item.runId === event.runId && item.path === event.path)), { ...event, status: "open" }]);
          setDock("review");
        }
        if (event.type === "file_changed") {
          if (/\.(html?|md|svg)$/i.test(event.path || "")) setPreviewOpen(true);
          syncAgentFile(event.path);
        }
        if (event.type === "command_output") {
          setTermLog((prev) => `${prev}${event.text || ""}`.slice(-20000));
        }
        if (event.type === "command") {
          setCommands((prev) => [...prev.filter((item) => item.id !== event.id), { id: event.id, command: event.command, status: "waiting" }]);
          setDock("term");
        }
        if (event.type === "focus" || event.type === "edit" || event.type === "file_changed") {
          noteTouch(event.agentId || agentId, event.path);
        }
      }, ctrl.signal);
    } catch (err) {
      if (err.name === "AbortError") {
        setChats((prev) => stopOpenWork(prev));
        return;
      }
      setChats((prev) => ({
        ...prev,
        [agentId]: (prev[agentId] || []).map((m) => (m.id === assistant.id ? { ...m, content: m.content || err.message } : m)),
      }));
    } finally {
      if (chatAbort.current === ctrl) chatAbort.current = null;
      setActivity({});
      setTasks({});
      setFaults({});
      taskTitles.current = {};
      setBusy("");
      setBusyAgent("");
    }
  }

  function runSlash(id, arg = "") {
    if (id === "search") return runSearch(arg);
    if (id === "diff") {
      setDock("review");
      return undefined;
    }
    if (id === "undo") return undoLastRun();
    if (id === "plan") {
      setMode("plan");
      return undefined;
    }
    if (id === "act") {
      setMode("act");
      return undefined;
    }
    if (id === "term") return runTerminal(arg);
    if (id === "git") return loadGit();
    if (id === "commit") return commitGit(arg);
    if (id === "pass") {
      const last = [...(chats[activeAgentId] || [])].reverse().find((message) => message.role === "assistant" && message.content);
      return passPlan(arg, last?.content || "");
    }
    if (id === "new") return newSession(activeAgentId);
    if (id === "fork") return forkSession(activeAgentId);
    if (id === "export") {
      exportSession(activeAgentId);
      return undefined;
    }
    const skill = skills.find((item) => item.id === id);
    if (skill) return sendChat([skill.prompt, arg].filter(Boolean).join("\n\n"));
    return undefined;
  }

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!booted) return undefined;
    refreshBackendStatus();
    const timer = setInterval(() => refreshBackendStatus(), 15000);
    return () => clearInterval(timer);
  }, [booted]);

  useEffect(() => {
    const source = new EventSource("/api/workspace/events");
    source.onmessage = () => refreshTree();
    const poll = setInterval(() => refreshTree(), 1200);
    return () => {
      source.close();
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    if (!booted) return;
    const shared = shareCrewTitles(booksRef.current, chatsRef.current);
    if (!shared.changed) return;
    booksRef.current = shared.books;
    setSessionBooks(shared.books);
    api.saveChats(packChats(shared.books, chatsRef.current)).catch(() => {});
  }, [booted, chats]);

  useEffect(() => {
    tabsRef.current = tabs;
    workspaceRef.current = workspaceRoot;
  }, [tabs, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return undefined;
    api.skills().then((data) => setSkills(data.skills || [])).catch(() => setSkills([]));
    return undefined;
  }, [workspaceRoot]);

  const tabKey = tabs.map((tab) => tab.path).join("\n");
  useEffect(() => {
    if (!readyRef.current || !workspaceRoot) return undefined;
    const handle = setTimeout(() => {
      api.saveProject(workspaceRoot, {
        chats: packChats(booksRef.current, chatsRef.current),
        tabs: tabKey ? tabKey.split("\n") : [],
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [workspaceRoot, tabKey]);

  useEffect(() => {
    boot();
    const onResize = () => setNarrow(window.innerWidth < 1040);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const activeTab = tabs.find((t) => t.path === activePath) || null;
  const activeAgent = agents.find((a) => a.id === activeAgentId) || agents[0] || null;
  const value = {
    settings,
    agents,
    chats,
    sessionBooks,
    skills,
    previewOpen,
    setPreviewOpen,
    newSession,
    openSession,
    deleteSession,
    patchSession,
    checkouts,
    loadCheckouts,
    forkSession,
    exportSession,
    models,
    modelError,
    tree,
    workspaceRoot,
    tabs,
    activePath,
    activeTab,
    activeAgentId,
    activeAgent,
    rightPanel,
    modal,
    busy,
    bootError,
    booted,
    backendStatus,
    leftOpen,
    rightOpen,
    chatFocus,
    setChatFocus,
    mobileView,
    narrow,
    setLeftOpen,
    setRightOpen,
    setMobileView,
    setActivePath,
    setActiveAgentId,
    setRightPanel,
    setModal,
    persistSettings,
    persistAgents,
    addAgent,
    persistChats,
    refreshModels,
    refreshBackendStatus,
    refreshTree,
    openFile,
    renamePath,
    deletePath,
    updateTab,
    saveTab,
    closeTab,
    sendChat,
    applyToEditor,
    boot,
    openWorkspaceFolder,
    openRecent,
    openLocalFiles,
    setWorkspace,
    revealActive,
    isDesktop: desktop.isDesktop,
    theme,
    toggleTheme,
    mode,
    setMode,
    dock,
    setDock,
    reviews,
    termLog,
    searchHits,
    dockNote,
    pendingLine,
    setPendingLine,
    openFileAt,
    runSearch,
    runTerminal,
    acceptEdit,
    rejectEdit,
    undoLastRun,
    runSlash,
    commands,
    decideCommand,
    setCommandMode,
    rejectHunk,
    gitText,
    loadGit,
    commitGit,
    stageBuffer,
    passPlan,
    busyAgent,
    activity,
    tasks,
    faults,
    updateInfo,
    checkUpdates,
    stopChat,
    followed,
    toggleFollow,
    touches,
    askBox,
    ask,
    finishAsk,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
