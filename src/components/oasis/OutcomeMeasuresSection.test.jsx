import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { renderWithProviders } from "@/test/testUtils";

const { getPublishedOutcomeMeasures, manageOASISRecords, entityCall, auth } = vi.hoisted(() => ({
  getPublishedOutcomeMeasures: vi.fn(),
  manageOASISRecords: vi.fn(),
  entityCall: vi.fn(),
  auth: { current: null },
}));

// Any direct entity read or function call fails the test: the section reads
// only through the published-outcome broker.
vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: new Proxy({}, { get: (_t, entity) => new Proxy({}, { get: (_u, op) => (...args) => entityCall(entity, op, ...args) }) }),
    functions: { invoke: (...args) => entityCall("functions", "invoke", ...args) },
  },
}));
vi.mock("@/functions/getPublishedOutcomeMeasures", () => ({ getPublishedOutcomeMeasures }));
vi.mock("@/functions/manageOASISRecords", () => ({ manageOASISRecords }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.current }));

import OutcomeMeasuresSection, { previousUtcDate } from "./OutcomeMeasuresSection";

const PUBLISHED = {
  success: true,
  publication: { published_at: "2026-10-08T04:00:00.000Z", calculation_version: "outcome-v2" },
  patient_outcome_metrics: [{ patient_id: "p1" }, { patient_id: "p2" }],
  agency_kpis: [{
    id: "kpi-1",
    metric_name: "Improvement in Ambulation/Locomotion",
    metric_value: 62.5,
    benchmark_value: 70,
    unit: "%",
    status: "warning",
    contributing_factors: ["5 of 8 eligible episodes improved"],
  }],
};

describe("OutcomeMeasuresSection", () => {
  beforeEach(() => {
    getPublishedOutcomeMeasures.mockReset();
    manageOASISRecords.mockReset();
    entityCall.mockReset();
    auth.current = { user: { id: "u1" }, tenantContext: { agency_id: "agency-a" } };
  });

  it("previousUtcDate is the day before in UTC", () => {
    expect(previousUtcDate(new Date("2026-10-08T01:30:00Z"))).toBe("2026-10-07");
    expect(previousUtcDate(new Date("2026-03-01T23:59:00Z"))).toBe("2026-02-28");
  });

  it("reads the caller's own agency's published daily run and renders its measures", async () => {
    getPublishedOutcomeMeasures.mockResolvedValue({ data: PUBLISHED });
    renderWithProviders(<OutcomeMeasuresSection />);

    expect(await screen.findByText("Improvement in Ambulation/Locomotion")).toBeInTheDocument();
    expect(screen.getByText("62.5%")).toBeInTheDocument();
    expect(screen.getByText(/5 of 8 eligible episodes improved/)).toBeInTheDocument();
    expect(screen.getByText(/2 discharge episodes/)).toBeInTheDocument();
    const day = previousUtcDate();
    expect(getPublishedOutcomeMeasures).toHaveBeenCalledWith({
      agency_id: "agency-a", period_type: "daily", period_start: day, period_end: day,
    });
    // A member's agency comes from the bound tenant context; it is never
    // looked up, and nothing reads an outcome entity directly.
    expect(manageOASISRecords).not.toHaveBeenCalled();
    expect(entityCall).not.toHaveBeenCalled();
  });

  it("says plainly when no run has been published for the day", async () => {
    getPublishedOutcomeMeasures.mockRejectedValue(Object.assign(new Error("not found"), {
      response: { status: 404, data: { error: "No published outcome run exists for this reporting window" } },
    }));
    renderWithProviders(<OutcomeMeasuresSection />);
    expect(await screen.findByText(/No published outcome run for/)).toBeInTheDocument();
  });

  it("shows the broker's refusal rather than any value", async () => {
    getPublishedOutcomeMeasures.mockRejectedValue(Object.assign(new Error("forbidden"), {
      response: { status: 403, data: { error: "Agency administrator or manager membership is required" } },
    }));
    renderWithProviders(<OutcomeMeasuresSection />);
    expect(await screen.findByText(/Agency administrator or manager membership is required/)).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("the platform owner reports on an agency the broker lists, not one typed in", async () => {
    auth.current = { user: { id: "owner" }, tenantContext: { agency_id: null, is_platform_owner: true } };
    manageOASISRecords.mockResolvedValue({ agencies: [{ id: "agency-z", name: "Only Agency" }] });
    getPublishedOutcomeMeasures.mockResolvedValue({ data: PUBLISHED });
    renderWithProviders(<OutcomeMeasuresSection />);
    await waitFor(() => expect(getPublishedOutcomeMeasures).toHaveBeenCalled());
    expect(manageOASISRecords).toHaveBeenCalledWith("list_agencies");
    expect(getPublishedOutcomeMeasures.mock.calls[0][0].agency_id).toBe("agency-z");
  });

  it("contains no direct outcome entity read and no route to the computation job", () => {
    const source = readFileSync("src/components/oasis/OutcomeMeasuresSection.jsx", "utf8");
    expect(source).not.toMatch(/base44\.entities|functions\.invoke|@\/api\/base44Client/);
    expect(source).not.toMatch(/computeOutcomeMeasures|dispatchNightlyOutcomeMeasures/);
  });
});
