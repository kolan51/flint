import test from "node:test";
import assert from "node:assert/strict";
import { parseStreamLine, modelsEndpoint } from "./providers.js";
import { commandAllowed, commandMatches } from "./commands.js";
import { nearBottom } from "../src/scroll.js";
import { parseTestOutput } from "./tests.js";
import { applyUnifiedDiff, locateEdit, replyDiffs } from "./editmatch.js";
import { checkCommandFor } from "./check.js";
import { typescriptError } from "./syntax.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("a llama.cpp address is not asked for an Ollama tag list", () => {
  const ollama = modelsEndpoint({ kind: "ollama", baseUrl: "http://192.168.1.214:11434" });
  assert.equal(ollama.kind, "ollama");
  assert.equal(ollama.url, "http://192.168.1.214:11434/api/tags");
  const local = modelsEndpoint({ kind: "ollama", baseUrl: "http://192.168.1.214:8080/v1" });
  assert.equal(local.kind, "openai");
  assert.equal(local.url, "http://192.168.1.214:8080/v1/models");
});

test("colon keepalive is not JSON", () => {
  assert.equal(parseStreamLine(":"), null);
  assert.equal(parseStreamLine("data: :"), null);
  assert.equal(parseStreamLine(""), null);
  assert.deepEqual(parseStreamLine('data: {"ok":true}'), { chunk: { ok: true } });
  assert.deepEqual(parseStreamLine("data: [DONE]"), { done: true });
  assert.equal(parseStreamLine("data: not-json"), null);
});

test("a saved command is allowed and a different one is not", () => {
  assert.equal(commandMatches("python -m unittest test_smoke", "python -m unittest test_smoke"), true);
  assert.equal(commandMatches("python -m unittest test_smoke", "python -m py_compile calculator.py"), false);
  assert.equal(commandMatches("python -m unittest test_smoke -v", "python -m unittest*"), true);
  assert.equal(commandAllowed("python -m unittest test_smoke", ["python -m py_compile calculator.py"]), false);
  assert.equal(commandAllowed("python -m unittest test_smoke", ["python -m unittest test_smoke"]), true);
});

test("a job in the prompt stays the job", async () => {
  const { agentJob } = await import("../src/faces.js");
  assert.equal(agentJob({ systemPrompt: "You are the tester. You try the change." }), "Tester");
  assert.equal(agentJob({ systemPrompt: "You are Worker 2, the reviewer. You look for bugs." }), "Reviewer");
  assert.equal(agentJob({ systemPrompt: "You are a coding agent on the user's machine." }), "");
});

test("chat stays pinned only near the bottom", () => {
  assert.equal(nearBottom(1000, 960, 40), true);
  assert.equal(nearBottom(1000, 920, 40), true);
  assert.equal(nearBottom(1000, 900, 40), false);
});

test("an old thread becomes a session and a later note stays beside it", async () => {
  const { appendAgentMessages, unpackChats } = await import("../src/sessions.js");
  const saved = appendAgentMessages({ agent: [{ role: "user", content: "fix the calculator" }] }, "agent", [
    { role: "user", content: "second" },
  ]);
  const again = unpackChats(saved);
  assert.equal(again.active.agent[0].content, "fix the calculator");
  assert.equal(again.active.agent.at(-1).content, "second");
  assert.equal(again.books.agent.items.length, 1);
});

test("an apply agent is not given a slice of the job", async () => {
  process.env.FLINT_NO_LISTEN = "1";
  const { delegationTargets, systemFor } = await import("./index.js");
  const agents = [
    { id: "agent", name: "Senior", role: "lead" },
    { id: "w1", name: "Worker1", role: "chat" },
    { id: "patch", name: "Patch", role: "apply" },
  ];
  const job = delegationTargets(agents[0], agents, [{ role: "user", content: "fix the missing divide bug in the calculator" }]);
  assert.deepEqual(job.map((item) => item.name), ["Worker1"]);
  const quiet = systemFor(agents[0], agents, { prompt: { compact: true } }, {
    map: "divide()",
    journal: "old notes",
    rules: "always write tests",
    messages: [{ role: "user", content: "what time is it" }],
  });
  assert.match(quiet, /divide\(\)/);
  assert.doesNotMatch(quiet, /You lead/);
  assert.doesNotMatch(quiet, /old notes/);
  assert.match(quiet, /Patch writes the diff/);
  const split = systemFor(agents[0], agents, { prompt: { compact: true } }, {
    map: "divide()",
    messages: [{ role: "user", content: "fix the missing divide bug in the calculator" }],
  });
  assert.match(split, /You lead Worker1/);
  assert.match(split, /Patch writes the diff/);
  const applying = systemFor(agents[2], agents, { prompt: { compact: false } }, { map: "divide()" });
  assert.match(applying, /edit_file/);
  assert.doesNotMatch(applying, /assign_work/);
});

