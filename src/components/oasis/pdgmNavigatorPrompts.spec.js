import { describe, expect, it } from "vitest";
import {
  buildFinancialPredictionRequest,
  buildNavigationRequest,
  buildResolutionWorkflowRequest,
} from "./pdgmNavigatorPrompts";

const args = {
  item: { finding: "example" },
  type: "discrepancy",
  navigation: {},
  agencyCosts: {},
};

describe("PDGM navigator financial prompt safety", () => {
  it("hard-disables LLM-derived grouping and functional scoring", () => {
    expect(() => buildNavigationRequest({ pdgmData: {}, analysisResults: {}, revenueData: {} }))
      .toThrow(/AI-derived PDGM grouping and reimbursement guidance are unavailable/i);
  });

  it("refuses to ask AI for dollars when the canonical payment is unavailable", () => {
    expect(() => buildFinancialPredictionRequest({
      ...args,
      revenueData: {
        original: { incomplete: true, paymentAvailable: false, totalPayment: null, caseMixWeight: null },
      },
    })).toThrow(/AI-derived PDGM grouping and reimbursement guidance are unavailable/i);
  });

  it("cannot be unlocked by a caller-supplied complete numeric payload", () => {
    expect(() => buildFinancialPredictionRequest({
      ...args,
      revenueData: {
        original: { incomplete: false, paymentAvailable: true, totalPayment: 0, caseMixWeight: 0 },
      },
    })).toThrow(/AI-derived PDGM grouping and reimbursement guidance are unavailable/i);
  });

  it("hard-disables AI-authored discrepancy correction workflows", () => {
    expect(() => buildResolutionWorkflowRequest({ discrepancy: {}, pdgmData: {} }))
      .toThrow(/AI-derived PDGM grouping and reimbursement guidance are unavailable/i);
  });
});
