import test from "node:test";
import assert from "node:assert/strict";
import { extractClinicalIndicators } from "./clinicalIndicators.js";

const CATEGORIES = [
  "assistDevices", "oxygenUse", "woundPresent", "fallRisk", "painMentioned",
  "cognitiveIssues", "diabetic", "cardiacIssues", "assistanceNeeded", "independentMentioned",
];

test("always returns every indicator category with a boolean detected flag", () => {
  const r = extractClinicalIndicators("");
  for (const k of CATEGORIES) {
    assert.ok(k in r, `missing category: ${k}`);
    assert.equal(typeof r[k].detected, "boolean");
  }
});

test("an empty narrative detects nothing", () => {
  const r = extractClinicalIndicators("");
  assert.equal(r.assistDevices.detected, false);
  assert.equal(r.woundPresent.detected, false);
  assert.equal(r.painMentioned.detected, false);
  assert.equal(r.diabetic.detected, false);
});

test("detects assistive devices, oxygen, wounds, and pain", () => {
  const n =
    "Patient ambulates with a rolling walker. O2 at 2 L/min via nasal cannula continuous. " +
    "Stage 2 pressure ulcer to sacrum with serous drainage. Reports pain 8/10 in the lower back.";
  const r = extractClinicalIndicators(n);
  assert.equal(r.assistDevices.detected, true);
  assert.ok(r.assistDevices.walkers.length > 0);
  assert.equal(r.oxygenUse.detected, true);
  assert.ok(r.oxygenUse.flowRate.length > 0);
  assert.equal(r.woundPresent.detected, true);
  assert.ok(r.woundPresent.pressureUlcers.length > 0);
  assert.equal(r.painMentioned.detected, true);
});

test("detects diabetic and cardiac indicators", () => {
  const n =
    "Type 2 diabetes managed with insulin; blood sugar 180. " +
    "History of CHF with bilateral lower extremity edema and shortness of breath.";
  const r = extractClinicalIndicators(n);
  assert.equal(r.diabetic.detected, true);
  assert.equal(r.cardiacIssues.detected, true);
  assert.ok(r.cardiacIssues.edema.length > 0);
});
