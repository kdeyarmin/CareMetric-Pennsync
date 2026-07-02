import test from "node:test";
import assert from "node:assert/strict";
import {
  isIcdCode,
  extractIcdCodesFromText,
  harvestDiagnosisCandidates,
  lookupClinicalGroup,
  resolveScenario,
  generateDiagnosisCodes,
  formatIcd,
  formatClinicalGroup,
} from "./diagnosisCodeGenerator.js";
import { DEFAULT_ICD10_CLINICAL_GROUPS, DEFAULT_PDGM_RATES } from "../pdgm/pdgmRates.js";

// ── code recognition ──

test("isIcdCode accepts dotted, bare, and alphanumeric-category codes", () => {
  assert.equal(isIcdCode("I50.9"), true);
  assert.equal(isIcdCode("i509"), true);
  assert.equal(isIcdCode("I10"), true);
  assert.equal(isIcdCode("C4A.10"), true);
  assert.equal(isIcdCode("CHF"), false);
  assert.equal(isIcdCode("U99999999"), false);
  assert.equal(isIcdCode(""), false);
});

test("extractIcdCodesFromText finds dotted and bare codes in prose", () => {
  const found = extractIcdCodesFromText("CHF (I50.9), HTN I10, COPD exacerbation J44.1");
  assert.deepEqual(found.map((f) => f.code), ["I509", "J441", "I10"]);
});

test("extractIcdCodesFromText does not treat vitamin/room tokens as codes", () => {
  assert.deepEqual(extractIcdCodesFromText("Vitamin B12 deficiency, follow up in room B12"), []);
  // ...but a genuine bare code elsewhere in the same text is still found.
  const found = extractIcdCodesFromText("Vitamin B12 deficiency (E53.8)");
  assert.deepEqual(found.map((f) => f.code), ["E538"]);
});

test("formatIcd re-dots normalized codes for display", () => {
  assert.equal(formatIcd("I509"), "I50.9");
  assert.equal(formatIcd("I10"), "I10");
});

// ── harvesting: only codes present in the referral, never invented ──

const FULL_REFERRAL = {
  admission_details: { admission_source: "Hospital discharge - Penn Presbyterian" },
  diagnoses: {
    primary_diagnosis: "CHF exacerbation (I50.9)",
    primary_icd10: "I50.9",
    secondary_diagnoses: ["Type 2 diabetes E11.9", "COPD (J44.9)", "Generalized weakness"],
    comorbidity_adjustments: [],
  },
  oasis_assessment: {
    m1021_primary_diagnosis: "I50.9 - Heart failure, unspecified",
    m1023_other_diagnoses: ["E11.9", "Pressure ulcer sacrum L89.153"],
  },
};

test("harvest dedupes across fields and records evidence paths", () => {
  const { candidates } = harvestDiagnosisCandidates(FULL_REFERRAL);
  const codes = candidates.map((c) => c.code).sort();
  assert.deepEqual(codes, ["E119", "I509", "J449", "L89153"]);
  const chf = candidates.find((c) => c.code === "I509");
  assert.equal(chf.documentedAsPrimary, true);
  assert.ok(chf.evidence.length >= 2);
  assert.ok(chf.evidence.some((e) => e.path === "diagnoses.primary_icd10"));
});

test("uncoded diagnoses are queued for a coder, not auto-coded", () => {
  const { candidates, uncoded } = harvestDiagnosisCandidates(FULL_REFERRAL);
  assert.ok(uncoded.some((u) => /generalized weakness/i.test(u.description)));
  // The engine must not have conjured a code for it.
  assert.ok(!candidates.some((c) => /weakness/i.test(c.description)));
});

test("harvest supports the quick-scan shape (top-level fields)", () => {
  const { candidates } = harvestDiagnosisCandidates({
    primary_diagnosis: "CVA with hemiplegia",
    secondary_diagnoses: ["Atrial fibrillation I48.91"],
    icd10_codes: ["I63.9", "I48.91"],
  });
  assert.deepEqual(candidates.map((c) => c.code).sort(), ["I4891", "I639"]);
});

test("empty/absent referral data yields no candidates and no crash", () => {
  assert.deepEqual(harvestDiagnosisCandidates(null).candidates, []);
  assert.deepEqual(harvestDiagnosisCandidates({}).candidates, []);
});

// ── clinical-group lookup (longest prefix wins, mirrors calculatePDGM) ──

