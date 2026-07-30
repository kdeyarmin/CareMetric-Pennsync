import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const mocks = vi.hoisted(() => ({
  moduleUpdate: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      TrainingModule: { update: mocks.moduleUpdate },
    },
  },
}));

import ModuleScriptPanel from "./ModuleScriptPanel";

const AUTHORED_SCRIPT =
  "Picture your first visit of the day. Before you knock, you are already assessing fall risk. " +
  "Today we walk through what to look for and how to document it the same day.";

const moduleWithScript = {
  id: "module-1",
  title: "Safe transfers",
  content_json: {
    intro: "Falls are the leading cause of injury in home care.",
    video_narration: AUTHORED_SCRIPT,
  },
};

describe("ModuleScriptPanel", () => {
  beforeEach(() => {
    mocks.moduleUpdate.mockReset();
    mocks.moduleUpdate.mockResolvedValue({});
  });

  it("shows the AI-written presenter script exactly as the video will read it", async () => {
    renderWithProviders(<ModuleScriptPanel module={moduleWithScript} courseId="course-1" />);

    fireEvent.click(screen.getByRole("button", { name: /View script/ }));

    expect(await screen.findByText("AI-written presenter script")).toBeInTheDocument();
    expect(screen.getByText(AUTHORED_SCRIPT)).toBeInTheDocument();
  });

  it("labels modules without an authored script as auto-assembled", async () => {
    renderWithProviders(
      <ModuleScriptPanel
        module={{ id: "m2", title: "Reporting", content_json: { intro: "Report same day." } }}
        courseId="course-1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /View script/ }));

    expect(await screen.findByText("Auto-assembled from lesson text")).toBeInTheDocument();
  });

  it("saves an edited script into content_json.video_narration", async () => {
    renderWithProviders(<ModuleScriptPanel module={moduleWithScript} courseId="course-1" />);

    fireEvent.click(screen.getByRole("button", { name: /View script/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit script/ }));

    const nextScript =
      "Welcome back. Today we focus on safe patient transfers, step by step, so nobody gets hurt on your shift. Let's start with the setup before you ever touch the patient.";
    fireEvent.change(screen.getByLabelText("Presenter script for Safe transfers"), {
      target: { value: nextScript },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save script" }));

    await waitFor(() =>
      expect(mocks.moduleUpdate).toHaveBeenCalledWith("module-1", {
        content_json: {
          intro: "Falls are the leading cause of injury in home care.",
          video_narration: nextScript,
        },
      })
    );
  });

  it("blocks saving a non-empty script that is too short to be used", async () => {
    renderWithProviders(<ModuleScriptPanel module={moduleWithScript} courseId="course-1" />);

    fireEvent.click(screen.getByRole("button", { name: /View script/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit script/ }));
    fireEvent.change(screen.getByLabelText("Presenter script for Safe transfers"), {
      target: { value: "Too short." },
    });

    expect(screen.getByRole("button", { name: "Save script" })).toBeDisabled();
    expect(screen.getByText(/Scripts under 80 characters are ignored/)).toBeInTheDocument();
  });
});
