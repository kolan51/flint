import test from "node:test";
import assert from "node:assert/strict";
import { parseStreamLine } from "./providers.js";
import { commandAllowed, commandMatches } from "./commands.js";
import { nearBottom } from "../src/scroll.js";
import { parseTestOutput } from "./tests.js";

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

test("test failures keep the file and the line", () => {
  const pytest = parseTestOutput("FAILED test_calc.py::test_divide - AssertionError: boom\n");
  assert.equal(pytest[0].name, "test_divide");
  assert.equal(pytest[0].path, "test_calc.py");
  const unit = parseTestOutput('FAIL: test_add (test_calc.Calc)\nFile "calculator.py", line 4\nAssertionError\n');
  assert.equal(unit[0].path, "calculator.py");
  assert.equal(unit[0].line, 4);
});
