import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/testUtils";
import OutcomeMeasuresSection from "./OutcomeMeasuresSection";
import {
  IMPROVEMENT_MEASURES,
  STAR_MIN_EPISODES,
} from "./outcomeMeasureEngine";

// Hoisted, per-test-mutable stubs. The vi.mock factories below are hoisted above
// imports, so anything they close over must come from vi.hoisted().
const { state, toastMock } = vi.hoisted(() => ({
  state: {
    kpiFilter: async () => [],
    metricFilter: async () => [],
    invoke: async () => ({ data: {} }),
  },
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock, Toaster: () => null }));

vi.mock("@/api/base44Client", () => {
  const arr = async () => [];
  const obj = async () => ({});
  const entityStub = new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === "then") return undefined;
        if (p === "get" || p === "create" || p === "update") return obj;
        return arr;
      },
    }
  );
  const entities = new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === "AgencyKPI") {
          return { filter: (...args) => state.kpiFilter(...args) };
        }
        if (name === "PatientOutcomeMetric") {
          return { filter: (...args) => state.metricFilter(...args) };
        }
        return entityStub;
      },
    }
  );
  const fns = { invoke: (...args) => state.invoke(...args) };
  const integrations = new Proxy(
    {},
    { get: () => new Proxy({}, { get: () => async () => ({}) }) }
  );
  return {
    base44: {
      entities,
      functions: fns,
      integrations,
      auth: { me: async () => ({ email: "admin@x.com", role: "admin" }) },
      asServiceRole: { entities, functions: fns, integrations },
    },
  };
});

// Three computed episode pairs: ambulation improved in 2 of 3 (66.7%), bathing
// improved in 1 of 2 eligible (one excluded), everything else not improved.
const metricRows = [
  {
    patient_id: "p1",
    episode_start: "2026-05-01",
    episode_end: "2026-06-01",
    outcome_measure_source: "oasis_change_score",
    gg_discharge_function_score: 60,
    measure_results: [
      { measure: "ambulation", status: "improved" },
      { measure: "bed_transfer", status: "not_improved" },
      { measure: "bathing", status: "improved" },
      { measure: "dyspnea", status: "not_improved" },
      { measure: "oral_meds", status: "not_improved" },
    ],
  },
  {
    patient_id: "p2",
    episode_start: "2026-05-03",
    episode_end: "2026-06-10",
    outcome_measure_source: "oasis_change_score",
    gg_discharge_function_score: 70,
    measure_results: [
      { measure: "ambulation", status: "improved" },
      { measure: "bed_transfer", status: "not_improved" },
      { measure: "bathing", status: "excluded", reason: "unratable_code" },
      { measure: "dyspnea", status: "not_improved" },
      { measure: "oral_meds", status: "improved" },
    ],
  },
  {
    patient_id: "p3",
    episode_start: "2026-05-05",
    episode_end: "2026-06-20",
    outcome_measure_source: "oasis_change_score",
    measure_results: [
      { measure: "ambulation", status: "not_improved" },
      { measure: "bed_transfer", status: "not_improved" },
      { measure: "bathing", status: "not_improved" },
      { measure: "dyspnea", status: "not_improved" },
      { measure: "oral_meds", status: "not_improved" },
    ],
  },
];

const kpiRows = [
  {
    metric_name: "Improvement in Ambulation/Locomotion",
    metric_category: "quality",
    period_start: "2026-05-01",
    period_end: "2026-06-20",
    metric_value: 66.7,
    benchmark_value: 60,
    unit: "%",
    status: "on_target",
  },
  // Stale, better-looking period for the same measure — the newest period_end
  // must win, so this row's 100% never renders.
  {
    metric_name: "Improvement in Ambulation/Locomotion",
    metric_category: "quality",
    period_start: "2026-01-01",
    period_end: "2026-03-31",
    metric_value: 100,
    benchmark_value: 60,
    unit: "%",
    status: "on_target",
  },
];

