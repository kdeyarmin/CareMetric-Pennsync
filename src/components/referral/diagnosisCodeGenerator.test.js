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
  codeLabel,
  toPersistedCoding,
} from "./diagnosisCodeGenerator.js";
import { DEFAULT_ICD10_CLINICAL_GROUPS, DEFAULT_PDGM_RATES } from "../pdgm/pdgmRates.js";

// ── code recognition ──

test("isIcdCode accepts dotted, bare, and alphanumeric-category codes", () => {
  assert.equal(isIcdCode("I50.9"), true);
  assert.equal(isIcdCode("i509"), true);
  assert.equal(isIcdCode("I10"), true);
  assert.equal(isIcdCode("C4A.10"), true);
  assert.equal(isIcdCode("U07.1"), true); // U-chapter (COVID-19) is valid ICD-10-CM
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

test("extractIcdCodesFromText does not treat IV-fluid tokens as codes", () => {
  assert.deepEqual(extractIcdCodesFromText("IV D5W at 75 mL/hr, then D5NS"), []);
  // A real code alongside an infusion order is still found.
  const found = extractIcdCodesFromText("Dehydration E86.0, IV D5W ordered");
  assert.deepEqual(found.map((f) => f.code), ["E860"]);
});

test("extractIcdCodesFromText does not treat clinical abbreviations as codes", () => {
  // T2DM/L4L5-style tokens are code-shaped but not codes — they must go to
  // the coder queue, never be surfaced as ICD-10.
  assert.deepEqual(extractIcdCodesFromText("Type 2 diabetes mellitus (T2DM), uncontrolled"), []);
  assert.deepEqual(extractIcdCodesFromText("Laminectomy L4L5, s/p fall"), []);
  // Alpha-category codes are still harvested in dotted form.
  assert.deepEqual(extractIcdCodesFromText("Melanoma C4A.10").map((f) => f.code), ["C4A10"]);
});

test("U-chapter codes are harvested from text and dedicated fields", () => {
  assert.deepEqual(extractIcdCodesFromText("COVID-19 pneumonia (U07.1)").map((f) => f.code), ["U071"]);
  const { candidates } = harvestDiagnosisCandidates({
    diagnoses: { primary_icd10: "U07.1" },
  });
  assert.deepEqual(candidates.map((c) => c.code), ["U071"]);
});

test("abbreviation-only diagnoses land in the coder queue, not the sequence", () => {
  const result = generateDiagnosisCodes({
    diagnoses: { primary_diagnosis: "Type 2 diabetes mellitus (T2DM)" },
  });
  assert.equal(result.hasCodes, false);
  assert.equal(result.sequenced.length, 0);
  assert.ok(result.uncoded.some((u) => /diabetes/i.test(u.description)));
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

test("harvest supports the persisted quick-scan shape (diagnoses.icd10_codes)", () => {
  // ReferralIntake.handleCreateReferral nests the scan output under
  // extracted_data.diagnoses — codes there must not read as "uncoded".
  const { candidates } = harvestDiagnosisCandidates({
    diagnoses: {
      primary_diagnosis: "CHF",
      secondary_diagnoses: ["COPD"],
      icd10_codes: ["I50.9", "J44.9"],
    },
  });
  assert.deepEqual(candidates.map((c) => c.code).sort(), ["I509", "J449"]);
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

test("cerebrovascular sequelae (I6x) sequence as Neuro, not Cardiac", () => {
  // Post-stroke sequelae and hemorrhage codes must match the intake preview
  // (all I6* → Neuro) rather than falling through the "I" chapter to Cardiac.
  assert.equal(lookupClinicalGroup("I69.351", DEFAULT_ICD10_CLINICAL_GROUPS), "MMTA_Neuro_Rehab");
  assert.equal(lookupClinicalGroup("I61.9", DEFAULT_ICD10_CLINICAL_GROUPS), "MMTA_Neuro_Rehab");
  assert.equal(lookupClinicalGroup("I60.0", DEFAULT_ICD10_CLINICAL_GROUPS), "MMTA_Neuro_Rehab");
  // Non-cerebrovascular I codes are unchanged.
  assert.equal(lookupClinicalGroup("I10", DEFAULT_ICD10_CLINICAL_GROUPS), "MMTA_Cardiac_Circulatory");
  assert.equal(lookupClinicalGroup("I25.10", DEFAULT_ICD10_CLINICAL_GROUPS), "MMTA_Cardiac_Circulatory");
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
  // Z48.x is an acceptable surgical-aftercare principal under PDGM; use a
  // status/factor Z (Z79.4) so the fixture stays all-unacceptable.
  const result = generateDiagnosisCodes({
    diagnoses: { primary_icd10: "R26.9", secondary_diagnoses: ["Z79.4"] },
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

// ── persistence shape (Referral.diagnosis_coding) ──

test("codeLabel renders 'CODE — description' with a code-only fallback", () => {
  assert.equal(codeLabel({ displayCode: "I50.9", description: "CHF exacerbation" }), "I50.9 — CHF exacerbation");
  assert.equal(codeLabel({ displayCode: "I10", description: "" }), "I10");
  assert.equal(codeLabel(null), "");
});

test("toPersistedCoding distinguishes acceptable-candidate from chosen-primary", () => {
  // An RTP-acceptable code that the agency map can't weight: candidate exists
  // (has_acceptable_primary) but no PDGM primary was chosen (has_pdgm_primary).
  const unmapped = toPersistedCoding(
    generateDiagnosisCodes(
      { diagnoses: { primary_icd10: "I63.9" } },
      { icdGroups: { Q99: "MMTA_Other" } } // replace-semantics map missing I63
    )
  );
  assert.equal(unmapped.has_acceptable_primary, true);
  assert.equal(unmapped.has_pdgm_primary, false);
  // All-RTP referral: neither flag.
  const rtpOnly = toPersistedCoding(generateDiagnosisCodes({ diagnoses: { primary_icd10: "R26.9" } }));
  assert.equal(rtpOnly.has_acceptable_primary, false);
  assert.equal(rtpOnly.has_pdgm_primary, false);
});

test("toPersistedCoding produces the lean top-level Referral shape", () => {
  const persisted = toPersistedCoding(generateDiagnosisCodes(FULL_REFERRAL));
  assert.equal(persisted.has_acceptable_primary, true);
  assert.equal(persisted.has_pdgm_primary, true);
  assert.equal(persisted.sequenced[0].role, "primary");
  assert.equal(persisted.sequenced[0].code, "L89.153");
  assert.equal(persisted.scenario.admission_source, "institutional");
  // Evidence is reduced to paths — no verbatim quotes are persisted.
  for (const dx of persisted.sequenced) {
    assert.ok(Array.isArray(dx.evidence_paths));
    assert.equal(dx.evidence, undefined);
    assert.equal(typeof dx.evidence_paths[0], "string");
  }
  assert.ok(persisted.uncoded.some((u) => /generalized weakness/i.test(u.description)));
  assert.equal(toPersistedCoding(null), null);
});

test("uses the same default tables as the live PDGM model (drift guard)", () => {
  const result = generateDiagnosisCodes(FULL_REFERRAL);
  const expected =
    DEFAULT_PDGM_RATES.clinicalGroupWeights.MMTA_Wounds.institutional_early;
  assert.equal(result.primary.caseMixWeight, expected);
});

// ── Regression: fabricated-code guards (2026-07 review) ─────────────────────

test("clinical shorthand shaped like codes is never harvested", () => {
  assert.deepEqual(extractIcdCodesFromText("B12 deficiency anemia"), []);
  assert.deepEqual(extractIcdCodesFromText("T12 compression fracture, pain at T10-T11"), []);
  assert.deepEqual(extractIcdCodesFromText("gave amp of D50 for hypoglycemia"), []);
  // Past the anatomic vertebral range, a bare code still harvests.
  assert.equal(extractIcdCodesFromText("breast ca C50")[0]?.code, "C50");
});

test("a fabricated token can no longer steal the PDGM principal slot", () => {
  const result = generateDiagnosisCodes({
    diagnoses: {
      primary_icd10: "I50.9",
      secondary_diagnoses: ["B12 deficiency anemia", "T12 compression fracture"],
    },
  });
  assert.equal(result.primary?.code, "I509", "the documented I50.9 stays principal");
  assert.ok(!result.sequenced.some((d) => d.code === "B12" || d.code === "T12"));
});

test("a sentence period without a space does not eat a genuine bare code", () => {
  assert.equal(extractIcdCodesFromText("Primary dx I10.Ambulates independently")[0]?.code, "I10");
});
