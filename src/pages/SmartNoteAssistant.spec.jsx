import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const draftStorageMocks = vi.hoisted(() => ({
  lease: Object.freeze({ epoch: 42 }),
  captureLease: vi.fn(),
  isLeaseCurrent: vi.fn(),
  save: vi.fn(async () => {}),
  get: vi.fn(async () => null),
  remove: vi.fn(async () => {}),
}));

// No backend: the page's entity queries resolve empty, which is enough to render
// Step 1. The draft-autosave module is dynamically imported and self-catching.
vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await vi.importActual("@/test/testUtils");
  return { base44: makeBase44Stub() };
});

// The durable-draft store is IndexedDB-backed, which jsdom does not provide; its
// real failure mode in the browser is a caught, non-fatal rejection. Stub it so
// those rejections don't surface as unhandled errors and fail the run — draft
// persistence is not what this spec covers.
vi.mock("@/lib/phiStorage", async (importOriginal) => ({
  ...await importOriginal(),
  captureAuthorityDraftLease: draftStorageMocks.captureLease,
  isAuthorityDraftLeaseCurrent: draftStorageMocks.isLeaseCurrent,
}));

vi.mock("@/lib/draftNotes", () => ({
  saveDraftNoteLocally: draftStorageMocks.save,
  getDraftNoteLocally: draftStorageMocks.get,
  deleteDraftNoteLocally: draftStorageMocks.remove,
}));

import SmartNoteAssistant from "./SmartNoteAssistant";

// Past the 20-character floor, but still carrying template scaffolding.
const DRAFT_WITH_BLANKS =
  "Homebound: unable to leave home without considerable effort due to [diagnosis]. Pain _/10.";
const DRAFT_FILLED =
  "Homebound: unable to leave home without considerable effort due to severe dyspnea. Pain 3/10.";

const reviewButton = () => screen.getByRole("button", { name: /review & complete/i });

async function typeDraft(text) {
  const editor = await screen.findByPlaceholderText(/enter bullet points or rough draft/i);
  fireEvent.change(editor, { target: { value: text } });
  return editor;
}

describe("SmartNoteAssistant — Step 1 gate on template blanks", () => {
  beforeEach(() => {
    sessionStorage.clear();
    draftStorageMocks.captureLease.mockReset();
    draftStorageMocks.captureLease.mockReturnValue(draftStorageMocks.lease);
    draftStorageMocks.isLeaseCurrent.mockReset();
    draftStorageMocks.isLeaseCurrent.mockReturnValue(true);
    draftStorageMocks.save.mockClear();
    draftStorageMocks.get.mockClear();
    draftStorageMocks.remove.mockClear();
  });

  it("keeps Review unavailable while the draft still has blanks", async () => {
    renderWithProviders(<SmartNoteAssistant />);
    await typeDraft(DRAFT_WITH_BLANKS);

    // The draft is long enough to review, so only the blanks can be holding it.
    expect(DRAFT_WITH_BLANKS.trim().length).toBeGreaterThan(20);
    await waitFor(() => expect(reviewButton()).toBeDisabled());
  });

  it("says why, rather than leaving a dead button", async () => {
    renderWithProviders(<SmartNoteAssistant />);
    await typeDraft(DRAFT_WITH_BLANKS);

    // The status beside the button and the alert above the editor must agree
    // with the disabled state — that agreement is the point of the gate.
    expect(await screen.findByText(/blanks? to fill before review/i)).toBeInTheDocument();
    expect(await screen.findByText(/unfilled blanks? left from a template/i)).toBeInTheDocument();
  });

  it("releases Review once the blanks are filled in", async () => {
    renderWithProviders(<SmartNoteAssistant />);
    await typeDraft(DRAFT_WITH_BLANKS);
    await waitFor(() => expect(reviewButton()).toBeDisabled());

    await typeDraft(DRAFT_FILLED);
    await waitFor(() => expect(reviewButton()).toBeEnabled());
    expect(screen.queryByText(/unfilled blanks? left from a template/i)).not.toBeInTheDocument();
  });

  it("still holds Review below the minimum draft length", async () => {
    renderWithProviders(<SmartNoteAssistant />);
    await typeDraft("too short");
    await waitFor(() => expect(reviewButton()).toBeDisabled());
    expect(await screen.findByText(/more characters needed/i)).toBeInTheDocument();
  });

  it("captures the authority lease before the async durable autosave and passes it through", async () => {
    renderWithProviders(<SmartNoteAssistant />);
    await typeDraft(DRAFT_FILLED);

    await waitFor(() => expect(draftStorageMocks.save).toHaveBeenCalled());
    const saveCall = draftStorageMocks.save.mock.calls.find(([record]) => (
      record?.note === DRAFT_FILLED
    ));
    expect(saveCall?.[1]).toBe(draftStorageMocks.lease);
    expect(draftStorageMocks.captureLease.mock.invocationCallOrder.at(-1)).toBeLessThan(
      draftStorageMocks.save.mock.invocationCallOrder.at(-1),
    );
  });
});
