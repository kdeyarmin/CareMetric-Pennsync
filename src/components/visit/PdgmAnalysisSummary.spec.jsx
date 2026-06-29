import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import PdgmAnalysisSummary from "./PdgmAnalysisSummary";

const PDGM = {
  clinical_group: "MMTA - Cardiac",
  clinical_group_confidence: "high",
  clinical_group_rationale: "CHF documented in narrative",
  primary_dx_icd10_suggested: "I50.9",
  alternative_clinical_groups: ["MMTA - Respiratory"],
  functional_level: "medium",
  functional_points_calculated: 42,
  comorbidity_adjustment: "low",
  comorbidity_count: 2,
  estimated_case_mix_weight: "1.0432",
  optimization_potential: "+$420 with documentation",
  qualifying_comorbidities: {
    high_impact: ["CHF (I50.2)"],
    low_impact: ["Hypertension", "Type 2 Diabetes"],
    potential_additions: ["COPD"],
  },
  case_mix_weight_breakdown: {
    clinical_component: "0.45",
    functional_component: "0.32",
    comorbidity_component: "0.27",
  },
  optimization_strategies: ["Document daily weights", "Specify HF type (HFrEF vs HFpEF)"],
};

describe("PdgmAnalysisSummary", () => {
  it("renders the score grid, qualifying comorbidities, breakdown, and strategies", () => {
    renderWithProviders(<PdgmAnalysisSummary pdgmAnalysis={PDGM} />);
    expect(screen.getByText("PDGM Case-Mix Analysis")).toBeInTheDocument();
    expect(screen.getByText("MMTA - Cardiac")).toBeInTheDocument();
    expect(screen.getByText(/HIGH Confidence/)).toBeInTheDocument();
    expect(screen.getByText("CHF documented in narrative")).toBeInTheDocument();
    expect(screen.getByText(/I50\.9/)).toBeInTheDocument();
    expect(screen.getByText("MMTA - Respiratory")).toBeInTheDocument();
    expect(screen.getByText("42 points")).toBeInTheDocument();
    expect(screen.getByText("2 qualifying")).toBeInTheDocument();
    expect(screen.getByText("1.0432")).toBeInTheDocument();
    expect(screen.getByText("+$420 with documentation")).toBeInTheDocument();
    // qualifying comorbidities
    expect(screen.getByText("Qualifying Comorbidities:")).toBeInTheDocument();
    expect(screen.getByText(/CHF \(I50\.2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Hypertension/)).toBeInTheDocument();
    expect(screen.getByText(/COPD/)).toBeInTheDocument();
    // case-mix breakdown
    expect(screen.getByText("Case-Mix Weight Breakdown:")).toBeInTheDocument();
    expect(screen.getByText("0.45")).toBeInTheDocument();
    // optimization strategies
    expect(screen.getByText(/Document daily weights/)).toBeInTheDocument();
  });

  it("omits optional sections that are absent from the data", () => {
    renderWithProviders(
      <PdgmAnalysisSummary
        pdgmAnalysis={{
          clinical_group: "MMTA - Cardiac",
          clinical_group_confidence: "low",
          functional_level: "low",
          comorbidity_adjustment: "none",
          estimated_case_mix_weight: "0.98",
          optimization_potential: "None",
        }}
      />,
    );
    expect(screen.getByText("PDGM Case-Mix Analysis")).toBeInTheDocument();
    expect(screen.queryByText("Qualifying Comorbidities:")).toBeNull();
    expect(screen.queryByText("Case-Mix Weight Breakdown:")).toBeNull();
    expect(screen.queryByText(/Optimization Strategies:/)).toBeNull();
  });

  it("renders nothing without pdgmAnalysis", () => {
    const { container } = renderWithProviders(<PdgmAnalysisSummary pdgmAnalysis={null} />);
    expect(container.firstChild).toBeNull();
  });
});
