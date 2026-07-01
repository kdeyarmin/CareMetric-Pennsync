import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PPHPreventionWorklist from "./PPHPreventionWorklist";

const patients = [
  { id: "hi", first_name: "High", last_name: "Risk", admission_date: "2026-06-20", status: "active" },
  { id: "lo", first_name: "Low", last_name: "Risk", admission_date: "2026-01-01", status: "active" },
];
const oasisData = [
  {
    patient_id: "hi",
    pdgm_data: {
      admission_source: "institutional",
      primary_diagnosis: "Congestive heart failure",
      functional_scores: { m1860_ambulation: 5, m1850_transferring: 4, m1830_bathing: 4 },
    },
  },
  { patient_id: "lo", pdgm_data: { admission_source: "community", primary_diagnosis: "Hypertension" } },
];

describe("PPHPreventionWorklist", () => {
  it("renders an agency-wide ranked worklist tagged to the HHVBP PPH measure", () => {
    render(<PPHPreventionWorklist patients={patients} oasisData={oasisData} visits={[]} />);
    expect(screen.getByText(/PPH Prevention Worklist/i)).toBeInTheDocument();
    expect(screen.getByText(/HHVBP ~26%/i)).toBeInTheDocument();
    // High-risk CHF patient is ranked #1 with recommended interventions.
    expect(screen.getByText("High Risk")).toBeInTheDocument();
    expect(screen.getByText(/Front-loaded visit schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/MD contact \/ care coordination/i)).toBeInTheDocument();
  });

  it("handles an empty patient set", () => {
    render(<PPHPreventionWorklist patients={[]} oasisData={[]} visits={[]} />);
    expect(screen.getByText(/No active patients to rank/i)).toBeInTheDocument();
  });
});
