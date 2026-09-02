import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NoteToOasisPrefill from "./NoteToOasisPrefill";
import { mapNoteToOASIS } from "@/functions/mapNoteToOASIS";

vi.mock("@/functions/mapNoteToOASIS", () => ({ mapNoteToOASIS: vi.fn() }));

const SECTIONS = [
  {
    id: "transferring",
    questions: [
      {
        id: "m1860",
        label: "M1860 — Ambulation/Locomotion",
        options: [
          { value: 0, label: "0 — Able to independently walk" },
          { value: 3, label: "3 — Requires use of two-handed device or walker" },
        ],
      },
    ],
  },
];

const SUGGESTION = {
  item_number: "M1860",
  // The model still sends these; the panel must not act on them.
  suggested_value: "3",
  suggested_value_label: "3 — Requires use of two-handed device or walker",
  confidence_score: 92,
  supporting_text: "Patient ambulates with a rolling walker and one-person assist.",
  clinical_rationale: "Documented walker use — enter code 3.",
};

async function runPanel(suggestions) {
  mapNoteToOASIS.mockResolvedValue({ data: { success: true, oasis_suggestions: suggestions } });
  render(<NoteToOasisPrefill patientId="p1" sections={SECTIONS} />);
  fireEvent.click(screen.getByText("Find note evidence for OASIS items"));
  fireEvent.change(screen.getByPlaceholderText(/Paste the clinical/i), {
    target: { value: "Patient ambulates with a rolling walker." },
  });
  fireEvent.click(screen.getByRole("button", { name: /Find evidence in this note/i }));
  await waitFor(() => expect(mapNoteToOASIS).toHaveBeenCalled());
}

describe("NoteToOasisPrefill", () => {
  beforeEach(() => {
    mapNoteToOASIS.mockReset();
  });

  it("shows the verbatim evidence and a question, never a suggested response", async () => {
    await runPanel([SUGGESTION]);

    expect(await screen.findByText("M1860 — Ambulation/Locomotion")).toBeInTheDocument();
    expect(screen.getByText(/rolling walker and one-person assist/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose the official response yourself/i)).toBeInTheDocument();

    // The model's chosen value must appear nowhere on the panel.
    expect(screen.queryByText(/Requires use of two-handed device or walker/i)).not.toBeInTheDocument();
    // Its code assertion in free text is neutralised.
    expect(screen.queryByText(/enter code 3/i)).not.toBeInTheDocument();
  });

  it("offers no control that could apply a model-chosen response", async () => {
    await runPanel([SUGGESTION]);
    await screen.findByText("M1860 — Ambulation/Locomotion");

    for (const name of [/Attest/i, /Apply/i, /Pre-fill/i, /Accept/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("states that PennSync does not select OASIS responses", async () => {
    await runPanel([]);
    expect(screen.getByText(/does not select OASIS responses/i)).toBeInTheDocument();
  });

  it("skips a suggestion with no verbatim evidence", async () => {
    await runPanel([{ item_number: "M1860", clinical_rationale: "Probably a 3." }]);
    await waitFor(() =>
      expect(screen.getByText(/not shown \(no verbatim evidence/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText("M1860 — Ambulation/Locomotion")).not.toBeInTheDocument();
  });
});
