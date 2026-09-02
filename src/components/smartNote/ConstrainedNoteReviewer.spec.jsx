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
    expect(await screen.findByText(/these required elements look brief/i)).toBeInTheDocument();
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
    expect(screen.queryByText(/these required elements look brief/i)).not.toBeInTheDocument();
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

describe("ConstrainedNoteReviewer — unfilled template blanks gate generation", () => {
  // Criticals ARE documented here, so only the leftover blank can block: this
  // isolates the placeholder gate from the critical-element gate.
  const DRAFT_WITH_BLANK = [
    "Patient is homebound due to severe dyspnea and requires a walker with one-person assist.",
    "Skilled wound care with a sterile dressing change to the sacral ulcer.",
    "Pain level: _/10, location: _",
  ].join("\n");

  const CLEAN_DRAFT = [
    "Patient is homebound due to severe dyspnea and requires a walker with one-person assist.",
    "Skilled wound care with a sterile dressing change to the sacral ulcer.",
    "Pain level 4/10, location right heel.",
  ].join("\n");

  beforeEach(() => { setOnline(false); });
  afterEach(() => { setOnline(true); vi.clearAllMocks(); });

  it("blocks generation and names the lines still holding blanks", async () => {
    const { generateConstrainedNote } = await import("./compliance/generation");
    renderWithProviders(<ConstrainedNoteReviewer roughNote={DRAFT_WITH_BLANK} serviceLine="home_health" visitType="routine_visit" />);

    expect(screen.getByText(/unfilled blanks in your draft/i)).toBeInTheDocument();
    expect(screen.getByText(/Pain level: _\/10, location: _/)).toBeInTheDocument();

    const generateBtn = screen.getByRole("button", { name: /generate final note/i });
    expect(generateBtn).toBeDisabled();
    fireEvent.click(generateBtn);
    expect(generateConstrainedNote).not.toHaveBeenCalled();
  });

  it("generates once the blanks are filled in", async () => {
    const { generateConstrainedNote } = await import("./compliance/generation");
    renderWithProviders(<ConstrainedNoteReviewer roughNote={CLEAN_DRAFT} serviceLine="home_health" visitType="routine_visit" />);

    expect(screen.queryByText(/unfilled blanks in your draft/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate final note/i }));

    expect(await screen.findByText(/final clinical note/i)).toBeInTheDocument();
    await waitFor(() => expect(generateConstrainedNote).toHaveBeenCalledTimes(1));
  });

  it("a blank re-introduced by a manual edit fails verification", async () => {
    renderWithProviders(<ConstrainedNoteReviewer roughNote={CLEAN_DRAFT} serviceLine="home_health" visitType="routine_visit" />);
    fireEvent.click(screen.getByRole("button", { name: /generate final note/i }));
    expect(await screen.findByText(/final clinical note/i)).toBeInTheDocument();

    // Hand-edit the verified note to reintroduce a blank, then re-check.
    const noteBox = screen.getByDisplayValue(/Patient was seen for a routine visit/i);
    fireEvent.change(noteBox, { target: { value: "Patient was seen for a routine visit. Wound measured _ cm." } });
    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));

    expect(await screen.findByText(/fix required before finalizing/i)).toBeInTheDocument();
    expect(screen.getByText(/unfilled blanks are still in the note/i)).toBeInTheDocument();
  });

  it("an untouched template scores 0% and asks every required question", () => {
    // The shipped routine-SN template, unedited. Every line is scaffolding, so
    // nothing counts as documented and the nurse is asked about all of it.
    const TEMPLATE = [
      "• Vital signs: BP _/_,  HR _, RR _, O2 _% on RA, Temp _°F, Wt _ lbs",
      "• Homebound status: patient unable to leave home without considerable effort due to [diagnosis]",
      "• Skilled need: [wound care / medication management / disease management teaching]",
    ].join("\n");
    renderWithProviders(<ConstrainedNoteReviewer roughNote={TEMPLATE} serviceLine="home_health" visitType="routine_visit" />);

    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText(/0 of \d+ required elements documented/i)).toBeInTheDocument();
    expect(screen.getByText(/why is the patient homebound/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate final note/i })).toBeDisabled();
  });
});

