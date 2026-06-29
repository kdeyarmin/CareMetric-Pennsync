import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PDGM_RATES,
  mergePdgmRates,
  deepMergeNumbers,
  DEFAULT_ICD10_CLINICAL_GROUPS,
  effectiveIcdGroups,
} from "./pdgmRates.js";

test("no override returns the defaults unchanged", () => {
  assert.deepEqual(mergePdgmRates(undefined), DEFAULT_PDGM_RATES);
  assert.deepEqual(mergePdgmRates(null), DEFAULT_PDGM_RATES);
  assert.deepEqual(mergePdgmRates({}), DEFAULT_PDGM_RATES);
});

test("a single overridden weight replaces only that number", () => {
  const merged = mergePdgmRates({
    clinicalGroupWeights: { MMTA_Wounds: { community_early: 1.5 } },
  });
  assert.equal(merged.clinicalGroupWeights.MMTA_Wounds.community_early, 1.5);
  // siblings preserved
  assert.equal(
    merged.clinicalGroupWeights.MMTA_Wounds.community_late,
    DEFAULT_PDGM_RATES.clinicalGroupWeights.MMTA_Wounds.community_late
  );
  // other groups untouched
  assert.deepEqual(
    merged.clinicalGroupWeights.MMTA_Cardiac_Circulatory,
    DEFAULT_PDGM_RATES.clinicalGroupWeights.MMTA_Cardiac_Circulatory
  );
});

test("base payment rate and nested multipliers can be overridden", () => {
  const merged = mergePdgmRates({
    basePaymentRate: 2100.5,
    comorbidityMultipliers: { community_early: { high: 1.09 } },
    functionalThresholds: { community_early: { high: 19 } },
  });
  assert.equal(merged.basePaymentRate, 2100.5);
  assert.equal(merged.comorbidityMultipliers.community_early.high, 1.09);
  assert.equal(merged.comorbidityMultipliers.community_early.low, DEFAULT_PDGM_RATES.comorbidityMultipliers.community_early.low);
  assert.equal(merged.functionalThresholds.community_early.high, 19);
  assert.equal(merged.functionalThresholds.community_early.low, DEFAULT_PDGM_RATES.functionalThresholds.community_early.low);
});

test("non-numeric / malformed overrides never blank a default", () => {
  const merged = mergePdgmRates({
    basePaymentRate: "not-a-number",
    clinicalGroupWeights: { MMTA_Wounds: { community_early: NaN, community_late: null } },
  });
  assert.equal(merged.basePaymentRate, DEFAULT_PDGM_RATES.basePaymentRate);
  assert.equal(merged.clinicalGroupWeights.MMTA_Wounds.community_early, DEFAULT_PDGM_RATES.clinicalGroupWeights.MMTA_Wounds.community_early);
  assert.equal(merged.clinicalGroupWeights.MMTA_Wounds.community_late, DEFAULT_PDGM_RATES.clinicalGroupWeights.MMTA_Wounds.community_late);
});

test("the merge is non-mutating", () => {
  const before = JSON.stringify(DEFAULT_PDGM_RATES);
  deepMergeNumbers(DEFAULT_PDGM_RATES, { basePaymentRate: 9999 });
  assert.equal(JSON.stringify(DEFAULT_PDGM_RATES), before);
});

test("an unknown group can be added without disturbing known ones", () => {
  const merged = mergePdgmRates({
    clinicalGroupWeights: { Custom_Group: { community_early: 1.11 } },
  });
  assert.equal(merged.clinicalGroupWeights.Custom_Group.community_early, 1.11);
  assert.ok(merged.clinicalGroupWeights.MMTA_Wounds); // defaults intact
});

test("ICD map has no 'S' default (S is the injury chapter, not skin)", () => {
  assert.equal(DEFAULT_ICD10_CLINICAL_GROUPS.S, undefined);
  assert.equal(DEFAULT_ICD10_CLINICAL_GROUPS.L, "MMTA_Wounds"); // skin chapter
});

test("effectiveIcdGroups falls back to defaults when empty/unset, else uses the saved map verbatim", () => {
  assert.equal(effectiveIcdGroups(undefined), DEFAULT_ICD10_CLINICAL_GROUPS);
  assert.equal(effectiveIcdGroups(null), DEFAULT_ICD10_CLINICAL_GROUPS);
  assert.equal(effectiveIcdGroups({}), DEFAULT_ICD10_CLINICAL_GROUPS);
  // A saved map is used as-is — supports add/edit AND remove.
  const saved = { I: "MMTA_Cardiac_Circulatory", S: "MMTA_Musculoskeletal" };
  assert.equal(effectiveIcdGroups(saved), saved);
});
