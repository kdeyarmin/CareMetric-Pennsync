import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import CrossValidationResults from "./CrossValidationResults";

const ITEMS = [
  {
    rule_violated: "M1860 must align with M1850",
    audit_risk: "medium",
    items_involved: ["M1860", "M1850"],
    current_values: "M1860=2, M1850=4",
    expected_relationship: "M1850 should not exceed M1860",
    narrative_evidence: "ambulates with walker",
    pdgm_impact: "Lowers functional score",
    resolution: "Reconcile the two items",
  },
];

describe("CrossValidationResults", () => {
  it("renders the rule, involved items, values, evidence, impact, and resolution", () => {
    renderWithProviders(<CrossValidationResults items={ITEMS} />);
    expect(screen.getByText("M1860 must align with M1850")).toBeInTheDocument();
    expect(screen.getByText("medium audit risk")).toBeInTheDocument();
    expect(screen.getByText("M1860=2, M1850=4")).toBeInTheDocument();
    expect(screen.getByText("M1850 should not exceed M1860")).toBeInTheDocument();
    expect(screen.getByText(/ambulates with walker/)).toBeInTheDocument();
    expect(screen.getByText("Lowers functional score")).toBeInTheDocument();
    expect(screen.getByText(/Reconcile the two items/)).toBeInTheDocument();
  });

  it("renders nothing when there are no items", () => {
    const { container } = renderWithProviders(<CrossValidationResults items={null} />);
    expect(container.firstChild).toBeNull();
  });
});
