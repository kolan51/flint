import { getTask, setTaskStatus, updateTask } from "./tasks.js";
import { runVerification, detectVerification } from "./verify.js";
import { routeCrew } from "./modelRouter.js";
import { agentRole } from "./tools.js";

const MAX_REPAIR = 2;

function stamp() {
  return new Date().toISOString();
}

function pushHistory(task, text, extra = {}) {
  const history = [...(task.history || []), { at: stamp(), text, kind: "activity", ...extra }].slice(-40);
  return { ...task, history };
}

function planFromReply(text, fallback) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter((line) => line && line.length < 200 && !/^```/.test(line));
  const picked = lines.slice(0, 8);
  return picked.length ? picked : fallback;
}

function architectPrompt(task) {
  return [
    "You are the Architect for this Flint Task. Plan only. Do not edit files.",
    `Title: ${task.title}`,
    `Request: ${task.request || task.description}`,
    task.acceptance?.length ? `Acceptance:\n${task.acceptance.map((item) => `- ${item}`).join("\n")}` : "",
    task.files?.length ? `Likely files:\n${task.files.map((item) => `- ${item}`).join("\n")}` : "",
    "Reply with a short numbered implementation plan (3 to 6 steps). Name files when you can.",
  ].filter(Boolean).join("\n\n");
}

function implementPrompt(task, report = null) {
  const failure = report?.failed?.length
    ? `Previous verification failed:\n${report.failed.map((item) => `$ ${item.command}\nexit ${item.code}\n${item.output || ""}`).join("\n\n").slice(0, 6000)}`
    : "";
  return [
    "You are the Implementer for this Flint Task. Make the smallest change that meets acceptance.",
    `Title: ${task.title}`,
    `Request: ${task.request || task.description}`,
    task.acceptance?.length ? `Acceptance:\n${task.acceptance.map((item) => `- ${item}`).join("\n")}` : "",
    task.plan?.length ? `Plan:\n${task.plan.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    task.files?.length ? `Start with:\n${task.files.map((item) => `- ${item}`).join("\n")}` : "",
    "Do not weaken or delete acceptance tests to make the job look done.",
    failure,
  ].filter(Boolean).join("\n\n");
}

function reviewerPrompt(task, report) {
  return [
    "You are the Reviewer. Do not edit files. Summarize whether the change is ready to keep.",
    `Title: ${task.title}`,
    `Acceptance:\n${(task.acceptance || []).map((item) => `- ${item}`).join("\n") || "- (none)"}`,
    report
      ? `Verification: ${report.passed?.length || 0} passed, ${report.failed?.length || 0} failed, ${report.skipped?.length || 0} skipped`
      : "Verification: not run",
    "Reply with Approve or Needs work, and one short paragraph.",
  ].join("\n\n");
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
    if (route?.agentId) {
      const hit = (agents || []).find((item) => item.id === route.agentId);
      if (hit) return { ...hit, route };
    }
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

export async function runTaskOrchestration(workspace, taskId, {
  settings,
  agents,
  signal,
  emit,
  runAgentTurn = null,
} = {}) {
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
  task = pushHistory(task, "Crew assigned", { assignment });
  task = await updateTask(workspace, taskId, { history: task.history, assignment, routing: crew.routes });
  emit?.({ type: "activity", text: "Crew assigned", assignment, task });

  const fallbackPlan = task.plan?.length
    ? task.plan
    : [
      "Inspect ranked files and acceptance criteria",
      "Implement the smallest change that meets acceptance",
      "Run verification without rewriting the criteria",
    ];

  if (crew.architect) {
    emit?.({ type: "status", job: "architect", agentId: crew.architect.id, text: `${crew.architect.name}: Planning` });
    task = pushHistory(task, `${crew.architect.name}: Planning`, { job: "architect" });
    task = await updateTask(workspace, taskId, { history: task.history });
    let plan = fallbackPlan;
    let architectReply = "";
    if (runAgentTurn) {
      const turn = await runAgentTurn({
        agent: crew.architect,
        job: "architect",
        mode: "plan",
        prompt: architectPrompt(task),
      });
      architectReply = String(turn?.reply || "");
      plan = planFromReply(architectReply, fallbackPlan);
    }
    task = await updateTask(workspace, taskId, {
      plan,
      history: [...(task.history || []), {
        at: stamp(),
        text: `${crew.architect.name}: Plan ready`,
        job: "architect",
        plan,
        reply: architectReply.slice(0, 4000),
      }],
    });
    emit?.({ type: "activity", job: "architect", text: "Plan ready", plan, task });
  }

  if (task.status === "approved" || task.status === "blocked" || task.status === "failed" || task.status === "review") {
    if (task.status === "review") {
      task = await setTaskStatus(workspace, taskId, "implementing");
    } else if (task.status !== "implementing") {
      task = await setTaskStatus(workspace, taskId, "implementing");
    }
  }

  let attempts = Number(task.repairAttempts || 0);
  let report = null;

  const runImplementer = async (failureReport) => {
    if (!crew.implementer) return;
    emit?.({ type: "status", job: "implementer", agentId: crew.implementer.id, text: `${crew.implementer.name}: Implementing` });
    task = await updateTask(workspace, taskId, {
      history: [...(task.history || []), {
        at: stamp(),
        text: `${crew.implementer.name}: Implementing`,
        job: "implementer",
        kind: "activity",
      }],
    });
    if (!runAgentTurn) return;
    const turn = await runAgentTurn({
      agent: crew.implementer,
      job: "implementer",
      mode: "act",
      prompt: implementPrompt(task, failureReport),
    });
    task = await updateTask(workspace, taskId, {
      history: [...(task.history || []), {
        at: stamp(),
        text: `${crew.implementer.name}: Implementation turn finished`,
        job: "implementer",
        reply: String(turn?.reply || "").slice(0, 4000),
      }],
    });
    emit?.({ type: "activity", job: "implementer", text: "Implementation turn finished", task });
  };

  await runImplementer(null);

  while (attempts <= MAX_REPAIR) {
    if (signal?.aborted) throw new Error("Cancelled.");
    if (task.status !== "verifying") {
      task = await setTaskStatus(workspace, taskId, "verifying");
    }
    if (assignment.verifier) {
      emit?.({ type: "status", job: "verifier", agentId: assignment.verifier.id, text: `${assignment.verifier.name}: Running checks` });
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
    emit?.({ type: "verification", report, task });

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
    emit?.({ type: "activity", job: "implementer", text: `Repair loop ${attempts}/${MAX_REPAIR}`, task });
    await runImplementer(report);
  }

  if (crew.reviewer) {
    emit?.({ type: "status", job: "reviewer", agentId: crew.reviewer.id, text: `${crew.reviewer.name}: Examining diff` });
    let reviewReply = "";
    if (runAgentTurn) {
      const turn = await runAgentTurn({
        agent: crew.reviewer,
        job: "reviewer",
        mode: "plan",
        prompt: reviewerPrompt(task, report),
      });
      reviewReply = String(turn?.reply || "");
    }
    task = await updateTask(workspace, taskId, {
      history: [...(task.history || []), {
        at: stamp(),
        text: `${crew.reviewer.name}: Examining diff and verification`,
        job: "reviewer",
        kind: "activity",
        reply: reviewReply.slice(0, 4000),
      }],
    });
  }

  task = await setTaskStatus(workspace, taskId, "review", { verificationReport: report, repairAttempts: attempts });
  emit?.({ type: "activity", text: "Ready for review", task });
  return { task, report, crew: assignment, stopped: "" };
}
