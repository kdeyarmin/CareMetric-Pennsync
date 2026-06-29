import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import ClinicalIndicatorsGrid from "./ClinicalIndicatorsGrid";

// Three of the eight indicators detected; the rest not found.
const CLINICAL = {
  assistDevices: { detected: true, sentences: ["uses a rolling walker"] },
  oxygenUse: { detected: false },
  woundPresent: { detected: true, sentences: [] },
  fallRisk: { detected: false },
  painMentioned: { detected: false },
  cognitiveIssues: { detected: false },
  diabetic: { detected: true, sentences: ["checks blood glucose"] },
  cardiacIssues: { detected: false },
};

describe("ClinicalIndicatorsGrid", () => {
  it("renders every indicator tile with its label", () => {
    renderWithProviders(<ClinicalIndicatorsGrid clinical={CLINICAL} />);
    for (const label of [
      "Assistive Devices",
      "Oxygen Use",
      "Wounds",
      "Fall Risk",
      "Pain",
      "Cognitive",
      "Diabetic",
      "Cardiac",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks detected vs not-found indicators", () => {
    renderWithProviders(<ClinicalIndicatorsGrid clinical={CLINICAL} />);
    expect(screen.getAllByText("Detected")).toHaveLength(3);
    expect(screen.getAllByText("Not found")).toHaveLength(5);
  });

  it("treats a missing indicator entry as not-found (optional chaining)", () => {
    renderWithProviders(<ClinicalIndicatorsGrid clinical={{}} />);
    // every tile still renders, all not-found
    expect(screen.getAllByText("Not found")).toHaveLength(8);
  });

  it("renders nothing without clinical data", () => {
    const { container } = renderWithProviders(<ClinicalIndicatorsGrid clinical={null} />);
    expect(container.firstChild).toBeNull();
  });
});
