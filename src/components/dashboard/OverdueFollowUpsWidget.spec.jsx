import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { listReferrals, auth } = vi.hoisted(() => ({
  listReferrals: vi.fn(),
  auth: { tenantContext: null },
}));

vi.mock("@/functions/manageAuthorizedReferral", () => ({
  listAuthorizedReferrals: (...args) => listReferrals(...args),
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => auth,
}));

import OverdueFollowUpsWidget, { followUpAttentionRows, OVERDUE_DAYS } from "./OverdueFollowUpsWidget";

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const context = (tenantRole, overrides = {}) => ({
  agency_id: "agency-a",
  membership_id: "m1",
  membership_version: 1,
  membership_status: "active",
  tenant_role: tenantRole,
  ...overrides,
});

beforeEach(() => {
  listReferrals.mockReset();
  auth.tenantContext = null;
});

describe("OverdueFollowUpsWidget (restored 2026-10-08)", () => {
  it.each([
    ["clinician"],
    ["office_staff"],
    ["social_worker"],
    ["spiritual_care"],
  ])("never asks the broker for a %s, who does not open every chart", (role) => {
    auth.tenantContext = context(role);
    const { container } = renderWithProviders(<OverdueFollowUpsWidget />);
    expect(container).toBeEmptyDOMElement();
    expect(listReferrals).not.toHaveBeenCalled();
  });

  it("stays silent without an active membership", () => {
    auth.tenantContext = context("agency_admin", { membership_status: "suspended" });
    renderWithProviders(<OverdueFollowUpsWidget />);
    expect(listReferrals).not.toHaveBeenCalled();
  });

  it("lists follow-ups for an agency administrator from their own agency's broker", async () => {
    auth.tenantContext = context("agency_admin");
    listReferrals.mockResolvedValue({
      referrals: [
        {
          id: "r-overdue",
          status: "processed",
          patient_name: "Pat Overdue",
          referral_source: "Dr. Smith",
          follow_up_requests: { status: "sent", generated_at: daysAgo(OVERDUE_DAYS + 1), items: [{ item_status: "open" }] },
        },
        {
          id: "r-in",
          status: "processed",
          patient_name: "Pat Response",
          follow_up_requests: { status: "received", received_at: daysAgo(1), items: [{ item_status: "answered" }] },
        },
        {
          id: "r-closed",
          status: "soc_completed",
          patient_name: "Pat Closed",
          follow_up_requests: { status: "sent", generated_at: daysAgo(9) },
        },
      ],
    });
    renderWithProviders(<OverdueFollowUpsWidget />);
    expect(await screen.findByText("Pat Overdue")).toBeInTheDocument();
    expect(screen.getByText("Pat Response")).toBeInTheDocument();
    expect(screen.queryByText("Pat Closed")).not.toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();
    expect(listReferrals).toHaveBeenCalledWith({ agencyId: "agency-a", limit: 200 });
    expect(screen.getByRole("link", { name: /Pat Overdue/ })).toHaveAttribute("href", "/ReferralFollowUp?id=r-overdue");
  });

  it("reports a refused read instead of an empty queue", async () => {
    auth.tenantContext = context("manager");
    listReferrals.mockRejectedValue(new Error("Forbidden"));
    renderWithProviders(<OverdueFollowUpsWidget />);
    expect(await screen.findByText(/No empty queue is being inferred/)).toBeInTheDocument();
  });

  it("orders overdue sends before fresh responses before waiting sends", () => {
    const rows = followUpAttentionRows([
      { id: "waiting", follow_up_requests: { status: "sent", generated_at: daysAgo(1) } },
      { id: "response", follow_up_requests: { status: "received", received_at: daysAgo(2) } },
      { id: "overdue", follow_up_requests: { status: "sent", generated_at: daysAgo(OVERDUE_DAYS + 3) } },
    ]);
    expect(rows.map((row) => row.referral.id)).toEqual(["overdue", "response", "waiting"]);
  });

  it("refetches on mount without leaking another agency's cache key", async () => {
    auth.tenantContext = context("manager", { agency_id: "agency-b" });
    listReferrals.mockResolvedValue({ referrals: [] });
    renderWithProviders(<OverdueFollowUpsWidget />);
    await waitFor(() => expect(listReferrals).toHaveBeenCalledWith({ agencyId: "agency-b", limit: 200 }));
  });
});
