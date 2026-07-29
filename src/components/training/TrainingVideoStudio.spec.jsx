import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const mocks = vi.hoisted(() => ({
  moduleFilter: vi.fn(async () => []),
  moduleUpdate: vi.fn(async () => ({})),
}));

vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await import("@/test/testUtils");
  const stub = makeBase44Stub();
  return {
    base44: {
      ...stub,
      entities: new Proxy(stub.entities, {
        get: (target, prop) =>
          prop === "TrainingModule"
            ? { filter: mocks.moduleFilter, update: mocks.moduleUpdate }
            : target[prop],
      }),
    },
  };
});

vi.mock("@/functions/manageTrainingVideos", () => ({
  manageTrainingVideos: vi.fn(),
}));

vi.mock("@/components/training/PresenterPicker", () => ({
  default: () => <div>Presenter picker</div>,
}));

import TrainingVideoStudio from "./TrainingVideoStudio";
import { manageTrainingVideos } from "@/functions/manageTrainingVideos";

describe("TrainingVideoStudio embedded course review", () => {
  beforeEach(() => {
    mocks.moduleFilter.mockClear();
    mocks.moduleFilter.mockResolvedValue([]);
    manageTrainingVideos.mockReset();
    manageTrainingVideos.mockResolvedValue({
      data: {
        heygen_configured: true,
        modules: [
          {
            module_id: "module-1",
            title: "Safe transfers",
            video_status: "processing",
          },
        ],
      },
    });
  });

  it("opens directly on the generated course and monitors its videos", async () => {
    renderWithProviders(
      <TrainingVideoStudio
        course={{ id: "course-1", title: "Fall Prevention", status: "draft" }}
      />
    );

    expect(await screen.findByText("Presenter videos for “Fall Prevention”")).toBeInTheDocument();
    expect(screen.queryByText("Choose a course")).not.toBeInTheDocument();
    expect(await screen.findByText("Safe transfers")).toBeInTheDocument();
    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(screen.getByText("Generating — auto-refreshing…")).toBeInTheDocument();

    await waitFor(() => {
      expect(manageTrainingVideos).toHaveBeenCalledWith({
        action: "status",
        course_id: "course-1",
      });
    });
  });

  it("lets the admin review each lesson's presenter script", async () => {
    mocks.moduleFilter.mockResolvedValue([
      {
        id: "module-1",
        title: "Safe transfers",
        order_index: 0,
        content_json: {
          video_narration:
            "Picture your first visit of the day. Before you knock, you are already assessing fall risk. Today we walk through what to look for during transfers.",
        },
      },
    ]);

    renderWithProviders(
      <TrainingVideoStudio
        course={{ id: "course-1", title: "Fall Prevention", status: "draft" }}
      />
    );

    const toggle = await screen.findByRole("button", { name: /View script/ });
    toggle.click();

    expect(await screen.findByText("AI-written presenter script")).toBeInTheDocument();
    expect(screen.getByText(/Picture your first visit of the day/)).toBeInTheDocument();
  });
});
