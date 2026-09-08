import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from 'react';
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const draftStorageMocks = vi.hoisted(() => ({
  lease: Object.freeze({ epoch: 42 }),
  captureLease: vi.fn(),
  isLeaseCurrent: vi.fn(),
  save: vi.fn(async () => {}),
  get: vi.fn(async () => null),
  remove: vi.fn(async () => {}),
}));

const authorizationMocks = vi.hoisted(() => ({
  visitState: null,
  patientState: null,
  patientCalls: [],
  visitId: null,
  forceRender: null,
}));

// No backend: the page's entity queries resolve empty, which is enough to render
// Step 1. The draft-autosave module is dynamically imported and self-catching.
vi.mock("@/api/base44Client", async () => {
  const { makeBase44Stub } = await vi.importActual("@/test/testUtils");
  return {
    base44: makeBase44Stub({
      auth: {
        me: async () => ({
          id: 'user-a',
          email: 'clinician@example.com',
          care_scope: 'home_health',
        }),
      },
    }),
  };
});

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    tenantContext: {
      user_id: 'user-a',
      agency_id: 'agency-a',
      membership_id: 'membership-a',
      membership_version: 7,
      tenant_role: 'clinician',
    },
  }),
}));

vi.mock('@/hooks/useScopedPatients', () => ({
  useScopedPatients: () => ({
    data: [{
      id: 'patient-a',
      first_name: 'Ada',
      last_name: 'Lovelace',
      status: 'active',
    }],
  }),
}));

vi.mock('@/hooks/useAuthorizedPatient', () => ({
  useAuthorizedPatient: (options) => {
    authorizationMocks.patientCalls.push(options);
    if (!options.enabled) {
      return { data: undefined, isSuccess: false, isError: false, tenantScope: null };
    }
    return authorizationMocks.patientState;
  },
}));

vi.mock('@/hooks/useAuthorizedVisit', () => ({
  useAuthorizedVisit: () => authorizationMocks.visitState,
}));

vi.mock('@/functions/getAuthorizedPatientNoteHistory', () => ({
  getAuthorizedPatientNoteHistory: async ({ patientId }) => ({
    success: true,
    patient_id: patientId,
    entries: [],
  }),
}));

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

function SmartNoteHarness() {
  const [, setRevision] = useState(0);
  authorizationMocks.forceRender = () => setRevision((value) => value + 1);
  return <SmartNoteAssistant visitId={authorizationMocks.visitId} />;
}

async function refreshSmartNote() {
  await act(async () => {
    authorizationMocks.forceRender();
  });
}

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
    authorizationMocks.patientCalls.length = 0;
    authorizationMocks.visitId = null;
    authorizationMocks.forceRender = null;
    authorizationMocks.visitState = {
      data: undefined,
      isSuccess: false,
      isError: false,
      tenantScope: null,
    };
    authorizationMocks.patientState = {
      data: {
        id: 'patient-a',
        first_name: 'Ada',
        last_name: 'Lovelace',
        status: 'active',
        care_type: 'home_health',
        primary_diagnosis: 'I10',
        updated_date: '2026-09-07T12:00:00.000Z',
      },
      isSuccess: true,
      isError: false,
      tenantScope: {
        user_id: 'user-a',
        agency_id: 'agency-a',
        membership_id: 'membership-a',
        membership_version: 7,
        tenant_role: 'clinician',
      },
    };
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

  it('preserves the bound patient and draft across a successful same-authority Visit recheck', async () => {
    const success = {
      data: {
        id: 'visit-a',
        patient_id: 'patient-a',
        visit_type: 'routine_visit',
        emr_handoff_status: 'not_started',
        emr_handoff_history: [],
        documentation_review_ack: null,
      },
      isSuccess: true,
      isError: false,
      tenantScope: authorizationMocks.patientState.tenantScope,
    };
    authorizationMocks.visitState = success;
    authorizationMocks.visitId = 'visit-a';
    renderWithProviders(<SmartNoteHarness />);
    await typeDraft(DRAFT_FILLED);
    expect(await screen.findByText(/Ada Lovelace/, { selector: 'strong' })).toBeInTheDocument();
    await waitFor(() => expect(draftStorageMocks.save).toHaveBeenCalled());

    authorizationMocks.visitState = {
      data: undefined,
      isSuccess: false,
      isError: false,
      tenantScope: null,
    };
    await refreshSmartNote();
    expect(await screen.findByText(/Verifying visit access/i)).toBeInTheDocument();

    authorizationMocks.visitState = success;
    await refreshSmartNote();
    const editor = await screen.findByPlaceholderText(/enter bullet points or rough draft/i);
    await waitFor(() => expect(editor).toHaveValue(DRAFT_FILLED));
    expect(await screen.findByText(/Ada Lovelace/, { selector: 'strong' })).toBeInTheDocument();
    expect(authorizationMocks.patientCalls.at(-1)?.patientId).toBe('patient-a');
  });

  it('hides and destructively clears bound Visit state after a settled denial', async () => {
    authorizationMocks.visitState = {
      data: {
        id: 'visit-a',
        patient_id: 'patient-a',
        visit_type: 'routine_visit',
      },
      isSuccess: true,
      isError: false,
      tenantScope: authorizationMocks.patientState.tenantScope,
    };
    authorizationMocks.visitId = 'visit-a';
    renderWithProviders(<SmartNoteHarness />);
    await typeDraft(DRAFT_FILLED);
    expect(await screen.findByText(/Ada Lovelace/, { selector: 'strong' })).toBeInTheDocument();
    await waitFor(() => expect(draftStorageMocks.save).toHaveBeenCalled());

    authorizationMocks.visitState = {
      data: undefined,
      isSuccess: false,
      isError: true,
      tenantScope: null,
    };
    await refreshSmartNote();
    expect(await screen.findByText(/Visit access could not be verified/i)).toBeInTheDocument();

    authorizationMocks.visitState = {
      data: undefined,
      isSuccess: false,
      isError: false,
      tenantScope: null,
    };
    authorizationMocks.visitId = null;
    await refreshSmartNote();
    const editor = await screen.findByPlaceholderText(/enter bullet points or rough draft/i);
    await waitFor(() => expect(editor).toHaveValue(''));
    expect(screen.queryByText(/Ada Lovelace/, { selector: 'strong' })).not.toBeInTheDocument();
  });

  it('never falls back to roster details when exact Patient revalidation fails', async () => {
    authorizationMocks.visitState = {
      data: {
        id: 'visit-a',
        patient_id: 'patient-a',
        visit_type: 'routine_visit',
      },
      isSuccess: true,
      isError: false,
      tenantScope: authorizationMocks.patientState.tenantScope,
    };
    authorizationMocks.visitId = 'visit-a';
    renderWithProviders(<SmartNoteHarness />);
    await typeDraft(DRAFT_FILLED);
    expect(await screen.findByText(/Ada Lovelace/, { selector: 'strong' })).toBeInTheDocument();

    authorizationMocks.patientState = {
      data: undefined,
      isSuccess: false,
      isError: true,
      tenantScope: null,
    };
    await refreshSmartNote();
    expect(await screen.findByText(/Patient chart access could not be verified/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ada Lovelace/, { selector: 'strong' })).not.toBeInTheDocument();
    expect(reviewButton()).toBeDisabled();
  });
});
