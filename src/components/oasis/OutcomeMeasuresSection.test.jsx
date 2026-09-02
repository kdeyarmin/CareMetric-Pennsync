import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { renderWithProviders } from "@/test/testUtils";
import OutcomeMeasuresSection from "./OutcomeMeasuresSection";

describe("OutcomeMeasuresSection safe state", () => {
  it("shows a clear tenant-security hold instead of clinical values", () => {
    renderWithProviders(<OutcomeMeasuresSection />);

    expect(screen.getByText(/temporarily unavailable pending tenant security validation/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Direct outcome-data reads and browser recomputation are disabled/i))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /recompute/i })).toBeNull();
  });

  it("contains no direct outcome entity read or browser function invocation", () => {
    const source = readFileSync("src/components/oasis/OutcomeMeasuresSection.jsx", "utf8");
    expect(source).not.toMatch(/base44\.entities\.(AgencyKPI|PatientOutcomeMetric)/);
    expect(source).not.toMatch(/computeOutcomeMeasures|functions\.invoke/);
  });
});
