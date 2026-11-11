import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./studio.js";
import { checkCommandFor } from "./check.js";

function check(name, command, kind = "test") {
  return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, command, kind };
}

export async function detectVerification(workspace) {
  const checks = [];
  let pkg = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf8"));
  } catch {
    pkg = null;
  }
  if (pkg?.scripts?.test) checks.push(check("Unit tests", "npm test", "test"));
  if (pkg?.scripts?.lint) checks.push(check("Lint", "npm run lint", "lint"));
  if (pkg?.scripts?.build) checks.push(check("Build", "npm run build", "build"));
  if (pkg?.scripts?.typecheck) checks.push(check("Typecheck", "npm run typecheck", "typecheck"));
  else if (pkg?.devDependencies?.typescript || pkg?.dependencies?.typescript) {
    checks.push(check("Typecheck", "npx tsc --noEmit", "typecheck"));
  }
  try {
    await fs.access(path.join(workspace, "pyproject.toml"));
    checks.push(check("Pytest", "python -m pytest -q", "test"));
  } catch {
    /* no python project file */
  }
  try {
    const names = await fs.readdir(workspace);
    const hasPyTests = names.some((name) => /^test_.*\.py$/i.test(name));
    let testsHasPy = false;
    if (names.includes("tests")) {
      try {
        const nested = await fs.readdir(path.join(workspace, "tests"));
        testsHasPy = nested.some((name) => /\.py$/i.test(name));
      } catch {
        testsHasPy = false;
      }
    }
    if ((hasPyTests || testsHasPy) && !checks.some((item) => item.command.includes("pytest"))) {
      checks.push(check("Pytest", "python -m pytest -q", "test"));
    }
  } catch {
    /* folder unreadable */
  }
  return { checks: checks.slice(0, 8), source: "detected" };
}

export async function runVerification(workspace, { checks = [], settings = null, allowed = false } = {}) {
  const started = Date.now();
  const configured = checkCommandFor(settings, workspace);
  const list = [...checks];
  if (configured && !list.some((item) => item.command === configured)) {
    list.unshift(check("Folder check", configured, "custom"));
  }
  const report = {
    at: new Date().toISOString(),
    workspace: String(workspace || ""),
    durationMs: 0,
    passed: [],
    failed: [],
    skipped: [],
    unavailable: [],
    commands: [],
  };
  if (!list.length) {
    report.unavailable.push({ name: "Verification", reason: "No checks configured for this folder." });
    report.durationMs = Date.now() - started;
    return report;
  }
  if (!allowed && settings?.commands?.mode !== "allow") {
    for (const item of list) {
      report.skipped.push({
        name: item.name,
        command: item.command,
        reason: "Commands need approval. Set Commands to Allow always, or run checks from the dock.",
      });
    }
    report.durationMs = Date.now() - started;
    return report;
  }
  for (const item of list.slice(0, 8)) {
    const began = Date.now();
    try {
      const result = await runCommand(workspace, item.command, 600000);
      const entry = {
        name: item.name,
        command: item.command,
        kind: item.kind || "test",
        code: result.code,
        ms: Date.now() - began,
        output: String(result.output || "").slice(-6000),
      };
      report.commands.push(entry);
      if (result.code === 0) report.passed.push(entry);
      else report.failed.push(entry);
    } catch (err) {
      const entry = {
        name: item.name,
        command: item.command,
        kind: item.kind || "test",
        code: 1,
        ms: Date.now() - began,
        output: err.message,
      };
      report.commands.push(entry);
      report.failed.push(entry);
    }
  }
  report.durationMs = Date.now() - started;
  return report;
}
