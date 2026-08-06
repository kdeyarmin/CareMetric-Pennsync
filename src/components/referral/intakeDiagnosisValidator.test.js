import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIcd,
  validatePrimaryDiagnosis,
  previewClinicalGroup,
  validateIntakeDiagnoses,
} from "./intakeDiagnosisValidator.js";

test("normalizeIcd strips dots and spaces and uppercases", () => {
  assert.equal(normalizeIcd("i63.9"), "I639");
  assert.equal(normalizeIcd(" z47.1 "), "Z471");
});

// ── unacceptable primary detection ──

test("R-chapter symptom codes are unacceptable (RTP)", () => {
  const r = validatePrimaryDiagnosis("R26.9"); // abnormality of gait
  assert.equal(r.acceptable, false);
  assert.equal(r.category, "symptom_code");
});

test("Z-chapter status codes are unacceptable (RTP) unless surgical-aftercare", () => {
  const z = validatePrimaryDiagnosis("Z79.4"); // long-term insulin use — status, not aftercare
  assert.equal(z.acceptable, false);
  assert.equal(z.category, "status_code");
});

test("surgical-aftercare Z codes are acceptable PDGM principals", () => {
  for (const code of ["Z47.1", "Z48.00", "Z96.641"]) {
    const z = validatePrimaryDiagnosis(code);
    assert.equal(z.acceptable, true, `${code} should be an acceptable principal`);
    assert.equal(z.category, "acceptable");
  }
});

test("a curated unacceptable code is flagged", () => {
  const i10 = validatePrimaryDiagnosis("I10");
  assert.equal(i10.acceptable, false);
  assert.equal(i10.category, "unacceptable_list");
});

test("a specific, acceptable code passes", () => {
  const ok = validatePrimaryDiagnosis("I63.9"); // cerebral infarction
  assert.equal(ok.acceptable, true);
  assert.equal(ok.category, "acceptable");
});

test("missing code is critical", () => {
  const none = validatePrimaryDiagnosis("");
  assert.equal(none.acceptable, false);
  assert.equal(none.category, "missing");
  assert.equal(none.severity, "critical");
});

// ── clinical-group preview ──

test("stroke code previews Neuro Rehabilitation, not generic circulatory", () => {
  assert.equal(previewClinicalGroup("I63.9").clinical_group, "Neuro Rehabilitation");
});

test("cardiac code previews MMTA - Cardiac and Circulatory", () => {
  assert.equal(previewClinicalGroup("I50.9").clinical_group, "MMTA - Cardiac and Circulatory");
});

test("respiratory code previews MMTA - Respiratory", () => {
  assert.equal(previewClinicalGroup("J44.9").clinical_group, "MMTA - Respiratory");
});

test("musculoskeletal code previews Musculoskeletal Rehabilitation", () => {
  assert.equal(previewClinicalGroup("M17.11").clinical_group, "Musculoskeletal Rehabilitation");
});

test("pressure-ulcer code previews Wound", () => {
  assert.equal(previewClinicalGroup("L89.153").clinical_group, "Wound");
});

test("unknown prefix falls back to MMTA - Other with low confidence", () => {
  const p = previewClinicalGroup("Q99");
  assert.equal(p.clinical_group, "MMTA - Other");
  assert.equal(p.confidence, "low");
});

// ── combined intake validation ──

test("validateIntakeDiagnoses flags RTP risk and returns a finding for a bad primary", () => {
  const res = validateIntakeDiagnoses({ primary: "R26.9", secondaries: ["I10", "E11.9"] });
  assert.equal(res.acceptable, false);
  assert.equal(res.rtp_risk, true);
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].role, "primary");
  assert.equal(res.secondary_count, 2);
});

test("validateIntakeDiagnoses passes a good primary and previews its group", () => {
  const res = validateIntakeDiagnoses({ primary: "J44.9" });
  assert.equal(res.acceptable, true);
  assert.equal(res.rtp_risk, false);
  assert.equal(res.clinical_group_preview.clinical_group, "MMTA - Respiratory");
  assert.equal(res.findings.length, 0);
});

// ── Regression: preview vs RTP coherence (2026-07 review) ───────────────────

test("an RTP-unacceptable principal never previews with high confidence", () => {
  const rtp = validatePrimaryDiagnosis("Z79.4");
  const preview = previewClinicalGroup("Z79.4");
  assert.equal(rtp.acceptable, false);
  assert.equal(preview.confidence, "low", "the preview must not confidently group a guaranteed-RTP code");
});

test("surgical-aftercare Z principals preview MMTA Surgical Aftercare with confidence", () => {
  const ok = validatePrimaryDiagnosis("Z47.1");
  const preview = previewClinicalGroup("Z47.1");
  assert.equal(ok.acceptable, true);
  assert.equal(preview.clinical_group, "MMTA - Surgical Aftercare");
  assert.notEqual(preview.confidence, "low");
});
