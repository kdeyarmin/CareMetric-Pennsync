import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTiming,
  computeAdmissionSource,
  computeFunctionalPoints,
  computeFunctionalLevel,
  assignClinicalGroup,
  assignComorbidityAdjustment,
  lookupCaseMix,
  caseMixKey,
  groupPeriod,
} from "./pdgmGrouper.js";

// ── ILLUSTRATIVE fixture only — NOT official CMS data. Real grouping requires
//    the agency's current CMS PDGM tables. ──
const CMS = {
  itemPoints: {
    m1860: { "0": 0, "1": 1, "2": 2, "3": 5 },
    m1830: { "0": 0, "1": 2, "2": 3 },
  },
  functionalThresholds: { low: 1, medium: 4 },
  dxToGroup: {
    I509: "MMTA - Cardiac and Circulatory",
    S72001A: "Musculoskeletal Rehabilitation",
  },
  comorbidity: {
    subgroups: { E119: "Endocrine", N183: "Renal" },
    interactions: [["Endocrine", "Renal"]],
  },
  caseMixTable: {
    "early|community|MMTA - Cardiac and Circulatory|medium|low": { hipps: "1AA11", weight: 1.0234 },
  },
};

test("timing: first period early, later periods late", () => {
  assert.equal(computeTiming(1), "early");
  assert.equal(computeTiming(2), "late");
  assert.equal(computeTiming(0), null);
  assert.equal(computeTiming("x"), null);
});

test("admission source", () => {
  assert.equal(computeAdmissionSource({ hadInstitutionalStay: true }), "institutional");
  assert.equal(computeAdmissionSource({ hadInstitutionalStay: false }), "community");
  assert.equal(computeAdmissionSource(), "community");
});

test("functional points sum from the supplied table (string or number responses)", () => {
  const fp = computeFunctionalPoints({ m1860: "3", m1830: 2 }, CMS.itemPoints);
  assert.equal(fp.points, 8); // 5 + 3
});

test("functional points: missing/empty answers skipped, no table → null", () => {
  assert.equal(computeFunctionalPoints({ m1860: "" }, CMS.itemPoints).points, 0);
  assert.equal(computeFunctionalPoints({ m1860: 1 }, null), null);
});

test("functional level thresholds", () => {
  const t = CMS.functionalThresholds;
  assert.equal(computeFunctionalLevel(1, t), "low");
  assert.equal(computeFunctionalLevel(4, t), "medium");
  assert.equal(computeFunctionalLevel(5, t), "high");
  assert.equal(computeFunctionalLevel(2, null), null);
});

test("clinical group lookup normalizes the ICD code; unknown → null (no guess)", () => {
  assert.equal(assignClinicalGroup("I50.9", CMS.dxToGroup), "MMTA - Cardiac and Circulatory");
  assert.equal(assignClinicalGroup("Z99.9", CMS.dxToGroup), null);
  assert.equal(assignClinicalGroup("I50.9", null), null);
});

test("comorbidity: interaction → high, single subgroup → low, none → none", () => {
  assert.equal(assignComorbidityAdjustment(["E11.9", "N18.3"], CMS.comorbidity), "high");
  assert.equal(assignComorbidityAdjustment(["E11.9"], CMS.comorbidity), "low");
  assert.equal(assignComorbidityAdjustment(["Z00.0"], CMS.comorbidity), "none");
  assert.equal(assignComorbidityAdjustment([], CMS.comorbidity), "none");
});

test("case-mix lookup", () => {
  const key = caseMixKey({ timing: "early", admissionSource: "community", clinicalGroup: "MMTA - Cardiac and Circulatory", functionalLevel: "medium", comorbidityLevel: "low" });
  assert.equal(lookupCaseMix({ timing: "early", admissionSource: "community", clinicalGroup: "MMTA - Cardiac and Circulatory", functionalLevel: "medium", comorbidityLevel: "low" }, CMS.caseMixTable).hipps, "1AA11");
  assert.ok(key.includes("early|community"));
});

test("groupPeriod: complete when all tables resolve", () => {
  const result = groupPeriod(
    { periodNumber: 1, hadInstitutionalStay: false, principalDiagnosis: "I50.9", secondaryDiagnoses: ["E11.9"], answers: { m1860: "2", m1830: "1" } },
    CMS
  );
  assert.equal(result.complete, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.clinicalGroup, "MMTA - Cardiac and Circulatory");
  assert.equal(result.functionalLevel, "medium"); // 2 + 2 = 4
  assert.equal(result.comorbidityLevel, "low");
  assert.equal(result.hipps, "1AA11");
  assert.equal(result.caseMixWeight, 1.0234);
});

