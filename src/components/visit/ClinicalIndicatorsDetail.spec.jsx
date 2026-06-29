import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import ClinicalIndicatorsDetail from "./ClinicalIndicatorsDetail";

const CLINICAL = {
  assistDevices: { detected: true, sentences: ["uses a rolling walker", "needs a cane outdoors"] },
  woundPresent: { detected: true, sentences: [] }, // detected but no phrases → no copy buttons
  oxygenUse: { detected: false },
  // other indicators absent → skipped (if (!indicator) return null)
};

describe("ClinicalIndicatorsDetail", () => {
  it("renders only the indicators present in the data, with detected/not-found state", () => {
    renderWithProviders(<ClinicalIndicatorsDetail clinical={CLINICAL} copiedText={null} onCopy={vi.fn()} />);
    expect(screen.getByText("Clinical Indicators Extracted")).toBeInTheDocument();
    expect(screen.getByText("Assistive Devices")).toBeInTheDocument();
    expect(screen.getByText("Wound Presence")).toBeInTheDocument();
    expect(screen.getByText("Oxygen Usage")).toBeInTheDocument();
    // an absent indicator is skipped entirely
    expect(screen.queryByText("Cardiac Symptoms")).toBeNull();
    expect(screen.getAllByText("Detected")).toHaveLength(2);
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });

  it("renders the matched phrases and a copy button per phrase", () => {
    renderWithProviders(<ClinicalIndicatorsDetail clinical={CLINICAL} copiedText={null} onCopy={vi.fn()} />);
    expect(screen.getByText(/uses a rolling walker/)).toBeInTheDocument();
    expect(screen.getByText(/needs a cane outdoors/)).toBeInTheDocument();
    // two phrases for assistDevices → two copy buttons (woundPresent has none)
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("calls onCopy with the phrase text and a per-phrase id", () => {
    const onCopy = vi.fn();
    renderWithProviders(<ClinicalIndicatorsDetail clinical={CLINICAL} copiedText={null} onCopy={onCopy} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onCopy).toHaveBeenCalledWith("uses a rolling walker", "assistDevices-0");
  });

  it("renders nothing without clinical data", () => {
    const { container } = renderWithProviders(
      <ClinicalIndicatorsDetail clinical={null} copiedText={null} onCopy={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
