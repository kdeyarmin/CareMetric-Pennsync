import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFaceToFace,
  parseCredential,
  toFaceToFaceEncounter,
  referralToF2FInput,
  F2F_WINDOW_BEFORE_DAYS,
} from "./faceToFaceValidator.js";

// ── credential parsing ──

test("parses eligible credentials from free text", () => {
  assert.deepEqual(parseCredential("John Smith, MD"), { credential: "MD", eligible: true });
  assert.deepEqual(parseCredential("Jane Doe NP"), { credential: "NP", eligible: true });
  assert.deepEqual(parseCredential("Dr. Lee, DO"), { credential: "DO", eligible: true });
});

test("flags ineligible credentials", () => {
  assert.deepEqual(parseCredential("Mary Jones, RN"), { credential: "RN", eligible: false });
  assert.deepEqual(parseCredential("Bob PT"), { credential: "PT", eligible: false });
});

test("unknown credential returns null eligibility", () => {
  assert.deepEqual(parseCredential("Sam Taylor"), { credential: null, eligible: null });
});

// ── full validation happy path ──

const goodEncounter = {
  encounter_date: "2026-06-15",
  practitioner_name: "Dr. Alice Wong, MD",
  clinical_reason: "Acute exacerbation of congestive heart failure with dyspnea",
  documented_conditions: ["Congestive heart failure", "Hypertension"],
};

