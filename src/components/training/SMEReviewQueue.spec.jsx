import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const mocks = vi.hoisted(() => ({
  courseFilter: vi.fn(),
  courseUpdate: vi.fn(),
  moduleFilter: vi.fn(),
  questionFilter: vi.fn(),
  auditRecord: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: {
      me: vi.fn().mockResolvedValue({
        role: "admin",
        email: "reviewer@example.com",
        full_name: "Clinical Reviewer",
      }),
    },
    entities: {
      TrainingCourse: {
        filter: mocks.courseFilter,
        update: mocks.courseUpdate,
      },
      TrainingModule: { filter: mocks.moduleFilter },
      TrainingQuestion: { filter: mocks.questionFilter },
      Notification: { create: mocks.notificationCreate },
    },
  },
}));

vi.mock("@/functions/recordTrainingAuditEvent", () => ({
  recordTrainingAuditEvent: mocks.auditRecord,
}));

import SMEReviewQueue from "./SMEReviewQueue";

const pendingCourse = {
  id: "course-1",
  title: "Fall Prevention",
  status: "pending_review",
  needs_sme_review: true,
  ai_generated: true,
  enable_certificate: true,
  business_line_scope: "all",
};

describe("SMEReviewQueue", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.courseFilter.mockResolvedValue([pendingCourse]);
    mocks.moduleFilter.mockResolvedValue([]);
    mocks.questionFilter.mockResolvedValue([]);
    mocks.courseUpdate.mockResolvedValue({});
    mocks.auditRecord.mockResolvedValue({});
    mocks.notificationCreate.mockResolvedValue({});
  });

  it("only loads courses explicitly submitted for review", async () => {
    renderWithProviders(<SMEReviewQueue />);

    expect(await screen.findByText("Fall Prevention")).toBeInTheDocument();
    expect(mocks.courseFilter).toHaveBeenCalledWith(
      { needs_sme_review: true, status: "pending_review" },
      "-updated_date",
      200
    );
  });

  it("blocks approval when lessons or quiz questions are missing", async () => {
    renderWithProviders(<SMEReviewQueue />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve & Publish" }));

    await waitFor(() => {
      expect(mocks.moduleFilter).toHaveBeenCalled();
      expect(mocks.questionFilter).toHaveBeenCalled();
    });
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
    expect(mocks.auditRecord).not.toHaveBeenCalled();
  });

  it("records human approval metadata for a complete course", async () => {
    mocks.moduleFilter.mockResolvedValue([{ id: "module-1" }]);
    mocks.questionFilter.mockResolvedValue([{ id: "question-1", active: true }]);
    renderWithProviders(<SMEReviewQueue />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve & Publish" }));

    await waitFor(() => {
      expect(mocks.courseUpdate).toHaveBeenCalledWith(
        "course-1",
        expect.objectContaining({
          status: "published",
          needs_sme_review: false,
          approved_by: "reviewer@example.com",
          published_by: "reviewer@example.com",
          approved_at: expect.any(String),
          published_date: expect.any(String),
        })
      );
    });
    expect(mocks.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "course_published",
        courseId: "course-1",
      })
    );
  });
});
