import { describe, it, expect } from "vitest";
import { DEFAULT_PDGM_RATES } from "./pdgmRates.js";
import { computePeriodReimbursement, computeImpact, normalizePdgmDataToScenario } from "./reimbursementImpact.js";

describe("computePeriodReimbursement", () => {
  it("applies the canonical formula (base × clinical × functional × comorbidity)", () => {
    const r = DEFAULT_PDGM_RATES;
    const out = computePeriodReimbursement({
      clinicalGroup: "MMTA_Cardiac_Circulatory",
      admissionSource: "community", timing: "early",
      functionalLevel: "medium", comorbidityLevel: "none",
    }, r);
    const clinical = r.clinicalGroupWeights.MMTA_Cardiac_Circulatory.community_early; // 0.9456
    const fn = r.functionalMultipliers.community_early.medium; // 1.0
    const co = r.comorbidityMultipliers.community_early.none;   // 1.0
    const expectedWeight = Math.round(clinical * fn * co * 10000) / 10000;
    // laborShare default with wageIndex 1.0 leaves base unchanged.
    const expectedPay = Math.round(r.basePaymentRate * expectedWeight * 100) / 100;
    expect(out.caseMixWeight).toBe(expectedWeight);
    expect(out.adjustedBase).toBe(r.basePaymentRate);
    expect(out.payment).toBe(expectedPay);
  });

  it("falls back to the canonical labor share (not 1.0) when rates omit it", () => {
    // A non-default wage index makes the labor-share fallback observable: a 1.0
    // fallback would apply the full wage index, overstating the adjusted base.
    const ratesNoLabor = { ...DEFAULT_PDGM_RATES, laborShare: undefined };
    const scenario = {
      clinicalGroup: "MMTA_Wounds", admissionSource: "community", timing: "early",
      functionalLevel: "low", comorbidityLevel: "none",
    };
    const wageIndex = 1.2;
    const out = computePeriodReimbursement(scenario, ratesNoLabor, wageIndex);
    const ls = DEFAULT_PDGM_RATES.laborShare;
    const expectedBase = Math.round(DEFAULT_PDGM_RATES.basePaymentRate * (ls * wageIndex + (1 - ls)) * 100) / 100;
    expect(out.adjustedBase).toBe(expectedBase);
    // Sanity: a 1.0 fallback would have produced base × wageIndex, which is larger.
    expect(out.adjustedBase).toBeLessThan(Math.round(DEFAULT_PDGM_RATES.basePaymentRate * wageIndex * 100) / 100);
  });

  it("returns null (never guesses) for an unknown clinical group or level", () => {
    expect(computePeriodReimbursement({ clinicalGroup: "NOPE", functionalLevel: "low", comorbidityLevel: "none" })).toBeNull();
    expect(computePeriodReimbursement({ clinicalGroup: "MMTA_Wounds", functionalLevel: "bogus", comorbidityLevel: "none" })).toBeNull();
  });
});

describe("computeImpact", () => {
  const base = {
    clinicalGroup: "MMTA_Wounds", admissionSource: "community", timing: "early", comorbidityLevel: "none",
  };

  it("shows a positive delta when documentation raises the functional level", () => {
    const res = computeImpact(
      { ...base, functionalLevel: "low" },
      { ...base, functionalLevel: "high" },
    );
    expect(res.complete).toBe(true);
    expect(res.paymentDelta).toBeGreaterThan(0);
    expect(res.weightDelta).toBeGreaterThan(0);
    expect(res.paymentPct).toBeGreaterThan(0);
    // After payment equals before + delta (rounding-consistent).
    expect(Math.round((res.before.payment + res.paymentDelta) * 100) / 100).toBe(res.after.payment);
  });

  it("is zero-delta when before == after", () => {
    const same = { ...base, functionalLevel: "medium" };
    const res = computeImpact(same, same);
    expect(res.paymentDelta).toBe(0);
    expect(res.weightDelta).toBe(0);
  });

  it("marks the result incomplete when either side can't be computed", () => {
    const res = computeImpact({ ...base, functionalLevel: "low" }, { ...base, clinicalGroup: "NOPE", functionalLevel: "low" });
    expect(res.complete).toBe(false);
    expect(res.after).toBeNull();
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
