import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { invoke, auth } = vi.hoisted(() => ({
  invoke: vi.fn(),
  auth: { user: { id: "u1", email: "admin@a.test" } },
}));

vi.mock("@/api/base44Client", () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => auth,
}));

import PhoneAnalyticsPanel from "./PhoneAnalyticsPanel";

const now = new Date().toISOString();
const report = {
  success: true,
  scope: "agency",
  row_limit: 5000,
  truncated: false,
  texts: [
    { id: "s1", created_date: now, direction: "outbound", status: "delivered", from_masked: "(•••) •••-0100", to_masked: "(•••) •••-1234", body_length: 12 },
    { id: "s2", created_date: now, direction: "outbound", status: "failed", from_masked: "(•••) •••-0100", to_masked: "(•••) •••-1234", body_length: 4 },
    { id: "s3", created_date: now, direction: "inbound", status: "received", from_masked: "(•••) •••-1234", to_masked: "(•••) •••-0100", body_length: 6 },
  ],
  calls: [
    { id: "c1", created_date: now, direction: "outbound", status: "completed", duration_seconds: 90 },
  ],
  consents: [
    { consent_key: "k1", consent_status: "opted_in", captured_at: now },
  ],
  members: [
    { email: "admin@a.test", has_work_number: true, has_personal_cell: true },
    { email: "nurse@a.test", has_work_number: false, has_personal_cell: false },
  ],
};

beforeEach(() => {
  invoke.mockReset();
  auth.user = { id: "u1", email: "admin@a.test" };
});

describe("PhoneAnalyticsPanel (restored 2026-10-08)", () => {
  it("summarizes the server's scoped phone report", async () => {
    invoke.mockResolvedValue({ data: report });
    renderWithProviders(<PhoneAnalyticsPanel />);

    expect(await screen.findByText("1 in · 2 out")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("getUserActivityLog", { mode: "phone", days: 30 });
    expect(screen.getByText("1 of 2 sent")).toBeInTheDocument(); // delivered
    expect(screen.getByText("1 of 2")).toBeInTheDocument(); // work-number coverage
    expect(screen.getAllByText("50%")).toHaveLength(2); // delivery rate and coverage
    expect(screen.getByText(/\(your agency\)/)).toBeInTheDocument();
  });

  it("renders nothing for a caller the server refuses", async () => {
    const refusal = Object.assign(new Error("Request failed with status code 403"), {
      response: { status: 403, data: { error: "Administrator access required." } },
    });
    invoke.mockRejectedValue(refusal);
    const { container } = renderWithProviders(<PhoneAnalyticsPanel />);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows a failure state, never zero activity, when the report cannot be read", async () => {
    invoke.mockResolvedValue({ data: { success: false, error: "Internal server error" } });
    renderWithProviders(<PhoneAnalyticsPanel />);

    expect(await screen.findByText("Phone and SMS analytics unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Total texts")).not.toBeInTheDocument();
  });
});
