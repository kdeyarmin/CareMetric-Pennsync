import { describe, it, expect } from "vitest";
import { computePeriodReimbursement, computeImpact, normalizePdgmDataToScenario } from "./reimbursementImpact.js";

describe("retired factorized reimbursement approximation", () => {
  const scenario = {
      clinicalGroup: "MMTA_Cardiac_Circulatory",
      admissionSource: "community", timing: "early",
      functionalLevel: "medium", comorbidityLevel: "none",
  };

  it("never emits money even when callers supply complete-looking inputs", () => {
    expect(computePeriodReimbursement(scenario)).toBeNull();
    expect(computePeriodReimbursement(scenario, {
      basePaymentRate: 999999,
      clinicalGroupWeights: { MMTA_Cardiac_Circulatory: { community_early: 99 } },
      functionalMultipliers: { community_early: { medium: 99 } },
      comorbidityMultipliers: { community_early: { none: 99 } },
    })).toBeNull();
  });

  it("never emits before/after deltas", () => {
    const res = computeImpact(scenario, { ...scenario, functionalLevel: "high" });
    expect(res.complete).toBe(false);
    expect(res.before).toBeNull();
    expect(res.after).toBeNull();
    expect(res).not.toHaveProperty("paymentDelta");
  });
});

describe("normalizePdgmDataToScenario", () => {
  it("maps a record's pdgm_data fields (incl. display-name clinical group)", () => {
    expect(normalizePdgmDataToScenario({
      clinical_group: "MMTA - Cardiac and Circulatory",
      admission_source: "Institutional",
      episode_timing: "Late",
      functional_level: "High",
      comorbidity_adjustment: "Low",
    })).toEqual({
      clinicalGroup: "MMTA_Cardiac_Circulatory",
      admissionSource: "institutional",
      timing: "late",
      functionalLevel: "high",
      comorbidityLevel: "low",
    });
  });

  it("accepts the pdgmRates key form directly and functional_impairment_level fallback", () => {
    const out = normalizePdgmDataToScenario({ clinical_group: "MMTA_Wounds", functional_impairment_level: "medium" });
    expect(out.clinicalGroup).toBe("MMTA_Wounds");
    expect(out.functionalLevel).toBe("medium");
  });

  it("omits fields it can't confidently map (never guesses) and tolerates junk", () => {
    expect(normalizePdgmDataToScenario({ clinical_group: "Mystery", functional_level: "" })).toEqual({});
    expect(normalizePdgmDataToScenario(null)).toEqual({});
  });
});