test("a compliant F2F is valid", () => {
  const res = validateFaceToFace({
    encounter: goodEncounter,
    socDate: "2026-06-20", // encounter 5 days before SOC
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(res.valid, true);
  assert.equal(res.status, "valid");
  assert.equal(res.days_from_soc, -5);
  assert.equal(res.checks.practitioner.eligible, true);
  assert.equal(res.checks.window.within_window, true);
  assert.equal(res.checks.linkage.linked, true);
});

// ── practitioner check ──

test("an RN encounter is invalid (ineligible practitioner)", () => {
  const res = validateFaceToFace({
    encounter: { ...goodEncounter, practitioner_name: "Nurse Betty, RN" },
    socDate: "2026-06-20",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(res.status, "invalid");
  assert.equal(res.valid, false);
});

// ── timing window ──

test("encounter more than 90 days before SOC is invalid", () => {
  const res = validateFaceToFace({
    encounter: { ...goodEncounter, encounter_date: "2026-01-01" },
    socDate: "2026-06-20",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(res.status, "invalid");
  assert.equal(res.checks.window.within_window, false);
  assert.ok(res.days_from_soc < -F2F_WINDOW_BEFORE_DAYS);
});

test("encounter within 30 days AFTER SOC is in window", () => {
  const res = validateFaceToFace({
    encounter: { ...goodEncounter, encounter_date: "2026-07-10" },
    socDate: "2026-06-20", // 20 days after
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(res.checks.window.within_window, true);
  assert.equal(res.days_from_soc, 20);
});

test("encounter more than 30 days after SOC is invalid", () => {
  const res = validateFaceToFace({
    encounter: { ...goodEncounter, encounter_date: "2026-08-01" },
    socDate: "2026-06-20",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(res.status, "invalid");
  assert.equal(res.checks.window.within_window, false);
});

// ── diagnosis linkage ──

test("encounter unrelated to the primary diagnosis is invalid", () => {
  const res = validateFaceToFace({
    encounter: { ...goodEncounter, clinical_reason: "Routine wellness check", documented_conditions: ["Seasonal allergies"] },
    socDate: "2026-06-20",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(res.checks.linkage.linked, false);
  assert.equal(res.status, "invalid");
});

test("a short abbreviation diagnosis that appears literally in the reason links", () => {
  const res = validateFaceToFace({
    encounter: { ...goodEncounter, documented_conditions: [], clinical_reason: "Acute CHF exacerbation" },
    socDate: "2026-06-20",
    primaryDiagnosis: "CHF",
  });
  assert.equal(res.checks.linkage.linked, true);
  assert.equal(res.valid, true);
});

test("a short abbreviation with no literal match is needs_review, NOT a hard fail", () => {
  const res = validateFaceToFace({
    encounter: { ...goodEncounter, documented_conditions: [], clinical_reason: "Cardiac decompensation" },
    socDate: "2026-06-20",
    primaryDiagnosis: "CHF",
  });
  assert.equal(res.checks.linkage.linked, null);
  assert.equal(res.status, "needs_review"); // not "invalid"
});

// ── needs review ──

test("missing SOC date yields needs_review, not a hard fail", () => {
  const res = validateFaceToFace({ encounter: goodEncounter, primaryDiagnosis: "Congestive heart failure" });
  assert.equal(res.status, "needs_review");
  assert.equal(res.valid, false);
  assert.equal(res.checks.window.within_window, null);
});

test("unknown practitioner (no credential) with everything else fine is needs_review", () => {
  const res = validateFaceToFace({
    encounter: { ...goodEncounter, practitioner_name: "Alice Wong" },
    socDate: "2026-06-20",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(res.checks.practitioner.eligible, null);
  assert.equal(res.status, "needs_review");
});

// ── entity mapping ──

test("toFaceToFaceEncounter builds an entity payload with the validation outcome", () => {
  const validation = validateFaceToFace({ encounter: goodEncounter, socDate: "2026-06-20", primaryDiagnosis: "Congestive heart failure" });
  const rec = toFaceToFaceEncounter(
    { referralId: "r1", patientId: "p1", encounter: goodEncounter, socDate: "2026-06-20", primaryDiagnosis: "Congestive heart failure" },
    validation,
  );
  assert.equal(rec.referral_id, "r1");
  assert.equal(rec.validation_status, "valid");
  assert.equal(rec.eligible_practitioner, true);
  assert.equal(rec.within_window, true);
  assert.equal(rec.diagnosis_linked, true);
  assert.equal(rec.days_from_soc, -5);
  assert.equal(rec.source, "referral_document");
});

// ── referral → validator input mapping ──

test("referralToF2FInput maps extracted_data.face_to_face onto validator input", () => {
  const referral = {
    diagnosis: "Congestive heart failure",
    estimated_start_date: "2026-06-20",
    extracted_data: {
      face_to_face: {
        encounter_date: "2026-06-15",
        practitioner_name: "Dr. Alice Wong",
        practitioner_type: "MD",
        clinical_reason: "Acute exacerbation of congestive heart failure",
      },
    },
  };
  const input = referralToF2FInput(referral);
  assert.equal(input.socDate, "2026-06-20");
  assert.equal(input.primaryDiagnosis, "Congestive heart failure");
  const res = validateFaceToFace(input);
  assert.equal(res.valid, true);
});

test("referralToF2FInput accepts the RAW extraction shape (top-level face_to_face)", () => {
  // ReferralPDFSummarizer passes extractedData directly to ReferralAnalyzer, so
  // face_to_face / diagnoses / admission_details are top-level (not nested).
  const rawExtraction = {
    diagnoses: { primary_diagnosis: "Congestive heart failure" },
    admission_details: { admission_date: "2026-06-20" },
    face_to_face: {
      encounter_date: "2026-06-15",
      practitioner_name: "Dr. Alice Wong",
      practitioner_type: "MD",
      clinical_reason: "Acute exacerbation of congestive heart failure",
    },
  };
  const input = referralToF2FInput(rawExtraction);
  assert.ok(input);
  assert.equal(input.socDate, "2026-06-20");
  assert.equal(input.primaryDiagnosis, "Congestive heart failure");
  assert.equal(validateFaceToFace(input).valid, true);
});

test("referralToF2FInput returns null when the referral carries no F2F block", () => {
  assert.equal(referralToF2FInput({ extracted_data: {} }), null);
  assert.equal(referralToF2FInput(null), null);
});

// ── Regression: credential parsing + linkage (2026-07 review) ───────────────

test("dotted and spelled-out credentials parse ('M.D.', 'Nurse Practitioner')", () => {
  assert.deepEqual(parseCredential("John Smith, M.D."), { credential: "MD", eligible: true });
  assert.deepEqual(parseCredential("Jane Roe, D.O."), { credential: "DO", eligible: true });
  assert.equal(parseCredential("Amy Lee, Nurse Practitioner").credential, "NP");
});

test("a surname spelling a credential does not validate the practitioner", () => {
  const out = validateFaceToFace({
    encounter: { practitioner_name: "Nguyen Do", encounter_date: "2026-07-01", clinical_reason: "Seen for congestive heart failure" },
    socDate: "2026-07-10",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(out.checks.practitioner.eligible, null, "'Do' as a surname is not an eligible-credential claim");
  assert.equal(out.status, "needs_review");
  // Written as an actual credential, it still parses.
  assert.equal(parseCredential("Nguyen Tran, DO", { fromName: true }).eligible, true);
});

test("an encounter documented with the standard abbreviation still links", () => {
  const out = validateFaceToFace({
    encounter: { practitioner_type: "MD", encounter_date: "2026-07-01", clinical_reason: "Seen for CHF exacerbation with worsening dyspnea" },
    socDate: "2026-07-10",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(out.checks.linkage.linked, true);
  assert.equal(out.status, "valid");
});

test("word forms of the diagnosis link ('hypertension' vs 'hypertensive')", () => {
  const out = validateFaceToFace({
    encounter: { practitioner_type: "MD", encounter_date: "2026-07-01", clinical_reason: "Hypertensive urgency managed with med adjustment" },
    socDate: "2026-07-10",
    primaryDiagnosis: "Hypertension",
  });
  assert.equal(out.checks.linkage.linked, true);
});

test("a generic shared token alone does not link (weak-necessity false pass)", () => {
  const out = validateFaceToFace({
    encounter: { practitioner_type: "MD", encounter_date: "2026-07-01", clinical_reason: "Evaluated for acute renal failure" },
    socDate: "2026-07-10",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(out.checks.linkage.linked, false, "'failure' alone must not link CHF to renal failure");
  assert.equal(out.status, "invalid");
});

// ── signature check ──

test("an explicitly UNSIGNED F2F routes to needs_review, never valid", () => {
  const out = validateFaceToFace({
    encounter: { ...goodEncounter, practitioner_type: "MD", practitioner_signature_present: false },
    socDate: "2026-06-20",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(out.status, "needs_review");
  assert.equal(out.checks.signature.present, false);
  assert.ok(out.reasons.some((r) => r.includes("UNSIGNED")));
});

test("a signed F2F stays valid and records the signed date", () => {
  const out = validateFaceToFace({
    encounter: {
      ...goodEncounter,
      practitioner_type: "MD",
      practitioner_signature_present: true,
      signed_date: "2026-06-15",
    },
    socDate: "2026-06-20",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(out.status, "valid");
  assert.equal(out.checks.signature.present, true);
  assert.ok(out.reasons.some((r) => r.includes("signed 2026-06-15")));
});

test("unknown signature presence is informational only (legacy extractions keep their status)", () => {
  const out = validateFaceToFace({
    encounter: { ...goodEncounter, practitioner_type: "MD" },
    socDate: "2026-06-20",
    primaryDiagnosis: "Congestive heart failure",
  });
  assert.equal(out.status, "valid");
  assert.equal(out.checks.signature.present, null);
  assert.ok(out.reasons.some((r) => r.includes("verify the F2F note is signed")));
});

test("referralToF2FInput passes the signature fields through", () => {
  const input = referralToF2FInput({
    face_to_face: {
      encounter_date: "2026-06-15",
      practitioner_name: "Dr. A",
      practitioner_signature_present: false,
      signed_date: "",
    },
    estimated_start_date: "2026-06-20",
    diagnosis: "CHF",
  });
  assert.equal(input.encounter.practitioner_signature_present, false);
});
