import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/testUtils";

const mocks = vi.hoisted(() => ({
  agencies: vi.fn(),
  manage: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: { entities: { Agency: { list: mocks.agencies } } },
}));
vi.mock("@/functions/manageAgencyMembership", () => ({
  manageAgencyMembership: mocks.manage,
}));
vi.mock("@/lib/superAdmin", () => ({
  isSuperAdmin: (user) => user?.role === "admin" && user?.email === "owner@agency.test",
  isSuperAdminEmail: (email) => email === "owner@agency.test",
}));

import AgencyAccessPanel from "./AgencyAccessPanel";

const owner = { id: "owner-1", email: "owner@agency.test", role: "admin" };
const nurse = { id: "user-2", email: "Nurse@Agency.test", full_name: "Pat Nurse", role: "user", is_active: true };
const notFound = Object.assign(new Error("Membership not found"), { status: 404 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agencies.mockResolvedValue([{ id: "agency-1", agency_name: "Penn Home Health", status: "active" }]);
});

describe("AgencyAccessPanel", () => {
  it("renders nothing for anyone but the platform owner", () => {
    const { container } = renderWithProviders(
      <AgencyAccessPanel currentUser={{ id: "a", email: "admin@agency.test", role: "admin" }} users={[nurse]} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(mocks.agencies).not.toHaveBeenCalled();
  });

  it("grants a staff member access by provisioning and then activating", async () => {
    let membership = null;
    mocks.manage.mockImplementation(async (payload) => {
      if (payload.action === "inspect") {
        if (!membership) throw notFound;
        return { data: { membership } };
      }
      if (payload.action === "provision") {
        membership = { id: "m-1", status: "pending", tenant_role: payload.tenant_role, version: 1 };
      } else if (payload.action === "activate") {
        membership = { ...membership, status: "active", version: membership.version + 1 };
      }
      return { data: { membership } };
    });

    const user = userEvent.setup();
    renderWithProviders(<AgencyAccessPanel currentUser={owner} users={[owner, nurse]} />);

    expect(await screen.findByText("Penn Home Health")).toBeInTheDocument();
    // The owner is never listed: the function refuses to give the owner a membership.
    expect(screen.queryByText("owner@agency.test")).not.toBeInTheDocument();
    expect(await screen.findByText("No access")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /grant access/i }));

    await waitFor(() => expect(screen.getByText("Access granted.")).toBeInTheDocument());
    const calls = mocks.manage.mock.calls.map(([payload]) => payload).filter((p) => p.action !== "inspect");
    expect(calls).toEqual([
      {
        action: "provision",
        agency_id: "agency-1",
        target_user_id: "user-2",
        target_user_email: "nurse@agency.test",
        reason: expect.any(String),
        tenant_role: "clinician",
      },
      {
        action: "activate",
        agency_id: "agency-1",
        target_user_id: "user-2",
        target_user_email: "nurse@agency.test",
        reason: expect.any(String),
        expected_version: 1,
      },
    ]);
    expect(await screen.findByText("active")).toBeInTheDocument();
  });

  it("shows the function's refusal inline instead of claiming success", async () => {
    mocks.manage.mockImplementation(async (payload) => {
      if (payload.action === "inspect") throw notFound;
      throw Object.assign(new Error("Target User is deactivated"), { status: 409 });
    });
    const user = userEvent.setup();
    renderWithProviders(<AgencyAccessPanel currentUser={owner} users={[nurse]} />);

    await user.click(await screen.findByRole("button", { name: /grant access/i }));
    expect(await screen.findByText(/Target User is deactivated \(409\)/)).toBeInTheDocument();
    expect(screen.queryByText("Access granted.")).not.toBeInTheDocument();
  });
});
