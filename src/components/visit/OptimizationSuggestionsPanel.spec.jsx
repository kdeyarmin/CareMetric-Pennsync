import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import OptimizationSuggestionsPanel from "./OptimizationSuggestionsPanel";

const UNDERSCORE = { id: "u1", title: "Underscore A" };

function makeProps(overrides = {}) {
  return {
    oasisResults: {
      pdgm_analysis: {
        clinical_group_confidence: "medium", // !== high → clinical-group sub-panel
        clinical_group: "MMTA - Cardiac",
        functional_level: "low", // !== high → functional sub-panel
        functional_points_calculated: 8,
        comorbidity_adjustment: "none", // !== high → comorbidity sub-panel
        comorbidity_count: 0,
        qualifying_comorbidities: { potential_additions: ["COPD (J44.9)"] },
      },
      functional_score_analysis: {
        m1830_bathing: { documented_value: 1 },
        m1860_ambulation: { documented_value: 1 },
        m1850_transferring: { documented_value: 1 },
      },
      vague_documentation: [{ id: "v1" }],
      cross_validation_failures: [{ id: "x1" }],
      underscoring_opportunities: [UNDERSCORE],
      critical_missing: [{ id: "c1" }],
    },
    extractedIndicators: {
      functional: { bathing: { allPhrases: ["needs assist with bathing"] } },
      clinical: {
        assistDevices: { detected: false },
        fallRisk: { detected: false },
        painMentioned: { detected: false },
        cognitiveIssues: { detected: false },
        diabetic: { detected: true },
        cardiacIssues: { detected: true },
        woundPresent: { detected: false },
      },
    },
    patient: { primary_diagnosis: "CHF" },
    showOptimizationPanel: true,
    setShowOptimizationPanel: vi.fn(),
    copiedText: null,
    copyToClipboard: vi.fn(),
    handleSuggestionAccept: vi.fn(),
    ...overrides,
  };
}

describe("OptimizationSuggestionsPanel — expanded", () => {
  it("renders the header and each optimization sub-panel", () => {
    renderWithProviders(<OptimizationSuggestionsPanel {...makeProps()} />);
    expect(screen.getByText("Automated Optimization Suggestions")).toBeInTheDocument();
    expect(screen.getByText("Hide")).toBeInTheDocument();
    expect(screen.getByText("Strengthen Clinical Group Assignment")).toBeInTheDocument();
    expect(screen.getByText("Maximize Functional Score Documentation")).toBeInTheDocument();
    expect(screen.getByText("Improve Comorbidity Adjustment")).toBeInTheDocument();
    expect(screen.getByText("Apply Top Suggestion Now")).toBeInTheDocument();
  });

  it("toggles the panel via the Hide button", () => {
    const setShowOptimizationPanel = vi.fn();
    renderWithProviders(
      <OptimizationSuggestionsPanel {...makeProps({ setShowOptimizationPanel })} />,
    );
    fireEvent.click(screen.getByText("Hide"));
    expect(setShowOptimizationPanel).toHaveBeenCalledWith(false);
  });

  it("applies the top suggestion (first of underscoring/critical/vague)", () => {
    const handleSuggestionAccept = vi.fn();
    renderWithProviders(
      <OptimizationSuggestionsPanel {...makeProps({ handleSuggestionAccept })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Apply Top Suggestion Now/ }));
    expect(handleSuggestionAccept).toHaveBeenCalledWith(UNDERSCORE, "optimization");
  });

  it("copies a suggestion via an icon copy button", () => {
    const copyToClipboard = vi.fn();
    renderWithProviders(<OptimizationSuggestionsPanel {...makeProps({ copyToClipboard })} />);
    // Copy buttons are icon-only (no text); the first one is the M1830 bathing phrase.
    const copyButtons = screen.getAllByRole("button").filter((b) => b.textContent.trim() === "");
    fireEvent.click(copyButtons[0]);
    expect(copyToClipboard).toHaveBeenCalledWith("needs assist with bathing", "bathing-suggestion");
  });
});

describe("OptimizationSuggestionsPanel — collapsed", () => {
  it("shows the count badge and hides the sub-panels", () => {
    renderWithProviders(
      <OptimizationSuggestionsPanel {...makeProps({ showOptimizationPanel: false })} />,
    );
    expect(screen.getByText("Show")).toBeInTheDocument();
    // confidence + functional + comorbidity all != 'high' → 3 areas
    expect(screen.getByText(/3 optimization areas available/)).toBeInTheDocument();
    expect(screen.queryByText("Strengthen Clinical Group Assignment")).toBeNull();
  });
});
