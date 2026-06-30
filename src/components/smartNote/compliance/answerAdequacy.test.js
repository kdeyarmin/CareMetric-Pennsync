import test from "node:test";
import assert from "node:assert/strict";
import { checkAnswerAdequacy, elementsWithAdequacyRules } from "./answerAdequacy.js";

test("flags a conclusory homebound restatement", () => {
  const r = checkAnswerAdequacy("homebound", "Patient is homebound.");
  assert.equal(r.adequate, false);
  assert.ok(r.tip);
});

test("accepts a specific homebound answer with cause + taxing effort", () => {
  const r = checkAnswerAdequacy(
    "homebound",
    "Homebound due to severe dyspnea; requires a walker and one-person assist to ambulate and tires after a few steps.",
  );
  assert.equal(r.adequate, true);
});

test("flags a bare skilled-need restatement", () => {
  assert.equal(checkAnswerAdequacy("skilled_need", "Skilled nursing.").adequate, false);
});

test("accepts a specific skilled-need answer", () => {
  const r = checkAnswerAdequacy(
    "skilled_need",
    "Performed skilled wound assessment and sterile dressing change to the sacral ulcer.",
  );
  assert.equal(r.adequate, true);
});

test("flags education without confirmation of understanding", () => {
  const r = checkAnswerAdequacy("education", "Talked about the diet.");
  assert.equal(r.adequate, false);
});

test("accepts education with teach-back", () => {
  const r = checkAnswerAdequacy(
    "education",
    "Taught low-sodium diet; patient verbalized understanding and named foods to avoid via teach-back.",
  );
  assert.equal(r.adequate, true);
});

test("has no opinion on elements without a rule", () => {
  assert.equal(checkAnswerAdequacy("vitals", "x").adequate, true);
  assert.equal(checkAnswerAdequacy("medication", "n/a").adequate, true);
});

test("empty answer is not flagged (gating owns emptiness)", () => {
  assert.equal(checkAnswerAdequacy("homebound", "").adequate, true);
  assert.equal(checkAnswerAdequacy("homebound", "   ").adequate, true);
});

test("every listed rule id returns a tip when given a too-short answer", () => {
  for (const id of elementsWithAdequacyRules()) {
    const r = checkAnswerAdequacy(id, "ok");
    assert.equal(r.adequate, false, `${id} should flag a trivial answer`);
    assert.ok(r.tip, `${id} should provide a tip`);
  }
});