beforeEach(() => {
  state.kpiFilter = async () => [];
  state.metricFilter = async () => [];
  state.invoke = vi.fn(async () => ({
    data: { success: true, discharges_evaluated: 3, agency_kpis_written: 5 },
  }));
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

describe("OutcomeMeasuresSection", () => {
  it("shows a loading state while queries are in flight (no zeroed dashboard)", () => {
    state.kpiFilter = () => new Promise(() => {}); // never resolves
    state.metricFilter = () => new Promise(() => {});
    renderWithProviders(<OutcomeMeasuresSection />);

    expect(screen.getByText(/Loading outcome measures/i)).toBeInTheDocument();
    // Must not paint an empty/zero coverage line mid-fetch.
    expect(screen.queryByText(/complete episode pair/i)).toBeNull();
    expect(screen.queryByText(/0 of 20 episodes/i)).toBeNull();
  });

  it("renders the designed empty state when no episode pairs exist yet", async () => {
    renderWithProviders(<OutcomeMeasuresSection />);

    expect(
      await screen.findByText(
        new RegExp(
          `0 of ${STAR_MIN_EPISODES} episodes — measures appear as episodes accumulate`,
          "i"
        )
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Based on 0 complete episode pairs documented in PennSync/i)
    ).toBeInTheDocument();
    // No measure rows in the empty state.
    expect(screen.queryByText(/eligible episodes? improved/i)).toBeNull();
  });

  it("renders measures with rates, episode counts, star-floor flags, benchmark trend, and coverage", async () => {
    state.kpiFilter = async () => kpiRows;
    state.metricFilter = async () => metricRows;
    renderWithProviders(<OutcomeMeasuresSection />);

    // Coverage label is first-class.
    expect(
      await screen.findByText(/Based on 3 complete episode pairs documented in PennSync/i)
    ).toBeInTheDocument();
    // Below-floor sparse-data callout.
    expect(
      screen.getByText(new RegExp(`3 of ${STAR_MIN_EPISODES} episodes — measures appear`, "i"))
    ).toBeInTheDocument();

    // All five improvement measures render, plus the GG score row.
    for (const m of IMPROVEMENT_MEASURES) {
      expect(screen.getByText(m.label)).toBeInTheDocument();
    }
    expect(screen.getByText(/GG Discharge Function Score/i)).toBeInTheDocument();

    // Ambulation shows the LATEST-period AgencyKPI rate + benchmark delta.
    expect(screen.getByText("66.7%")).toBeInTheDocument();
    expect(screen.queryByText("100.0%")).toBeNull();
    expect(screen.getByText(/\+6\.7 pts vs benchmark/i)).toBeInTheDocument();

    // Per-measure episode counts from the engine rollup.
    expect(screen.getByText(/2 of 3 eligible episodes improved/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 eligible episodes improved/i)).toBeInTheDocument();
    // Star floor not met at 3 episodes.
    expect(screen.getAllByText(new RegExp(`3 of ${STAR_MIN_EPISODES} episodes`, "i")).length)
      .toBeGreaterThan(0);
    expect(screen.queryByText(/Star floor met/i)).toBeNull();

    // GG average of 60 and 70 across the 2 scored episodes.
    expect(screen.getByText("65")).toBeInTheDocument();

    // EMR-of-record caveat.
    expect(
      screen.getByText(/Official CMS star ratings are computed from your EMR/i)
    ).toBeInTheDocument();
  });

  it("renders a distinct error state (with retry) when the reads fail", async () => {
    state.kpiFilter = async () => {
      throw new Error("boom");
    };
    renderWithProviders(<OutcomeMeasuresSection />);

    expect(
      await screen.findByText(/Couldn.t load outcome measures/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // Error must not fall through to the empty/zero rendering.
    expect(screen.queryByText(/complete episode pair/i)).toBeNull();
  });

  it("Recompute now invokes the backend with a busy state and success toast", async () => {
    const user = userEvent.setup();
    state.kpiFilter = async () => kpiRows;
    state.metricFilter = async () => metricRows;
    renderWithProviders(<OutcomeMeasuresSection />);

    const button = await screen.findByRole("button", { name: /recompute now/i });
    await user.click(button);

    await waitFor(() => {
      expect(state.invoke).toHaveBeenCalledWith("computeOutcomeMeasures", {});
      expect(toastMock.success).toHaveBeenCalled();
    });
    expect(toastMock.success.mock.calls[0][0]).toMatch(/3 episode pair\(s\) evaluated/);
  });

  it("toasts an error when the recompute fails", async () => {
    const user = userEvent.setup();
    state.kpiFilter = async () => kpiRows;
    state.metricFilter = async () => metricRows;
    state.invoke = vi.fn(async () => {
      throw new Error("cron exploded");
    });
    renderWithProviders(<OutcomeMeasuresSection />);

    const button = await screen.findByRole("button", { name: /recompute now/i });
    await user.click(button);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    expect(toastMock.error.mock.calls[0][0]).toMatch(/cron exploded/);
  });
});
