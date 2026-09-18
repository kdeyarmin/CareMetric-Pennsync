import { useState } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/testUtils';

const audioMocks = vi.hoisted(() => ({
  visitId: null,
  visitState: null,
  forceRender: null,
  uploadFile: vi.fn(),
  invoke: vi.fn(),
  persist: vi.fn(),
  leaseCurrent: true,
  patientAllowed: true,
}));

const scope = {
  user_id: 'user-a',
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 7,
  tenant_role: 'clinician',
};

const patients = {
  'patient-a': {
    id: 'patient-a',
    first_name: 'Ada',
    last_name: 'Lovelace',
    status: 'active',
    care_type: 'home_health',
    primary_diagnosis: 'I10',
    updated_date: '2026-09-07T12:00:00.000Z',
  },
  'patient-b': {
    id: 'patient-b',
    first_name: 'Grace',
    last_name: 'Hopper',
    status: 'active',
    care_type: 'home_health',
    primary_diagnosis: 'J44',
    updated_date: '2026-09-07T12:00:00.000Z',
  },
};

vi.mock('@/api/base44Client', async () => {
  const { makeBase44Stub } = await vi.importActual('@/test/testUtils');
  return {
    base44: makeBase44Stub({
      functions: { invoke: audioMocks.invoke },
      integrations: { Core: { UploadFile: audioMocks.uploadFile } },
    }),
  };
});

vi.mock('@/lib/phiStorage', () => ({
  captureAuthorityDraftLease: () => Object.freeze({ epoch: 42 }),
  isAuthorityDraftLeaseCurrent: () => audioMocks.leaseCurrent,
}));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ tenantContext: scope }) }));

vi.mock('@/hooks/useScopedPatients', () => ({
  useScopedPatients: () => ({ data: Object.values(patients) }),
}));

vi.mock('@/hooks/useAuthorizedPatient', () => ({
  useAuthorizedPatient: ({ patientId, enabled }) => (
    enabled && audioMocks.patientAllowed && patients[patientId]
      ? { data: patients[patientId], isSuccess: true, isError: false, tenantScope: scope }
      : { data: undefined, isSuccess: false, isError: false, tenantScope: null }
  ),
}));

vi.mock('@/hooks/useAuthorizedVisit', () => ({
  useAuthorizedVisit: () => audioMocks.visitState,
}));

vi.mock('@/functions/getAuthorizedPatientNoteHistory', () => ({
  getAuthorizedPatientNoteHistory: async ({ patientId }) => ({
    success: true,
    patient_id: patientId,
    entries: [],
  }),
}));

vi.mock('../utils/activityLogger', () => ({
  logActivity: vi.fn(),
  ActivityActions: { NOTE_AI_GENERATED: 'note_ai_generated' },
}));

vi.mock('./AudioRecorder', () => ({
  default: ({ onAudioProcessed, isProcessing }) => (
    <button
      type="button"
      disabled={isProcessing}
      onClick={() => onAudioProcessed(new Blob(['audio'], { type: 'audio/webm' }))}
    >
      Record test audio
    </button>
  ),
}));

