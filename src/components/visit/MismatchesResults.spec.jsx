import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import MismatchesResults from "./MismatchesResults";

const ITEMS = [
  {
    oasis_item: "M1830 Bathing",
    audit_risk: "high",
    uploaded_score: "2",
    narrative_suggests: "4",
    discrepancy: "Score lower than narrative supports",
    recommendation: "Re-score M1830 to 4",
  },
];

describe("MismatchesResults", () => {
  it("renders the mismatch card with scores, discrepancy, and recommendation", () => {
    renderWithProviders(<MismatchesResults items={ITEMS} />);
    expect(screen.getByText("M1830 Bathing")).toBeInTheDocument();
    expect(screen.getByText("high audit risk")).toBeInTheDocument();
    expect(screen.getByText("Uploaded OASIS Score")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Score lower than narrative supports")).toBeInTheDocument();
    expect(screen.getByText(/Re-score M1830 to 4/)).toBeInTheDocument();
  });

  it("renders nothing when there are no items", () => {
    const { container } = renderWithProviders(<MismatchesResults items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
