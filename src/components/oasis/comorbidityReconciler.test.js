import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveOasisConditions,
  reconcileComorbidities,
  reconcileFromOasis,
  comorbiditySubgroup,
} from "./comorbidityReconciler.js";

// ── subgroup mapping ──

test("maps conditions to PDGM comorbidity subgroups", () => {
  assert.equal(comorbiditySubgroup("Heart Failure"), "Circulatory");
  assert.equal(comorbiditySubgroup("COPD"), "Respiratory");
  assert.equal(comorbiditySubgroup("Diabetes Mellitus"), "Endocrine");
  assert.equal(comorbiditySubgroup("Depression"), "Behavioral");
  assert.equal(comorbiditySubgroup("Sprained ankle"), null);
});

// ── OASIS derivation ──

test("derives documented conditions from OASIS items", () => {
  const conditions = deriveOasisConditions({ m1020: 2, m1730: 1, m1306: 1 });
  const labels = conditions.map((c) => c.condition);
  assert.ok(labels.includes("Heart Failure"));
  assert.ok(labels.includes("Depression"));
  assert.ok(labels.includes("Pressure Ulcer"));
});

test("string OASIS answers coerce and non-diagnosis items are ignored", () => {
  const conditions = deriveOasisConditions({ m1020: "3", m1730: "0", m1860: "4" });
  const labels = conditions.map((c) => c.condition);
  assert.deepEqual(labels, ["COPD"]); // m1730=0 → no depression; m1860 ignored
});

// ── reconciliation ──

test("a documented condition already coded is captured", () => {
  const res = reconcileComorbidities({
    documentedConditions: ["Heart Failure"],
    codedSecondaries: ["I50.9 Heart failure, unspecified"],
  });
  assert.equal(res.captured.length, 1);
  assert.equal(res.gaps.length, 0);
});

test("a documented condition NOT coded becomes a gap and (if eligible) an opportunity", () => {
  const res = reconcileComorbidities({
    documentedConditions: ["Depression", "COPD"],
    codedSecondaries: ["E11.9 Type 2 diabetes"],
  });
  assert.equal(res.gaps.length, 2);
  assert.equal(res.comorbidity_opportunities.length, 2); // both map to a subgroup
  assert.equal(res.potential_adjustment_count, 2);
  assert.match(res.comorbidity_opportunities[0].message, /capture the .* comorbidity adjustment/);
});

test("subgroup match captures across naming variants (CHF vs Heart failure)", () => {
  const res = reconcileComorbidities({
    documentedConditions: ["CHF"],
    codedSecondaries: ["Congestive heart failure"],
  });
  assert.equal(res.captured.length, 1);
  assert.equal(res.gaps.length, 0);
});

test("a documented gap with no PDGM subgroup is a gap but not an opportunity", () => {
  const res = reconcileComorbidities({
    documentedConditions: ["Seasonal allergies"],
    codedSecondaries: [],
  });
  assert.equal(res.gaps.length, 1);
  assert.equal(res.comorbidity_opportunities.length, 0);
});

// ── OASIS convenience path ──

test("reconcileFromOasis links derivation + reconciliation", () => {
  // m1020=2 (Heart Failure) + m1730=1 (Depression); only heart failure coded.
  const res = reconcileFromOasis({ m1020: 2, m1730: 1 }, ["I50.9 Heart failure"]);
  const oppConditions = res.comorbidity_opportunities.map((o) => o.condition);
  assert.ok(oppConditions.includes("Depression"));
  assert.ok(!oppConditions.includes("Heart Failure")); // already captured
});

// ── single-shared-token false captures ──

test("one shared generic token does not mark a distinct condition captured", () => {
  // Regression: "Heart Failure" used to be swallowed by coded "Renal failure"
  // (shared token "failure"), hiding an adjustment-eligible Circulatory gap.
  const res = reconcileComorbidities({
    documentedConditions: ["Heart Failure"],
    codedSecondaries: ["Renal failure"],
  });
  assert.equal(res.captured.length, 0);
  assert.equal(res.gaps.length, 1);
  assert.equal(res.comorbidity_opportunities.length, 1);
  assert.equal(res.comorbidity_opportunities[0].subgroup, "Circulatory");
});

test("shared 'ulcer' token does not capture a pressure ulcer under a diabetic ulcer code", () => {
  const res = reconcileComorbidities({
    documentedConditions: ["Pressure Ulcer"],
    codedSecondaries: ["Diabetic foot ulcer"],
  });
  assert.equal(res.captured.length, 0);
  assert.equal(res.gaps.length, 1);
});

test("a real multi-token overlap still captures", () => {
  const res = reconcileComorbidities({
    documentedConditions: ["Heart Failure"],
    codedSecondaries: ["Congestive heart failure, unspecified"],
  });
  assert.equal(res.captured.length, 1);
  assert.equal(res.gaps.length, 0);
});

test("a single-token condition captures on its exact token", () => {
  const res = reconcileComorbidities({
    documentedConditions: ["Hypertension"],
    codedSecondaries: ["Essential hypertension"],
  });
  assert.equal(res.captured.length, 1);
});
