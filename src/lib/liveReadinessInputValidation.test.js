import test from "node:test";
import assert from "node:assert/strict";
import { formatLiveReadinessInputErrors, validateLiveReadinessInput } from "./liveReadinessInputValidation.js";

const validInput = {
  release: { release_id: "r1" },
  matrix: [{ id: "LR-X", capability: "Example", priority: 1, risk: "high" }],
  evidence: { "LR-X": { owner: { value: "owner", references: ["docs/owner.md"] }, reviewers: { product: "approved" } } },
};

test("valid readiness input returns no validation errors", () => {
  assert.deepEqual(validateLiveReadinessInput(validInput), []);
});

test("validator rejects non-object top-level input and malformed containers", () => {
  assert.deepEqual(validateLiveReadinessInput(null), [{ path: "$", message: "Input must be a JSON object." }]);
  const errors = validateLiveReadinessInput({ release: [], evidence: [], matrix: {} });
  assert.deepEqual(errors.map((error) => error.path), ["release", "evidence", "matrix"]);
});

test("validator reports evidence entry and reviewer shape errors without raw values", () => {
  const errors = validateLiveReadinessInput({ evidence: { "LR-X": { owner: { value: "secret", references: "not-array" }, reviewers: [] } } });
  assert.deepEqual(errors.map((error) => error.path), ["evidence.LR-X.reviewers", "evidence.LR-X.owner.references"]);
  assert.equal(formatLiveReadinessInputErrors(errors).includes("secret"), false);
});

test("validator reports invalid matrix rows and missing fields", () => {
  const errors = validateLiveReadinessInput({ matrix: [null, { id: "LR-X" }] });
  assert.deepEqual(errors.map((error) => error.path), ["matrix.0", "matrix.1.capability", "matrix.1.priority", "matrix.1.risk"]);
});
