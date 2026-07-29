import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const mocks = vi.hoisted(() => ({
  moduleFilter: vi.fn(async () => []),
}));

vi.mock("@/api/base44Client", () => ({
  base44: { entities: { TrainingModule: { filter: mocks.moduleFilter } } },
}));

import CourseCatalogDetail from "./CourseCatalogDetail";

const course = {
  id: "course-1",
  title: "Fall Prevention in the Home",
  short_description: "Reduce preventable falls during home visits.",
  description: "A practical course for field staff covering assessment and intervention.",
  category: "safety",
  business_line_scope: "home_health",
  training_type: "course",
  version: "2.1",
  ceu_hours: 1.5,
  estimated_minutes: 45,
  passing_score: 80,
  enable_certificate: true,
  certificate_valid_months: 12,
  role_targets: ["RN", "Home Health Aide"],
  learning_objectives: ["Identify fall hazards", "Apply a transfer technique"],
  competency_skills_json: [{ skill: "Safe gait belt transfer", criteria: "Demonstrates without prompting" }],
  regulatory_crosswalk_json: [
    { regulation: "42 CFR §484.60", title: "Care planning", how_this_course_addresses_it: "Documents fall interventions." },
  ],
  real_world_relevance: "Falls are the top source of avoidable ED visits in home health.",
  references_json: [{ title: "CDC STEADI", url: "https://example.org/steadi", note: "Screening tool" }],
};

describe("CourseCatalogDetail", () => {
  beforeEach(() => {
    mocks.moduleFilter.mockReset();
    mocks.moduleFilter.mockResolvedValue([
      { id: "m1", title: "Spotting hazards", estimated_minutes: 20, video_url: "https://example.org/v.mp4" },
      { id: "m2", title: "Safe transfers", estimated_minutes: 25 },
    ]);
  });

  it("shows the full syllabus a learner needs before enrolling", async () => {
    renderWithProviders(<CourseCatalogDetail course={course} open onOpenChange={() => {}} />);

    expect(await screen.findByText("Fall Prevention in the Home")).toBeInTheDocument();
    expect(screen.getByText("1.5 CE hrs")).toBeInTheDocument();
    expect(screen.getByText("45 min")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("Valid 12 mo")).toBeInTheDocument();
    expect(screen.getByText("2.1")).toBeInTheDocument();

    expect(screen.getByText("Who should take this")).toBeInTheDocument();
    expect(screen.getByText("Home Health Aide")).toBeInTheDocument();
    expect(screen.getByText("What you will be able to do")).toBeInTheDocument();
    expect(screen.getByText("Identify fall hazards")).toBeInTheDocument();
    expect(screen.getByText("Skills your supervisor can validate")).toBeInTheDocument();
    expect(screen.getByText("Regulatory alignment")).toBeInTheDocument();
    expect(screen.getByText("42 CFR §484.60 — Care planning")).toBeInTheDocument();
    expect(screen.getByText("Why this matters now")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CDC STEADI" })).toHaveAttribute("href", "https://example.org/steadi");

    // The lesson outline comes from the course's real modules.
    expect(await screen.findByText("Spotting hazards")).toBeInTheDocument();
    expect(screen.getByText("2 (1 on video)")).toBeInTheDocument();
  });

  it("enrolls from the detail view for an elective course", async () => {
    const onEnroll = vi.fn();
    renderWithProviders(
      <CourseCatalogDetail course={course} open onOpenChange={() => {}} onEnroll={onEnroll} />
    );

    fireEvent.click(await screen.findByRole("button", { name: /Enroll in this course/ }));
    expect(onEnroll).toHaveBeenCalledWith("course-1");
  });

  it("replaces the enroll action for enrolled and administrator-assigned courses", async () => {
    const { unmount } = renderWithProviders(
      <CourseCatalogDetail course={course} open onOpenChange={() => {}} enrolled />
    );
    expect(await screen.findByText("Enrolled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enroll in this course/ })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<CourseCatalogDetail course={course} open onOpenChange={() => {}} required />);
    expect(await screen.findByText("Assigned by your administrator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enroll in this course/ })).not.toBeInTheDocument();
  });

  it("renders nothing without a course and does not query modules while closed", () => {
    const { container } = renderWithProviders(
      <CourseCatalogDetail course={null} open={false} onOpenChange={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(mocks.moduleFilter).not.toHaveBeenCalled();
  });
});
