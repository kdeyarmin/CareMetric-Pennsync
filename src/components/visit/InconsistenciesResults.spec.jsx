import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import InconsistenciesResults from "./InconsistenciesResults";

const ITEMS = [
  {
    issue: "Conflicting ambulation statements",
    inconsistency_type: "score_mismatch",
    audit_risk: "high",
    location_1: "ambulates independently",
    location_2: "requires max assist to ambulate",
    oasis_items_affected: ["M1860", "M1850"],
    why_problematic: "Cannot be both independent and max assist",
    resolution: "Clarify true ambulation status",
  },
];

describe("InconsistenciesResults", () => {
  it("renders the issue, type, risk, both statements, affected items, and resolution", () => {
    renderWithProviders(<InconsistenciesResults items={ITEMS} />);
    expect(screen.getByText("Conflicting ambulation statements")).toBeInTheDocument();
    expect(screen.getByText("score mismatch")).toBeInTheDocument(); // underscores replaced
    expect(screen.getByText("high risk")).toBeInTheDocument();
    expect(screen.getByText(/ambulates independently/)).toBeInTheDocument();
    expect(screen.getByText(/requires max assist to ambulate/)).toBeInTheDocument();
    expect(screen.getByText("Affects:")).toBeInTheDocument();
    expect(screen.getByText(/Cannot be both independent and max assist/)).toBeInTheDocument();
    expect(screen.getByText(/Clarify true ambulation status/)).toBeInTheDocument();
  });

  it("renders nothing when there are no items", () => {
    const { container } = renderWithProviders(<InconsistenciesResults items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
