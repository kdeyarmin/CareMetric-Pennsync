import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

// The recorder imports the Base44 client at module load; stub it so the render
// smoke doesn't need a backend (the transcription calls only fire on record).
vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await vi.importActual("@/test/testUtils");
  return { base44: makeBase44Stub() };
});

import VisitAudioRecorder from "./VisitAudioRecorder";

describe("VisitAudioRecorder", () => {
  it("renders ONE record control defaulting to Narrative, with a format toggle", () => {
    renderWithProviders(<VisitAudioRecorder onTranscribed={() => {}} />);
    // Single record button (narrative default) — not the old two side-by-side recorders.
    expect(screen.getByRole("button", { name: /record visit/i })).toBeTruthy();
    // Format toggle present with both options.
    expect(screen.getByRole("group", { name: /transcription format/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^narrative$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^soap$/i })).toBeTruthy();
  });

  it("switches the record action to SOAP when the SOAP toggle is clicked", () => {
    renderWithProviders(<VisitAudioRecorder onTranscribed={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^soap$/i }));
    expect(screen.getByRole("button", { name: /record soap visit/i })).toBeTruthy();
  });

  it("does not touch the microphone on mount (records only on user action)", () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    renderWithProviders(<VisitAudioRecorder onTranscribed={() => {}} />);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
