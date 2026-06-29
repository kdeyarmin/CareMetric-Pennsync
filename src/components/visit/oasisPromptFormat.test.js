import test from "node:test";
import assert from "node:assert/strict";
import { formatExtractedOasisForPrompt } from "./oasisPromptFormat.js";

test("returns an empty string when there is no data", () => {
  assert.equal(formatExtractedOasisForPrompt(null), "");
  assert.equal(formatExtractedOasisForPrompt(undefined), "");
});

test("formats the provided OASIS sections with header and footer", () => {
  const out = formatExtractedOasisForPrompt({
    patient_info: { assessment_date: "2026-01-15", soc_date: "2026-01-01" },
    m0100_reason_for_assessment: "Start of Care",
    clinical_record_items: {
      m1021_primary_diagnosis: "CHF",
      m1021_icd10_code: "I50.9",
      m1023_other_diagnoses: [{ code: "E11.9", description: "Diabetes" }],
      m1030_therapies_at_soc: "PT",
    },
    adl_iadl_status: { m1830_bathing: "2", m1860_ambulation: "3" },
    discharge_info: { m2410_discharge_disposition: "Home" },
  });
  assert.match(out, /=== UPLOADED OASIS ASSESSMENT DATA ===/);
  assert.match(out, /PATIENT INFO:/);
  assert.match(out, /Assessment Type: Start of Care/);
  assert.match(out, /M1021 Primary Dx: CHF \(I50\.9\)/);
  assert.match(out, /M1023 Other Dx: E11\.9: Diabetes/);
  assert.match(out, /ADL\/IADL STATUS/);
  assert.match(out, /M1830 Bathing: 2/);
  assert.match(out, /DISCHARGE INFO:/);
  assert.match(out, /=== END UPLOADED OASIS DATA ===/);
});

test("omits absent sections and fills N/A for missing fields", () => {
  const out = formatExtractedOasisForPrompt({ patient_info: {} });
  assert.match(out, /PATIENT INFO:/);
  assert.match(out, /Assessment Date: N\/A/);
  assert.doesNotMatch(out, /CLINICAL RECORD:/);
  assert.doesNotMatch(out, /ADL\/IADL STATUS/);
});
