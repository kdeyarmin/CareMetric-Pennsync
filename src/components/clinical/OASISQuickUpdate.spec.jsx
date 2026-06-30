import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

// Use the shared Base44 stub (every entity call resolves empty). The factory is
// hoisted, so it can't close over module imports — pull the helper in via a
// dynamic import inside the async factory instead.
vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await import("@/test/testUtils");
  return { base44: makeBase44Stub() };
});

import OASISQuickUpdate from "./OASISQuickUpdate";

describe("OASISQuickUpdate", () => {
  const patient = { id: "p1", full_name: "Test Patient" };

  it("renders the quick-entry form with the per-item OASIS functional fields", async () => {
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    expect(await screen.findByText("OASIS Quick Update")).toBeInTheDocument();
    // Fields are driven by oasisScales (each labelled with its OASIS-E M-number).
    expect(screen.getByText("Ambulation (M1860)")).toBeInTheDocument();
    expect(screen.getByText("Bathing (M1830)")).toBeInTheDocument();
    expect(screen.getByText("Dressing Upper (M1810)")).toBeInTheDocument();
    expect(screen.getByText("Transferring (M1850)")).toBeInTheDocument();
    expect(screen.getByText("Toileting (M1845)")).toBeInTheDocument();
    expect(screen.getByText("Pain Frequency (M1242)")).toBeInTheDocument();
  });

  it("keeps Save disabled with no changes and no assessment type", async () => {
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    const save = await screen.findByRole("button", { name: /Save as Draft/i });
    expect(save).toBeDisabled();
  });

  it("keeps Save disabled when there are changes but still no assessment type", async () => {
    renderWithProviders(<OASISQuickUpdate patient={patient} />);
    const save = await screen.findByRole("button", { name: /Save as Draft/i });

    // Typing a clinical note flips hasChanges true without picking a type. Save
    // must stay gated on the required assessment type, and the hint should appear.
    const note = screen.getByLabelText(/Clinical Note/i);
    fireEvent.change(note, { target: { value: "Patient stable, no acute changes." } });

    expect(save).toBeDisabled();
    expect(screen.getByText(/Select an assessment type to save/i)).toBeInTheDocument();
  });
});
