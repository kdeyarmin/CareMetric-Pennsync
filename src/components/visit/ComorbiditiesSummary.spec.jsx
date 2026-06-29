import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import ComorbiditiesSummary from "./ComorbiditiesSummary";

// Shape mirrors identifyComorbidities() output as consumed by the panel.
const COMORBIDITIES = {
  count: 2,
  adjustment: "high",
  high: [{ name: "CHF", icd10_codes: ["I50.2", "I50.3"] }],
  low: [{ name: "Hypertension" }],
};

const EMPTY = { count: 0, adjustment: "none", high: [], low: [] };

describe("ComorbiditiesSummary — compact", () => {
  it("renders the chip list with adjustment and comorbidity names", () => {
    renderWithProviders(<ComorbiditiesSummary comorbidities={COMORBIDITIES} variant="compact" />);
    expect(screen.getByText("Identified Comorbidities")).toBeInTheDocument();
    expect(screen.getByText(/high adjustment/)).toBeInTheDocument();
    expect(screen.getByText("CHF")).toBeInTheDocument();
    expect(screen.getByText("Hypertension")).toBeInTheDocument();
  });

  it("renders nothing when no comorbidities were found", () => {
    const { container } = renderWithProviders(
      <ComorbiditiesSummary comorbidities={EMPTY} variant="compact" />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("ComorbiditiesSummary — expanded", () => {
  it("renders the high/low card with names, ICD-10 codes, and uppercased adjustment", () => {
    renderWithProviders(<ComorbiditiesSummary comorbidities={COMORBIDITIES} variant="expanded" />);
    expect(screen.getByText("Comorbidity Analysis")).toBeInTheDocument();
    expect(screen.getByText(/HIGH Adjustment/)).toBeInTheDocument();
    expect(screen.getByText("CHF")).toBeInTheDocument();
    expect(screen.getByText(/I50\.2, I50\.3/)).toBeInTheDocument();
    expect(screen.getByText("Hypertension")).toBeInTheDocument();
  });

  it("always renders (with placeholders) even when empty", () => {
    renderWithProviders(<ComorbiditiesSummary comorbidities={EMPTY} variant="expanded" />);
    expect(screen.getByText("Comorbidity Analysis")).toBeInTheDocument();
    expect(screen.getAllByText("None identified")).toHaveLength(2);
  });
});