describe("ConstrainedNoteReviewer — conclusory documentation in the DRAFT itself", () => {
  beforeEach(() => { setOnline(false); });
  afterEach(() => { setOnline(true); vi.clearAllMocks(); });

  // "Discharged on 3/12" satisfies the discharge_reason presence scan, so it was
  // never turned into a question — and the adequacy rule written for exactly that
  // phrase only ever ran against the `answers` map. Generate stayed enabled.
  const BARE_DISCHARGE = "Discharged on 3/12. Final visit completed and the paperwork was left with the family.";

  it("soft-confirms a conclusory discharge reason that came from the draft", async () => {
    const { generateConstrainedNote } = await import("./compliance/generation");
    renderWithProviders(<ConstrainedNoteReviewer roughNote={BARE_DISCHARGE} serviceLine="home_health" visitType="discharge" />);

    // No critical GAP — the draft satisfied presence — so the hard gate is clear.
    expect(screen.queryByText(/required before generating/i)).not.toBeInTheDocument();
    const generateBtn = screen.getByRole("button", { name: /generate final note/i });
    expect(generateBtn).toBeEnabled();

    fireEvent.click(generateBtn);
    const panel = await screen.findByText(/these required elements look brief/i);
    expect(panel).toBeInTheDocument();
    expect(screen.getByText(/a date alone is not a reason/i)).toBeInTheDocument();
    expect(generateConstrainedNote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: /complete as written/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate final note/i }));
    expect(await screen.findByText(/final clinical note/i)).toBeInTheDocument();
    expect(generateConstrainedNote).toHaveBeenCalledTimes(1);
  });

  it("does not soft-confirm a discharge reason that actually states a reason", async () => {
    const { generateConstrainedNote } = await import("./compliance/generation");
    renderWithProviders(
      <ConstrainedNoteReviewer
        roughNote={
          "Discharged with all care-plan goals met; the patient independently performs her own dressing changes "
          + "and no longer requires skilled nursing."
        }
        serviceLine="home_health"
        visitType="discharge"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate final note/i }));
    expect(await screen.findByText(/final clinical note/i)).toBeInTheDocument();
    expect(screen.queryByText(/these required elements look brief/i)).not.toBeInTheDocument();
    expect(generateConstrainedNote).toHaveBeenCalledTimes(1);
  });

  it("does not double-warn on homebound, which the denial guardrail already judges", async () => {
    const { generateConstrainedNote } = await import("./compliance/generation");
    // Conclusory homebound IN THE DRAFT. The guardrail panel reports it and gates
    // the save; the soft confirm must stay out of the way rather than say it twice.
    renderWithProviders(
      <ConstrainedNoteReviewer
        roughNote="Patient is homebound. Skilled wound care with a sterile dressing change to the sacral ulcer."
        serviceLine="home_health"
        visitType="routine_visit"
      />,
    );
    expect(screen.getByText(/denial risk/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate final note/i }));
    expect(await screen.findByText(/final clinical note/i)).toBeInTheDocument();
    expect(screen.queryByText(/these required elements look brief/i)).not.toBeInTheDocument();
    expect(generateConstrainedNote).toHaveBeenCalledTimes(1);
  });
});

describe("ConstrainedNoteReviewer — what is left, and where the advisories went", () => {
  beforeEach(() => { setOnline(false); });
  afterEach(() => { setOnline(true); });

  it("names what is blocking Generate instead of leaving the nurse to find it", () => {
    renderWithProviders(
      <ConstrainedNoteReviewer roughNote={NEUTRAL_DRAFT} serviceLine="home_health" visitType="routine_visit" />,
    );
    // Two criticals (homebound, skilled need) are unanswered on a neutral draft.
    expect(screen.getAllByText(/2 required answers needed/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /generate final note/i })).toBeDisabled();
  });

  it("counts unfilled blanks alongside the unanswered criticals", () => {
    renderWithProviders(
      <ConstrainedNoteReviewer
        roughNote={"Patient homebound, unable to leave without considerable effort due to severe dyspnea. "
          + "Skilled wound care with a sterile dressing change performed. Pain level: _/10, location: _"}
        serviceLine="home_health"
        visitType="routine_visit"
      />,
    );
    expect(screen.getAllByText(/blanks to fix/i).length).toBeGreaterThan(0);
  });

  it("says so plainly when nothing is blocking", () => {
    renderWithProviders(
      <ConstrainedNoteReviewer
        roughNote={"Patient homebound, unable to leave home without considerable effort due to severe dyspnea and "
          + "requires a rolling walker. Skilled wound care with a sterile dressing change to the sacral ulcer."}
        serviceLine="home_health"
        visitType="routine_visit"
      />,
    );
    expect(screen.getByText(/nothing blocking — ready to generate/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate final note/i })).toBeEnabled();
  });

  it("keeps an advisory's count on its header, so collapsing it hides nothing important", () => {
    renderWithProviders(
      <ConstrainedNoteReviewer roughNote={NEUTRAL_DRAFT} serviceLine="home_health" visitType="routine_visit" />,
    );
    const denial = screen.getByRole("button", { name: /denial risk/i });
    expect(denial).toHaveTextContent(/% risk/);
    expect(denial).toHaveTextContent(/to strengthen/);
  });

  it("lets the nurse collapse an advisory once they have read it", async () => {
    renderWithProviders(
      <ConstrainedNoteReviewer roughNote={NEUTRAL_DRAFT} serviceLine="home_health" visitType="routine_visit" />,
    );
    // A draft this thin has a blocking finding, so the panel starts open.
    expect(screen.getByText(/These documentation patterns drive most Medicare denials/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /denial risk/i }));
    await waitFor(() => {
      expect(screen.queryByText(/These documentation patterns drive most Medicare denials/i)).not.toBeInTheDocument();
    });
    // The header keeps reporting it either way.
    expect(screen.getByRole("button", { name: /denial risk/i })).toHaveTextContent(/% risk/);
  });

  it("opens an advisory that carries a blocking finding, rather than hiding it", () => {
    // Conclusory homebound: the guardrail reports this as a critical cluster.
    renderWithProviders(
      <ConstrainedNoteReviewer
        roughNote="Patient is homebound. Skilled wound care with a sterile dressing change to the sacral ulcer."
        serviceLine="home_health"
        visitType="routine_visit"
      />,
    );
    expect(screen.getByText(/These documentation patterns drive most Medicare denials/i)).toBeInTheDocument();
  });

});
