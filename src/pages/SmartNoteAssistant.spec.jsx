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
  tenantContext: null,
  patientCalls: [],
  visitId: null,
  forceRender: null,
  persist: vi.fn(),
  handoff: vi.fn(),
  reviewAck: vi.fn(),
  history: vi.fn(),
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
  useAuth: () => ({ tenantContext: authorizationMocks.tenantContext }),
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
  getAuthorizedPatientNoteHistory: authorizationMocks.history,
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

vi.mock('@/functions/updateAuthorizedVisit', async (importOriginal) => ({
  ...await importOriginal(),
  advanceVisitHandoff: authorizationMocks.handoff,
  setVisitReviewAcknowledgement: authorizationMocks.reviewAck,
}));

vi.mock('@/components/smartNote/persistVisitNote', async (importOriginal) => ({
  ...await importOriginal(),
  persistVisitNote: authorizationMocks.persist,
}));

vi.mock('@/components/smartNote/StructuredNoteDrafter', () => ({
  default: ({ onDraftReady }) => <button onClick={() => onDraftReady(
    'A structured nursing draft with explicit edited vital signs.', 'routine_visit', { heart_rate: 84 },
  )}>Use structured test draft</button>,
}));

vi.mock('@/components/smartNote/ConstrainedNoteReviewer', () => ({
  default: ({ roughNote, renderFinalNote, onBack }) => <>
    <button onClick={onBack}>Edit draft</button>
    {renderFinalNote({ finalNote: roughNote, coverage: 88, result: {
      finalNote: roughNote, presence: [], required: [],
    } })}
  </>,
}));

vi.mock('@/components/smartNote/FinalNoteDisplay', () => ({
  default: ({ onSave, onReset, saveDisabled, saved, onReportHandoffStatus, onReviewAck }) => <>
    <button disabled={saveDisabled} onClick={onSave}>Save test note</button>
    <button onClick={onReset}>Discard test note</button>
    <button onClick={() => onReportHandoffStatus('copied_to_emr')}>Report test handoff</button>
    <button onClick={() => onReviewAck(true)}>Acknowledge test review</button>
    {saved && <span>Test note fully saved</span>}
  </>,
}));

import { PartialVisitSaveError } from '@/components/smartNote/persistVisitNote';
import SmartNoteAssistant from "./SmartNoteAssistant";
import ClinicalDocumentation from './ClinicalDocumentation';

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
const SAVED_NOTE = 'Recorded nursing visit.\nPatient reported pain 0/10.\nLiteral <script>text</script> remains text.';

function completedVisit() {
  return {
    data: { id: 'visit-a', patient_id: 'patient-a', visit_date: '2026-09-17',
      visit_type: 'routine_visit', status: 'completed', nurse_notes: SAVED_NOTE,
      raw_transcription: 'Original rough material', vital_signs: { heart_rate: 73, pain_level: 0, weight: 147.5 },
      documentation_source: 'smart_note', grounding_pending: false,
      updated_date: '2026-09-17T15:30:00.000Z' },
    isSuccess: true, isError: false, tenantScope: authorizationMocks.patientState.tenantScope,
  };
}

const reviewButton = () => screen.getByRole("button", { name: /review & complete/i });