test("a commit message stays on the request", async () => {
  const { commitMessage } = await import("./studio.js");
  assert.equal(commitMessage("Fix the divider\n\n[Open file: style.css]\n```css\nbody{}\n```"), "Fix the divider");
  assert.equal(commitMessage(""), "Keep the diff");
});

test("keeping one file does not commit the rest of the folder", async () => {
  const { commitKeptPath } = await import("./studio.js");
  const { spawn } = await import("node:child_process");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flint-keep-"));
  const git = (args) => new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: dir, windowsHide: true });
    let out = "";
    child.stdout?.on("data", (buf) => { out += buf.toString(); });
    child.stderr?.on("data", (buf) => { out += buf.toString(); });
    child.on("error", reject);
    child.on("close", (code) => (code ? reject(new Error(out || `git ${args[0]} failed`)) : resolve(out)));
  });
  await git(["init"]);
  await git(["config", "user.email", "flint@example.com"]);
  await git(["config", "user.name", "Flint"]);
  await fs.writeFile(path.join(dir, "a.txt"), "one\n");
  await fs.writeFile(path.join(dir, "b.txt"), "two\n");
  await git(["add", "--", "a.txt", "b.txt"]);
  await git(["commit", "-m", "start"]);
  await fs.writeFile(path.join(dir, "a.txt"), "one\nchanged\n");
  await fs.writeFile(path.join(dir, "b.txt"), "two\nchanged\n");
  const kept = await commitKeptPath(dir, "a.txt", "Fix the divider in the calculator");
  assert.equal(kept.committed, true);
  const status = await git(["status", "--short"]);
  assert.match(status, /b\.txt/);
  assert.doesNotMatch(status, /a\.txt/);
  const log = await git(["log", "-1", "--format=%s"]);
  assert.match(log, /Fix the divider/);
  const missing = await commitKeptPath(path.join(dir, "not-a-repo"), "a.txt", "nope");
  assert.equal(missing.committed, false);
});

test("a lead splits a real job and keeps a short question", async () => {
  process.env.FLINT_NO_LISTEN = "1";
  const { delegationTargets } = await import("./index.js");
  const agents = [
    { id: "agent", name: "Senior" },
    { id: "w1", name: "Worker1" },
    { id: "w2", name: "Worker2" },
    { id: "w3", name: "Worker3" },
  ];
  const job = delegationTargets(agents[0], agents, [{ role: "user", content: "fix the missing divide bug in the calculator" }]);
  assert.deepEqual(job.map((item) => item.name), ["Worker1", "Worker2", "Worker3"]);
  const quiet = delegationTargets(agents[0], agents, [{ role: "user", content: "what time is it" }]);
  assert.equal(quiet.length, 0);
});

test("a sloppy span still lands when it is unique", () => {
  const file = "def divide(a, b):\n    if b == 0:\n        raise ZeroDivisionError\n    return a / b\n";
  const exact = locateEdit(file, "    if b == 0:\n        raise ZeroDivisionError");
  assert.equal(file.slice(exact.at, exact.at + exact.old.length), "    if b == 0:\n        raise ZeroDivisionError");
  const loose = locateEdit(file, "if b == 0:\n    raise ZeroDivisionError");
  assert.equal(file.slice(loose.at, loose.at + loose.old.length), "    if b == 0:\n        raise ZeroDivisionError");
  assert.throws(() => locateEdit(`${file}${file}`, "def divide(a, b):"), /more than once/);
});

test("a unified diff applies when the span does not", () => {
  const file = "def divide(a, b):\n    return a / b\n";
  const diff = "@@ -1,2 +1,3 @@\n def divide(a, b):\n+    if b == 0:\n+        raise ZeroDivisionError\n     return a / b\n";
  assert.equal(applyUnifiedDiff(file, diff), "def divide(a, b):\n    if b == 0:\n        raise ZeroDivisionError\n    return a / b\n");
  assert.equal(applyUnifiedDiff(file, "not a diff"), null);
});

