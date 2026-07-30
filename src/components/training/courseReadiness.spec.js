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

  it("flags an interrupted AI draft as resumable with the missing lesson indexes", () => {
    const readiness = getCourseReadiness(
      {
        ai_generated: true,
        status: "draft",
        enable_certificate: true,
        ai_prompt_json: { outline_modules: [{ title: "M1" }, { title: "M2" }, { title: "M3" }] },
      },
      [{ id: "module-1", order_index: 0 }],
      []
    );

    expect(readiness).toMatchObject({
      aiResumable: true,
      outlineModuleCount: 3,
      missingModuleIndexes: [1, 2],
    });
  });

  it("marks a resumable draft when only the quiz is missing", () => {
    const readiness = getCourseReadiness(
      {
        ai_generated: true,
        status: "draft",
        enable_certificate: true,
        ai_prompt_json: { outline_modules: [{ title: "M1" }] },
      },
      [{ id: "module-1", order_index: 0 }],
      []
    );

    expect(readiness).toMatchObject({ aiResumable: true, missingModuleIndexes: [] });
  });

  it("does not offer resume for complete drafts, manual courses, or non-drafts", () => {
    const complete = getCourseReadiness(
      {
        ai_generated: true,
        status: "draft",
        enable_certificate: true,
        ai_prompt_json: { outline_modules: [{ title: "M1" }] },
      },
      [{ id: "module-1", order_index: 0 }],
      [{ id: "question-1", active: true }]
    );
    const manual = getCourseReadiness({ status: "draft" }, [], []);
    const pendingReview = getCourseReadiness(
      {
        ai_generated: true,
        status: "pending_review",
        ai_prompt_json: { outline_modules: [{ title: "M1" }, { title: "M2" }] },
      },
      [{ id: "module-1", order_index: 0 }],
      []
    );

    expect(complete.aiResumable).toBe(false);
    expect(manual.aiResumable).toBe(false);
    expect(pendingReview.aiResumable).toBe(false);
  });
});
