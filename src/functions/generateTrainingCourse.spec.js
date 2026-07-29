import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: { functions: { invoke: mocks.invoke } },
}));

import { resumeTrainingCourseStepwise } from "./generateTrainingCourse";

const partialCourse = {
  id: "course-1",
  title: "Fall Prevention",
  ai_prompt_json: {
    generate_videos: true,
    video_avatar_id: "avatar-9",
    video_voice_id: "voice-3",
    outline_modules: [{ title: "M1" }, { title: "M2" }, { title: "M3" }],
  },
};

describe("resumeTrainingCourseStepwise", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue({ data: { success: true, course_id: "course-1" } });
  });

  it("re-runs only the missing phases with the stored presenter settings", async () => {
    const progress = [];
    await resumeTrainingCourseStepwise(
      partialCourse,
      { missingModuleIndexes: [1, 2], regenerateAssessment: true },
      (p) => progress.push(p)
    );

    const payloads = mocks.invoke.mock.calls.map(([, payload]) => payload);
    expect(payloads).toEqual([
      { phase: "module", course_id: "course-1", module_index: 1 },
      { phase: "module", course_id: "course-1", module_index: 2 },
      { phase: "assessment", course_id: "course-1" },
      {
        phase: "finalize",
        course_id: "course-1",
        generate_videos: true,
        video_avatar_id: "avatar-9",
        video_voice_id: "voice-3",
      },
    ]);
    expect(progress.map((p) => p.label)).toEqual([
      "Writing lesson 2…",
      "Writing lesson 3…",
      "Building the quiz and knowledge checks…",
      "Finishing up…",
    ]);
    expect(progress.every((p) => p.totalSteps === 4)).toBe(true);
  });

  it("skips the assessment phase when the quiz already exists", async () => {
    await resumeTrainingCourseStepwise(partialCourse, {
      missingModuleIndexes: [2],
      regenerateAssessment: false,
    });

    const phases = mocks.invoke.mock.calls.map(([, payload]) => payload.phase);
    expect(phases).toEqual(["module", "finalize"]);
  });

  it("attaches the course id to failures so the caller can point at the draft", async () => {
    mocks.invoke.mockRejectedValue(Object.assign(new Error("LLM flaked"), { response: { status: 502 } }));

    await expect(
      resumeTrainingCourseStepwise(partialCourse, { missingModuleIndexes: [1] })
    ).rejects.toMatchObject({ course_id: "course-1", course_title: "Fall Prevention" });
  });
});
