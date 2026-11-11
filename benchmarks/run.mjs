#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proposeTask, approveTask, setTaskStatus, getTask } from "../server/tasks.js";
import { detectVerification, runVerification } from "../server/verify.js";
import { pickCrew } from "../server/scheduler.js";
import { routeFor } from "../server/modelRouter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "calc-bug");
const outDir = path.join(here, "results");

async function main() {
  const started = Date.now();
  const spec = JSON.parse(await fs.readFile(path.join(fixture, "task.json"), "utf8"));
  const verification = await detectVerification(fixture);
  const before = await runVerification(fixture, {
    checks: verification.checks,
    allowed: true,
    settings: { commands: { mode: "allow" }, check: { command: "", root: "" } },
  });

  const agents = [
    { id: "arch", name: "Architect", role: "architect", provider: "local", model: "local-plan" },
    { id: "impl", name: "Patch", role: "implementer", provider: "local", model: "local-coder" },
    { id: "ver", name: "Checker", role: "verifier", provider: "local", model: "local-check" },
    { id: "rev", name: "Reviewer", role: "reviewer", provider: "local", model: "local-review" },
  ];
  const settings = {
    routing: { mode: "balanced" },
    providers: { local: { id: "local", baseUrl: "http://127.0.0.1:8080" } },
    activeProvider: "local",
    defaultModel: "local-coder",
    commands: { mode: "allow" },
  };
  const crew = pickCrew(agents, settings);
  const route = routeFor("implementer", { settings, agents });

  const proposed = await proposeTask(fixture, {
    request: spec.request,
    map: "calc.js\n  divide()\n  add()\n",
    verification,
    agentId: crew.implementer?.id || "",
    model: route.model,
  });
  await approveTask(fixture, proposed.id);
  await setTaskStatus(fixture, proposed.id, "implementing");

  const repaired = `export function divide(a, b) {
  if (b === 0) throw new Error("division by zero");
  return a / b;
}

export function add(a, b) {
  return a + b;
}
`;
  await fs.writeFile(path.join(fixture, "calc.js"), repaired);
  const after = await runVerification(fixture, {
    checks: verification.checks,
    allowed: true,
    settings: { commands: { mode: "allow" }, check: { command: "", root: "" } },
  });
  await setTaskStatus(fixture, proposed.id, "verifying");
  const task = await setTaskStatus(fixture, proposed.id, "review", { verificationReport: after });
  const completed = after.failed.length === 0 && after.passed.length > 0
    ? await setTaskStatus(fixture, proposed.id, "completed")
    : await getTask(fixture, proposed.id);

  // restore the broken fixture for the next run
  await fs.writeFile(path.join(fixture, "calc.js"), `export function divide(a, b) {
  return a / b;
}

export function add(a, b) {
  return a + b;
}
`);

  const result = {
    at: new Date().toISOString(),
    fixture: "calc-bug",
    methodology: "Isolated fixture. Same folder before/after a known fix. No external model calls. No competitor scores.",
    metrics: {
      taskCompletion: completed.status === "completed",
      acceptancePassRate: after.passed.length / Math.max(1, after.passed.length + after.failed.length),
      failingChecksBefore: before.failed.length,
      failingChecksAfter: after.failed.length,
      repairIterations: 1,
      humanIntervention: "scripted fix applied by the benchmark runner",
      latencyMs: Date.now() - started,
      modelUsage: {
        implementer: route,
        crew: {
          architect: crew.architect?.name || "",
          implementer: crew.implementer?.name || "",
          verifier: crew.verifier?.name || "",
          reviewer: crew.reviewer?.name || "",
        },
      },
      cost: null,
      costNote: "No provider billing data is available in this offline fixture.",
    },
    taskId: proposed.id,
    finalStatus: completed.status,
  };

  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `calc-bug-${Date.now()}.json`);
  await fs.writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${file}`);
  if (!result.metrics.taskCompletion) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
