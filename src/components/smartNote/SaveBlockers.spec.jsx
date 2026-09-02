import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import SaveBlockers from "./SaveBlockers";

const items = (overrides = {}) => [
  { label: "Fix the fact-check findings above, then re-check.", blocked: false, ...overrides.fix },
  { label: "Select a patient — a note can only be saved to a chart.", blocked: false, ...overrides.patient },
  { label: "Acknowledge the chart safety conflict.", blocked: false, ...overrides.chart },
];

describe("SaveBlockers — why Save is disabled", () => {
  it("stays out of the way when nothing is blocking", () => {
    const { container } = renderWithProviders(<SaveBlockers items={items()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every outstanding reason at once, not one per click", () => {
    renderWithProviders(
      <SaveBlockers items={items({ patient: { blocked: true }, chart: { blocked: true } })} />,
    );
    expect(screen.getByText(/select a patient/i)).toBeInTheDocument();
    expect(screen.getByText(/acknowledge the chart safety conflict/i)).toBeInTheDocument();
  });

  it("does not list reasons that are already satisfied", () => {
    renderWithProviders(<SaveBlockers items={items({ patient: { blocked: true } })} />);
    expect(screen.getByText(/select a patient/i)).toBeInTheDocument();
    expect(screen.queryByText(/acknowledge the chart safety conflict/i)).not.toBeInTheDocument();
  });

  it("keeps a failed save's own message on screen instead of only in a toast", () => {
    renderWithProviders(
      <SaveBlockers items={items()} error="You're offline — the note is saved on this device and will need saving to the chart once you reconnect." />,
    );
    expect(screen.getByText(/this note wasn't saved/i)).toBeInTheDocument();
    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
  });

  it("announces itself, since it appears in response to an action", () => {
    renderWithProviders(<SaveBlockers items={items({ patient: { blocked: true } })} />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
  });
});
