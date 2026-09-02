import test from "node:test";
import assert from "node:assert/strict";
import { buildFollowUpPlan } from "./referralFollowUpEngine.js";
import { estimateFollowUpRevenueImpact, fmtUsd } from "./followUpRevenueImpact.js";

const EMPTY_PLAN = buildFollowUpPlan({});

test("follow-up revenue impact is globally unavailable and never becomes $0", () => {
  const impact = estimateFollowUpRevenueImpact(EMPTY_PLAN);
  assert.equal(impact.available, false);
  assert.equal(impact.isEstimate, false);
  assert.equal(impact.totalAtRisk, null);
  assert.equal(impact.totalUpsideLow, null);
  assert.equal(impact.totalUpsideHigh, null);
  assert.deepEqual(impact.perItem, {});
  assert.match(impact.message, /not a \$0 result/);
});

test("caller-supplied diagnoses and rate tables cannot unlock referral dollars", () => {
  const plan = buildFollowUpPlan({
    admission_details: { admission_source: "Hospital discharge" },
    diagnoses: { primary_icd10: "I50.9", recent_hospitalizations: [] },
  });
  const impact = estimateFollowUpRevenueImpact(plan, {
    rates: {
      basePaymentRate: 999999,
      clinicalGroupWeights: { MMTA_Cardiac_Circulatory: { institutional_early: 99 } },
    },
  });
  assert.equal(impact.available, false);
  assert.equal(impact.totalAtRisk, null);
  assert.deepEqual(impact.perItem, {});
});

test("fmtUsd preserves a real zero but never formats unavailable as $0", () => {
  assert.equal(fmtUsd(null), "Unavailable");
  assert.equal(fmtUsd(Number.NaN), "Unavailable");
  assert.equal(fmtUsd(0), "$0");
  assert.equal(fmtUsd(2038.22), "$2,038");
});
