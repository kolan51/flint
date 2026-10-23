import { commandAllowed } from "./commands.js";
import { loadSettings } from "./store.js";
import { listTree, readFile } from "./workspace.js";
import {
  assertLease,
  commitFile,
  gitRun,
  leasePath,
  noteJournal,
  proposeCommand,
  runCommand,
  searchWorkspace,
  startJob,
  webFetch,
  webSearch,
} from "./studio.js";
import { searchIndex } from "./codeIndex.js";
import { runHook } from "./hooks.js";

const listDir = {
  type: "function",
  function: {
    name: "list_dir",
    description: "List files and folders in the workspace. Omit path for the root.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative folder path" } },
    },
  },
};

const readFileTool = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read a text file from the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
};

const searchCode = {
  type: "function",
  function: {
    name: "search_code",
    description: "Find code in the project. Exact text and the local code index both run. Returns file paths, line numbers, and a short snippet.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Text to find, such as a function name" } },
      required: ["query"],
    },
  },
};

const editFile = {
  type: "function",
  function: {
    name: "edit_file",
    description: "Replace one exact span in a file. Copy old from the file, including enough lines to match once. Do not use this to rewrite a whole file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old: { type: "string", description: "Exact existing text to replace" },
        new: { type: "string", description: "Text to put in its place" },
      },
      required: ["path", "old", "new"],
    },
  },
};

const writeFileTool = {
  type: "function",
  function: {
    name: "write_file",
    description: "Create a new text file, or replace a whole file when edit_file cannot express the change.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
};

const runCommandTool = {
  type: "function",
  function: {
    name: "run_command",
    description: "Run a command in the project folder and read its output. It may run for up to 10 minutes. Set background true for a long build so the turn can finish while the output keeps collecting.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        background: { type: "boolean", description: "Leave the command running after this turn" },
      },
      required: ["command"],
    },
  },
};

const webSearchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web. Flint runs the search. The model server does not. Use this for docs, error strings, and library APIs, then web_fetch the best link.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

const gitStatusTool = {
  type: "function",
  function: {
    name: "git_status",
    description: "Show git status and a diff summary for the project.",
    parameters: { type: "object", properties: {} },
  },
};

const gitDiffTool = {
  type: "function",
  function: {
    name: "git_diff",
    description: "Show the git diff. Pass a path to limit it to one file.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
    },
  },
};

const webFetchTool = {
  type: "function",
  function: {
    name: "web_fetch",
    description: "Read the text of one http or https page. Use it after web_search, on the single best link.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
};

const passTask = {
  type: "function",
  function: {
    name: "pass_task",
    description: "Hand one piece of work to one other agent and wait for the result. Prefer assign_work when several workers should share a job.",
    parameters: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Exact agent name, such as Worker1" },
        task: { type: "string", description: "Standalone task: goal, files they may change, and what to send back" },
      },
      required: ["agent", "task"],
    },
  },
};

function workerRole(agent) {
  const line = String(agent?.systemPrompt || "").split("\n").find((row) => row.trim()) || agent?.name || "worker";
  return line.replace(/^You are\s+/i, "").replace(/\.$/, "").slice(0, 90);
}

export function assignWorkTool(workers = []) {
  const list = workers.map((agent) => `${agent.name}: ${workerRole(agent)}`).join("; ");
  return {
    type: "function",
    function: {
      name: "assign_work",
      description: workers.length
        ? `Split this job across the workers and wait for each result. Call this once before you edit files or run commands. Available workers: ${list}. Give every worker a different piece.`
        : "No other workers are available.",
      parameters: {
        type: "object",
        properties: {
          assignments: {
            type: "array",
            description: "One entry per worker",
            items: {
              type: "object",
              properties: {
                agent: { type: "string" },
                task: { type: "string" },
              },
              required: ["agent", "task"],
            },
          },
        },
        required: ["assignments"],
      },
    },
  };
}

const reading = [listDir, readFileTool, searchCode, webSearchTool, webFetchTool, gitStatusTool, gitDiffTool];
const writing = [editFile, writeFileTool, runCommandTool];

export function toolsFor(mode, allowPass, workers = []) {
  const pass = allowPass ? [passTask, assignWorkTool(workers)] : [];
  if (mode === "plan") return [...reading, ...pass];
  return [...reading, ...writing, ...pass];
}

export const agentTools = toolsFor("act", true);

const WRITING = new Set(["edit_file", "write_file", "run_command"]);

function flattenTree(nodes, prefix = "") {
  const lines = [];
  for (const node of nodes) {
    lines.push(`${prefix}${node.type === "dir" ? node.name + "/" : node.name}`);
    if (node.children?.length) lines.push(...flattenTree(node.children, `${prefix}  `));
  }
  return lines;
}

function findSpan(current, old) {
  const exact = tryLocate(current, old);
  if (exact) return { text: current, ...exact };
  if (current.includes("\r\n")) {
    const crlf = old.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    const span = tryLocate(current, crlf);
    if (span) return { text: current, ...span };
  }
  return null;
}

function tryLocate(text, old) {
  if (!old) return null;
  const at = text.indexOf(old);
  if (at < 0) return null;
  if (text.indexOf(old, at + old.length) >= 0) {
    throw new Error("That span matched more than once. Include more surrounding lines.");
  }
  return { at, old };
}

