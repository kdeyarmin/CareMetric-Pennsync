import { describe, it, expect } from "vitest";
import { getCourseReadiness } from "./courseReadiness";

describe("getCourseReadiness", () => {
  it("requires lessons, a quiz, and certificate issuance for AI courses", () => {
    const readiness = getCourseReadiness(
      { ai_generated: true, enable_certificate: false },
      [],
      []
    );

    expect(readiness.readyForReview).toBe(false);
    expect(readiness.blockers).toEqual([
      "Add at least one lesson.",
      "Add end-of-course quiz questions.",
      "Enable a certificate for this AI-generated course.",
    ]);
  });

  it("does not count inactive questions toward review readiness", () => {
    const readiness = getCourseReadiness(
      { ai_generated: true, enable_certificate: true },
      [{ id: "module-1" }],
      [{ id: "question-1", active: false }]
    );

    expect(readiness.questionCount).toBe(0);
    expect(readiness.readyForReview).toBe(false);
  });

  it("reports video rendering without blocking review", () => {
    const readiness = getCourseReadiness(
      {
        ai_generated: true,
        enable_certificate: true,
        ai_prompt_json: { generate_videos: true },
      },
      [
        { id: "module-1", video_status: "completed" },
        { id: "module-2", video_status: "processing" },
      ],
      [{ id: "question-1", active: true }]
    );

    expect(readiness).toMatchObject({
      readyForReview: true,
      videoRequested: true,
      completedVideoCount: 1,
      processingVideoCount: 1,
      videosReady: false,
    });
  });
});