test("groupPeriod: NEVER guesses — incomplete without CMS tables", () => {
  const result = groupPeriod({ periodNumber: 1, principalDiagnosis: "I50.9", answers: { m1860: "2" } }, {});
  assert.equal(result.complete, false);
  assert.equal(result.hipps, null);
  assert.equal(result.caseMixWeight, null);
  assert.ok(result.missing.some((m) => /clinical-group table/.test(m)));
  assert.ok(result.missing.some((m) => /functional/.test(m)));
});

test("groupPeriod: unknown principal Dx is reported, not fabricated", () => {
  const result = groupPeriod(
    { periodNumber: 2, principalDiagnosis: "Z99.9", secondaryDiagnoses: [], answers: { m1860: "1", m1830: "1" } },
    CMS
  );
  assert.equal(result.complete, false);
  assert.equal(result.clinicalGroup, null);
  assert.ok(result.missing.some((m) => /clinical group for principal Dx/.test(m)));
});

// ── no-guessing hardening (review findings) ──

test("computeFunctionalLevel: malformed thresholds → null, never a fabricated 'high'", () => {
  assert.equal(computeFunctionalLevel(3, {}), null); // no low/medium
  assert.equal(computeFunctionalLevel(3, { low: 1 }), null); // medium missing
  assert.equal(computeFunctionalLevel(3, { low: "1", medium: "4" }), null); // non-numeric
});

test("computeFunctionalPoints: a present response absent from the table is reported, not zeroed", () => {
  const fp = computeFunctionalPoints({ m1860: "9", m1830: "1" }, CMS.itemPoints); // "9" not in m1860 table
  assert.equal(fp.points, 2); // only m1830="1" → 2 scored
  assert.deepEqual(fp.unmapped, ["m1860=9"]);
});

test("groupPeriod: functionalThresholds keyed by clinical group resolves per group", () => {
  const cms = {
    ...CMS,
    functionalThresholds: { "MMTA - Cardiac and Circulatory": { low: 1, medium: 4 } },
  };
  const result = groupPeriod(
    { periodNumber: 1, principalDiagnosis: "I50.9", secondaryDiagnoses: ["E11.9"], answers: { m1860: "2", m1830: "1" } },
    cms
  );
  assert.equal(result.complete, true);
  assert.equal(result.functionalLevel, "medium");
  assert.equal(result.hipps, "1AA11");
});

test("groupPeriod: group-keyed thresholds absent for the assigned group → incomplete, not 'high'", () => {
  const cms = { ...CMS, functionalThresholds: { Wound: { low: 1, medium: 4 } } }; // no cardiac entry
  const result = groupPeriod(
    { periodNumber: 1, principalDiagnosis: "I50.9", secondaryDiagnoses: [], answers: { m1860: "2", m1830: "1" } },
    cms
  );
  assert.equal(result.complete, false);
  assert.equal(result.functionalLevel, null); // NOT "high"
});

test("groupPeriod: present-but-unmapped functional response forces incomplete", () => {
  const result = groupPeriod(
    { periodNumber: 1, principalDiagnosis: "I50.9", secondaryDiagnoses: ["E11.9"], answers: { m1860: "9", m1830: "1" } },
    CMS
  );
  assert.equal(result.complete, false);
  assert.ok(result.missing.some((m) => /unmapped functional response/.test(m)));
  assert.ok(result.missing.some((m) => /m1860=9/.test(m)));
});

test("groupPeriod: absent caseMixTable reports a missing TABLE, not a phantom entry", () => {
  const cms = { ...CMS };
  delete cms.caseMixTable;
  const result = groupPeriod(
    { periodNumber: 1, principalDiagnosis: "I50.9", secondaryDiagnoses: ["E11.9"], answers: { m1860: "2", m1830: "1" } },
    cms
  );
  assert.equal(result.complete, false);
  assert.ok(result.missing.some((m) => /case-mix weight\/HIPPS table/.test(m)));
  assert.ok(!result.missing.some((m) => /entry for this combination/.test(m)));
});

test("groupPeriod: comorbidity table present but missing subgroups → reported (no 'null' in key)", () => {
  const cms = { ...CMS, comorbidity: {} }; // malformed: no subgroups
  const result = groupPeriod(
    { periodNumber: 1, principalDiagnosis: "I50.9", secondaryDiagnoses: ["E11.9"], answers: { m1860: "2", m1830: "1" } },
    cms
  );
  assert.equal(result.complete, false);
  assert.equal(result.comorbidityLevel, null);
  assert.ok(result.missing.some((m) => /comorbidity subgroup table/.test(m)));
});
