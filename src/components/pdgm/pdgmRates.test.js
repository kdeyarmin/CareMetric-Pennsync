import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PDGM_RATES,
  mergePdgmRates,
  deepMergeNumbers,
  DEFAULT_ICD10_CLINICAL_GROUPS,
  effectiveIcdGroups,
  computeFunctionalLevelHighShape,
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

test("functionalThresholds use the backend-mirrored { low, high } timing-keyed shape (NOT the grouper's { low, medium })", () => {
  // Guard against conflating this revenue-estimator table with
  // pdgmGrouper.groupPeriod()'s clinical-group-keyed { low, medium } shape.
  // calculatePDGM (entry.ts) reads `.high` as the High cutoff; renaming it to
  // `medium` would break backend parity and silently corrupt level assignment.
  const buckets = ["community_early", "community_late", "institutional_early", "institutional_late"];
  for (const bucket of buckets) {
    const t = DEFAULT_PDGM_RATES.functionalThresholds[bucket];
    assert.ok(t, `missing threshold bucket ${bucket}`);
    assert.equal(typeof t.low, "number", `${bucket}.low must be numeric`);
    assert.equal(typeof t.high, "number", `${bucket}.high must be numeric`);
    assert.equal(t.medium, undefined, `${bucket} must NOT carry a 'medium' key (that is the grouper's shape)`);
    assert.ok(t.high > t.low, `${bucket}: high must exceed low`);
  }
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

// ── Live-path functional boundary (calculatePDGM shape) ───────────────────────
// points >= high → high; points >= low → medium (incl. points == low); else low.
// Distinct from pdgmGrouper.computeFunctionalLevel (points <= low → low).

test("computeFunctionalLevelHighShape: boundary at low is medium (live path)", () => {
  const t = { low: 9, high: 18 };
  assert.equal(computeFunctionalLevelHighShape(8, t), "low");
  assert.equal(computeFunctionalLevelHighShape(9, t), "medium"); // == low
  assert.equal(computeFunctionalLevelHighShape(17, t), "medium");
  assert.equal(computeFunctionalLevelHighShape(18, t), "high"); // == high
  assert.equal(computeFunctionalLevelHighShape(19, t), "high");
});

test("computeFunctionalLevelHighShape: rejects malformed inputs", () => {
  assert.equal(computeFunctionalLevelHighShape(5, null), null);
  assert.equal(computeFunctionalLevelHighShape(5, { low: 9 }), null);
  assert.equal(computeFunctionalLevelHighShape(NaN, { low: 9, high: 18 }), null);
  assert.equal(computeFunctionalLevelHighShape("9", { low: 9, high: 18 }), null);
});

test("computeFunctionalLevelHighShape: default community_early thresholds", () => {
  const t = DEFAULT_PDGM_RATES.functionalThresholds.community_early;
  assert.equal(computeFunctionalLevelHighShape(t.low - 1, t), "low");
  assert.equal(computeFunctionalLevelHighShape(t.low, t), "medium");
  assert.equal(computeFunctionalLevelHighShape(t.high - 1, t), "medium");
  assert.equal(computeFunctionalLevelHighShape(t.high, t), "high");
});
