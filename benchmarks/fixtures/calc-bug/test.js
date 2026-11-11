import test from "node:test";
import assert from "node:assert/strict";
import { add, divide } from "./calc.js";

test("add joins two numbers", () => {
  assert.equal(add(2, 3), 5);
});

test("divide rejects zero", () => {
  assert.throws(() => divide(1, 0), /zero/i);
});
