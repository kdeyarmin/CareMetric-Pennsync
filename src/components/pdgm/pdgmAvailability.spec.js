import { describe, expect, it } from "vitest";
import {
  buildPdgmRevenueExportRows,
  formatPdgmCurrency,
  getAlternativeScenarioState,
  getPdgmComparisonState,
  getPdgmPaymentState,
  redactUnavailableNavigationFinancials,
} from "./pdgmAvailability";

const blocked = {
  incomplete: true,
  paymentAvailable: false,
  totalPayment: null,
  reason: "pdgm_functional_definitions_unavailable",
  message: "PDGM payment is unavailable — this is not a $0 result.",
  actionRequired: ["Use the official EMR/CMS-approved grouper."],
};

describe("PDGM payment availability", () => {
  it("does not coerce an incomplete null payment to zero", () => {
    expect(getPdgmPaymentState(blocked)).toMatchObject({ available: false, amount: null });
    expect(formatPdgmCurrency(null)).toBe("Unavailable");
    expect(formatPdgmCurrency(undefined)).toBe("Unavailable");
  });

  it("honors paymentAvailable false even if a legacy payload contains zero", () => {
    expect(getPdgmPaymentState({ paymentAvailable: false, totalPayment: 0 }).available).toBe(false);
  });

  it("lets the global default-off gate win over a caller-supplied complete zero", () => {
    const state = getPdgmPaymentState({ incomplete: false, paymentAvailable: true, totalPayment: 0 });
    expect(state).toMatchObject({ available: false, amount: null });
    expect(formatPdgmCurrency(state.amount)).toBe("Unavailable");
    // Formatting an independently verified numeric zero remains correct; the
    // payment-state gate simply never grants that status in this release.
    expect(formatPdgmCurrency(0)).toBe("$0.00");
  });

  it("requires an explicitly available, finite alternative-scenario summary", () => {
    expect(getAlternativeScenarioState({
      available: false,
      scenarios: { community_early: blocked },
      minPayment: null,
      maxPayment: null,
      paymentRange: null,
    }).available).toBe(false);
  });

  it("marks a comparison unavailable when either payment is blocked", () => {
    const comparison = getPdgmComparisonState({
      original: blocked,
      corrected: { paymentAvailable: true, totalPayment: 3100 },
      revenueDifference: null,
      percentageIncrease: null,
    });
    expect(comparison.available).toBe(false);
    expect(comparison.actions).toContain("Use the official EMR/CMS-approved grouper.");
  });

  it("exports unavailable text, reason, and action without a misleading $0", () => {
    const rows = buildPdgmRevenueExportRows({
      original: blocked,
      corrected: blocked,
      revenueDifference: null,
      percentageIncrease: null,
    });
    const text = rows.flat().join("\n");
    expect(text).toContain("Unavailable");
    expect(text).toContain("not a $0 result");
    expect(text).toContain("Use the official EMR/CMS-approved grouper.");
    expect(text).not.toContain("$0.00");
  });

  it("redacts AI navigator payment fields when the canonical engine is unavailable", () => {
    const state = getPdgmPaymentState(blocked);
    const safe = redactUnavailableNavigationFinancials({
      case_mix_calculation: { calculated_payment: 9999, final_case_mix_weight: 4.2 },
      discrepancies: [{ finding: "x", revenue_impact: "$500" }],
      optimization_opportunities: [{ area: "x", potential_impact: "$1000" }],
      summary: { payment_amount: 9999, key_drivers: ["diagnosis"] },
    }, state);
    expect(safe.case_mix_calculation).toBeNull();
    expect(safe.summary.payment_amount).toBeNull();
    expect(safe.discrepancies[0]).not.toHaveProperty("revenue_impact");
    expect(safe.optimization_opportunities[0]).not.toHaveProperty("potential_impact");
    expect(JSON.stringify(safe)).not.toContain("9999");
  });
});
