import test from "node:test";
import assert from "node:assert/strict";
import { computeAge, formatAge } from "./age.js";

test("computeAge accounts for birthdays that have not occurred yet", () => {
  const ref = new Date(2026, 6, 3); // July 3, 2026 local time
  assert.equal(computeAge("1961-12-01", ref), 64);
  assert.equal(computeAge("1961-05-01", ref), 65);
  assert.equal(computeAge("1961-07-03", ref), 65);
});

test("computeAge validates ISO calendar dates and formats invalid ages as Unknown", () => {
  const ref = new Date(2026, 6, 3);
  assert.ok(Number.isNaN(computeAge("2020-02-30", ref)));
  assert.ok(Number.isNaN(computeAge("not a date", ref)));
  assert.equal(formatAge("not a date", ref), "Unknown");
});
