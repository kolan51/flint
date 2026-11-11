import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const TASK_VERSION = 1;

export const TASK_STATUSES = [
  "draft",
  "awaiting_approval",
  "approved",
  "implementing",
  "verifying",
  "review",
  "completed",
  "failed",
  "blocked",
  "cancelled",
];

const TRANSITIONS = {
  draft: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["approved", "draft", "cancelled"],
  approved: ["implementing", "verifying", "cancelled"],
  implementing: ["verifying", "blocked", "failed", "cancelled"],
  verifying: ["review", "blocked", "failed", "implementing"],
  review: ["completed", "implementing", "blocked", "cancelled"],
  completed: ["draft"],
  failed: ["draft", "approved", "cancelled"],
  blocked: ["implementing", "verifying", "cancelled", "draft"],
  cancelled: ["draft"],
};

function tasksDir(workspace) {
  return path.join(workspace, ".flint", "tasks");
}

function taskPath(workspace, id) {
  return path.join(tasksDir(workspace), `${id}.json`);
}

function stamp() {
  return new Date().toISOString();
}

function cleanList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function shapeTask(raw = {}) {
  const now = stamp();
  const status = TASK_STATUSES.includes(raw.status) ? raw.status : "draft";
  return {
    version: TASK_VERSION,
    id: String(raw.id || `task_${crypto.randomBytes(4).toString("hex")}`),
    title: String(raw.title || "Untitled task").trim().slice(0, 120) || "Untitled task",
    description: String(raw.description || "").trim().slice(0, 4000),
    request: String(raw.request || "").trim().slice(0, 4000),
    goals: cleanList(raw.goals),
    nonGoals: cleanList(raw.nonGoals),
    acceptance: cleanList(raw.acceptance),
    constraints: cleanList(raw.constraints),
    files: cleanList(raw.files),
    plan: cleanList(raw.plan),
    dependencies: cleanList(raw.dependencies),
    agentId: String(raw.agentId || ""),
    model: String(raw.model || ""),
    status,
    verification: {
      checks: Array.isArray(raw.verification?.checks) ? raw.verification.checks.slice(0, 20) : [],
      requirePass: raw.verification?.requirePass !== false,
    },
    history: Array.isArray(raw.history) ? raw.history.slice(-40) : [],
    verificationReport: raw.verificationReport || null,
    worktreeId: String(raw.worktreeId || ""),
    approval: {
      required: raw.approval?.required !== false,
      approvedAt: raw.approval?.approvedAt || "",
      approvedBy: raw.approval?.approvedBy || "",
    },
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

async function writeTask(workspace, task) {
  const dir = tasksDir(workspace);
  await fs.mkdir(dir, { recursive: true });
  const next = { ...task, updatedAt: stamp() };
  await fs.writeFile(taskPath(workspace, next.id), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function note(task, text, extra = {}) {
  const history = [...(task.history || []), { at: stamp(), text, ...extra }].slice(-40);
  return { ...task, history };
}

export async function listTasks(workspace) {
  const dir = tasksDir(workspace);
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const tasks = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
      tasks.push(shapeTask(raw));
    } catch {
      /* skip broken task files */
    }
  }
  return tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getTask(workspace, id) {
  try {
    return shapeTask(JSON.parse(await fs.readFile(taskPath(workspace, id), "utf8")));
  } catch {
    return null;
  }
}

export async function createTask(workspace, input = {}) {
  const task = shapeTask({
    ...input,
    status: input.status || "draft",
    history: [{ at: stamp(), text: "Created" }],
  });
  return writeTask(workspace, task);
}

export async function updateTask(workspace, id, patch = {}) {
  const current = await getTask(workspace, id);
  if (!current) throw new Error("Task not found.");
  const next = shapeTask({
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    history: current.history,
    verificationReport: patch.verificationReport === undefined ? current.verificationReport : patch.verificationReport,
  });
  return writeTask(workspace, note(next, "Updated"));
}

export async function setTaskStatus(workspace, id, status, extra = {}) {
  const current = await getTask(workspace, id);
  if (!current) throw new Error("Task not found.");
  const nextStatus = String(status || "");
  if (!TASK_STATUSES.includes(nextStatus)) throw new Error(`Unknown task status: ${nextStatus}`);
  if (nextStatus === "completed") {
    const report = extra.verificationReport || current.verificationReport;
    if (current.verification?.requirePass !== false) {
      if (!report || report.failed?.length || !report.passed?.length) {
        throw new Error("A task cannot complete without a passing verification report.");
      }
    }
  }
  const allowed = TRANSITIONS[current.status] || [];
  if (current.status !== nextStatus && !allowed.includes(nextStatus)) {
    throw new Error(`Cannot move a task from ${current.status} to ${nextStatus}.`);
  }
  let next = shapeTask({
    ...current,
    ...extra,
    status: nextStatus,
    id: current.id,
    createdAt: current.createdAt,
    history: current.history,
  });
  next = note(next, `Status → ${nextStatus}`, { status: nextStatus });
  return writeTask(workspace, next);
}

export async function approveTask(workspace, id) {
  const current = await getTask(workspace, id);
  if (!current) throw new Error("Task not found.");
  if (current.status !== "draft" && current.status !== "awaiting_approval") {
    throw new Error("Only a draft or awaiting task can be approved.");
  }
  let next = shapeTask({
    ...current,
    status: "approved",
    approval: { ...current.approval, approvedAt: stamp(), approvedBy: "user" },
  });
  next = note(next, "Approved");
  return writeTask(workspace, next);
}

function titleFrom(request) {
  const line = String(request || "").trim().split(/\r?\n/)[0].replace(/\s+/g, " ");
  if (!line) return "Untitled task";
  return line.slice(0, 72);
}

export async function proposeTask(workspace, { request, map = "", verification = null, agentId = "", model = "" } = {}) {
  const text = String(request || "").trim();
  if (!text) throw new Error("Write what the task should do.");
  const files = [...new Set(String(map || "").split(/\r?\n/).filter((line) => line && !/^\s/.test(line)))].slice(0, 12);
  const checks = verification?.checks || [];
  const task = shapeTask({
    title: titleFrom(text),
    description: text,
    request: text,
    goals: [text.slice(0, 160)],
    nonGoals: ["Unrelated refactors", "Dependency upgrades unless required"],
    acceptance: [
      "The requested behavior works in the open folder",
      "Existing verification checks that still apply still pass",
      checks.length ? `Verification includes: ${checks.map((item) => item.name).join(", ")}` : "Verification steps are reviewed before run",
    ],
    constraints: ["Stay inside the open folder", "Keep diffs reviewable"],
    files,
    plan: [
      "Inspect the ranked files and existing patterns",
      "Implement the smallest change that meets acceptance",
      "Run the configured verification checks",
      "Leave the result in review until it is kept",
    ],
    dependencies: [],
    agentId,
    model,
    status: "awaiting_approval",
    verification: {
      checks,
      requirePass: true,
    },
    history: [{ at: stamp(), text: "Proposed from chat request" }],
  });
  return writeTask(workspace, task);
}
