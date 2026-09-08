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

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ tenantContext: scope }) }));

vi.mock('@/hooks/useScopedPatients', () => ({
  useScopedPatients: () => ({ data: Object.values(patients) }),
}));

vi.mock('@/hooks/useAuthorizedPatient', () => ({
  useAuthorizedPatient: ({ patientId, enabled }) => (
    enabled && patients[patientId]
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
  default: ({ roughNote }) => <div data-testid="reviewer-note">{roughNote}</div>,
}));

vi.mock('../smartNote/FinalNoteDisplay', () => ({ default: () => null }));

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
});
