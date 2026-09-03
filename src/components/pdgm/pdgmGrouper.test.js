import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTiming,
  computeAdmissionSource,
  computeM1033Points,
  computeFunctionalPoints,
  computeFunctionalLevel,
  assignClinicalGroup,
  assignComorbidityAdjustment,
  lookupCaseMix,
  caseMixKey,
  groupPeriod,
  UNSUPPORTED_CMS_GROUPING_BEHAVIORS,
} from "./pdgmGrouper.js";
import {
  CMS_PDGM_FUNCTIONAL_ITEM_POINTS_CY2026,
  CMS_PDGM_M1033_SCORING_CY2026,
} from "./cmsPdgmFunctionalDataCy2026.js";

const CARDIAC_GROUP = "MMTA - Cardiac and Circulatory";

/** @returns {Record<string, string>} */
function m1033Answers(selected = []) {
  const selectedSet = new Set(selected);
  const answers = Object.fromEntries(
    CMS_PDGM_M1033_SCORING_CY2026.itemIds.map((itemId) => [itemId, selectedSet.has(itemId) ? "1" : "0"]),
  );
  answers[CMS_PDGM_M1033_SCORING_CY2026.noneAboveItemId] = selected.length === 0 ? "1" : "0";
  return answers;
}

/** @type {Readonly<Record<string, string>>} */
const COMPLETE_FUNCTIONAL_ANSWERS = Object.freeze({
  ...m1033Answers(["M1033_HOSP_RISK_HSTRY_FALLS"]),
  M1800: "0",
  M1810: "0",
  M1820: "0",
  M1830: "3",
  M1840: "2",
  M1850: "0",
  M1860: "4",
});

// Small diagnosis/case-mix fixture. Functional response points and Cardiac
// threshold boundaries are the actual CY 2026 CMS values; diagnosis and HIPPS
// rows remain illustrative and can never make groupPeriod complete.
const CMS = {
  itemPoints: CMS_PDGM_FUNCTIONAL_ITEM_POINTS_CY2026,
  m1033: CMS_PDGM_M1033_SCORING_CY2026,
  functionalThresholds: { [CARDIAC_GROUP]: { low: 28, high: 44 } },
  dxToGroup: { I509: CARDIAC_GROUP },
  comorbidity: {
    subgroups: { E119: "Endocrine", N183: "Renal", J449: "Respiratory" },
    lowSubgroups: ["Endocrine"],
    interactions: [["Endocrine", "Renal"]],
  },
  caseMixTable: {
    [`early|community|${CARDIAC_GROUP}|medium|low`]: { hipps: "1AA11", weight: 1.0234 },
  },
};

test("timing helper rejects fractional and invalid period numbers", () => {
  assert.equal(computeTiming(1), "early");
  assert.equal(computeTiming(2), "late");
  assert.equal(computeTiming(1.5), null);
  assert.equal(computeTiming(0), null);
  assert.equal(computeTiming("x"), null);
});

test("admission-source helper requires an explicit boolean", () => {
  assert.equal(computeAdmissionSource({ hadInstitutionalStay: true }), "institutional");
  assert.equal(computeAdmissionSource({ hadInstitutionalStay: false }), "community");
  assert.equal(computeAdmissionSource(), null);
  assert.equal(computeAdmissionSource(/** @type {any} */ ({ hadInstitutionalStay: "false" })), null);
});

test("CY 2026 functional point mappings match the CMS FI_Responses table", () => {
  const p = CMS_PDGM_FUNCTIONAL_ITEM_POINTS_CY2026;
  assert.deepEqual(p.M1800, { "0": 0, "1": 0, "2": 3, "3": 3 });
  assert.deepEqual(p.M1810, { "0": 0, "1": 0, "2": 5, "3": 5 });
  assert.deepEqual(p.M1820, { "0": 0, "1": 0, "2": 4, "3": 12 });
  assert.deepEqual(p.M1850, { "0": 0, "1": 1, "2": 4, "3": 4, "4": 4, "5": 4 });
  assert.deepEqual(p.M1860, { "0": 0, "1": 0, "2": 5, "3": 1, "4": 20, "5": 20, "6": 20 });
});

test("M1033: four qualifying risks score 12 points", () => {
  const selected = CMS_PDGM_M1033_SCORING_CY2026.scoringItemIds.slice(0, 4);
  const result = computeM1033Points(m1033Answers(selected), CMS_PDGM_M1033_SCORING_CY2026);
  assert.equal(result.points, 12);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unmapped, []);
  assert.deepEqual(result.inconsistent, []);
});

test("M1033: fewer than four qualifying risks score zero", () => {
  const selected = CMS_PDGM_M1033_SCORING_CY2026.scoringItemIds.slice(0, 3);
  assert.equal(
    computeM1033Points(m1033Answers(selected), CMS_PDGM_M1033_SCORING_CY2026).points,
    0,
  );
});

