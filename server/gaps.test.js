import test from "node:test";
import assert from "node:assert/strict";
import { parseStreamLine } from "./providers.js";
import { commandAllowed, commandMatches } from "./commands.js";
import { nearBottom } from "../src/scroll.js";
import { parseTestOutput } from "./tests.js";
import { applyUnifiedDiff, locateEdit } from "./editmatch.js";
import { checkCommandFor } from "./check.js";
import { typescriptError } from "./syntax.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
});

test("test failures keep the file and the line", () => {
  const pytest = parseTestOutput("FAILED test_calc.py::test_divide - AssertionError: boom\n");
  assert.equal(pytest[0].name, "test_divide");
  assert.equal(pytest[0].path, "test_calc.py");
  const unit = parseTestOutput('FAIL: test_add (test_calc.Calc)\nFile "calculator.py", line 4\nAssertionError\n');
  assert.equal(unit[0].path, "calculator.py");
  assert.equal(unit[0].line, 4);
});
