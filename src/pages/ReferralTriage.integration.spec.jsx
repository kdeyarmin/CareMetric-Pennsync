import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

// Spies for the entity writes the triage→patient flow performs.
const { patientCreate, taskCreate, toastSuccess, toastError } = vi.hoisted(() => ({
  patientCreate: vi.fn(async () => ({ id: 'patient-1' })),
  taskCreate: vi.fn(async () => ({ id: 'task-1' })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock('@/api/base44Client', () => {
  const entities = new Proxy({}, {
    get: (_t, name) => {
      if (name === 'Patient') return { create: patientCreate };
      if (name === 'Task') return { create: taskCreate };
      return { create: vi.fn(async () => ({})), filter: vi.fn(async () => []), list: vi.fn(async () => []) };
    },
  });
  return { base44: { entities, auth: { me: async () => ({ email: 'nurse@x.com', role: 'nurse' }) } } };
});

// Stub the AI analyzer child: render a button that fires onTriageComplete with a
// fixed analysis, so this test exercises the page's create-from-triage flow
// without depending on the analyzer's internals or any LLM call.
const ANALYSIS = {
  patient_name: 'Jane Doe',
  date_of_birth: '1950-05-01',
  primary_diagnosis: 'CHF',
  secondary_diagnoses: ['COPD'],
  clinical_summary: 'Referred for skilled nursing.',
  urgency_level: 'CRITICAL',
};
vi.mock('@/components/referral/ReferralTriageAnalyzer', () => ({
  default: ({ onTriageComplete }) => (
    <button onClick={() => onTriageComplete(ANALYSIS)}>run-triage</button>
  ),
}));

import ReferralTriage from '@/pages/ReferralTriage';

beforeEach(() => {
  patientCreate.mockClear();
  taskCreate.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe('ReferralTriage — create patient from triage', () => {
  it('maps analysis to a Patient (with required-field placeholders) and a task', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReferralTriage />);

    // 1. Complete triage → the "Next Steps" action card appears.
    await user.click(screen.getByText('run-triage'));
    const createBtn = await screen.findByRole('button', { name: /Create Patient/i });

    // 2. Create patient + task.
    await user.click(createBtn);

    await waitFor(() => expect(patientCreate).toHaveBeenCalledTimes(1));
    const patientArg = patientCreate.mock.calls[0][0];
    expect(patientArg).toMatchObject({
      first_name: 'Jane',
      last_name: 'Doe',
      primary_diagnosis: 'CHF',
      status: 'active',
      care_type: 'home_health',
      // Required Patient fields absent from triage fall back to placeholders so
      // the create succeeds (regression guard for the create-from-triage flow).
      phone: 'Not provided on referral',
      address: 'Not provided on referral',
      emergency_contact_name: 'Not provided on referral',
      emergency_contact_phone: 'Not provided on referral',
    });

    // A CRITICAL referral creates a high-priority admission task.
    await waitFor(() => expect(taskCreate).toHaveBeenCalledTimes(1));
    expect(taskCreate.mock.calls[0][0]).toMatchObject({ priority: 'high', status: 'pending' });

    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
