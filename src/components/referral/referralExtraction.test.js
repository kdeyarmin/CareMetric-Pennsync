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

test("rich extraction prompt covers OASIS, PDGM, and confidence scoring", () => {
  const prompt = buildReferralExtractionPrompt("application/pdf");
  assert.match(prompt, /OASIS-E assessment/);
  assert.match(prompt, /PDGM/);
  assert.match(prompt, /CONFIDENCE SCORING \(REQUIRED\)/);
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
    "oasis_assessment",
    "extraction_confidence",
  ]) {
    assert.ok(props[section], `expected schema to define ${section}`);
  }
  // The per-section confidence object backs the real per-field confidence UI.
  assert.ok(REFERRAL_EXTRACTION_SCHEMA.properties.extraction_confidence.properties.overall);
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
  assert.match(calls[0].params.prompt, /home health intake coordinator/);
  // The heavy clinical extraction gets the longer retry/timeout budget.
  assert.deepEqual(calls[0].options, { retries: 2, timeoutMs: 120000, backoffMs: 800 });
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
