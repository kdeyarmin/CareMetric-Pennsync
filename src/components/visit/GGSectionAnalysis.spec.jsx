import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import GGSectionAnalysis from "./GGSectionAnalysis";

const ANALYSIS = {
  gg0130_self_care_summary: "Independent with grooming",
  gg0170_mobility_summary: "Requires supervision for transfers",
  goal_appropriateness: "Goals are realistic",
  functional_improvement_potential: "High potential for ambulation gains",
};

describe("GGSectionAnalysis", () => {
  it("renders the heading and each provided field", () => {
    renderWithProviders(<GGSectionAnalysis analysis={ANALYSIS} />);
    expect(screen.getByText("Section GG Functional Analysis")).toBeInTheDocument();
    expect(screen.getByText("Independent with grooming")).toBeInTheDocument();
    expect(screen.getByText("Requires supervision for transfers")).toBeInTheDocument();
    expect(screen.getByText("Goals are realistic")).toBeInTheDocument();
    expect(screen.getByText("High potential for ambulation gains")).toBeInTheDocument();
  });

  it("omits fields that are not present", () => {
    renderWithProviders(<GGSectionAnalysis analysis={{ gg0130_self_care_summary: "Only self-care" }} />);
    expect(screen.getByText("Only self-care")).toBeInTheDocument();
    expect(screen.queryByText("GG0170 Mobility")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no analysis", () => {
    const { container } = renderWithProviders(<GGSectionAnalysis analysis={null} />);
    expect(container.firstChild).toBeNull();
  });
});
