import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import ClinicalGroupSummary from "./ClinicalGroupSummary";

const GROUP = {
  group: "MMTA-CARDIAC",
  name: "Cardiac/Circulatory",
  confidence: "high",
  matchedPatterns: ["heart failure", "edema"],
};

describe("ClinicalGroupSummary — compact", () => {
  it("renders the group, name, confidence, and matched patterns", () => {
    renderWithProviders(<ClinicalGroupSummary clinicalGroup={GROUP} variant="compact" />);
    expect(screen.getByText("PDGM Clinical Group")).toBeInTheDocument();
    expect(screen.getByText(/high confidence/)).toBeInTheDocument();
    expect(screen.getByText(/MMTA-CARDIAC - Cardiac\/Circulatory/)).toBeInTheDocument();
    expect(screen.getByText("heart failure")).toBeInTheDocument();
    expect(screen.getByText("edema")).toBeInTheDocument();
  });

  it("omits the patterns row when there are none", () => {
    renderWithProviders(
      <ClinicalGroupSummary clinicalGroup={{ ...GROUP, matchedPatterns: [] }} variant="compact" />,
    );
    expect(screen.getByText("PDGM Clinical Group")).toBeInTheDocument();
    expect(screen.queryByText("heart failure")).toBeNull();
  });
});

describe("ClinicalGroupSummary — expanded", () => {
  it("renders the full card with uppercased confidence and patterns", () => {
    renderWithProviders(<ClinicalGroupSummary clinicalGroup={GROUP} variant="expanded" />);
    expect(screen.getByText("PDGM Clinical Group Analysis")).toBeInTheDocument();
    expect(screen.getByText("MMTA-CARDIAC")).toBeInTheDocument();
    expect(screen.getByText("Cardiac/Circulatory")).toBeInTheDocument();
    expect(screen.getByText(/HIGH CONFIDENCE/)).toBeInTheDocument();
    expect(screen.getByText("Matched Patterns:")).toBeInTheDocument();
    expect(screen.getByText("heart failure")).toBeInTheDocument();
  });
});

describe("ClinicalGroupSummary — guards", () => {
  it("renders nothing without a clinicalGroup", () => {
    const { container } = renderWithProviders(<ClinicalGroupSummary clinicalGroup={null} />);
    expect(container.firstChild).toBeNull();
  });
});