test("M1033: exhaustion and other-risk are validated but ignored for scoring", () => {
  const answers = m1033Answers([
    "M1033_HOSP_RISK_CRNT_EXHSTN",
    "M1033_HOSP_RISK_OTHR_RISK",
  ]);
  assert.equal(computeM1033Points(answers, CMS_PDGM_M1033_SCORING_CY2026).points, 0);
});

test("M1033: missing, non-binary, all-zero, and contradictory responses fail closed", () => {
  const missing = m1033Answers(["M1033_HOSP_RISK_HSTRY_FALLS"]);
  delete missing.M1033_HOSP_RISK_WEIGHT_LOSS;
  const missingResult = computeM1033Points(missing, CMS_PDGM_M1033_SCORING_CY2026);
  assert.equal(missingResult.points, null);
  assert.ok(missingResult.missing.includes("M1033_HOSP_RISK_WEIGHT_LOSS"));

  const invalid = m1033Answers(["M1033_HOSP_RISK_HSTRY_FALLS"]);
  invalid.M1033_HOSP_RISK_WEIGHT_LOSS = "2";
  assert.equal(computeM1033Points(invalid, CMS_PDGM_M1033_SCORING_CY2026).points, null);

  const allZero = m1033Answers(["M1033_HOSP_RISK_HSTRY_FALLS"]);
  allZero.M1033_HOSP_RISK_HSTRY_FALLS = "0";
  assert.equal(computeM1033Points(allZero, CMS_PDGM_M1033_SCORING_CY2026).points, null);

  const contradictory = m1033Answers(["M1033_HOSP_RISK_HSTRY_FALLS"]);
  contradictory.M1033_HOSP_RISK_NONE_ABOVE = "1";
  assert.equal(computeM1033Points(contradictory, CMS_PDGM_M1033_SCORING_CY2026).points, null);
});

test("functional points require every M1033 and M1800-M1860 answer", () => {
  const result = computeFunctionalPoints(COMPLETE_FUNCTIONAL_ANSWERS, CMS.itemPoints, CMS.m1033);
  assert.equal(result.points, 36); // M1830=10 + M1840=6 + M1860=20
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unmapped, []);
  assert.deepEqual(result.inconsistent, []);

  const partial = { ...COMPLETE_FUNCTIONAL_ANSWERS };
  delete partial.M1850;
  const incomplete = computeFunctionalPoints(partial, CMS.itemPoints, CMS.m1033);
  assert.equal(incomplete.points, null);
  assert.deepEqual(incomplete.missing, ["M1850"]);

  const empty = computeFunctionalPoints({}, CMS.itemPoints, CMS.m1033);
  assert.equal(empty.points, null);
  assert.equal(empty.missing.length, 17); // ten M1033 flags + seven M18xx items
});

test("functional points reject a present response absent from the CMS table", () => {
  const answers = { ...COMPLETE_FUNCTIONAL_ANSWERS, M1860: "9" };
  const result = computeFunctionalPoints(answers, CMS.itemPoints, CMS.m1033);
  assert.equal(result.points, null);
  assert.deepEqual(result.unmapped, ["M1860=9"]);
});

test("functional levels use CMS LOW_POINT/HIGH_POINT boundary semantics", () => {
  const thresholds = { low: 28, high: 44 };
  assert.equal(computeFunctionalLevel(28, thresholds), "low");
  assert.equal(computeFunctionalLevel(29, thresholds), "medium");
  assert.equal(computeFunctionalLevel(43, thresholds), "medium");
  assert.equal(computeFunctionalLevel(44, thresholds), "high");
});

test("functional levels reject malformed thresholds and non-finite points", () => {
  assert.equal(computeFunctionalLevel(Number.NaN, { low: 28, high: 44 }), null);
  assert.equal(computeFunctionalLevel(Number.POSITIVE_INFINITY, { low: 28, high: 44 }), null);
  assert.equal(computeFunctionalLevel(30, { low: 44, high: 28 }), null);
  assert.equal(computeFunctionalLevel(30, { low: 28, medium: 43 }), null);
});

test("clinical group lookup normalizes ICD punctuation but does not guess", () => {
  assert.equal(assignClinicalGroup("I50.9", CMS.dxToGroup), CARDIAC_GROUP);
  assert.equal(assignClinicalGroup("Z99.9", CMS.dxToGroup), null);
  assert.equal(assignClinicalGroup("I50.9", null), null);
});

test("comorbidity helper requires low flags and interactions", () => {
  assert.equal(assignComorbidityAdjustment(["E11.9", "N18.3"], CMS.comorbidity), "high");
  assert.equal(assignComorbidityAdjustment(["E11.9"], CMS.comorbidity), "low");
  assert.equal(assignComorbidityAdjustment(["J44.9"], CMS.comorbidity), "none");
  assert.equal(assignComorbidityAdjustment([], CMS.comorbidity), "none");
  assert.equal(assignComorbidityAdjustment(["E11.9"], { subgroups: CMS.comorbidity.subgroups }), null);
});

