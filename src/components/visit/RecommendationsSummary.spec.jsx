import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import RecommendationsSummary from "./RecommendationsSummary";

describe("RecommendationsSummary", () => {
  it("renders the heading and each recommendation", () => {
    renderWithProviders(
      <RecommendationsSummary recommendations={["Document assist level", "Add wound measurements"]} />,
    );
    expect(screen.getByText("OASIS Documentation Recommendations")).toBeInTheDocument();
    expect(screen.getByText("Document assist level")).toBeInTheDocument();
    expect(screen.getByText("Add wound measurements")).toBeInTheDocument();
  });

  it("renders nothing when the list is empty", () => {
    const { container } = renderWithProviders(<RecommendationsSummary recommendations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when recommendations are missing", () => {
    const { container } = renderWithProviders(<RecommendationsSummary />);
    expect(container.firstChild).toBeNull();
  });
});
