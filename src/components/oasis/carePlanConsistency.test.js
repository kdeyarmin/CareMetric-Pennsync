import test from "node:test";
import assert from "node:assert/strict";
import { checkCarePlanConsistency, interventionsWithConsistencyRules } from "./carePlanConsistency.js";

const ambItem = { id: "fp-3", name: "Ambulation Safety Teaching" };
const balanceItem = { id: "fp-4", name: "Balance Exercise Program" };
const insulinItem = { id: "mm-3", name: "Insulin Administration Teaching" };
const woundItem = { id: "wc-1", name: "Wound Assessment" };

test("flags an ambulation goal for a bedfast patient (M1860 = 5)", () => {
  const out = checkCarePlanConsistency({ m1860: 5 }, [ambItem]);
  assert.equal(out.length, 1);
  assert.equal(out[0].interventionId, "fp-3");
  assert.match(out[0].message, /non-ambulatory or bedfast/);
});

test("flags ambulation/balance goals when transferring is bedfast (M1850 = 4)", () => {
  const out = checkCarePlanConsistency({ m1850: 4 }, [ambItem, balanceItem]);
  assert.deepEqual(out.map((c) => c.interventionId).sort(), ["fp-3", "fp-4"]);
});

test("does NOT flag ambulation goals for an ambulatory patient", () => {
  assert.equal(checkCarePlanConsistency({ m1860: 1, m1850: 1 }, [ambItem, balanceItem]).length, 0);
});

test("coerces string answers (M1860 = '4')", () => {
  assert.equal(checkCarePlanConsistency({ m1860: "4" }, [ambItem]).length, 1);
});

test("flags patient self-injection teaching under severe cognitive impairment (M1700 >= 3)", () => {
  assert.equal(checkCarePlanConsistency({ m1700: 3 }, [insulinItem]).length, 1);
  assert.equal(checkCarePlanConsistency({ m1700: 4 }, [insulinItem]).length, 1);
});

test("does NOT flag self-teaching for an alert patient (M1700 = 1)", () => {
  assert.equal(checkCarePlanConsistency({ m1700: 1 }, [insulinItem]).length, 0);
});

test("interventions without a rule are never flagged", () => {
  assert.equal(checkCarePlanConsistency({ m1860: 5, m1700: 4 }, [woundItem]).length, 0);
});

test("missing/blank answers never produce a conflict", () => {
  assert.equal(checkCarePlanConsistency({}, [ambItem, insulinItem]).length, 0);
  assert.equal(checkCarePlanConsistency({ m1860: "" }, [ambItem]).length, 0);
});

test("handles empty/invalid items safely", () => {
  assert.deepEqual(checkCarePlanConsistency({ m1860: 5 }, []), []);
  assert.deepEqual(checkCarePlanConsistency({ m1860: 5 }, null), []);
});

test("every rule id reports a finding when its condition is met", () => {
  for (const id of interventionsWithConsistencyRules()) {
    const out = checkCarePlanConsistency({ m1860: 5, m1850: 4, m1700: 4 }, [{ id, name: id }]);
    assert.equal(out.length, 1, `${id} should flag under the extreme findings`);
    assert.ok(out[0].message);
  }
});
