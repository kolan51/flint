import { getTask, setTaskStatus, updateTask } from "./tasks.js";
import { runVerification, detectVerification } from "./verify.js";
import { routeCrew } from "./modelRouter.js";
import { agentRole } from "./tools.js";

const MAX_REPAIR = 2;

function stamp() {
  return new Date().toISOString();
}

function activity(task, text, extra = {}) {
  const history = [...(task.history || []), { at: stamp(), text, kind: "activity", ...extra }].slice(-40);
  return { ...task, history };
}

export function pickCrew(agents, settings) {
  const routed = routeCrew(settings, agents);
  const byRole = {};
  for (const agent of agents || []) {
    const role = agentRole(agent);
    if (!byRole[role]) byRole[role] = agent;
  }
  const resolve = (job) => {
    const route = routed[job];
    if (route?.agentId) return { ...(agents || []).find((item) => item.id === route.agentId), route };
    if (byRole[job]) return { ...byRole[job], route: { ...route, agentId: byRole[job].id, reason: `Seat ${job}.` } };
    return null;
  };
  return {
    architect: resolve("architect") || resolve("lead"),
    implementer: resolve("implementer") || resolve("apply") || (agents || [])[0],
    verifier: resolve("verifier"),
    reviewer: resolve("reviewer"),
    routes: routed,
  };
}

export async function runTaskOrchestration(workspace, taskId, { settings, agents, signal } = {}) {
  let task = await getTask(workspace, taskId);
  if (!task) throw new Error("Task not found.");
  if (signal?.aborted) throw new Error("Cancelled.");

  if (task.status === "awaiting_approval" || task.status === "draft") {
    throw new Error("Approve the task before running the crew.");
  }

  const crew = pickCrew(agents || [], settings || {});
  const assignment = {
    architect: crew.architect ? { id: crew.architect.id, name: crew.architect.name, reason: crew.architect.route?.reason || "" } : null,
    implementer: crew.implementer ? { id: crew.implementer.id, name: crew.implementer.name, reason: crew.implementer.route?.reason || "" } : null,
    verifier: crew.verifier ? { id: crew.verifier.id, name: crew.verifier.name, reason: crew.verifier.route?.reason || "" } : null,
    reviewer: crew.reviewer ? { id: crew.reviewer.id, name: crew.reviewer.name, reason: crew.reviewer.route?.reason || "" } : null,
  };

  task = await updateTask(workspace, taskId, {
    assignment,
    routing: crew.routes,
    agentId: assignment.implementer?.id || task.agentId,
    model: crew.implementer?.model || task.model,
  });
  task = activity(task, "Crew assigned", { assignment });
  await updateTask(workspace, taskId, { history: task.history, assignment, routing: crew.routes });

  if (assignment.architect) {
    task = activity(task, `${assignment.architect.name}: Planning`, { job: "architect" });
    const plan = task.plan?.length
      ? task.plan
      : [
        "Inspect ranked files and acceptance criteria",
        "Implement the smallest change that meets acceptance",
        "Run verification without rewriting the criteria",
      ];
    task = await updateTask(workspace, taskId, {
      plan,
      history: [...task.history, { at: stamp(), text: `${assignment.architect.name}: Plan ready`, job: "architect", plan }],
    });
  }

  if (task.status === "approved" || task.status === "blocked" || task.status === "failed") {
    task = await setTaskStatus(workspace, taskId, "implementing");
  }
  if (assignment.implementer) {
    task = await updateTask(workspace, taskId, {
      history: [...(task.history || []), {
        at: stamp(),
        text: `${assignment.implementer.name}: Implementing`,
        job: "implementer",
        kind: "activity",
      }],
    });
  }

  let attempts = Number(task.repairAttempts || 0);
  let report = null;
  while (attempts <= MAX_REPAIR) {
    if (signal?.aborted) throw new Error("Cancelled.");
    if (task.status !== "verifying") {
      task = await setTaskStatus(workspace, taskId, "verifying");
    }
    if (assignment.verifier) {
      task = await updateTask(workspace, taskId, {
        history: [...(task.history || []), {
          at: stamp(),
          text: `${assignment.verifier.name}: Running checks`,
          job: "verifier",
          kind: "activity",
        }],
      });
    }
    const checks = task.verification?.checks?.length
      ? task.verification.checks
      : (await detectVerification(workspace)).checks;
    report = await runVerification(workspace, {
      checks,
      settings,
      allowed: settings?.commands?.mode === "allow",
    });
    if (!report.failed.length && (report.passed.length || report.skipped.length || report.unavailable.length)) {
      if (!report.passed.length && report.skipped.length) {
        task = await setTaskStatus(workspace, taskId, "blocked", { verificationReport: report, repairAttempts: attempts });
        return { task, report, crew: assignment, stopped: "Verification was skipped until commands are allowed." };
      }
      if (!report.passed.length && report.unavailable.length && !report.skipped.length) {
        task = await setTaskStatus(workspace, taskId, "blocked", { verificationReport: report, repairAttempts: attempts });
        return { task, report, crew: assignment, stopped: "No verification checks are available for this folder." };
      }
      break;
    }
    attempts += 1;
    if (attempts > MAX_REPAIR) {
      task = await setTaskStatus(workspace, taskId, "blocked", { verificationReport: report, repairAttempts: attempts });
      return { task, report, crew: assignment, stopped: `Verification failed after ${MAX_REPAIR} repair attempts.` };
    }
    task = await setTaskStatus(workspace, taskId, "implementing", { verificationReport: report, repairAttempts: attempts });
    task = await updateTask(workspace, taskId, {
      history: [...(task.history || []), {
        at: stamp(),
        text: `Repair loop ${attempts}/${MAX_REPAIR}`,
        job: "implementer",
        kind: "activity",
      }],
    });
  }

  if (assignment.reviewer) {
    task = await updateTask(workspace, taskId, {
      history: [...(task.history || []), {
        at: stamp(),
        text: `${assignment.reviewer.name}: Examining diff and verification`,
        job: "reviewer",
        kind: "activity",
      }],
    });
  }
  task = await setTaskStatus(workspace, taskId, "review", { verificationReport: report, repairAttempts: attempts });
  return { task, report, crew: assignment, stopped: "" };
}
