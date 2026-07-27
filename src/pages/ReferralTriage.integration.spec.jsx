import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

const { patientCreate, referralCreate, taskCreate, toastSuccess, toastError, analysisState } = vi.hoisted(() => ({
  patientCreate: vi.fn(async () => ({ id: 'patient-1' })),
  referralCreate: vi.fn(async () => ({ id: 'referral-1' })),
  taskCreate: vi.fn(async () => ({ id: 'task-1' })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  analysisState: { value: null },
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock('@/api/base44Client', () => {
  const entities = new Proxy({}, {
    get: (_t, name) => {
      if (name === 'Patient') return { create: patientCreate };
      if (name === 'Referral') return { create: referralCreate };
      if (name === 'Task') return { create: taskCreate };
      return { create: vi.fn(async () => ({})), filter: vi.fn(async () => []), list: vi.fn(async () => []) };
    },
  });
  return { base44: { entities, auth: { me: async () => ({ email: 'nurse@x.com', role: 'nurse' }) } } };
});

vi.mock('@/components/referral/ReferralTriageAnalyzer', () => ({
  default: ({ onTriageComplete }) => (
    <button onClick={() => onTriageComplete(analysisState.value)}>run-triage</button>
  ),
}));

import ReferralTriage from '@/pages/ReferralTriage';

const COMPLETE_ANALYSIS = {
  patient_name: 'Jane Doe',
  date_of_birth: '1950-05-01',
  primary_diagnosis: 'CHF',
  secondary_diagnoses: ['COPD'],
  clinical_summary: 'Referred for skilled nursing.',
  urgency_level: 'CRITICAL',
};

beforeEach(() => {
  analysisState.value = { ...COMPLETE_ANALYSIS };
  patientCreate.mockClear();
  referralCreate.mockClear();
  taskCreate.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe('ReferralTriage — create patient from triage', () => {
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
    await waitFor(() => expect(taskCreate).toHaveBeenCalledTimes(1));
    expect(taskCreate.mock.calls[0][0]).toMatchObject({ priority: 'high', status: 'pending' });

    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
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
    expect(referralCreate.mock.calls[0][0].extracted_data.missing_patient_identity).toEqual(['DOB, MRN, phone, or address']);
    await waitFor(() => expect(taskCreate).toHaveBeenCalledTimes(1));
    expect(taskCreate.mock.calls[0][0]).toMatchObject({
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
