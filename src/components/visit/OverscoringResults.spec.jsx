import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import OverscoringResults from "./OverscoringResults";

vi.mock("../oasis/OASISFeedbackPanel", () => ({
  default: ({ onAccept }) => <button onClick={onAccept}>stub-accept</button>,
}));

const ITEM = {
  oasis_item: "M1830 Bathing",
  audit_risk: "high",
  claimed_score: "5",
  supported_score: "3",
  narrative_evidence: "needs assist with bathing",
  recommended_action: "Lower the score to 3",
};

describe("OverscoringResults", () => {
  it("renders the risk fields", () => {
    renderWithProviders(
      <OverscoringResults items={[ITEM]} visit={{ id: "v1" }} patient={{ id: "p1" }} onAccept={vi.fn()} onReject={vi.fn()} onModify={vi.fn()} />,
    );
    expect(screen.getByText("M1830 Bathing")).toBeInTheDocument();
    expect(screen.getByText("high audit risk")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(/Lower the score to 3/)).toBeInTheDocument();
  });

  it("forwards onAccept with the item", () => {
    const onAccept = vi.fn();
    renderWithProviders(
      <OverscoringResults items={[ITEM]} visit={{ id: "v1" }} patient={{ id: "p1" }} onAccept={onAccept} onReject={vi.fn()} onModify={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("stub-accept"));
    expect(onAccept).toHaveBeenCalledWith(ITEM);
  });

  it("renders nothing when there are no items", () => {
    const { container } = renderWithProviders(<OverscoringResults items={null} />);
    expect(container.firstChild).toBeNull();
  });
});
