import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

// The reviewer's compliance modules import the Base44 client at load; stub it so
// the render needs no backend.
vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await vi.importActual("@/test/testUtils");
  return { base44: makeBase44Stub() };
});

// Make the LLM step deterministic: the constrained scribe returns a fixed note and
// the grounding pass always passes. Lets us test the UI flow (gaps → soft confirm →
// generate) without a live model. Running the reviewer OFFLINE additionally skips
// the completeness critic and the grounding network call.
vi.mock("./compliance/generation", () => ({
  generateConstrainedNote: vi.fn(async () => ({ note: "Patient was seen for a routine visit." })),
  groundNote: vi.fn(async () => ({ ok: true, unsupported: [], sentences: [] })),
}));

import ConstrainedNoteReviewer from "./ConstrainedNoteReviewer";

// A neutral draft (>= 20 chars) that matches NONE of the required-element keyword
// patterns, so every required element — including the two criticals (homebound,
// skilled need) — is a gap the reviewer asks about.
const NEUTRAL_DRAFT = "Saw the client today and went over how things are going overall.";

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

// Fill a gap's free-text answer. Gap textareas render in required-element order;
// [0] = homebound, [1] = skilled need for a home-health routine visit.
function answerTextareas() {
  return screen.getAllByPlaceholderText(/type or dictate your answer/i);
}

describe("ConstrainedNoteReviewer — questions, adequacy & soft-confirm gate", () => {
  beforeEach(() => { setOnline(false); }); // offline: skip critic + grounding, mock generation
  afterEach(() => { setOnline(true); vi.clearAllMocks(); });

  it("asks the critical questions and offers a compliant example for homebound", () => {
    renderWithProviders(<ConstrainedNoteReviewer roughNote={NEUTRAL_DRAFT} serviceLine="home_health" visitType="routine_visit" />);
    // The homebound + skilled-need questions surface as gaps.
    expect(screen.getByText(/why is the patient homebound/i)).toBeInTheDocument();
    expect(screen.getByText(/what skilled nursing service/i)).toBeInTheDocument();
    // The homebound question exposes a compliant example expander.
    const exampleToggle = screen.getAllByRole("button", { name: /see a compliant example/i })[0];
    fireEvent.click(exampleToggle);
    expect(screen.getByText(/requires a rolling walker/i)).toBeInTheDocument();
  });

  it("soft-confirms a conclusory critical answer before generating, then proceeds once acknowledged", async () => {
    const { generateConstrainedNote } = await import("./compliance/generation");
    renderWithProviders(<ConstrainedNoteReviewer roughNote={NEUTRAL_DRAFT} serviceLine="home_health" visitType="routine_visit" />);

    const tas = answerTextareas();
    fireEvent.change(tas[0], { target: { value: "Patient is homebound." } }); // conclusory → inadequate
    fireEvent.change(tas[1], { target: { value: "Performed skilled wound assessment and a sterile dressing change to the sacral ulcer." } });

    // Both criticals are answered, so the hard gate is clear and Generate is enabled.
    const generateBtn = screen.getByRole("button", { name: /generate final note/i });
    expect(generateBtn).toBeEnabled();
    fireEvent.click(generateBtn);

    // The brief homebound answer triggers the soft confirm — generation has NOT run.
    expect(await screen.findByText(/these required answers look brief/i)).toBeInTheDocument();
    expect(generateConstrainedNote).not.toHaveBeenCalled();
    expect(screen.queryByText(/final clinical note/i)).not.toBeInTheDocument();

    // Acknowledge, then generate — now it proceeds.
    fireEvent.click(screen.getByRole("checkbox", { name: /complete as written/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate final note/i }));

    expect(await screen.findByText(/final clinical note/i)).toBeInTheDocument();
    expect(generateConstrainedNote).toHaveBeenCalledTimes(1);
  });

  it("generates without a soft confirm when the critical answers are specific", async () => {
    const { generateConstrainedNote } = await import("./compliance/generation");
    renderWithProviders(<ConstrainedNoteReviewer roughNote={NEUTRAL_DRAFT} serviceLine="home_health" visitType="routine_visit" />);

    const tas = answerTextareas();
    fireEvent.change(tas[0], { target: { value: "Homebound due to severe dyspnea; requires a walker and one-person assist to ambulate and tires after a few steps." } });
    fireEvent.change(tas[1], { target: { value: "Skilled observation and assessment of unstable CHF with lung auscultation and edema check." } });

    fireEvent.click(screen.getByRole("button", { name: /generate final note/i }));

    expect(await screen.findByText(/final clinical note/i)).toBeInTheDocument();
    expect(screen.queryByText(/these required answers look brief/i)).not.toBeInTheDocument();
    await waitFor(() => expect(generateConstrainedNote).toHaveBeenCalledTimes(1));
  });

  it("blocks generation entirely while a critical element is unanswered", () => {
    renderWithProviders(<ConstrainedNoteReviewer roughNote={NEUTRAL_DRAFT} serviceLine="home_health" visitType="routine_visit" />);
    // Nothing answered yet → the hard gate disables Generate and names what's missing.
    expect(screen.getByRole("button", { name: /generate final note/i })).toBeDisabled();
    expect(screen.getByText(/required before generating/i)).toBeInTheDocument();
  });
});
