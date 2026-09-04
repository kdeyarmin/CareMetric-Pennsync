import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/testUtils";

const {
  aiRun,
  pathwayFilter,
  taskBulkCreate,
  logActivity,
} = vi.hoisted(() => ({
  aiRun: vi.fn(),
  pathwayFilter: vi.fn(),
  taskBulkCreate: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      ClinicalPathway: { filter: pathwayFilter },
      Task: { bulkCreate: taskBulkCreate },
    },
  },
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
import { ActivityActions } from "@/components/utils/activityLogger";

const TASK_ACTIVATION_BLOCKER =
  "Task-bearing pathway activation is unavailable pending an atomic, idempotent task-creation broker. No tasks have been created.";

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

function recommendationsWithTasks(tasks) {
  return {
    overall_strategy: "Address the documented risks.",
    quick_wins: [],
    recommended_pathways: [{ ...BASE_PATHWAY, tasks_to_generate: tasks }],
  };
}

function taskCreateActivityWasLogged() {
  return logActivity.mock.calls.some(([action]) => action === ActivityActions.TASK_CREATE);
}

function renderRecommender() {
  const onPathwaysActivated = vi.fn();
  renderWithProviders(
    <AIPathwayRecommender
      pdgmData={PDGM_DATA}
      analysisResults={ANALYSIS_RESULTS}
      patientId="patient-1"
      onPathwaysActivated={onPathwaysActivated}
    />
  );
  return onPathwaysActivated;
}

beforeEach(() => {
  aiRun.mockReset();
  pathwayFilter.mockReset().mockResolvedValue([]);
  taskBulkCreate.mockReset();
  logActivity.mockReset();
});

describe("AIPathwayRecommender task activation safety", () => {
  it("blocks task-bearing activation before any Task write or activation callback", async () => {
    aiRun.mockResolvedValue(recommendationsWithTasks([
      {
        title: "Call patient",
        description: "Review symptoms.",
        type: "call",
        priority: "high",
        due_timeframe: "today",
      },
    ]));
    const onPathwaysActivated = renderRecommender();

    const activate = await screen.findByRole("button", { name: "Task Creation Unavailable" });
    expect(activate).toBeDisabled();
    expect(screen.getByText(TASK_ACTIVATION_BLOCKER)).toBeInTheDocument();

    await userEvent.click(activate);

    expect(taskBulkCreate).not.toHaveBeenCalled();
    expect(taskCreateActivityWasLogged()).toBe(false);
    expect(onPathwaysActivated).not.toHaveBeenCalled();
  });

  it("preserves callback-only activation for a selected pathway with zero tasks", async () => {
    const recommendation = recommendationsWithTasks([]);
    aiRun.mockResolvedValue(recommendation);
    const onPathwaysActivated = renderRecommender();

    const activate = await screen.findByRole("button", { name: "Activate Pathways" });
    expect(activate).toBeEnabled();
    expect(screen.queryByText(TASK_ACTIVATION_BLOCKER)).not.toBeInTheDocument();

    await userEvent.click(activate);

    await waitFor(() => {
      expect(onPathwaysActivated).toHaveBeenCalledWith(recommendation.recommended_pathways);
    });
    expect(taskBulkCreate).not.toHaveBeenCalled();
    expect(taskCreateActivityWasLogged()).toBe(false);
  });
});