test("the folder check stays with the folder it was saved for", () => {
  assert.equal(checkCommandFor({ check: { command: "npm test", root: "F:/app" } }, "F:/app"), "npm test");
  assert.equal(checkCommandFor({ check: { command: "npm test", root: "F:/app" } }, "F:/other"), "");
  assert.equal(checkCommandFor({ check: { command: "  ", root: "F:/app" } }, "F:/app"), "");
});

test("typescript syntax is reported and valid code is quiet", async () => {
  assert.equal(await typescriptError("export function add(a: number, b: number) { return a + b }\n"), null);
  const bad = await typescriptError("export function add(a: number { return a }\n");
  assert.equal(bad.line >= 1, true);
  assert.match(bad.message, /Expected/);
});

test("the repo map keeps function names and drops the body", async () => {
  const { repoMap } = await import("./repomap.js");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flint-map-"));
  await fs.writeFile(path.join(dir, "calc.py"), "def divide(a, b):\n    return a / b\n");
  const map = await repoMap(dir);
  assert.match(map, /calc\.py/);
  assert.match(map, /divide\(a, b\)/);
  assert.equal(map.includes("return a / b"), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test("the repo map ranks the file the request names", async () => {
  const { repoMap } = await import("./repomap.js");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flint-rank-"));
  await fs.writeFile(path.join(dir, "aaa.py"), "def unused(a, b):\n    return a\n");
  await fs.writeFile(path.join(dir, "zebra.py"), "def divide(a, b):\n    return a / b\n");
  const map = await repoMap(dir, "divide the numbers");
  assert.ok(map.indexOf("zebra.py") < map.indexOf("aaa.py"));
  await fs.rm(dir, { recursive: true, force: true });
});

test("a reply diff lands once when the hunk matches", async () => {
  const { applyReplyText } = await import("./tools.js");
  const { paths } = await import("./store.js");
  const journal = path.join(paths.dataDir, "journal.json");
  const runs = path.join(paths.dataDir, "runs.json");
  const savedJournal = await fs.readFile(journal, "utf8").catch(() => null);
  const savedRuns = await fs.readFile(runs, "utf8").catch(() => null);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flint-reply-"));
  const original = "def divide(a, b):\n    return a / b\n";
  const diff = "```diff\n--- a/calc.py\n+++ b/calc.py\n@@ -1,2 +1,3 @@\n def divide(a, b):\n+    if b == 0:\n+        raise ZeroDivisionError\n     return a / b\n```";
  try {
    await fs.writeFile(path.join(dir, "calc.py"), original);
    const run = { id: "run_test", files: {}, edits: [] };
    const first = await applyReplyText(dir, diff, { run, agent: { id: "a", name: "Test" } });
    assert.equal(first.length, 1);
    const second = await applyReplyText(dir, diff, { run, agent: { id: "a", name: "Test" } });
    assert.equal(second.length, 0);
    const miss = "--- a/calc.py\n+++ b/calc.py\n@@ -1,2 +1,2 @@\n def missing():\n-    return 1\n+    return 2\n";
    assert.equal((await applyReplyText(dir, miss, { run, agent: { id: "a", name: "Test" } })).length, 0);
    assert.match(await fs.readFile(path.join(dir, "calc.py"), "utf8"), /ZeroDivisionError/);
    assert.equal(replyDiffs(diff)[0].path, "calc.py");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (savedJournal == null) await fs.rm(journal, { force: true });
    else await fs.writeFile(journal, savedJournal);
    if (savedRuns == null) await fs.rm(runs, { force: true });
    else await fs.writeFile(runs, savedRuns);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("script files use the typescript language server ids", async () => {
  const { languageIdFor } = await import("./lsp.js");
  assert.equal(languageIdFor("app.py"), "python");
  assert.equal(languageIdFor("app.ts"), "typescript");
  assert.equal(languageIdFor("app.tsx"), "typescriptreact");
  assert.equal(languageIdFor("app.js"), "javascript");
  assert.equal(languageIdFor("app.jsx"), "javascriptreact");
});

test("test failures keep the file and the line", () => {
  const pytest = parseTestOutput("FAILED test_calc.py::test_divide - AssertionError: boom\n");
  assert.equal(pytest[0].name, "test_divide");
  assert.equal(pytest[0].path, "test_calc.py");
  const unit = parseTestOutput('FAIL: test_add (test_calc.Calc)\nFile "calculator.py", line 4\nAssertionError\n');
  assert.equal(unit[0].path, "calculator.py");
  assert.equal(unit[0].line, 4);
});