async function openVitals() {
  const toggle = screen.getByRole('button', { name: /^Vital Signs/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return screen.findByLabelText('Heart Rate');
}

async function typeDraft(text) {
  const editor = await screen.findByPlaceholderText(/enter bullet points or rough draft/i);
  fireEvent.change(editor, { target: { value: text } });
  return editor;
}

describe("SmartNoteAssistant — Step 1 gate on template blanks", () => {
  beforeEach(() => {
    sessionStorage.clear();
    authorizationMocks.persist.mockReset();
    authorizationMocks.handoff.mockReset().mockResolvedValue({});
    authorizationMocks.reviewAck.mockReset().mockResolvedValue({});
    authorizationMocks.history.mockReset().mockImplementation(async ({ patientId }) => ({
      success: true, patient_id: patientId, entries: [],
    }));
    draftStorageMocks.captureLease.mockReset();
    draftStorageMocks.captureLease.mockReturnValue(draftStorageMocks.lease);
    draftStorageMocks.isLeaseCurrent.mockReset();
    draftStorageMocks.isLeaseCurrent.mockReturnValue(true);
    draftStorageMocks.save.mockClear();
    draftStorageMocks.get.mockClear();
    draftStorageMocks.remove.mockClear();
    authorizationMocks.tenantContext = {
      user_id: 'user-a', agency_id: 'agency-a', membership_id: 'membership-a',
      membership_version: 7, tenant_role: 'clinician',
    };
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

  it('reopens completed Visit note and recorded vitals through ClinicalDocumentation with fresh draft stores', async () => {
    authorizationMocks.visitState = completedVisit();
    renderWithProviders(<ClinicalDocumentation />, { route: '/ClinicalDocumentation?visitId=visit-a' });
    await screen.findByRole('heading', { name: 'Saved visit note' });
    expect(screen.getByLabelText('Saved note text').textContent).toBe(SAVED_NOTE);
    expect(screen.getByText('73 bpm')).toBeInTheDocument();
    expect(screen.getByText('147.5')).toBeInTheDocument();
    expect(screen.getByText('Weight (unit not recorded)')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter bullet points or rough draft/i)).toHaveValue('');
    expect(reviewButton()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save test note' })).not.toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(authorizationMocks.persist).not.toHaveBeenCalled();
    expect(draftStorageMocks.save).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-a')).toBeNull();
  });

  it('keeps a separate patient draft and preserves explicit review, same-Visit update and handoff', async () => {
    const success = completedVisit();
    authorizationMocks.visitId = 'visit-a';
    const originalDraft = { note: DRAFT_FILLED, visitType: 'routine_visit', patientId: 'patient-a' };
    sessionStorage.setItem('smart_note_draft_v2:patient-a', JSON.stringify(originalDraft));
    authorizationMocks.persist.mockResolvedValue({
      mode: 'update', visitId: 'visit-a', auditId: 'audit-a', finalText: DRAFT_FILLED, coverageScore: 88,
    });
    renderWithProviders(<SmartNoteHarness />, { route: '/ClinicalDocumentation?visitId=visit-a&patientId=patient-a' });
    // Exact authority hooks withhold their projection until the live lookup settles.
    await screen.findByText(/Verifying visit access/i);
    authorizationMocks.visitState = success;
    await refreshSmartNote();
    await screen.findByRole('heading', { name: 'Saved visit note' });
    expect(screen.getByLabelText('Saved note text').textContent).toBe(SAVED_NOTE);
    const editor = screen.getByPlaceholderText(/enter bullet points or rough draft/i);
    await waitFor(() => expect(editor).toHaveValue(DRAFT_FILLED));
    await waitFor(() => expect(draftStorageMocks.save).toHaveBeenCalled());
    expect(JSON.parse(sessionStorage.getItem('smart_note_draft_v2:patient-a'))).toEqual(originalDraft);
    expect(authorizationMocks.persist).not.toHaveBeenCalled();
    expect(authorizationMocks.reviewAck).not.toHaveBeenCalled();
    expect(authorizationMocks.handoff).not.toHaveBeenCalled();
    await waitFor(() => expect(reviewButton()).toBeEnabled());
    fireEvent.click(reviewButton());
    const saveButton = await screen.findByRole('button', { name: 'Save test note' });
    fireEvent.click(saveButton);
    await screen.findByText('Test note fully saved');
    expect(screen.getByRole('button', { name: 'Save test note' })).toBe(saveButton);
    expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
    expect(screen.queryByText('73 bpm')).not.toBeInTheDocument();
    expect(screen.getByText(/Reopen this visit to load its current saved record/)).toBeInTheDocument();
    expect(authorizationMocks.persist).toHaveBeenCalledTimes(1);
    expect(authorizationMocks.persist.mock.calls[0][0]).toMatchObject({
      existingVisitId: 'visit-a', savedVisitId: null, patientId: 'patient-a', roughNote: DRAFT_FILLED,
      vitals: success.data.vital_signs, preserveExistingVitals: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Report test handoff' }));
    await waitFor(() => expect(authorizationMocks.handoff).toHaveBeenCalledWith({
      visitId: 'visit-a', nextStatus: 'copied_to_emr',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge test review' }));
    await waitFor(() => expect(authorizationMocks.reviewAck).toHaveBeenCalledWith({
      visitId: 'visit-a', acknowledged: true, nurseEdited: false, noteText: DRAFT_FILLED,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(await screen.findByPlaceholderText(/enter bullet points or rough draft/i)).toHaveValue(DRAFT_FILLED);
    expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Discard test note' }));
    expect(await screen.findByPlaceholderText(/enter bullet points or rough draft/i)).toHaveValue('');
    expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
    expect(screen.getByText(/Reopen this visit to load its current saved record/)).toBeInTheDocument();
    expect(authorizationMocks.persist).toHaveBeenCalledTimes(1);
  });

  it('retires the old saved projection after an uncertain same-Visit write while keeping review and retry intact', async () => {
    const expectedError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const success = completedVisit();
    authorizationMocks.visitId = 'visit-a';
    authorizationMocks.persist.mockImplementationOnce(async ({ saveProgress }) => {
      saveProgress.visitId = 'visit-a';
      throw new PartialVisitSaveError(saveProgress, ['documentation']);
    }).mockImplementationOnce(async ({ saveProgress }) => ({
      mode: 'update', visitId: saveProgress.visitId, auditId: 'audit-a',
      finalText: DRAFT_FILLED, coverageScore: 88,
    }));
    const mounted = renderWithProviders(<SmartNoteHarness />);
    await screen.findByText(/Verifying visit access/i);
    authorizationMocks.visitState = success;
    await refreshSmartNote();
    await screen.findByRole('heading', { name: 'Saved visit note' });
    await typeDraft(DRAFT_FILLED);
    await waitFor(() => expect(draftStorageMocks.save).toHaveBeenCalled());
    fireEvent.click(reviewButton());
    const saveButton = await screen.findByRole('button', { name: 'Save test note' });
    fireEvent.click(saveButton);
    await screen.findByText(/latest changes could not be confirmed/);
    expect(screen.getByRole('button', { name: 'Save test note' })).toBe(saveButton);
    expect(screen.queryByText('Test note fully saved')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
    expect(screen.queryByText('73 bpm')).not.toBeInTheDocument();
    expect(screen.getByText(/Reopen this visit to load its current saved record/)).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('smart_note_draft_v2:patient-a')).note).toBe(DRAFT_FILLED);
    expect(draftStorageMocks.remove).not.toHaveBeenCalled();
    const firstSave = authorizationMocks.persist.mock.calls[0][0];
    expect(firstSave.existingVisitId).toBe('visit-a');
    fireEvent.click(saveButton);
    await screen.findByText('Test note fully saved');
    const retrySave = authorizationMocks.persist.mock.calls[1][0];
    expect(retrySave.savedVisitId).toBe('visit-a');
    expect(retrySave.saveProgress).toBe(firstSave.saveProgress);
    expect(screen.getByRole('button', { name: 'Save test note' })).toBe(saveButton);
    expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
    expect(expectedError).toHaveBeenCalledTimes(1);
    expect(expectedError.mock.calls[0][1]).toBeInstanceOf(PartialVisitSaveError);
    expectedError.mockRestore();

    // A fresh component displays only its newly authorized projection.
    mounted.unmount();
    authorizationMocks.visitState = { data: undefined, isSuccess: false, isError: false, tenantScope: null };
    renderWithProviders(<SmartNoteHarness />);
    await screen.findByText(/Verifying visit access/i);
    authorizationMocks.visitState = {
      ...success, data: { ...success.data, nurse_notes: DRAFT_FILLED,
        updated_date: '2026-09-17T15:35:00.000Z', vital_signs: { heart_rate: 75 } },
    };
    await refreshSmartNote();
    await screen.findByRole('heading', { name: 'Saved visit note' });
    expect(screen.getByLabelText('Saved note text').textContent).toBe(DRAFT_FILLED);
    expect(screen.getByText('75 bpm')).toBeInTheDocument();
    expect(screen.queryByText('73 bpm')).not.toBeInTheDocument();
    expect(authorizationMocks.persist).toHaveBeenCalledTimes(2);
  });

  it('displays the exact authorized saved record while note history is pending or unavailable', async () => {
    let rejectHistory;
    authorizationMocks.history.mockReturnValue(new Promise((_resolve, reject) => { rejectHistory = reject; }));
    authorizationMocks.visitState = completedVisit();
    authorizationMocks.visitId = 'visit-a';
    renderWithProviders(<SmartNoteHarness />);
    await screen.findByRole('heading', { name: 'Saved visit note' });
    await typeDraft(DRAFT_FILLED);
    expect(screen.getByLabelText('Saved note text').textContent).toBe(SAVED_NOTE);
    expect(screen.getByText('73 bpm')).toBeInTheDocument();
    expect(reviewButton()).toBeDisabled();
    await act(async () => { rejectHistory(new Error('History temporarily unavailable')); });
    await screen.findByText(/Patient chart access could not be verified/);
    expect(screen.getByLabelText('Saved note text').textContent).toBe(SAVED_NOTE);
    expect(screen.getByText('73 bpm')).toBeInTheDocument();
    expect(reviewButton()).toBeDisabled();
    expect(authorizationMocks.persist).not.toHaveBeenCalled();
  });

  it('merges explicit vital edits and clears with the bound record through recheck and structured drafting', async () => {
    const success = completedVisit();
    authorizationMocks.visitState = success;
    authorizationMocks.visitId = 'visit-a';
    authorizationMocks.persist.mockResolvedValue({ mode: 'update', visitId: 'visit-a', finalText: DRAFT_FILLED });
    renderWithProviders(<SmartNoteHarness />);
    await screen.findByRole('heading', { name: 'Saved visit note' });
    const heart = await openVitals();
    expect(heart).toHaveValue(73);
    expect(screen.getByLabelText('Pain Level (0-10)')).toHaveValue(0);
    fireEvent.change(heart, { target: { value: '81' } });
    fireEvent.change(screen.getByLabelText('Pain Level (0-10)'), { target: { value: '' } });
    authorizationMocks.visitState = { data: undefined, isSuccess: false, isError: false, tenantScope: null };
    await refreshSmartNote();
    expect(screen.queryByLabelText('Heart Rate')).not.toBeInTheDocument();
    authorizationMocks.visitState = { ...success, data: { ...success.data } };
    await refreshSmartNote();
    expect(await openVitals()).toHaveValue(81);
    expect(screen.getByLabelText('Pain Level (0-10)')).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Structured draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use structured test draft' }));
    expect(await openVitals()).toHaveValue(84);
    expect(screen.getByLabelText('Pain Level (0-10)')).toHaveValue(null);
    await waitFor(() => expect(reviewButton()).toBeEnabled());
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Save test note' }));
    await screen.findByText('Test note fully saved');
    expect(authorizationMocks.persist.mock.calls[0][0]).toMatchObject({
      existingVisitId: 'visit-a', preserveExistingVitals: false,
      vitals: { heart_rate: 84, pain_level: null, weight: 147.5 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(await openVitals()).toHaveValue(84);
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Discard test note' }));
    expect(await openVitals()).toHaveValue(null);
    authorizationMocks.visitState = { ...success, data: { ...success.data } };
    await refreshSmartNote();
    expect(await openVitals()).toHaveValue(null);
  });

  it('blocks a known newer source from being overwritten while preserving the current vital draft', async () => {
    const success = completedVisit();
    authorizationMocks.visitState = success;
    authorizationMocks.visitId = 'visit-a';
    renderWithProviders(<SmartNoteHarness />);
    await screen.findByRole('heading', { name: 'Saved visit note' });
    await typeDraft(DRAFT_FILLED);
    fireEvent.change(await openVitals(), { target: { value: '81' } });
    fireEvent.click(reviewButton());
    const saveButton = await screen.findByRole('button', { name: 'Save test note' });
    authorizationMocks.visitState = { ...success, data: { ...success.data,
      updated_date: '2026-09-17T15:32:00.000Z', vital_signs: { heart_rate: 99, pain_level: 5, weight: 160 } } };
    await refreshSmartNote();
    expect(screen.getByText(/This visit changed while you were editing vital signs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save test note' })).toBe(saveButton);
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(authorizationMocks.persist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(await openVitals()).toHaveValue(81);
    expect(screen.getByPlaceholderText(/enter bullet points or rough draft/i)).toHaveValue(DRAFT_FILLED);
    expect(reviewButton()).toBeDisabled();
  });

  it('retains the pending receipt when a fresh authorized record confirms our own vital write', async () => {
    const expectedError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const success = completedVisit();
    authorizationMocks.visitState = success;
    authorizationMocks.visitId = 'visit-a';
    authorizationMocks.persist.mockImplementationOnce(async ({ saveProgress }) => {
      saveProgress.visitId = 'visit-a';
      saveProgress.documentationKey = 'confirmed-documentation';
      throw new PartialVisitSaveError(saveProgress, ['history']);
    }).mockImplementationOnce(async ({ saveProgress }) => ({
      mode: 'update', visitId: saveProgress.visitId, finalText: DRAFT_FILLED,
    }));
    renderWithProviders(<SmartNoteHarness />);
    await screen.findByRole('heading', { name: 'Saved visit note' });
    await typeDraft(DRAFT_FILLED);
    fireEvent.change(await openVitals(), { target: { value: '81' } });
    fireEvent.change(screen.getByLabelText('Pain Level (0-10)'), { target: { value: '' } });
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Save test note' }));
    await screen.findByText(/some supporting records could not be confirmed/);
    const first = authorizationMocks.persist.mock.calls[0][0];
    authorizationMocks.visitState = { ...success, data: { ...success.data,
      updated_date: '2026-09-17T15:32:00.000Z', vital_signs: { heart_rate: 81, weight: 147.5 } } };
    await refreshSmartNote();
    const retry = screen.getByRole('button', { name: 'Save test note' });
    expect(retry).toBeEnabled();
    expect(screen.queryByText(/This visit changed while you were editing vital signs/)).not.toBeInTheDocument();
    fireEvent.click(retry);
    await screen.findByText('Test note fully saved');
    expect(authorizationMocks.persist.mock.calls[1][0]).toMatchObject({
      savedVisitId: 'visit-a', saveProgress: first.saveProgress,
      preserveExistingVitals: false, vitals: { heart_rate: 81, pain_level: null, weight: 147.5 },
    });
    expect(authorizationMocks.persist.mock.calls[1][0].saveProgress).toBe(first.saveProgress);
    expect(expectedError).toHaveBeenCalledTimes(1);
    expect(expectedError.mock.calls[0][1]).toBeInstanceOf(PartialVisitSaveError);
    expectedError.mockRestore();
  });

  it('does not carry saved vital edits into another Visit for the same patient', async () => {
    const success = completedVisit();
    authorizationMocks.visitState = success;
    authorizationMocks.visitId = 'visit-a';
    renderWithProviders(<SmartNoteHarness />);
    await screen.findByRole('heading', { name: 'Saved visit note' });
    fireEvent.change(await openVitals(), { target: { value: '81' } });
    authorizationMocks.visitId = 'visit-b';
    authorizationMocks.visitState = { ...success, data: { ...success.data, id: 'visit-b', vital_signs: { heart_rate: 62 } } };
    await refreshSmartNote();
    expect(await openVitals()).toHaveValue(62);
    expect(screen.getByLabelText('Pain Level (0-10)')).toHaveValue(null);
  });

  it('withholds saved note and vitals during a Visit recheck and after a settled denial', async () => {
    const success = completedVisit();
    authorizationMocks.visitState = success;
    authorizationMocks.visitId = 'visit-a';
    renderWithProviders(<SmartNoteHarness />);
    await screen.findByRole('heading', { name: 'Saved visit note' });
    await typeDraft(DRAFT_FILLED);
    await waitFor(() => expect(draftStorageMocks.save).toHaveBeenCalled());
    authorizationMocks.visitState = { data: undefined, isSuccess: false, isError: false, tenantScope: null };
    await refreshSmartNote();
    expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
    expect(screen.queryByText('73 bpm')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/enter bullet points or rough draft/i)).not.toBeInTheDocument();
    authorizationMocks.visitState = success;
    await refreshSmartNote();
    await screen.findByRole('heading', { name: 'Saved visit note' });
    expect(screen.getByPlaceholderText(/enter bullet points or rough draft/i)).toHaveValue(DRAFT_FILLED);
    authorizationMocks.visitState = { data: undefined, isSuccess: false, isError: true, tenantScope: null };
    await refreshSmartNote();
    expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
    expect(screen.queryByText('73 bpm')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-a')).toBeNull();
    expect(authorizationMocks.persist).not.toHaveBeenCalled();
  });

  it('withholds the saved Visit projection when the current Patient grant is pending or denied', async () => {
    authorizationMocks.visitState = completedVisit();
    authorizationMocks.visitId = 'visit-a';
    renderWithProviders(<SmartNoteHarness />);
    await screen.findByRole('heading', { name: 'Saved visit note' });
    for (const isError of [false, true]) {
      authorizationMocks.patientState = { data: undefined, isSuccess: false, isError, tenantScope: null };
      await refreshSmartNote();
      expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
      expect(screen.queryByText('73 bpm')).not.toBeInTheDocument();
      expect(reviewButton()).toBeDisabled();
    }
    expect(authorizationMocks.persist).not.toHaveBeenCalled();
  });

  it.each([
    ['subject change', () => { authorizationMocks.tenantContext = { ...authorizationMocks.tenantContext, user_id: 'user-b' }; }],
    ['membership version change', () => { authorizationMocks.tenantContext = { ...authorizationMocks.tenantContext, membership_version: 8 }; }],
    ['expired session lease', () => { draftStorageMocks.isLeaseCurrent.mockReturnValue(false); }],
    ['navigation to another Visit', () => { authorizationMocks.visitId = 'visit-b'; }],
  ])('hides a previously displayed saved note immediately on %s despite cached successful projections', async (_label, invalidate) => {
    authorizationMocks.visitState = completedVisit();
    authorizationMocks.visitId = 'visit-a';
    renderWithProviders(<SmartNoteHarness />);
    await screen.findByRole('heading', { name: 'Saved visit note' });
    fireEvent.change(await openVitals(), { target: { value: '81' } });
    invalidate();
    await refreshSmartNote();
    expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
    expect(screen.queryByText('73 bpm')).not.toBeInTheDocument();
    const hiddenVital = screen.queryByLabelText('Heart Rate');
    if (hiddenVital) expect(hiddenVital).toHaveValue(null);
    expect(authorizationMocks.persist).not.toHaveBeenCalled();
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
  it('keeps the partial Visit and request identity through Retry and returning to review', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    authorizationMocks.persist.mockImplementationOnce(async ({ saveProgress }) => {
      saveProgress.visitId = 'partial-visit';
      saveProgress.auditId = 'confirmed-audit';
      throw new PartialVisitSaveError(saveProgress, ['history']);
    }).mockImplementationOnce(async ({ saveProgress }) => ({
      mode: 'update', visitId: saveProgress.visitId, auditId: saveProgress.auditId,
      finalText: DRAFT_FILLED, coverageScore: 88,
    }));
    renderWithProviders(<SmartNoteAssistant />, { route: '/SmartNoteAssistant?patientId=patient-a' });
    await typeDraft(DRAFT_FILLED);
    await waitFor(() => expect(reviewButton()).toBeEnabled());
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Save test note' }));
    expect(await screen.findByText(/The visit is saved, but some supporting records/)).toBeInTheDocument();
    expect(screen.queryByText('Test note fully saved')).not.toBeInTheDocument();
    expect(draftStorageMocks.remove).not.toHaveBeenCalled();
    const first = authorizationMocks.persist.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(await screen.findByPlaceholderText(/enter bullet points or rough draft/i)).toHaveValue(DRAFT_FILLED);
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Save test note' }));
    expect(await screen.findByText('Test note fully saved')).toBeInTheDocument();
    const retry = authorizationMocks.persist.mock.calls[1][0];
    expect(retry.savedVisitId).toBe('partial-visit');
    expect(retry.savedAuditId).toBe('confirmed-audit');
    expect(retry.saveProgress).toBe(first.saveProgress);
  });

  it('starts a new creation identity only after the prior draft is discarded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    authorizationMocks.persist.mockRejectedValue(new Error('response lost'));
    renderWithProviders(<SmartNoteAssistant />, { route: '/SmartNoteAssistant?patientId=patient-a' });
    await typeDraft(DRAFT_FILLED);
    await waitFor(() => expect(reviewButton()).toBeEnabled());
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Save test note' }));
    await waitFor(() => expect(authorizationMocks.persist).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save test note' })).toBeEnabled());
    const first = authorizationMocks.persist.mock.calls[0][0].saveProgress;
    fireEvent.click(screen.getByRole('button', { name: 'Discard test note' }));
    await typeDraft(DRAFT_FILLED);
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Save test note' }));
    await waitFor(() => expect(authorizationMocks.persist).toHaveBeenCalledTimes(2));
    expect(authorizationMocks.persist.mock.calls[1][0].saveProgress.clientRequestId)
      .not.toBe(first.clientRequestId);
  });

  it('attaches pre-save handoff and review once when a partially saved Visit first completes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    authorizationMocks.persist.mockImplementationOnce(async ({ saveProgress }) => {
      saveProgress.visitId = 'partial-visit';
      throw new PartialVisitSaveError(saveProgress, ['history']);
    }).mockImplementationOnce(async ({ saveProgress }) => ({
      mode: 'create', visitId: saveProgress.visitId, auditId: 'confirmed-audit',
      finalText: DRAFT_FILLED, coverageScore: 88,
    })).mockImplementationOnce(async ({ saveProgress }) => ({
      mode: 'update', visitId: saveProgress.visitId, auditId: 'confirmed-audit',
      finalText: DRAFT_FILLED, coverageScore: 88,
    }));
    renderWithProviders(<SmartNoteAssistant />, { route: '/SmartNoteAssistant?patientId=patient-a' });
    await typeDraft(DRAFT_FILLED);
    await waitFor(() => expect(reviewButton()).toBeEnabled());
    fireEvent.click(reviewButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Report test handoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge test review' }));
    expect(authorizationMocks.handoff).not.toHaveBeenCalled();
    expect(authorizationMocks.reviewAck).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save test note' }));
    expect(await screen.findByText(/The visit is saved, but some supporting records/)).toBeInTheDocument();
    expect(authorizationMocks.handoff).not.toHaveBeenCalled();
    expect(authorizationMocks.reviewAck).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save test note' }));
    expect(await screen.findByText('Test note fully saved')).toBeInTheDocument();
    expect(authorizationMocks.persist.mock.calls[1][0].savedVisitId).toBe('partial-visit');
    await waitFor(() => expect(authorizationMocks.reviewAck).toHaveBeenCalledTimes(1));
    expect(authorizationMocks.handoff).toHaveBeenCalledExactlyOnceWith({
      visitId: 'partial-visit', nextStatus: 'copied_to_emr',
    });
    expect(authorizationMocks.reviewAck).toHaveBeenCalledWith({
      visitId: 'partial-visit', acknowledged: true, nurseEdited: false, noteText: DRAFT_FILLED,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save test note' }));
    await waitFor(() => expect(authorizationMocks.persist).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('Test note fully saved')).toBeInTheDocument();
    expect(authorizationMocks.handoff).toHaveBeenCalledTimes(1);
    expect(authorizationMocks.reviewAck).toHaveBeenCalledTimes(1);
  });

});
