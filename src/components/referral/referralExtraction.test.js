import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReferralExtractionPrompt,
  REFERRAL_EXTRACTION_SCHEMA,
  buildReferralQuickScanPrompt,
  REFERRAL_QUICKSCAN_SCHEMA,
  runReferralExtraction,
  runReferralQuickScan,
} from "./referralExtraction.js";

test("rich extraction prompt adapts to scanned-image vs PDF input", () => {
  const image = buildReferralExtractionPrompt("image/tiff");
  const pdf = buildReferralExtractionPrompt("application/pdf");
  assert.match(image, /scanned\/faxed document image/);
  assert.match(pdf, /This is a PDF document/);
  // Default (no arg) should behave like a PDF.
  assert.match(buildReferralExtractionPrompt(), /This is a PDF document/);
});

test("active extraction prompt is source-facts only and refuses OASIS/PDGM output", () => {
  const prompt = buildReferralExtractionPrompt("application/pdf");
  assert.match(prompt, /extracting documented facts/i);
  assert.match(prompt, /Do not select, suggest, infer, or output any OASIS M-item response/i);
  assert.match(prompt, /PDGM clinical group.*case-mix weight.*payment/i);
  assert.match(prompt, /calibrated extraction confidence/i);
});

test("rich extraction schema exposes the key clinical sections", () => {
  assert.equal(REFERRAL_EXTRACTION_SCHEMA.type, "object");
  const props = REFERRAL_EXTRACTION_SCHEMA.properties;
  for (const section of [
    "demographics",
    "admission_details",
    "diagnoses",
    "medications",
    "functional_status",
    "wound_details",
    "psychosocial",
    "extraction_confidence",
  ]) {
    assert.ok(props[section], `expected schema to define ${section}`);
  }
  // The per-section confidence object backs the real per-field confidence UI.
  assert.ok(REFERRAL_EXTRACTION_SCHEMA.properties.extraction_confidence.properties.overall);
  assert.equal(props.oasis_assessment, undefined);
  assert.equal(props.oasis_relevant_notes, undefined);
});

test("extraction prompts forbid invented data (anti-hallucination contract)", () => {
  const prompt = buildReferralExtractionPrompt("application/pdf");
  assert.match(prompt, /GROUNDING RULES/);
  assert.match(prompt, /never complete or infer identifiers/i);
  assert.match(prompt, /ICD-10 codes only when printed in the source/i);
  assert.match(prompt, /do not select, rank, or re-sequence diagnoses/i);
  // The invented "highest to lowest reimbursement" clinical-group ranking and
  // the revenue-driven primary re-selection instruction must be gone.
  assert.ok(!/highest to lowest reimbursement/.test(prompt), "no fabricated reimbursement ranking");
  assert.ok(
    !/Selecting the primary diagnosis that provides the highest case-mix weight/.test(prompt),
    "the model never re-selects the primary for revenue"
  );

  const quick = buildReferralQuickScanPrompt();
  assert.match(quick, /GROUNDING: Extract only what this document states/);
  assert.match(quick, /never inferred from a diagnosis name/);
});

test("diagnosis schema descriptions demand verbatim capture, never invention", () => {
  const dx = REFERRAL_EXTRACTION_SCHEMA.properties.diagnoses.properties;
  assert.match(dx.primary_diagnosis.description, /EXACTLY as documented/);
  assert.match(dx.primary_icd10.description, /ONLY as printed in the document/);
  assert.equal(dx.pdgm_clinical_group, undefined);
  assert.equal(dx.pdgm_optimization_notes, undefined);
  assert.equal(dx.comorbidity_adjustments, undefined);
  assert.match(dx.secondary_diagnoses.description, /documented in the referral, exactly as stated/);
});

test("quick scan prompt + schema drive form pre-fill and triage", () => {
  const prompt = buildReferralQuickScanPrompt();
  assert.match(prompt, /URGENCY ASSESSMENT/);
  assert.match(prompt, /SUGGESTED INITIAL TASKS/);

  const props = REFERRAL_QUICKSCAN_SCHEMA.properties;
  for (const field of ["patient_name", "category", "urgency_level", "suggested_initial_tasks"]) {
    assert.ok(props[field], `expected quick-scan schema to define ${field}`);
  }
  assert.deepEqual(props.urgency_level.enum, ["urgent", "high", "normal", "low"]);
});

// The run helpers take an injected `invoke` (the app's invokeLLM, which applies
// the shared retry/timeout policy); verify they call it with the right
// prompt/schema/policy and surface the result. A fake keeps the test offline.
const recordingInvoke = (calls, returnValue) => async (params, options) => {
  calls.push({ params, options });
  return returnValue;
};

test("runReferralExtraction calls invoke with the rich prompt, schema, and policy", async () => {
  const calls = [];
  const result = await runReferralExtraction(recordingInvoke(calls, { ok: true }), {
    fileUrl: "u://doc.pdf",
    fileType: "application/pdf",
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params.file_urls, ["u://doc.pdf"]);
  assert.equal(calls[0].params.response_json_schema, REFERRAL_EXTRACTION_SCHEMA);
  assert.match(calls[0].params.prompt, /extracting documented facts/i);
  // The heavy clinical extraction gets the longer retry/timeout budget.
  assert.deepEqual(calls[0].options, { retries: 2, timeoutMs: 120000, backoffMs: 800 });
});

test("runReferralExtraction strips provider-added OASIS and PDGM fields", async () => {
  const result = await runReferralExtraction(async () => ({
    demographics: { full_name: "Documented Name" },
    oasis_assessment: { m1800_grooming: "6" },
    oasis_relevant_notes: "suggested response",
    admission_note_template: "generated narrative",
    diagnoses: {
      primary_diagnosis: "Heart failure",
      pdgm_clinical_group: "MMTA_Cardiac_Circulatory",
      pdgm_optimization_notes: "sequence for payment",
      comorbidity_adjustments: ["invented"],
    },
    extraction_confidence: { overall: 80, oasis_assessment: 99 },
  }), { fileUrl: "u://doc.pdf" });

  assert.deepEqual(result.demographics, { full_name: "Documented Name" });
  assert.equal(result.oasis_assessment, undefined);
  assert.equal(result.oasis_relevant_notes, undefined);
  assert.equal(result.admission_note_template, undefined);
  assert.deepEqual(result.diagnoses, { primary_diagnosis: "Heart failure" });
  assert.deepEqual(result.extraction_confidence, { overall: 80 });
});

test("runReferralQuickScan calls invoke with the quick-scan prompt, schema, and policy", async () => {
  const calls = [];
  const result = await runReferralQuickScan(recordingInvoke(calls, { scan: true }), {
    fileUrl: "u://fax.tiff",
  });
  assert.deepEqual(result, { scan: true });
  assert.equal(calls[0].params.response_json_schema, REFERRAL_QUICKSCAN_SCHEMA);
  assert.match(calls[0].params.prompt, /automatic categorization/);
  // The lightweight scan uses a shorter budget for snappy form pre-fill.
  assert.deepEqual(calls[0].options, { retries: 1, timeoutMs: 60000, backoffMs: 600 });
});