test("case-mix lookup remains a deterministic, non-billing helper", () => {
  const variables = {
    timing: "early",
    admissionSource: "community",
    clinicalGroup: CARDIAC_GROUP,
    functionalLevel: "medium",
    comorbidityLevel: "low",
  };
  const key = caseMixKey(variables);
  assert.equal(lookupCaseMix(variables, CMS.caseMixTable).hipps, "1AA11");
  assert.ok(key.startsWith("early|community"));
});

test("groupPeriod never reports complete while full HHGS behaviors are unsupported", () => {
  const result = groupPeriod(
    {
      periodNumber: 1,
      hadInstitutionalStay: false,
      principalDiagnosis: "I50.9",
      secondaryDiagnoses: ["E11.9"],
      answers: COMPLETE_FUNCTIONAL_ANSWERS,
      responseSchemaId: "pennsync-oasis-response-v2-cms-e2",
    },
    CMS,
  );
  assert.equal(result.complete, false);
  assert.equal(result.functionalPoints, 36);
  assert.equal(result.functionalLevel, "medium");
  assert.equal(result.hipps, null);
  assert.equal(result.caseMixWeight, null);
  assert.deepEqual(result.unsupported, UNSUPPORTED_CMS_GROUPING_BEHAVIORS);
  for (const blocker of UNSUPPORTED_CMS_GROUPING_BEHAVIORS) {
    assert.ok(result.missing.includes(blocker));
  }
});

test("groupPeriod reports omitted functional and admission inputs instead of defaulting", () => {
  const partialAnswers = { ...COMPLETE_FUNCTIONAL_ANSWERS };
  delete partialAnswers.M1800;
  delete partialAnswers.M1033_HOSP_RISK_WEIGHT_LOSS;
  const result = groupPeriod(
    {
      periodNumber: 1,
      principalDiagnosis: "I50.9",
      answers: partialAnswers,
      responseSchemaId: "pennsync-oasis-response-v2-cms-e2",
    },
    CMS,
  );
  assert.equal(result.complete, false);
  assert.equal(result.functionalPoints, null);
  assert.ok(result.missing.some((message) => message.includes("admission source")));
  assert.ok(result.missing.some((message) => message.includes("secondary diagnosis list")));
  assert.ok(result.missing.some((message) => message.includes("M1800")));
  assert.ok(result.missing.some((message) => message.includes("M1033_HOSP_RISK_WEIGHT_LOSS")));
});

test("the app's legacy single M1033 tier is never treated as official flags", () => {
  const result = groupPeriod(
    {
      periodNumber: 1,
      hadInstitutionalStay: false,
      principalDiagnosis: "I50.9",
      secondaryDiagnoses: [],
      answers: { m1033: "high", M1800: "0", M1810: "0", M1820: "0", M1830: "0", M1840: "0", M1850: "0", M1860: "0" },
      responseSchemaId: "pennsync-oasis-response-v2-cms-e2",
    },
    CMS,
  );
  assert.equal(result.complete, false);
  assert.ok(result.missing.some((message) => message.includes("M1033_HOSP_RISK_HSTRY_FALLS")));
});

test("legacy or unversioned functional answers remain incomplete", () => {
  for (const responseSchemaId of [undefined, "pennsync-oasis-response-v1-legacy"]) {
    const result = groupPeriod(
      {
        periodNumber: 1,
        hadInstitutionalStay: false,
        principalDiagnosis: "I50.9",
        secondaryDiagnoses: [],
        answers: COMPLETE_FUNCTIONAL_ANSWERS,
        ...(responseSchemaId ? { responseSchemaId } : {}),
      },
      CMS,
    );
    assert.equal(result.complete, false);
    assert.ok(result.missing.some((message) => /response schema/.test(message)));
  }
});

test("missing or incomplete CMS tables are named explicitly", () => {
  const result = groupPeriod(
    {
      periodNumber: 1,
      hadInstitutionalStay: false,
      principalDiagnosis: "I50.9",
      secondaryDiagnoses: [],
      answers: COMPLETE_FUNCTIONAL_ANSWERS,
      responseSchemaId: "pennsync-oasis-response-v2-cms-e2",
    },
    {},
  );
  assert.equal(result.complete, false);
  assert.ok(result.missing.some((message) => /clinical-group table/.test(message)));
  assert.ok(result.missing.some((message) => /M1033/.test(message)));
  assert.ok(result.missing.some((message) => /comorbidity/.test(message)));
  assert.ok(result.missing.some((message) => /case-mix/.test(message)));
});
