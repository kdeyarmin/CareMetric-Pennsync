import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

const {
  patientCreate,
  referralCreate,
  taskCreate,
  toastSuccess,
  toastError,
  analysisState,
  tenantState,
} = vi.hoisted(() => ({
  patientCreate: vi.fn(async () => ({ id: 'patient-1' })),
  referralCreate: vi.fn(async () => ({ id: 'referral-1' })),
  taskCreate: vi.fn(async () => ({ id: 'task-1' })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  analysisState: { value: null },
  tenantState: { value: { agency_id: 'agency-a', tenant_role: 'manager' } },
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ tenantContext: tenantState.value }),
}));

vi.mock('@/functions/manageAuthorizedReferral', () => ({
  createAuthorizedReferral: (referral, options) => referralCreate(referral, options),
}));

vi.mock('@/api/base44Client', () => {
  const entities = new Proxy({}, {
    get: (_t, name) => {
      if (name === 'Patient') return { create: patientCreate };
      if (name === 'Task') return { create: taskCreate };
      return { create: vi.fn(async () => ({})), filter: vi.fn(async () => []), list: vi.fn(async () => []) };
    },
  });
  return {
    base44: {
      entities,
      functions: {
        invoke: async (name, payload) => {
          if (name === 'createAuthorizedPatient') {
            return { data: { patient: await patientCreate(payload) } };
          }
          return { data: {} };
        },
      },
      auth: { me: async () => ({ email: 'nurse@x.com', role: 'nurse' }) },
    },
  };
});

vi.mock('@/components/referral/ReferralTriageAnalyzer', () => ({
  default: ({ onTriageComplete, onTriageReset }) => (
    <>
      <button onClick={() => onTriageComplete(analysisState.value)}>run-triage</button>
      <button onClick={() => onTriageReset?.()}>new-packet</button>
    </>
  ),
}));

import ReferralTriage from '@/pages/ReferralTriage';

const COMPLETE_ANALYSIS = {
  patient_name: 'Jane Doe',
  date_of_birth: '1950-05-01',
  primary_diagnosis: 'CHF',
  secondary_diagnoses: ['COPD'],
  clinical_summary: 'Referred for skilled nursing.',
  // A legacy stored analysis can still carry this (D234 removed the level);
  // the create path must ignore it entirely — no referral priority, no
  // urgency-derived task priority or timeframe.
  urgency_level: 'CRITICAL',
};

