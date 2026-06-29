import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import QualityMeasuresImpact from "./QualityMeasuresImpact";

describe("QualityMeasuresImpact", () => {
  it("renders the heading and each measure", () => {
    renderWithProviders(
      <QualityMeasuresImpact measures={["Improves TNC mobility measure", "Raises star rating"]} />,
    );
    expect(screen.getByText("Quality Measures & Star Rating Impact")).toBeInTheDocument();
    expect(screen.getByText("Improves TNC mobility measure")).toBeInTheDocument();
    expect(screen.getByText("Raises star rating")).toBeInTheDocument();
  });

  it("renders nothing when the list is empty", () => {
    const { container } = renderWithProviders(<QualityMeasuresImpact measures={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when measures are missing", () => {
    const { container } = renderWithProviders(<QualityMeasuresImpact />);
    expect(container.firstChild).toBeNull();
  });
});
