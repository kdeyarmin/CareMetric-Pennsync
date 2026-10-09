import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("@/functions/processCompletedVisit", () => ({
  processCompletedVisit: (...args) => mocks.process(...args),
}));

import PostVisitProcessingPanel from "./PostVisitProcessingPanel";

describe("PostVisitProcessingPanel", () => {
  beforeEach(() => {
    mocks.process.mockReset();
  });

  it("sends only the visit id and reports the published tasks", async () => {
    mocks.process.mockResolvedValue({ data: { success: true, tasks_created: 1, tasks: [{ id: "t1", title: "Call physician" }] } });
    renderWithProviders(<PostVisitProcessingPanel visitId="visit-1" />);
    fireEvent.click(screen.getByRole("button", { name: /generate narrative and tasks/i }));
    expect(await screen.findByText("Call physician")).toBeInTheDocument();
    expect(mocks.process).toHaveBeenCalledWith({ visit_id: "visit-1" });
    expect(screen.getByRole("status")).toHaveTextContent(/1 follow-up task created/);
  });

  it("shows the server's refusal", async () => {
    mocks.process.mockImplementation(async () => {
      throw Object.assign(new Error("Forbidden"), {
        status: 403, data: { error: "Active clinician membership required" },
      });
    });
    renderWithProviders(<PostVisitProcessingPanel visitId="visit-1" />);
    fireEvent.click(screen.getByRole("button", { name: /generate narrative and tasks/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Active clinician membership required");
  });
});
