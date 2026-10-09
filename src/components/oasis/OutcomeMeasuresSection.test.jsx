import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { renderWithProviders } from "@/test/testUtils";

const mocks = vi.hoisted(() => ({
  auth: { tenantContext: { agency_id: "agency-1" } },
  getPublished: vi.fn(),
  compute: vi.fn(),
}));

vi.mock("@/lib/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/functions/getPublishedOutcomeMeasures", () => ({
  getPublishedOutcomeMeasures: (...args) => mocks.getPublished(...args),
}));
vi.mock("@/functions/computeOutcomeMeasures", () => ({
  computeOutcomeMeasures: (...args) => mocks.compute(...args),
}));

import OutcomeMeasuresSection, { outcomeWindow } from "./OutcomeMeasuresSection";

const notPublished = () => {
  const error = new Error("Not found");
  error.status = 404;
  error.data = { error: "No published outcome run exists for this reporting window" };
  return error;
};

describe("OutcomeMeasuresSection", () => {
  beforeEach(() => {
    mocks.auth = { tenantContext: { agency_id: "agency-1" } };
    mocks.getPublished.mockReset();
    mocks.compute.mockReset();
  });

  it("asks for the caller's agency and one exact closed window", async () => {
    mocks.getPublished.mockRejectedValue(notPublished());
    renderWithProviders(<OutcomeMeasuresSection />);
    expect(await screen.findByText(/No outcome measures have been published for this window yet/i)).toBeInTheDocument();
    const expected = outcomeWindow(90);
    expect(mocks.getPublished).toHaveBeenCalledWith({ agency_id: "agency-1", ...expected });
    expect(expected.period_type).toBe("custom");
    expect(expected.period_end < new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it("computes through the membership-checked broker and then shows the published run", async () => {
    mocks.getPublished.mockRejectedValueOnce(notPublished()).mockResolvedValue({
      data: {
        success: true,
        publication: { published_at: "2026-10-08T06:00:00.000Z" },
        patient_outcome_metrics: [{ id: "m1" }, { id: "m2" }],
        agency_kpis: [{
          id: "k1",
          metric_name: "Improvement in Ambulation",
          metric_value: 62.5,
          benchmark_value: 70,
          status: "below_benchmark",
          excluded_episode_count: 1,
        }],
      },
    });
    mocks.compute.mockResolvedValue({ data: { success: true, idempotent_replay: false } });
    renderWithProviders(<OutcomeMeasuresSection />);
    await screen.findByText(/No outcome measures have been published/i);
    fireEvent.click(screen.getByRole("button", { name: /compute now/i }));
    await waitFor(() => expect(mocks.compute).toHaveBeenCalledWith({ agency_id: "agency-1", ...outcomeWindow(90) }));
    expect(await screen.findByText("Improvement in Ambulation")).toBeInTheDocument();
    expect(screen.getByText("62.5%")).toBeInTheDocument();
    expect(screen.getByText(/2 episodes scored/)).toBeInTheDocument();
    expect(screen.getByText(/Outcome measures computed and published/)).toBeInTheDocument();
  });

  it("shows the broker's refusal instead of numbers", async () => {
    mocks.getPublished.mockRejectedValue(Object.assign(new Error("Forbidden"), {
      status: 403,
      data: { error: "No active membership for agency" },
    }));
    renderWithProviders(<OutcomeMeasuresSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No active membership for agency");
  });

  it("reads nothing without an agency workspace", () => {
    mocks.auth = { tenantContext: null };
    renderWithProviders(<OutcomeMeasuresSection />);
    expect(screen.getByText(/open inside an agency workspace/i)).toBeInTheDocument();
    expect(mocks.getPublished).not.toHaveBeenCalled();
  });

  it("never reads outcome entities or reaches the secret-only worker or dispatcher", () => {
    const source = readFileSync("src/components/oasis/OutcomeMeasuresSection.jsx", "utf8");
    expect(source).not.toMatch(/entities\.(AgencyKPI|PatientOutcomeMetric|OutcomeComputationRun)/);
    expect(source).not.toMatch(/computeOutcomeMeasuresV2|dispatchNightlyOutcomeMeasures|functions\.invoke/);
  });
});
