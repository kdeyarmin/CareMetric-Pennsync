import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/testUtils";

const {
  aiRun,
  manageOASISRecords,
  entityCall,
  logActivity,
} = vi.hoisted(() => ({
  aiRun: vi.fn(),
  manageOASISRecords: vi.fn(),
  entityCall: vi.fn(),
  logActivity: vi.fn(),
}));

// Any direct entity call fails the test: pathways and tasks must both go
// through the OASIS record broker, which authorizes the chart server-side.
vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: new Proxy({}, { get: (_t, entity) => new Proxy({}, { get: (_u, op) => (...args) => entityCall(entity, op, ...args) }) }),
  },
}));

vi.mock("@/functions/manageOASISRecords", async (importOriginal) => ({
  ...(await importOriginal()),
  manageOASISRecords,
}));

vi.mock("@/hooks/useAICall", () => ({
  useAICall: () => ({
    run: aiRun,
    loading: false,
    error: null,
    data: null,
    reset: vi.fn(),
  }),
}));

vi.mock("@/components/utils/activityLogger", () => ({
  ActivityActions: { GENERATE: "generate", TASK_CREATE: "task_create" },
  logActivity,
}));

import AIPathwayRecommender from "@/components/oasis/AIPathwayRecommender";

const BASE_PATHWAY = {
  pathway_name: "Heart failure monitoring",
  pathway_type: "custom_recommendation",
  match_score: 95,
  primary_trigger: "diagnosis",
  trigger_details: "Documented heart failure",
  clinical_rationale: "Close monitoring is indicated.",
  priority: "high",
  expected_outcomes: [],
  documentation_requirements: [],
  recommended_interventions: [],
};

const PDGM_DATA = { primary_diagnosis_code: "I50.9" };
const ANALYSIS_RESULTS = { accuracy_score: 80, compliance_score: 75, accuracy_issues: [] };
const CALL_TASK = {
  title: "Call patient",
  description: "Review symptoms.",
  type: "call",
  priority: "high",
  due_timeframe: "today",
};

function recommendationsWithTasks(tasks) {
  return {
    overall_strategy: "Address the documented findings.",
    quick_wins: [],
    recommended_pathways: [{ ...BASE_PATHWAY, tasks_to_generate: tasks }],
  };
}

function renderRecommender(patientId = "patient-1") {
  const onPathwaysActivated = vi.fn();
  renderWithProviders(
    <AIPathwayRecommender
      pdgmData={PDGM_DATA}
      analysisResults={ANALYSIS_RESULTS}
      patientId={patientId}
      onPathwaysActivated={onPathwaysActivated}
    />
  );
  return onPathwaysActivated;
}

beforeEach(() => {
  aiRun.mockReset();
  entityCall.mockReset();
  logActivity.mockReset();
  manageOASISRecords.mockReset().mockImplementation(async (action, payload) => {
    if (action === "list_pathways") return { pathways: [] };
    if (action === "create_tasks") {
      return { results: payload.tasks.map((task, index) => ({ key: task.key, status: "created", task_id: `t${index}` })) };
    }
    throw new Error(`unexpected action ${action}`);
  });
});

describe("AIPathwayRecommender task activation", () => {
  it("reads the pathway library and creates tasks only through the chart-authorizing broker", async () => {
    aiRun.mockResolvedValue(recommendationsWithTasks([CALL_TASK]));
    const onPathwaysActivated = renderRecommender();

    const activate = await screen.findByRole("button", { name: "Activate & Add Tasks" });
    expect(activate).toBeEnabled();
    await userEvent.click(activate);

    await waitFor(() => expect(onPathwaysActivated).toHaveBeenCalled());
    expect(manageOASISRecords).toHaveBeenCalledWith("list_pathways");
    const createCall = manageOASISRecords.mock.calls.find(([action]) => action === "create_tasks");
    expect(createCall).toBeTruthy();
    const [, payload] = createCall;
    expect(payload.patient_id).toBe("patient-1");
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0]).toMatchObject({ title: "Call patient", type: "call", priority: "high" });
    // Assignment and tenancy are the broker's to stamp, never the browser's.
    expect(payload.tasks[0]).not.toHaveProperty("assigned_to");
    expect(payload.tasks[0]).not.toHaveProperty("agency_id");
    expect(payload.tasks[0].key).toMatch(/^k[0-9a-f]{16}$/);
    expect(entityCall).not.toHaveBeenCalled();
  });

  it("repeats the same per-task key on a second click so the broker files nothing twice", async () => {
    aiRun.mockResolvedValue(recommendationsWithTasks([CALL_TASK]));
    renderRecommender();
    const activate = await screen.findByRole("button", { name: "Activate & Add Tasks" });
    await userEvent.click(activate);
    await waitFor(() => expect(manageOASISRecords.mock.calls.filter(([a]) => a === "create_tasks")).toHaveLength(1));
    await userEvent.click(await screen.findByRole("button", { name: "Activate & Add Tasks" }));
    await waitFor(() => expect(manageOASISRecords.mock.calls.filter(([a]) => a === "create_tasks")).toHaveLength(2));
    const [first, second] = manageOASISRecords.mock.calls.filter(([a]) => a === "create_tasks").map(([, p]) => p.tasks[0].key);
    expect(second).toBe(first);
  });

  it("creates no task without a linked patient", async () => {
    aiRun.mockResolvedValue(recommendationsWithTasks([CALL_TASK]));
    const onPathwaysActivated = renderRecommender(null);
    const activate = await screen.findByRole("button", { name: "Activate & Add Tasks" });
    expect(activate).toBeDisabled();
    expect(screen.getByText("Link this analysis to a patient to add pathway tasks.")).toBeInTheDocument();
    expect(manageOASISRecords.mock.calls.some(([action]) => action === "create_tasks")).toBe(false);
    expect(onPathwaysActivated).not.toHaveBeenCalled();
  });

  it("does not report activation when the broker refuses the chart", async () => {
    aiRun.mockResolvedValue(recommendationsWithTasks([CALL_TASK]));
    manageOASISRecords.mockImplementation(async (action) => {
      if (action === "list_pathways") return { pathways: [] };
      throw new Error("Forbidden");
    });
    const onPathwaysActivated = renderRecommender();
    await userEvent.click(await screen.findByRole("button", { name: "Activate & Add Tasks" }));
    await waitFor(() => expect(manageOASISRecords.mock.calls.some(([a]) => a === "create_tasks")).toBe(true));
    expect(onPathwaysActivated).not.toHaveBeenCalled();
  });

  it("preserves callback-only activation for a selected pathway with zero tasks", async () => {
    const recommendation = recommendationsWithTasks([]);
    aiRun.mockResolvedValue(recommendation);
    const onPathwaysActivated = renderRecommender();

    const activate = await screen.findByRole("button", { name: "Activate Pathways" });
    expect(activate).toBeEnabled();
    await userEvent.click(activate);

    await waitFor(() => {
      expect(onPathwaysActivated).toHaveBeenCalledWith(recommendation.recommended_pathways);
    });
    expect(manageOASISRecords.mock.calls.some(([action]) => action === "create_tasks")).toBe(false);
    expect(entityCall).not.toHaveBeenCalled();
  });
});
