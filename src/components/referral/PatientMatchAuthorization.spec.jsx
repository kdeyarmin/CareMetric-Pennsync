import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

const broker = vi.hoisted(() => ({
  authorized: true,
  fail: false,
  list: vi.fn(),
}));

vi.mock('@/functions/listAuthorizedPatients', () => ({
  listAuthorizedPatients: (...args) => broker.list(...args),
}));

import PatientMatchReview from './PatientMatchReview';
import PatientVerificationStep from './PatientVerificationStep';

const tenantContext = {
  user_id: 'user-a',
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'manager',
};

const scope = {
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'manager',
};

const referral = {
  extracted_data: {
    demographics: {
      full_name: 'New Referral',
      date_of_birth: '1940-01-01',
      phone: '555-0199',
      address: '99 Referral Road',
    },
    diagnoses: { primary_diagnosis: 'Referral diagnosis' },
  },
  match_analysis: {
    best_match_id: 'patient-a',
    confidence_score: 92,
    confidence_level: 'high',
    match_factors: ['Name and DOB'],
    discrepancies: [],
    reasoning: 'The documented identity fields overlap.',
  },
  match_suggestions: [{
    patient_id: 'patient-a',
    confidence_score: 92,
    reasons: ['Name and DOB'],
    discrepancies: [],
  }],
  match_confidence: 92,
  match_factors: ['Name and DOB'],
};

const identityPatient = {
  id: 'patient-a',
  first_name: 'Ada',
  middle_name: '',
  last_name: 'Lovelace',
  date_of_birth: '1815-12-10',
  medical_record_number: 'MRN-1',
  phone: '555-0100',
  address: '1 Computing Way',
};

beforeEach(() => {
  broker.authorized = true;
  broker.fail = false;
  broker.list.mockReset();
  broker.list.mockImplementation(async ({ purpose }) => {
    if (broker.fail) throw new Error('authorization failed');
    return {
      scope,
      patients: broker.authorized
        ? [{
          ...(purpose === 'roster'
            ? {
              id: 'patient-a',
              first_name: 'Ada',
              middle_name: '',
              last_name: 'Lovelace',
              primary_diagnosis: 'I10',
              updated_date: '2026-09-07T12:00:00.000Z',
            }
            : identityPatient),
        }]
        : [],
    };
  });
});

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('referral patient match authorization', () => {
  it('uses purpose-bound broker projections and invalidates a verification selection after reauthorization omits it', async () => {
    const client = queryClient();
    const user = userEvent.setup();
    const onConfirmMatch = vi.fn();
    renderWithProviders(
      <PatientVerificationStep
        referral={referral}
        tenantContext={tenantContext}
        onConfirmMatch={onConfirmMatch}
        onCreateNew={vi.fn()}
      />,
      { queryClient: client },
    );

    await user.click(await screen.findByText(/Ada\s+Lovelace/));
    const confirm = screen.getByRole('button', { name: /Confirm Selected Patient/i });
    expect(confirm).toBeEnabled();
    expect(broker.list.mock.calls.map(([request]) => request.purpose).sort()).toEqual([
      'identity_match',
      'roster',
    ]);

    broker.authorized = false;
    await client.invalidateQueries({
      queryKey: ['patients', 'authorized-referral-matches'],
    });

    expect(await screen.findByText(/suggested record is no longer available/i)).toBeInTheDocument();
    await waitFor(() => expect(confirm).toBeDisabled());
    await user.click(confirm);
    expect(onConfirmMatch).not.toHaveBeenCalled();
  });

  it('invalidates the legacy review selection and comparison after a fresh lookup omits the chart', async () => {
    const client = queryClient();
    const user = userEvent.setup();
    const onConfirmMatch = vi.fn();
    renderWithProviders(
      <PatientMatchReview
        referral={referral}
        tenantContext={tenantContext}
        onConfirmMatch={onConfirmMatch}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
      />,
      { queryClient: client },
    );

    await user.click(await screen.findByText('Ada Lovelace'));
    const confirm = screen.getByRole('button', { name: /Confirm Selected Match/i });
    const comparison = screen.getByRole('button', { name: /Side-by-Side Comparison/i });
    expect(confirm).toBeEnabled();
    expect(comparison).toBeEnabled();

    broker.authorized = false;
    await client.invalidateQueries({
      queryKey: ['patients', 'authorized-referral-matches'],
    });

    expect(await screen.findByText(/suggested record is no longer available/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(confirm).toBeDisabled();
      expect(comparison).toBeDisabled();
    });
    await user.click(confirm);
    expect(onConfirmMatch).not.toHaveBeenCalled();
  });

  it('selects a verification match from the keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PatientVerificationStep
        referral={referral}
        tenantContext={tenantContext}
        onConfirmMatch={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    );

    const match = await screen.findByRole('radio', { name: /Ada\s+Lovelace/i });
    match.focus();
    await user.keyboard('{Enter}');

    expect(match).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /Confirm Selected Patient/i })).toBeEnabled();
  });

  it('selects a legacy-review match from the keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PatientMatchReview
        referral={referral}
        tenantContext={tenantContext}
        onConfirmMatch={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const match = await screen.findByRole('radio', { name: /Ada Lovelace/i });
    match.focus();
    await user.keyboard(' ');

    expect(match).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /Confirm Selected Match/i })).toBeEnabled();
  });

  it('fails closed on an authorization error and offers only retry or exit actions', async () => {
    broker.fail = true;
    renderWithProviders(
      <PatientVerificationStep
        referral={referral}
        tenantContext={tenantContext}
        onConfirmMatch={vi.fn()}
        onCreateNew={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(await screen.findByText(/could not be authorized for this agency/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm Selected Patient/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Create New Patient Record/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Retry authorized lookup/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Skip for Now/i })).toBeEnabled();
  });
});
