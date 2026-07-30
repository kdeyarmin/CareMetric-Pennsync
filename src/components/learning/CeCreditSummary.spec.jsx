import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

import CeCreditSummary from "./CeCreditSummary";
import { buildCeTranscript } from "./ceTranscript";

const CERTIFICATES = [
  { id: "1", assignment_id: "a1", course_id: "c-hipaa", hours: 1, completion_date: "2026-02-01", training_category: "compliance" },
  { id: "2", assignment_id: "a2", course_id: "c-falls", hours: 1, completion_date: "2026-06-01", training_category: "safety" },
  { id: "3", assignment_id: "a3", course_id: "c-oasis", hours: 2, completion_date: "2025-04-01", training_category: "documentation" },
];

const COURSES = {
  "c-hipaa": { category: "compliance", estimated_minutes: 60, ceu_hours: 1 },
  "c-falls": { category: "safety", estimated_minutes: 90, ceu_hours: 1 },
  "c-oasis": { category: "documentation", estimated_minutes: 120, ceu_hours: 2 },
};

const transcriptFor = (user) =>
  buildCeTranscript(CERTIFICATES, {
    coursesById: COURSES,
    user,
    now: new Date("2026-07-01T12:00:00Z"),
  });

describe("CeCreditSummary", () => {
  it("reports the current credit year and a per-year breakdown", () => {
    renderWithProviders(<CeCreditSummary transcript={transcriptFor({ credential_type: "RN" })} />);

    expect(screen.getByText("Continuing education — 2026")).toBeInTheDocument();
    expect(screen.getByText(/4 CE hrs and 4.5 hrs of training on record overall/)).toBeInTheDocument();
    expect(screen.getByText("Credit by year")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(screen.getByText("safety: 1.5 hrs")).toBeInTheDocument();
  });

  it("shows aide in-service progress with the CMS citation", () => {
    renderWithProviders(<CeCreditSummary transcript={transcriptFor({ job_title: "Home Health Aide" })} />);

    expect(screen.getByText("Aide in-service training")).toBeInTheDocument();
    expect(screen.getByText(/2.5 of 12 hours — 9.5 hrs remaining/)).toBeInTheDocument();
    expect(screen.getByText(/42 CFR §484.80\(d\)/)).toBeInTheDocument();
  });

  it("omits the in-service bar for roles the rule does not cover", () => {
    renderWithProviders(<CeCreditSummary transcript={transcriptFor({ credential_type: "RN" })} />);

    expect(screen.queryByText("Aide in-service training")).not.toBeInTheDocument();
  });

  it("hides the yearly table in compact mode", () => {
    renderWithProviders(<CeCreditSummary transcript={transcriptFor({})} compact />);

    expect(screen.getByText("Continuing education — 2026")).toBeInTheDocument();
    expect(screen.queryByText("Credit by year")).not.toBeInTheDocument();
  });

  it("explains an empty transcript", () => {
    renderWithProviders(<CeCreditSummary transcript={buildCeTranscript([], {})} />);

    expect(screen.getByText("No credit earned yet")).toBeInTheDocument();
  });
});
