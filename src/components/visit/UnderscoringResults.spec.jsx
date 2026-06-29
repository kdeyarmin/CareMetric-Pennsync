import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import UnderscoringResults from "./UnderscoringResults";

// Stub the feedback panel so we can assert the lifted handlers fire.
vi.mock("../oasis/OASISFeedbackPanel", () => ({
  default: ({ onAccept, onReject, onModify }) => (
    <div>
      <button onClick={onAccept}>stub-accept</button>
      <button onClick={onReject}>stub-reject</button>
      <button onClick={() => onModify("modified")}>stub-modify</button>
    </div>
  ),
}));

const ITEM = {
  oasis_item: "M1860 Ambulation",
  revenue_impact: "+$200",
  current_implied_score: "2",
  supported_score: "4",
  narrative_evidence: "ambulates 50 feet with walker",
};

describe("UnderscoringResults", () => {
  it("renders the opportunity fields", () => {
    renderWithProviders(
      <UnderscoringResults items={[ITEM]} visit={{ id: "v1" }} patient={{ id: "p1" }} onAccept={vi.fn()} onReject={vi.fn()} onModify={vi.fn()} />,
    );
    expect(screen.getByText("M1860 Ambulation")).toBeInTheDocument();
    expect(screen.getByText("+$200")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/ambulates 50 feet with walker/)).toBeInTheDocument();
  });

  it("forwards the feedback handlers (accept passes the item)", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onModify = vi.fn();
    renderWithProviders(
      <UnderscoringResults items={[ITEM]} visit={{ id: "v1" }} patient={{ id: "p1" }} onAccept={onAccept} onReject={onReject} onModify={onModify} />,
    );
    fireEvent.click(screen.getByText("stub-accept"));
    fireEvent.click(screen.getByText("stub-reject"));
    fireEvent.click(screen.getByText("stub-modify"));
    expect(onAccept).toHaveBeenCalledWith(ITEM);
    expect(onReject).toHaveBeenCalled();
    expect(onModify).toHaveBeenCalledWith("modified");
  });

  it("renders nothing when there are no items", () => {
    const { container } = renderWithProviders(<UnderscoringResults items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
