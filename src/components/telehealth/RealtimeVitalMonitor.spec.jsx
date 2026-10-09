import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { manage } = vi.hoisted(() => ({ manage: vi.fn() }));

vi.mock("@/functions/manageTelehealthSession", () => ({
  manageTelehealthSession: (...args) => manage(...args),
}));

import RealtimeVitalMonitor, { isOutsideReference, vitalInputError } from "./RealtimeVitalMonitor";

const session = (vitals = {}) => ({ session: { id: "s1", agency_id: "agency-a", status: "active", vitals_captured: vitals } });

beforeEach(() => {
  manage.mockReset();
});

describe("RealtimeVitalMonitor (released 2026-10-08)", () => {
  it("reads the visit's vitals only through the broker's get action", async () => {
    manage.mockResolvedValue(session({ heart_rate: 120, recorded_at: "2026-10-08T12:00:00.000Z" }));
    renderWithProviders(<RealtimeVitalMonitor sessionId="s1" agencyId="agency-a" />);

    expect(await screen.findByText("120 bpm")).toBeInTheDocument();
    expect(manage).toHaveBeenCalledWith({ action: "get", agency_id: "agency-a", session_id: "s1" });
    // An out-of-range reading is flagged against the reference range, and
    // nothing claims to predict anything.
    expect(screen.getByText(/Outside the usual adult range: Heart rate 120 bpm/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/risk|predict/i);
  });

  it("records a reading through record_vitals and shows the server's merged answer", async () => {
    manage.mockImplementation(async (payload) => (payload.action === "get"
      ? session({})
      : session({ temperature: 98.6, recorded_at: "2026-10-08T12:01:00.000Z" })));
    renderWithProviders(<RealtimeVitalMonitor sessionId="s1" agencyId="agency-a" />);

    const input = await screen.findByLabelText("Temperature");
    fireEvent.change(input, { target: { value: "98.6" } });
    const recordButtons = screen.getAllByRole("button", { name: "Record" });
    fireEvent.click(recordButtons[3]);

    await waitFor(() => expect(manage).toHaveBeenCalledWith({
      action: "record_vitals",
      agency_id: "agency-a",
      session_id: "s1",
      vitals: { temperature: 98.6 },
    }));
    expect(await screen.findByText("98.6 °F")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Vital recorded on this visit.");
  });

  it("refuses an impossible value before any write", async () => {
    manage.mockResolvedValue(session({}));
    renderWithProviders(<RealtimeVitalMonitor sessionId="s1" agencyId="agency-a" />);

    const input = await screen.findByLabelText("Heart rate");
    fireEvent.change(input, { target: { value: "9000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Record" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent("Heart rate must be between 10 and 300");
    expect(manage.mock.calls.filter(([payload]) => payload.action === "record_vitals")).toEqual([]);
  });

  it("shows the server's refusal instead of a reading", async () => {
    manage.mockImplementation(async (payload) => {
      if (payload.action === "get") return session({});
      const error = new Error("Request failed with status code 403");
      error.response = { status: 403, data: { error: "This chart is not open to you" } };
      throw error;
    });
    renderWithProviders(<RealtimeVitalMonitor sessionId="s1" agencyId="agency-a" />);

    fireEvent.change(await screen.findByLabelText("Pain (0–10)"), { target: { value: "4" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Record" })[6]);
    expect(await screen.findByRole("alert")).toHaveTextContent("This chart is not open to you");
  });

  it("renders a failure state, not an empty grid, when the read fails", async () => {
    manage.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500, data: {} } }));
    renderWithProviders(<RealtimeVitalMonitor sessionId="s1" agencyId="agency-a" />);

    expect(await screen.findByText("Live vital capture unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
  });

  it("validates like the server and flags only against the reference range", () => {
    expect(vitalInputError("oxygen_saturation", "49")).toMatch(/between 50 and 100/);
    expect(vitalInputError("oxygen_saturation", "")).toMatch(/between 50 and 100/);
    expect(vitalInputError("oxygen_saturation", "97")).toBeNull();
    expect(isOutsideReference("oxygen_saturation", 91)).toBe(true);
    expect(isOutsideReference("pain_level", 9)).toBe(false);
  });
});
