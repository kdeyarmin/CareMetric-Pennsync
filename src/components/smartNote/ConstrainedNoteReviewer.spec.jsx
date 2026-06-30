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

// The online completeness critic. Default: no demotions. The propagation test
// overrides it per-call. Offline tests never invoke it (the effect early-returns).
vi.mock("./compliance/completenessCritic", () => ({
  critiqueCoverage: vi.fn(async () => ({ ok: true, elements: [] })),
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

describe("ConstrainedNoteReviewer — critic demotion propagates into scoring", () => {
  // This draft makes `safety` deterministically present (keyword "fall"), so it is
  // NOT a gap by the keyword scan. The online critic then judges it not actually
  // documented and demotes it.
  const NEGATED_DRAFT = "Patient seen at home; no fall risk assessment done today, nothing else of note.";

  beforeEach(() => { setOnline(true); }); // online so the completeness critic runs
  afterEach(() => { setOnline(true); vi.clearAllMocks(); });

  it("demotes a falsely-present element so a blank answer yields a 'not documented' line", async () => {
    const { critiqueCoverage } = await import("./compliance/completenessCritic");
    critiqueCoverage.mockResolvedValueOnce({ ok: true, elements: [{ id: "safety", documented: false }] });

    renderWithProviders(<ConstrainedNoteReviewer roughNote={NEGATED_DRAFT} serviceLine="home_health" visitType="routine_visit" />);

    // The keyword scan counted safety as present; the critic demotes it, so the
    // safety question now appears (it wasn't a deterministic gap).
    expect(await screen.findByText(/what safety \/ fall-risk assessment did you perform/i)).toBeInTheDocument();

    // Answer the two criticals adequately; leave the demoted safety element blank.
    const tas = screen.getAllByPlaceholderText(/type or dictate your answer/i);
    fireEvent.change(tas[0], { target: { value: "Homebound due to severe dyspnea; needs a walker and one-person assist to ambulate." } });
    fireEvent.change(tas[1], { target: { value: "Skilled wound assessment and sterile dressing change to the sacral ulcer." } });

    fireEvent.click(screen.getByRole("button", { name: /generate final note/i }));

    // Because the demotion flows into the fallback logic, the blank safety element
    // produces an honest "not documented" line in the saved note — it is no longer
    // silently treated as documented by the stray "fall" keyword. (The note renders
    // in a textarea, so assert on its value, not a text node.)
    expect(await screen.findByDisplayValue(/safety \/ fall-risk assessment was not documented this visit/i)).toBeInTheDocument();
  });
});
