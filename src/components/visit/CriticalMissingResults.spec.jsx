import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import CriticalMissingResults from "./CriticalMissingResults";

vi.mock("../oasis/OASISFeedbackPanel", () => ({
  default: ({ onAccept }) => <button onClick={onAccept}>stub-accept</button>,
}));

const ITEM = {
  oasis_item: "M1311 Pressure Ulcers",
  category: "Integumentary",
  reimbursement_impact: "high",
  why_critical: "Required for accurate case-mix",
  documentation_guidance: "Stage and measure each ulcer",
  example: "Stage 2 sacral ulcer, 2x1cm",
};

describe("CriticalMissingResults", () => {
  it("renders the critical item fields and impact badge", () => {
    renderWithProviders(
      <CriticalMissingResults items={[ITEM]} visit={{ id: "v1" }} patient={{ id: "p1" }} onAccept={vi.fn()} onReject={vi.fn()} onModify={vi.fn()} />,
    );
    expect(screen.getByText("M1311 Pressure Ulcers")).toBeInTheDocument();
    expect(screen.getByText("Integumentary")).toBeInTheDocument();
    expect(screen.getByText("HIGH IMPACT")).toBeInTheDocument();
    expect(screen.getByText(/Required for accurate case-mix/)).toBeInTheDocument();
    expect(screen.getByText("Stage and measure each ulcer")).toBeInTheDocument();
  });

  it("forwards onAccept with the item", () => {
    const onAccept = vi.fn();
    renderWithProviders(
      <CriticalMissingResults items={[ITEM]} visit={{ id: "v1" }} patient={{ id: "p1" }} onAccept={onAccept} onReject={vi.fn()} onModify={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("stub-accept"));
    expect(onAccept).toHaveBeenCalledWith(ITEM);
  });

  it("renders nothing when there are no items", () => {
    const { container } = renderWithProviders(<CriticalMissingResults items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
