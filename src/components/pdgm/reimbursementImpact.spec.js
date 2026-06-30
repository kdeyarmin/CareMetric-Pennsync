import { describe, it, expect } from "vitest";
import { DEFAULT_PDGM_RATES } from "./pdgmRates.js";
import { computePeriodReimbursement, computeImpact } from "./reimbursementImpact.js";

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