test("lookupClinicalGroup prefers the most specific prefix", () => {
  assert.equal(lookupClinicalGroup("I63.9", DEFAULT_ICD10_CLINICAL_GROUPS), "MMTA_Neuro_Rehab");
  assert.equal(lookupClinicalGroup("I50.9", DEFAULT_ICD10_CLINICAL_GROUPS), "MMTA_Cardiac_Circulatory");
  assert.equal(lookupClinicalGroup("L89.153", DEFAULT_ICD10_CLINICAL_GROUPS), "MMTA_Wounds");
  assert.equal(lookupClinicalGroup("S72.001A", DEFAULT_ICD10_CLINICAL_GROUPS), null); // no S entry on purpose
});

test("formatClinicalGroup humanizes group keys", () => {
  assert.equal(formatClinicalGroup("MMTA_Cardiac_Circulatory"), "Cardiac Circulatory");
  assert.equal(formatClinicalGroup(null), "Unmapped");
});

// ── scenario ──

test("resolveScenario: referral is always the early period; source drives the bucket", () => {
  const inst = resolveScenario(FULL_REFERRAL);
  assert.equal(inst.timing, "early");
  assert.equal(inst.admissionSource, "institutional");
  assert.equal(inst.bucket, "institutional_early");
  const comm = resolveScenario({ admission_details: { admission_source: "home / community" } });
  assert.equal(comm.bucket, "community_early");
  assert.equal(resolveScenario({}).bucket, "community_early");
});

// ── sequencing by the PDGM model ──

test("primary goes to the acceptable code with the highest case-mix weight", () => {
  const result = generateDiagnosisCodes(FULL_REFERRAL);
  // Wounds (L89.153) outweighs Cardiac (I50.9) in every default bucket.
  assert.equal(result.primary.code, "L89153");
  assert.equal(result.sequenced[0].role, "primary");
  assert.equal(result.sequenced[0].position, 1);
  // Every sequenced code came from the referral.
  const referralCodes = new Set(["I509", "E119", "J449", "L89153"]);
  for (const dx of result.sequenced) assert.ok(referralCodes.has(dx.code));
  // Secondaries are ordered by descending weight.
  const weights = result.sequenced.slice(1).map((d) => d.caseMixWeight ?? -1);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i - 1] >= weights[i]);
  // Re-sequencing away from the documented primary is flagged for review.
  assert.ok(result.warnings.some((w) => /documents I50\.9 as primary/.test(w)));
});

test("RTP-unacceptable codes never take the primary slot", () => {
  const result = generateDiagnosisCodes({
    diagnoses: {
      primary_icd10: "R26.9", // symptom code — RTP as principal
      secondary_diagnoses: ["E11.9"],
    },
  });
  assert.equal(result.primary.code, "E119");
  const r269 = result.sequenced.find((d) => d.code === "R269");
  assert.equal(r269.role, "secondary");
  assert.equal(r269.acceptablePrimary, false);
  assert.ok(r269.rtpReason);
});

test("all-unacceptable code sets produce no primary and a warning", () => {
  const result = generateDiagnosisCodes({
    diagnoses: { primary_icd10: "R26.9", secondary_diagnoses: ["Z48.00"] },
  });
  assert.equal(result.primary, null);
  assert.ok(result.warnings.some((w) => /principal diagnosis/i.test(w)));
  assert.equal(result.sequenced.every((d) => d.role === "secondary"), true);
});

test("no documented codes → hasCodes false and never-fabricate warning", () => {
  const result = generateDiagnosisCodes({
    diagnoses: { primary_diagnosis: "Congestive heart failure", secondary_diagnoses: ["Diabetes"] },
  });
  assert.equal(result.hasCodes, false);
  assert.equal(result.sequenced.length, 0);
  assert.equal(result.uncoded.length, 2);
  assert.ok(result.warnings.some((w) => /never auto-generated/i.test(w)));
});

test("agency rate/map overrides change the sequencing model", () => {
  // An agency override that boosts Endocrine above everything flips the primary.
  const result = generateDiagnosisCodes(FULL_REFERRAL, {
    rates: { clinicalGroupWeights: { MMTA_Endocrine: { institutional_early: 9.9 } } },
  });
  assert.equal(result.primary.code, "E119");
  // A replace-semantics ICD map with only one prefix leaves the rest unmapped.
  const mapped = generateDiagnosisCodes(FULL_REFERRAL, {
    icdGroups: { I50: "MMTA_Cardiac_Circulatory" },
  });
  assert.equal(mapped.primary.code, "I509");
  assert.ok(mapped.warnings.some((w) => /not in the agency's ICD-10/i.test(w)));
});

test("uses the same default tables as the live PDGM model (drift guard)", () => {
  const result = generateDiagnosisCodes(FULL_REFERRAL);
  const expected =
    DEFAULT_PDGM_RATES.clinicalGroupWeights.MMTA_Wounds.institutional_early;
  assert.equal(result.primary.caseMixWeight, expected);
});
