import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ClinicalIndicatorsPanel from "./ClinicalIndicatorsPanel";

// Pure component (no providers / network) — render directly.
describe("ClinicalIndicatorsPanel", () => {
  it("renders nothing for a too-short or empty narrative", () => {
    const { container } = render(<ClinicalIndicatorsPanel narrativeText="" />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<ClinicalIndicatorsPanel narrativeText="short" />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders nothing when the narrative has no detectable indicators", () => {
    const { container } = render(
      <ClinicalIndicatorsPanel narrativeText="The weather today was pleasant and the room was tidy and calm." />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("surfaces detected indicators and their evidence sentences", () => {
    const narrative =
      "Patient ambulates with a rolling walker. Uses oxygen at 2 L via nasal cannula. " +
      "Stage 2 pressure ulcer noted to the sacrum with serous drainage. History of falls in the past month.";
    render(<ClinicalIndicatorsPanel narrativeText={narrative} />);

    // Collapsed view shows chips for the detected categories.
    expect(screen.getByText("Clinical indicators detected")).toBeInTheDocument();
    expect(screen.getByText("Assistive Devices")).toBeInTheDocument();
    expect(screen.getByText("Oxygen Use")).toBeInTheDocument();
    expect(screen.getByText("Wounds / Skin")).toBeInTheDocument();
    expect(screen.getByText("Fall Risk")).toBeInTheDocument();

    // Expanding reveals the deterministic-scan disclaimer (advisory, no edit).
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/deterministic scan of your draft/i)).toBeInTheDocument();
  });
});