export async function runTool(workspace, name, rawArgs, ctx = {}) {
  const args = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : rawArgs || {};
  if (ctx.mode === "plan" && WRITING.has(name)) {
    throw new Error("Plan mode can search and read. It cannot edit files or run commands.");
  }
  if (name === "list_dir") {
    const tree = await listTree(workspace, args.path || "", 0, 8);
    return flattenTree(tree).join("\n") || "(empty)";
  }
  if (name === "read_file") return readFile(workspace, args.path);
  if (name === "search_code") {
    const query = args.query || args.q || "";
    noteJournal(workspace, `search: ${query}`);
    const [literal, indexed] = await Promise.all([
      searchWorkspace(workspace, query),
      searchIndex(workspace, query).catch(() => []),
    ]);
    const seen = new Set();
    const hits = [];
    for (const hit of [...indexed, ...literal]) {
      const key = `${hit.path}:${hit.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
      if (hits.length >= 30) break;
    }
    if (!hits.length) return "No matches.";
    return hits.map((hit) => `${hit.path}:${hit.line}: ${hit.text}`).join("\n");
  }
  if (name === "edit_file") {
    const rel = args.path;
    let current;
    try {
      current = await readFile(workspace, rel);
    } catch {
      throw new Error(`No file at ${rel}. Use write_file to create it.`);
    }
    const old = String(args.old ?? args.old_string ?? "");
    const next = String(args.new ?? args.new_string ?? "");
    if (!old) throw new Error("old text is empty. Copy the span from the file.");
    let span;
    try {
      span = findSpan(current, old);
    } catch (err) {
      throw err;
    }
    if (!span) throw new Error("That span was not in the file. Read it and copy the exact text.");
    const updated = span.text.slice(0, span.at) + next + span.text.slice(span.at + span.old.length);
    const saved = await saveEdit(workspace, ctx, rel, updated);
    return { content: `Edited ${saved.path} (${saved.bytes} bytes)`, edit: saved.edit, changed: saved.path };
  }
  if (name === "write_file") {
    const saved = await saveEdit(workspace, ctx, args.path, args.content ?? "");
    return { content: `Wrote ${saved.path} (${saved.bytes} bytes)`, edit: saved.edit, changed: saved.path };
  }
  if (name === "run_command") {
    const command = String(args.command || "");
    const live = ctx.confirmCommand ? await loadSettings() : null;
    const ask = ctx.confirmCommand && live?.commands?.mode !== "allow" && !commandAllowed(command, live?.commands?.allow);
    if (ask) {
      const pending = proposeCommand(command);
      const gate = await pending.shown;
      if (!gate?.skip) {
        ctx.emit?.({ type: "status", agentId: ctx.agent?.id || "", text: "Waiting for you" });
        ctx.emit?.({
          type: "command",
          id: pending.id,
          command,
          status: "waiting",
          agentId: ctx.agent?.id || "",
          agent: ctx.agent?.name || "",
        });
        const decision = await pending.promise;
        if (!decision.approved) {
          noteJournal(workspace, `skipped command: ${command}`);
          return "The user skipped this command.";
        }
      }
    }
    const background = args.background === true || args.background === "true";
    if (background) {
      const job = startJob(workspace, command);
      ctx.emit?.({ type: "command_output", text: `\n$ ${command}\nbackground ${job.id}\n` });
      noteJournal(workspace, `background ${job.id}: ${command}`);
      return `Started in the background (${job.id}). The turn can finish. Output collects in the terminal.`;
    }
    const result = await runCommand(workspace, command, 600000, (text) => {
      ctx.emit?.({ type: "command_output", text });
    });
    const tail = result.output.length > 6000 ? result.output.slice(-6000) : result.output;
    noteJournal(workspace, `command exit ${result.code ?? "?"}: ${command}`);
    await runHook(workspace, "command", { command, code: result.code });
    return `exit ${result.code ?? "?"}\n${tail}`;
  }
  if (name === "web_search") {
    const query = args.query || args.q || "";
    noteJournal(workspace, `web search: ${query}`);
    const found = await webSearch(query, ctx.search);
    const text = typeof found === "string" ? found : found.text;
    if (found?.sources?.length) ctx.emit?.({ type: "sources", sources: found.sources });
    return text;
  }
  if (name === "web_fetch") {
    noteJournal(workspace, `web fetch: ${args.url || ""}`);
    return webFetch(args.url || "");
  }
  if (name === "git_status") {
    const result = await gitRun(workspace, ["status", "--short"]);
    const stat = await gitRun(workspace, ["diff", "--stat"]);
    return [result.output, stat.output].filter(Boolean).join("\n") || "Clean";
  }
  if (name === "git_diff") {
    const result = await gitRun(workspace, args.path ? ["diff", "--", args.path] : ["diff"]);
    return result.output.slice(0, 8000);
  }
  if (name.startsWith("mcp_") && ctx.mcpCall) return ctx.mcpCall(name, args);
  throw new Error(`Unknown tool: ${name}`);
}

async function saveEdit(workspace, ctx, rel, content) {
  assertLease(rel, ctx.agent?.id || "");
  const saved = await commitFile(workspace, ctx.run, rel, content, { name: ctx.agent?.name || "", color: ctx.agent?.color || "" });
  if (ctx.leaseTask) leasePath(saved.path, { agentId: ctx.agent?.id || "", name: ctx.agent?.name || "Agent", taskId: ctx.leaseTask });
  noteJournal(workspace, `${ctx.agent?.name || "Agent"} edited ${saved.path}`);
  await runHook(workspace, "edit", { path: saved.path, agent: ctx.agent?.name || "" });
  return saved;
}
