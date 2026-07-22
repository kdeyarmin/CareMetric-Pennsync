import test from "node:test";
import assert from "node:assert/strict";
import { getUxStateCopy, validateUxStateCopy } from "./uxStateContracts.js";

test("UX state copy has required title/action/tone metadata", () => {
  const empty = getUxStateCopy("empty", { title: "No visits scheduled", actionLabel: "Schedule a visit" });
  assert.deepEqual(empty, { type: "empty", title: "No visits scheduled", actionLabel: "Schedule a visit", tone: "neutral" });
  assert.equal(validateUxStateCopy(empty).valid, true);
});

test("destructive confirmations require an explicit action label", () => {
  const result = validateUxStateCopy({ type: "destructive_confirmation", title: "Archive this user", tone: "warning" });
  assert.deepEqual(result.missing, ["actionLabel"]);
});
