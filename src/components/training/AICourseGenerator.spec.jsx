import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await import("@/test/testUtils");
  return {
    base44: makeBase44Stub({
      auth: { me: async () => ({ role: "admin", email: "educator@example.com" }) },
    }),
  };
});

vi.mock("@/functions/generateTrainingCourse", () => ({
  generateTrainingCourseStepwise: vi.fn(),
}));

vi.mock("@/components/training/PresenterPicker", () => ({
  default: () => <div>Presenter picker</div>,
}));

import AICourseGenerator from "./AICourseGenerator";
import { generateTrainingCourseStepwise } from "@/functions/generateTrainingCourse";

describe("AICourseGenerator", () => {
  beforeEach(() => {
    generateTrainingCourseStepwise.mockReset();
  });

  it("makes the topic-first complete course workflow clear", async () => {
    renderWithProviders(<AICourseGenerator />);

    expect(await screen.findByText("What should your team learn?")).toBeInTheDocument();
    expect(screen.getByText("Course design & lessons")).toBeInTheDocument();
    expect(screen.getByText("Presenter scripts & HeyGen videos")).toBeInTheDocument();
    expect(screen.getByText("End-of-course quiz")).toBeInTheDocument();
    expect(screen.getByText("Certificate after passing")).toBeInTheDocument();
    expect(screen.getByLabelText("Generate presenter videos (HeyGen)")).toBeChecked();
  });

  it("generates videos, a quiz, and a passing certificate from one topic", async () => {
    generateTrainingCourseStepwise.mockResolvedValue({
      success: true,
      course_id: "course-1",
      title: "Fall Prevention",
      video_generation_status: "generating",
    });
    const onGenerated = vi.fn();
    renderWithProviders(<AICourseGenerator onGenerated={onGenerated} />);

    const topic = await screen.findByLabelText("Course topic *");
    fireEvent.change(topic, { target: { value: "Fall prevention" } });
    fireEvent.click(screen.getByRole("button", { name: "Build complete course" }));

    await waitFor(() => expect(generateTrainingCourseStepwise).toHaveBeenCalledTimes(1));
    const [payload, onProgress] = generateTrainingCourseStepwise.mock.calls[0];
    expect(payload).toMatchObject({
      topic: "Fall prevention",
      question_count: 10,
      question_types: ["mcq", "true_false", "scenario_based"],
      generate_videos: true,
      passing_score: 80,
      enable_certificate: true,
      certificate_valid_months: 12,
      status: "draft",
    });
    expect(onProgress).toEqual(expect.any(Function));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith("course-1"));
  });

  it("offers to open the partial draft when a later phase fails", async () => {
    generateTrainingCourseStepwise.mockRejectedValue(
      Object.assign(new Error("The AI could not generate content for module 2."), {
        course_id: "draft-1",
        course_title: "Fall Prevention",
      })
    );
    const onGenerated = vi.fn();
    renderWithProviders(<AICourseGenerator onGenerated={onGenerated} />);

    const topic = await screen.findByLabelText("Course topic *");
    fireEvent.change(topic, { target: { value: "Fall prevention" } });
    fireEvent.click(screen.getByRole("button", { name: "Build complete course" }));

    expect(
      await screen.findByText(/open it to resume the AI generation/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the draft" }));
    expect(onGenerated).toHaveBeenCalledWith("draft-1");
  });
});
