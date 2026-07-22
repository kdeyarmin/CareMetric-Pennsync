import test from "node:test";
import assert from "node:assert/strict";
import { PR_READINESS_CHECKS, evaluatePrReadiness } from "./prReadinessChecklist.js";

test("PR readiness checklist requires workflow, permission, data, test, docs, and rollback evidence", () => {
  assert.deepEqual(evaluatePrReadiness({ summary: true }).missing, PR_READINESS_CHECKS.filter((check) => check !== "summary"));
  assert.equal(evaluatePrReadiness(Object.fromEntries(PR_READINESS_CHECKS.map((check) => [check, true]))).ready, true);
});
