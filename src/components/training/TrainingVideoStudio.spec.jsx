import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await import("@/test/testUtils");
  return { base44: makeBase44Stub() };
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
});
