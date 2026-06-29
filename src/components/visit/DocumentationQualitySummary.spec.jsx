import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import DocumentationQualitySummary from "./DocumentationQualitySummary";

const QUALITY = {
  specificity_score: 72,
  defensibility_score: 64,
  key_weaknesses: ["Vague assist levels", "Missing wound measurements"],
};

describe("DocumentationQualitySummary", () => {
  it("renders the scores and key weaknesses", () => {
    renderWithProviders(<DocumentationQualitySummary quality={QUALITY} />);
    expect(screen.getByText("Documentation Quality Analysis")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("64")).toBeInTheDocument();
    expect(screen.getByText("Vague assist levels")).toBeInTheDocument();
    expect(screen.getByText("Missing wound measurements")).toBeInTheDocument();
  });

  it("shows N/A when a score is missing and omits the weaknesses block when empty", () => {
    renderWithProviders(<DocumentationQualitySummary quality={{ key_weaknesses: [] }} />);
    expect(screen.getAllByText("N/A").length).toBe(2);
    expect(screen.queryByText("Key Weaknesses:")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no quality object", () => {
    const { container } = renderWithProviders(<DocumentationQualitySummary quality={null} />);
    expect(container.firstChild).toBeNull();
  });
});
