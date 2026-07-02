import test from "node:test";
import assert from "node:assert/strict";
import { buildFollowUpPlan } from "./referralFollowUpEngine.js";
import { estimateFollowUpRevenueImpact, fmtUsd } from "./followUpRevenueImpact.js";
import { DEFAULT_PDGM_RATES } from "../pdgm/pdgmRates.js";

const EMPTY_PLAN = buildFollowUpPlan({});

test("condition-of-payment gaps are at_risk at the base period value", () => {
  const impact = estimateFollowUpRevenueImpact(EMPTY_PLAN);
  assert.equal(impact.isEstimate, true);
  const f2f = impact.perItem.f2f_missing;
  assert.equal(f2f.type, "at_risk");
  // No coded primary on an empty referral → base rate without a weight.
  assert.equal(f2f.low, Math.round(DEFAULT_PDGM_RATES.basePaymentRate));
});

test("at-risk exposure totals as a max, not a sum (same period at stake)", () => {
  const impact = estimateFollowUpRevenueImpact(EMPTY_PLAN);
  const atRisk = Object.values(impact.perItem).filter((v) => v.type === "at_risk");
  assert.ok(atRisk.length >= 3);
  assert.equal(impact.totalAtRisk, Math.max(...atRisk.map((v) => v.high)));
});

test("institutional-source gap prices the weight delta for the primary's group", () => {
  const plan = buildFollowUpPlan({
    admission_details: { admission_source: "Hospital discharge" },
    diagnoses: { primary_icd10: "I50.9", recent_hospitalizations: [] },
  });
  assert.ok(plan.items.some((i) => i.id === "institutional_dates_missing"));
  const impact = estimateFollowUpRevenueImpact(plan);
  const w = DEFAULT_PDGM_RATES.clinicalGroupWeights.MMTA_Cardiac_Circulatory;
  const expected = Math.round(DEFAULT_PDGM_RATES.basePaymentRate * (w.institutional_early - w.community_early));
  assert.equal(impact.perItem.institutional_dates_missing.type, "upside");
  assert.equal(impact.perItem.institutional_dates_missing.low, expected);
});

test("uncoded comorbidities price the comorbidity-adjustment range", () => {
  const plan = buildFollowUpPlan({
    diagnoses: { primary_icd10: "I50.9", secondary_diagnoses: ["Generalized weakness"] },
  });
  const impact = estimateFollowUpRevenueImpact(plan);
  const entry = impact.perItem.uncoded_diagnoses;
  assert.equal(entry.type, "upside");
  assert.ok(entry.high > entry.low && entry.low > 0);
});

test("unquantifiable items are omitted, never guessed", () => {
  const plan = buildFollowUpPlan({
    diagnoses: { primary_diagnosis: "Heart failure, unspecified (I50.9)", primary_icd10: "I50.9" },
  });
  assert.ok(plan.items.some((i) => i.id === "unspecified_primary"));
  const impact = estimateFollowUpRevenueImpact(plan);
  assert.equal(impact.perItem.unspecified_primary, undefined);
  assert.equal(impact.perItem.medications_missing, undefined);
});

test("agency rate overrides flow into the estimates", () => {
  const impact = estimateFollowUpRevenueImpact(EMPTY_PLAN, { rates: { basePaymentRate: 1000 } });
  assert.equal(impact.perItem.f2f_missing.low, 1000);
});

test("fmtUsd renders rounded dollars", () => {
  assert.equal(fmtUsd(2038.22), "$2,038");
});
