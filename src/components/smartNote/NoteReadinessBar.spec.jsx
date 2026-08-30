import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import NoteReadinessBar from "./NoteReadinessBar";

describe("NoteReadinessBar — Step 1 live compliance preview", () => {
  it("renders nothing for a draft too short to scan", () => {
    const { container } = renderWithProviders(<NoteReadinessBar roughNote="too short" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the elements required to bill when they are missing", () => {
    renderWithProviders(
      <NoteReadinessBar roughNote="Saw the client today and things seemed to be going fine overall." />,
    );
    expect(screen.getByText(/required to bill this visit/i)).toBeInTheDocument();
    const billing = screen.getByText(/required to bill this visit/i).parentElement;
    expect(billing).toHaveTextContent(/Homebound status/i);
    expect(billing).toHaveTextContent(/Skilled need/i);
  });

  it("does not claim completeness while non-critical elements are still missing", () => {
    // Criticals are documented but most other required elements are not. Showing
    // a green "everything required is documented" here contradicted the
    // "N of 10 documented" line right above it and invited the nurse to stop.
    renderWithProviders(
      <NoteReadinessBar
        roughNote={
          "Patient is homebound due to severe dyspnea and requires a walker with one-person assist. "
          + "Skilled wound care with a sterile dressing change to the sacral ulcer."
        }
      />,
    );
    expect(screen.queryByText(/required to bill this visit/i)).not.toBeInTheDocument();
    const line = screen.getByText(/billing-critical elements are documented/i);
    expect(line).toBeInTheDocument();
    expect(line.parentElement).toHaveTextContent(/still missing/i);
    expect(screen.queryByText(/all \d+ required elements are documented/i)).not.toBeInTheDocument();
  });

  it("confirms full readiness only once every required element is documented", () => {
    const complete = [
      "Patient is homebound due to severe dyspnea and requires a walker with one-person assist.",
      "Skilled wound care with a sterile dressing change to the sacral ulcer.",
      "Vital signs BP 148/90, HR 82, O2 95% on RA.",
      "Patient tolerated the dressing change well.",
      "Educated the caregiver on the medication schedule; caregiver verbalized understanding.",
      "Progress toward the plan of care goals continues.",
      "Fall risk assessed and the home environment reviewed.",
      "Pain 3/10 at the wound site.",
      "Patient reports no new complaints this visit.",
      "Medication list reviewed for adherence.",
    ].join("\n");
    renderWithProviders(<NoteReadinessBar roughNote={complete} />);
    expect(screen.getByText(/all \d+ required elements are documented/i)).toBeInTheDocument();
    expect(screen.queryByText(/still missing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/required to bill this visit/i)).not.toBeInTheDocument();
  });

  it("warns about unfilled template blanks while the draft is still editable", () => {
    renderWithProviders(
      <NoteReadinessBar roughNote={"Homebound status: unable to leave home due to [diagnosis]\nPain level: _/10"} />,
    );
    expect(screen.getByText(/unfilled blank/i)).toBeInTheDocument();
    // A blank is not documentation, so homebound is still reported as missing.
    expect(screen.getByText(/required to bill this visit/i).parentElement).toHaveTextContent(/Homebound status/i);
  });

  it("counts vitals captured on the structured form, not just typed prose", () => {
    const roughNote = "Patient is homebound due to dyspnea, needs a walker. Skilled wound care performed.";
    const { unmount } = renderWithProviders(<NoteReadinessBar roughNote={roughNote} />);
    const before = screen.getByText(/of \d+ required elements documented/i).textContent;
    unmount();

    renderWithProviders(
      <NoteReadinessBar
        roughNote={roughNote}
        vitals={{ blood_pressure_systolic: 148, blood_pressure_diastolic: 90, heart_rate: 82 }}
      />,
    );
    const after = screen.getByText(/of \d+ required elements documented/i).textContent;
    expect(after).not.toEqual(before);
  });

  it("uses the hospice element set for a hospice visit", () => {
    renderWithProviders(
      <NoteReadinessBar
        roughNote="Visited the patient at home today and reviewed how the week has been going."
        serviceLine="hospice"
      />,
    );
    expect(screen.getByText(/required to bill this visit/i).parentElement).toHaveTextContent(/Comfort-focused skilled need/i);
  });
});

describe("NoteReadinessBar — blank count accuracy", () => {
  it("reports the true number of blanks, not the capped display-row count", () => {
    // 10 lines x 3 blanks = 30. Counting the capped display rows said "6".
    const draft = Array.from({ length: 10 }, (_, i) => `Line ${i}: BP _/_, HR _`).join("\n");
    renderWithProviders(<NoteReadinessBar roughNote={draft} />);
    expect(screen.getByText(/30 unfilled blanks/i)).toBeInTheDocument();
    expect(screen.queryByText(/6 unfilled blanks/i)).not.toBeInTheDocument();
  });

  it("uses the singular form for exactly one blank", () => {
    renderWithProviders(
      <NoteReadinessBar roughNote="Homebound status: unable to leave the home due to [diagnosis] this visit." />,
    );
    expect(screen.getByText(/1 unfilled blank$/i)).toBeInTheDocument();
  });
});
