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
  suggested_value: "3",
  confidence_score: 92,
  supporting_text: "Patient ambulates with a rolling walker and one-person assist.",
  clinical_rationale: "Documented walker use.",
};

describe("NoteToOasisPrefill", () => {
  beforeEach(() => {
    mapNoteToOASIS.mockReset();
  });

  it("maps a note to attestable drafts and applies on attest", async () => {
    mapNoteToOASIS.mockResolvedValue({ data: { success: true, oasis_suggestions: [SUGGESTION] } });
    const onApply = vi.fn();
    render(<NoteToOasisPrefill patientId="p1" sections={SECTIONS} onApply={onApply} />);

    // Expand the panel.
    fireEvent.click(screen.getByText("Pre-fill OASIS from a Note"));
    fireEvent.change(screen.getByPlaceholderText(/Paste the clinical/i), {
      target: { value: "Patient ambulates with a rolling walker." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Pre-fill OASIS from this note/i }));

    // The draft appears with its evidence; nothing applied yet.
    expect(await screen.findByText("M1860 — Ambulation/Locomotion")).toBeInTheDocument();
    expect(screen.getByText(/rolling walker and one-person assist/i)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    // Attesting applies the validated value to the form.
    fireEvent.click(screen.getByRole("button", { name: /Attest & apply/i }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("m1860", 3));
    expect(await screen.findByText("Applied")).toBeInTheDocument();
  });

  it("shows an info state when no confident suggestions are returned", async () => {
    mapNoteToOASIS.mockResolvedValue({ data: { success: true, oasis_suggestions: [] } });
    const onApply = vi.fn();
    render(<NoteToOasisPrefill patientId="p1" sections={SECTIONS} onApply={onApply} />);
    fireEvent.click(screen.getByText("Pre-fill OASIS from a Note"));
    fireEvent.change(screen.getByPlaceholderText(/Paste the clinical/i), { target: { value: "note" } });
    fireEvent.click(screen.getByRole("button", { name: /Pre-fill OASIS from this note/i }));
    await waitFor(() => expect(mapNoteToOASIS).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();
  });
});