beforeEach(() => {
  analysisState.value = { ...COMPLETE_ANALYSIS };
  tenantState.value = { agency_id: 'agency-a', tenant_role: 'manager' };
  patientCreate.mockClear();
  referralCreate.mockClear();
  taskCreate.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe('ReferralTriage — create patient from triage', () => {
  it('blocks non-intake roles before any patient or referral write', () => {
    tenantState.value = { agency_id: 'agency-a', tenant_role: 'clinician' };
    renderWithProviders(<ReferralTriage />);

    expect(screen.getByText('Referral triage unavailable')).toBeInTheDocument();
    expect(screen.queryByText('run-triage')).not.toBeInTheDocument();
    expect(patientCreate).not.toHaveBeenCalled();
    expect(referralCreate).not.toHaveBeenCalled();
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('creates a Patient, linked Referral, and task when minimum identity is present', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReferralTriage />);

    await user.click(screen.getByText('run-triage'));
    const createBtn = await screen.findByRole('button', { name: /Create Patient or Queue Referral/i });
    await user.click(createBtn);

    await waitFor(() => expect(patientCreate).toHaveBeenCalledTimes(1));
    expect(patientCreate.mock.calls[0][0]).toMatchObject({
      first_name: 'Jane',
      last_name: 'Doe',
      date_of_birth: '1950-05-01',
      primary_diagnosis: 'CHF',
      status: 'active',
      care_type: 'home_health',
      phone: null,
      address: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
    });

    await waitFor(() => expect(referralCreate).toHaveBeenCalledTimes(1));
    expect(referralCreate.mock.calls[0][0]).toMatchObject({ patient_id: 'patient-1', status: 'ready_for_admission' });
    // D234: no priority is written on the referral, and the admission task
    // keeps the flat staff default — the legacy CRITICAL level on the
    // analysis changes neither.
    expect(referralCreate.mock.calls[0][0]).not.toHaveProperty('priority');
    await waitFor(() => expect(taskCreate).toHaveBeenCalledTimes(1));
    expect(taskCreate.mock.calls[0][0]).toMatchObject({ priority: 'medium', status: 'pending', due_timeframe: 'this_week' });
    expect(taskCreate.mock.calls[0][0].description).not.toMatch(/Urgency/);

    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('ignores a document MRN carried by the analysis when creating the chart (D233)', async () => {
    // The analysis names the SENDING facility's MRN (Heritage Ridge's 13383).
    // It is not PennSync's number — MatrixCare assigns ours — so it must not
    // reach the created chart under either key the extractors have used.
    analysisState.value = { ...COMPLETE_ANALYSIS, medical_record_number: '13383', mrn: '13383' };
    const user = userEvent.setup();
    renderWithProviders(<ReferralTriage />);

    await user.click(screen.getByText('run-triage'));
    const createBtn = await screen.findByRole('button', { name: /Create Patient or Queue Referral/i });
    await user.click(createBtn);

    await waitFor(() => expect(patientCreate).toHaveBeenCalledTimes(1));
    const payload = patientCreate.mock.calls[0][0];
    expect(payload).not.toHaveProperty('medical_record_number');
    expect(JSON.stringify(payload)).not.toContain('13383');
  });

  it('drops the previous packet\'s create action as soon as a new packet starts', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReferralTriage />);

    await user.click(screen.getByText('run-triage'));
    expect(await screen.findByRole('button', { name: /Create Patient or Queue Referral/i })).toBeInTheDocument();

    await user.click(screen.getByText('new-packet'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Create Patient or Queue Referral/i })).toBeNull());
    expect(patientCreate).not.toHaveBeenCalled();
    expect(referralCreate).not.toHaveBeenCalled();
  });

  it('queues an awaiting-info referral instead of creating a placeholder patient when identity is incomplete', async () => {
    const user = userEvent.setup();
    analysisState.value = { ...COMPLETE_ANALYSIS, date_of_birth: 'Not provided', phone: '', address: '' };
    renderWithProviders(<ReferralTriage />);

    await user.click(screen.getByText('run-triage'));
    const createBtn = await screen.findByRole('button', { name: /Create Patient or Queue Referral/i });
    await user.click(createBtn);

    await waitFor(() => expect(referralCreate).toHaveBeenCalledTimes(1));
    expect(patientCreate).not.toHaveBeenCalled();
    expect(referralCreate.mock.calls[0][0]).toMatchObject({
      patient_name: 'Jane Doe',
      status: 'awaiting_info',
      requires_manual_review: true,
      assigned_to: 'nurse@x.com',
    });
    expect(referralCreate.mock.calls[0][0].extracted_data.missing_patient_identity).toEqual(['DOB, phone, or address']);
    expect(referralCreate.mock.calls[0][0]).not.toHaveProperty('priority');
    await waitFor(() => expect(taskCreate).toHaveBeenCalledTimes(1));
    expect(taskCreate.mock.calls[0][0]).toMatchObject({
      priority: 'medium',
      title: 'Complete referral identity: Jane Doe',
      // Must be a member of Task.type's schema enum — 'referral_follow_up' was
      // not, so the value never persisted. The referral linkage is carried by
      // related_entity / related_entity_id, not by the type.
      type: 'followup',
      related_entity: 'Referral',
      related_entity_id: 'referral-1',
    });
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Patient chart not created/));
  });
});
