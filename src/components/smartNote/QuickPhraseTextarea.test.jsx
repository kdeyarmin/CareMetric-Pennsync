import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

// Stub the Base44 client so the library query resolves to [] (no backend). The
// component then falls back to the bundled offline default phrases, which expand
// locally without a network round-trip.
vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await vi.importActual("@/test/testUtils");
  return { base44: makeBase44Stub() };
});

import QuickPhraseTextarea, { mergePhrases } from "./QuickPhraseTextarea";
import { DEFAULT_CLINICAL_PHRASES } from "@/components/clinical/defaultClinicalPhrases";

// Controlled harness — the component is controlled, exactly as used in the editor.
function Harness(props) {
  const [value, setValue] = useState(props.initial ?? "");
  return <QuickPhraseTextarea value={value} onChange={setValue} {...props} />;
}

const type = (ta, value, caret) =>
  fireEvent.change(ta, { target: { value, selectionStart: caret, selectionEnd: caret } });

describe("QuickPhraseTextarea", () => {
  it("opens the picker for a .dot-token and lists the matching phrase", async () => {
    renderWithProviders(<Harness />);
    const ta = screen.getByRole("textbox");
    type(ta, ".diab", 5);
    expect(await screen.findByText("diabetic education")).toBeInTheDocument();
  });

  it("inserts the offline default expansion at the caret on selection", async () => {
    renderWithProviders(<Harness />);
    const ta = screen.getByRole("textbox");
    type(ta, ".diab", 5);
    const option = await screen.findByText("diabetic education");
    fireEvent.click(option);
    await waitFor(() =>
      expect(screen.getByRole("textbox").value).toMatch(/diabetic self-management education/i),
    );
    // The trigger token is consumed, not left behind.
    expect(screen.getByRole("textbox").value).not.toMatch(/\.diab/);
  });

  it("does not open the menu for an ordinary sentence period", () => {
    renderWithProviders(<Harness />);
    const ta = screen.getByRole("textbox");
    type(ta, "Patient tolerated care.", 23);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports a leading / slash menu", async () => {
    renderWithProviders(<Harness />);
    const ta = screen.getByRole("textbox");
    type(ta, "/wound", 6);
    expect(await screen.findByText("wound care provided")).toBeInTheDocument();
  });

  it("does not falsely trigger on a vitals fraction like 120/80", () => {
    renderWithProviders(<Harness />);
    const ta = screen.getByRole("textbox");
    type(ta, "BP 120/80", 9);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("mergePhrases", () => {
  const defaultPhrase = DEFAULT_CLINICAL_PHRASES[0].phrase; // e.g. "diabetic education"
  const has = (list, phrase) => list.some((p) => p.phrase === phrase);

  it("keeps a default when only a NON-visible record shares its phrase", () => {
    // Another nurse's private template with the same phrase must not remove the
    // bundled default from the current nurse's picker.
    const templates = [{ id: "t1", phrase: defaultPhrase, created_by: "other@x.com" }];
    const merged = mergePhrases(templates, { email: "me@x.com", patientId: "" });
    const defaults = merged.filter((p) => !p.id);
    expect(has(defaults, defaultPhrase)).toBe(true);
  });

  it("suppresses the default when a VISIBLE record shares its phrase", () => {
    const templates = [{ id: "t1", phrase: defaultPhrase, is_agency_wide: true }];
    const merged = mergePhrases(templates, { email: "me@x.com", patientId: "" });
    const defaults = merged.filter((p) => !p.id);
    expect(has(defaults, defaultPhrase)).toBe(false);
    // The authored (visible) record is still present.
    expect(merged.some((p) => p.id === "t1")).toBe(true);
  });
});