vi.mock('@/components/ui/SearchablePatientSelect', () => ({
  default: ({ patients: options, value, onValueChange }) => (
    <select
      aria-label="Patient"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">Select</option>
      {options.map((patient) => (
        <option key={patient.id} value={patient.id}>
          {patient.first_name} {patient.last_name}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../smartNote/ConstrainedNoteReviewer', () => ({
  default: ({ roughNote, renderFinalNote }) => <>
    <div data-testid="reviewer-note">{roughNote}</div>
    {renderFinalNote({ finalNote: roughNote, coverage: 88, result: { finalNote: roughNote } })}
  </>,
}));

vi.mock('../smartNote/FinalNoteDisplay', () => ({
  default: ({ onSave, onReset, saveDisabled, saved }) => <>
    <button disabled={saveDisabled} onClick={onSave}>Save test note</button>
    <button onClick={onReset}>Discard test note</button>
    {saved && <span>Test note fully saved</span>}
  </>,
}));

vi.mock('../smartNote/persistVisitNote', async (importOriginal) => ({
  ...await importOriginal(),
  persistVisitNote: audioMocks.persist,
}));

import { PartialVisitSaveError } from '../smartNote/persistVisitNote';

const { default: AudioVisitCapture } = await import('./AudioVisitCapture.jsx');

function AudioHarness() {
  const [, setRevision] = useState(0);
  audioMocks.forceRender = () => setRevision((value) => value + 1);
  return (
    <AudioVisitCapture
      currentUser={{
        id: 'user-a',
        email: 'clinician@example.com',
        care_scope: 'home_health',
      }}
      visitId={audioMocks.visitId}
    />
  );
}

async function refreshAudio() {
  await act(async () => {
    audioMocks.forceRender();
  });
}

function visitSuccess() {
  return {
    data: {
      id: 'visit-a',
      patient_id: 'patient-a',
      visit_type: 'routine_visit',
    },
    isSuccess: true,
    isError: false,
    tenantScope: scope,
  };
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

describe('AudioVisitCapture authority binding', () => {
  beforeEach(() => {
    audioMocks.visitId = null;
    audioMocks.leaseCurrent = true;
    audioMocks.patientAllowed = true;
    audioMocks.persist.mockReset();
    audioMocks.forceRender = null;
    audioMocks.visitState = {
      data: undefined,
      isSuccess: false,
      isError: false,
      tenantScope: null,
    };
    audioMocks.uploadFile.mockReset().mockResolvedValue({ file_url: 'blob:test-audio' });
    audioMocks.invoke.mockReset().mockResolvedValue({
      data: { transcription: 'Authorized transcription.' },
    });
  });

  it('preserves the same patient and vitals across a successful Visit recheck', async () => {
    audioMocks.visitId = 'visit-a';
    audioMocks.visitState = visitSuccess();
    renderWithProviders(<AudioHarness />);

    const systolic = await screen.findByLabelText('BP Systolic');
    fireEvent.change(systolic, { target: { value: '120' } });
    expect(systolic).toHaveValue(120);
    expect(screen.getByLabelText('Patient')).toHaveValue('patient-a');

    audioMocks.visitState = {
      data: undefined,
      isSuccess: false,
      isError: false,
      tenantScope: null,
    };
    await refreshAudio();
    expect(screen.getByText(/Verifying visit access/i)).toBeInTheDocument();

    audioMocks.visitState = visitSuccess();
    await refreshAudio();
    await waitFor(() => expect(screen.getByLabelText('BP Systolic')).toHaveValue(120));
    expect(screen.getByLabelText('Patient')).toHaveValue('patient-a');
  });

  it('hides and clears patient-bound audio state after a settled Visit denial', async () => {
    audioMocks.visitId = 'visit-a';
    audioMocks.visitState = visitSuccess();
    renderWithProviders(<AudioHarness />);
    const systolic = await screen.findByLabelText('BP Systolic');
    fireEvent.change(systolic, { target: { value: '120' } });

    audioMocks.visitState = {
      data: undefined,
      isSuccess: false,
      isError: true,
      tenantScope: null,
    };
    await refreshAudio();
    expect(screen.getByText(/Visit access could not be verified/i)).toBeInTheDocument();

    audioMocks.visitId = null;
    audioMocks.visitState = {
      data: undefined,
      isSuccess: false,
      isError: false,
      tenantScope: null,
    };
    await refreshAudio();
    await waitFor(() => expect(screen.getByLabelText('Patient')).toHaveValue(''));
    expect(screen.getByLabelText('BP Systolic')).toHaveValue(null);
    expect(screen.queryByTestId('reviewer-note')).not.toBeInTheDocument();
  });

  it.each([false, true])('preserves saved audio-Visit vitals, including weight, when edited=%s', async (edit) => {
    audioMocks.visitId = 'visit-a';
    audioMocks.visitState = { ...visitSuccess(), data: { ...visitSuccess().data,
      vital_signs: { heart_rate: 73, pain_level: 0, weight: 147.5 }, updated_date: '2026-09-17T15:30:00.000Z' } };
    audioMocks.persist.mockResolvedValue({ mode: 'update', visitId: 'visit-a' });
    renderWithProviders(<AudioHarness />);
    await waitFor(() => expect(screen.getByLabelText('Heart Rate')).toHaveValue(73));
    expect(screen.getByLabelText('Pain Level (0-10)')).toHaveValue(0);
    if (edit) {
      fireEvent.change(screen.getByLabelText('Heart Rate'), { target: { value: '81' } });
      fireEvent.change(screen.getByLabelText('Pain Level (0-10)'), { target: { value: '' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Record test audio' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save test note' }));
    await screen.findByText('Test note fully saved');
    expect(audioMocks.persist.mock.calls[0][0]).toMatchObject({
      existingVisitId: 'visit-a', preserveExistingVitals: !edit,
      vitals: { heart_rate: edit ? 81 : 73, pain_level: edit ? null : 0, weight: 147.5 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard test note' }));
    expect(screen.getByLabelText('Heart Rate')).toHaveValue(null);
    audioMocks.visitState = { ...audioMocks.visitState, data: { ...audioMocks.visitState.data } };
    await refreshAudio();
    expect(screen.getByLabelText('Heart Rate')).toHaveValue(null);
  });

  it.each(['patient', 'lease'])('hides saved audio-Visit baseline when %s authority becomes unavailable', async (boundary) => {
    audioMocks.visitId = 'visit-a';
    audioMocks.visitState = { ...visitSuccess(), data: { ...visitSuccess().data,
      vital_signs: { heart_rate: 73 }, updated_date: '2026-09-17T15:30:00.000Z' } };
    renderWithProviders(<AudioHarness />);
    await waitFor(() => expect(screen.getByLabelText('Heart Rate')).toHaveValue(73));
    fireEvent.change(screen.getByLabelText('Heart Rate'), { target: { value: '81' } });
    if (boundary === 'patient') audioMocks.patientAllowed = false;
    else audioMocks.leaseCurrent = false;
    await refreshAudio();
    if (boundary === 'patient') expect(screen.queryByLabelText('Heart Rate')).not.toBeInTheDocument();
    else expect(screen.getByLabelText('Heart Rate')).toHaveValue(null);
    expect(audioMocks.persist).not.toHaveBeenCalled();
  });

  it('blocks an audio revision after a known source-version change without losing the working review', async () => {
    audioMocks.visitId = 'visit-a';
    audioMocks.visitState = { ...visitSuccess(), data: { ...visitSuccess().data,
      vital_signs: { heart_rate: 73, weight: 147.5 }, updated_date: '2026-09-17T15:30:00.000Z' } };
    renderWithProviders(<AudioHarness />);
    await waitFor(() => expect(screen.getByLabelText('Heart Rate')).toHaveValue(73));
    fireEvent.change(screen.getByLabelText('Heart Rate'), { target: { value: '81' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record test audio' }));
    const saveButton = await screen.findByRole('button', { name: 'Save test note' });
    audioMocks.visitState = { ...audioMocks.visitState, data: { ...audioMocks.visitState.data,
      vital_signs: { heart_rate: 73, weight: 160 }, updated_date: '2026-09-17T15:32:00.000Z' } };
    await refreshAudio();
    expect(screen.getByText(/This visit changed while you were editing vital signs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save test note' })).toBe(saveButton);
    expect(saveButton).toBeDisabled();
    expect(screen.getByTestId('reviewer-note')).toHaveTextContent('Authorized transcription.');
    fireEvent.click(saveButton);
    expect(audioMocks.persist).not.toHaveBeenCalled();
  });

  it('clears Patient A output on a real switch to Patient B', async () => {
    renderWithProviders(<AudioHarness />);
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'patient-a' } });
    await screen.findByLabelText('BP Systolic');
    fireEvent.click(screen.getByRole('button', { name: 'Record test audio' }));
    expect(await screen.findByTestId('reviewer-note')).toHaveTextContent('Authorized transcription.');

    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'patient-b' } });
    await waitFor(() => expect(screen.getByLabelText('Patient')).toHaveValue('patient-b'));
    expect(screen.queryByText('Authorized transcription.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reviewer-note')).not.toBeInTheDocument();
  });

  it('discards a late Patient A transcription after switching to Patient B', async () => {
    const recording = deferred();
    audioMocks.invoke.mockReturnValue(recording.promise);
    renderWithProviders(<AudioHarness />);
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'patient-a' } });
    await screen.findByLabelText('BP Systolic');
    fireEvent.click(screen.getByRole('button', { name: 'Record test audio' }));
    await waitFor(() => expect(audioMocks.invoke).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'patient-b' } });
    await waitFor(() => expect(screen.getByLabelText('Patient')).toHaveValue('patient-b'));
    await act(async () => {
      recording.resolve({ data: { transcription: 'Patient A secret transcription.' } });
      await recording.promise;
    });

    expect(screen.queryByText('Patient A secret transcription.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reviewer-note')).not.toBeInTheDocument();
  });
  it('retains the confirmed partial Visit and audit when the supporting write is retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    audioMocks.persist.mockImplementationOnce(async ({ saveProgress }) => {
      saveProgress.visitId = 'partial-audio-visit';
      saveProgress.auditId = 'confirmed-audit';
      throw new PartialVisitSaveError(saveProgress, ['history']);
    }).mockImplementationOnce(async ({ saveProgress }) => ({
      mode: 'create', visitId: saveProgress.visitId, auditId: saveProgress.auditId,
    }));
    renderWithProviders(<AudioHarness />);
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'patient-a' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Record test audio' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save test note' }));
    expect(await screen.findByText(/The visit is saved, but some supporting records/)).toBeInTheDocument();
    expect(screen.getByTestId('reviewer-note')).toHaveTextContent('Authorized transcription.');
    expect(screen.queryByText('Test note fully saved')).not.toBeInTheDocument();
    const first = audioMocks.persist.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Save test note' }));
    expect(await screen.findByText('Test note fully saved')).toBeInTheDocument();
    const retry = audioMocks.persist.mock.calls[1][0];
    expect(retry.savedVisitId).toBe('partial-audio-visit');
    expect(retry.savedAuditId).toBe('confirmed-audit');
    expect(retry.saveProgress).toBe(first.saveProgress);
  });

});
