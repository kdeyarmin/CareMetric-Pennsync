import { describe, it, expect } from "vitest";
import { extractClinicalIndicators } from "./clinicalIndicators";
import { determineClinicalGroup, identifyComorbidities } from "./pdgmClinicalGroup";
import { buildFunctionalPhrases } from "./oasisScrubberData";
import { buildOASISScrubberPrompt, oasisScrubberResponseSchema } from "./oasisScrubberPrompt";

// A narrative that trips several deterministic indicators (oxygen, wound, walker).
const NARRATIVE =
  "Patient on 2L oxygen via nasal cannula continuously. Requires moderate assist with shower. " +
  "Ambulates 50 feet with a walker. Stage 2 pressure ulcer noted to the sacrum.";

// Build the prompt-builder inputs exactly the way OASISScrubber does — through
// the real (pure, tested) producer functions — so the nested shapes the prompt
// reads are guaranteed correct without hand-mocking ~600 lines of field access.
function buildInputs(visitTypeRaw) {
  const patient = {
    primary_diagnosis: "I50.9 Heart failure, unspecified",
    secondary_diagnoses: ["E11.9 Type 2 diabetes mellitus"],
  };
  const visit = { id: "v1", visit_date: "2026-06-27", visit_type: visitTypeRaw };
  return {
    visitTypeLabel: visitTypeRaw.replace(/_/g, " ").toUpperCase(),
    visitTypeRaw,
    patient,
    visit,
    clinicalGroupAnalysis: determineClinicalGroup(patient.primary_diagnosis, patient.secondary_diagnoses),
    comorbidityAnalysis: identifyComorbidities(patient.primary_diagnosis, patient.secondary_diagnoses, NARRATIVE),
    clinicalIndicators: extractClinicalIndicators(NARRATIVE),
    functionalPhrases: buildFunctionalPhrases(NARRATIVE),
    vitalSigns: {},
    narrativeText: NARRATIVE,
    extractedOasisData: null,
  };
}

describe("buildOASISScrubberPrompt", () => {
  it("returns a non-empty prompt that embeds patient context and the pre-analysis", () => {
    const prompt = buildOASISScrubberPrompt(buildInputs("admission"));
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain("Heart failure");
    expect(prompt).toContain("PRE-ANALYZED PDGM CLINICAL GROUP");
    expect(prompt).toContain("CLINICAL INDICATORS EXTRACTED FROM NARRATIVE");
  });

  it("reflects detected indicators from the narrative", () => {
    const prompt = buildOASISScrubberPrompt(buildInputs("admission"));
    expect(prompt).toContain("OXYGEN USE");
    // At least one indicator (oxygen/wound/device) is detected in this narrative.
    expect(prompt).toMatch(/Detected: YES/);
  });

  it("appends the admission (SOC/ROC) mandatory section for an admission visit", () => {
    const prompt = buildOASISScrubberPrompt(buildInputs("admission"));
    expect(prompt).toContain("SOC/ROC MANDATORY");
    expect(prompt).not.toContain("DISCHARGE MANDATORY");
  });

  it("appends the discharge mandatory section for a discharge visit", () => {
    const prompt = buildOASISScrubberPrompt(buildInputs("discharge"));
    expect(prompt).toContain("DISCHARGE MANDATORY");
    expect(prompt).not.toContain("SOC/ROC MANDATORY");
  });

  it("appends the recertification mandatory section for a recertification visit", () => {
    const prompt = buildOASISScrubberPrompt(buildInputs("recertification"));
    expect(prompt).toContain("RECERTIFICATION MANDATORY");
  });

  it("renders 'None documented' when no vitals are supplied", () => {
    const prompt = buildOASISScrubberPrompt(buildInputs("admission"));
    expect(prompt).toContain("None documented");
  });
});

describe("oasisScrubberResponseSchema", () => {
  it("is a well-formed object schema with the expected top-level fields", () => {
    expect(oasisScrubberResponseSchema.type).toBe("object");
    const props = oasisScrubberResponseSchema.properties;
    expect(props).toBeTypeOf("object");
    for (const key of [
      "overall_score",
      "completeness_percentage",
      "ready_for_submission",
      "reimbursement_risk_level",
      "pdgm_analysis",
    ]) {
      expect(props).toHaveProperty(key);
    }
    expect(props.ready_for_submission.type).toBe("boolean");
    expect(props.pdgm_analysis.type).toBe("object");
  });
});
