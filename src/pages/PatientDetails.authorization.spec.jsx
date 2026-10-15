import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/testUtils';

// PatientDetails.context.spec.jsx replaces useAuthorizedPatient with a
// constant result. This suite runs the real hook, because the chart's reads
// share the ['currentUser'] and tenant-context queries, and those re-check on
// every observer mount. A reader that mounts only after the chart gate passes
// re-opens that gate, which unmounts the reader, and so on.
const mocks = vi.hoisted(() => ({
  authMe: vi.fn(),
  invoke: vi.fn(),
  listAuthorizedVisits: vi.fn(),
}));

vi.mock('@/api/base44Client', async () => {
  const { makeBase44Stub } = await import('@/test/testUtils');
  const stub = makeBase44Stub({
    auth: { me: mocks.authMe, logout: () => {}, redirectToLogin: () => {} },
    functions: { invoke: mocks.invoke },
  });
  return {
    base44: stub,
    tenantAuthorityClient: {
      getMyTenantContext: (payload) => mocks.invoke('getMyTenantContext', payload),
    },
  };
});

vi.mock('@/components/voice/PatientContactActions', () => ({
  default: () => <section aria-label="contact panel" />,
}));

vi.mock('@/components/telehealth/PatientTelehealthPanel', () => ({
  default: () => <section aria-label="telehealth panel" />,
}));

vi.mock('@/functions/listAuthorizedVisits', () => ({
  listAuthorizedVisits: mocks.listAuthorizedVisits,
}));

vi.mock('@/components/utils/activityLogger', () => ({
  ActivityActions: { VIEW: 'view' },
  logActivity: vi.fn(),
}));

const { bindTrustedTenantContext, clearTrustedTenantContext } = await import('@/lib/roles.js');
const { default: PatientDetails } = await import('@/pages/PatientDetails');

const PATIENT = {
  id: 'patient-a',
  first_name: 'Ada',
  middle_name: '',
  last_name: 'Lovelace',
  date_of_birth: '1950-03-04',
  medical_record_number: 'MRN-1',
  status: 'active',
  primary_diagnosis: 'I10',
  allergies: 'penicillin',
  updated_date: '2026-10-01T12:00:00.000Z',
};
const NAME = ['id', 'first_name', 'middle_name', 'last_name'];
// What the broker returns per purpose (getAuthorizedPatient rejects any other field).
const PROJECTIONS = {
  display: NAME,
  selector: [...NAME, 'medical_record_number', 'status', 'primary_diagnosis', 'updated_date'],
  visit_summary: [...NAME, 'date_of_birth', 'primary_diagnosis'],
  smart_note_context: [...NAME, 'date_of_birth', 'medical_record_number', 'status',
    'primary_diagnosis', 'allergies', 'updated_date'],
  oasis_analysis_context: [...NAME, 'date_of_birth', 'primary_diagnosis', 'allergies', 'updated_date'],
};
const project = (purpose) => Object.fromEntries(PROJECTIONS[purpose].map((key) => [key, PATIENT[key]]));

function tenantContext(role) {
  return {
    user_id: 'user-a',
    user_email: 'staff@example.com',
    membership_id: 'membership-a',
    membership_key: 'agency-a:user-a',
    membership_version: 7,
    agency_id: 'agency-a',
    tenant_role: role,
    membership_status: 'active',
    is_platform_owner: false,
    agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
  };
}

function setRole(role) {
  const context = tenantContext(role);
  const scope = {
    agency_id: 'agency-a',
    membership_id: 'membership-a',
    membership_version: 7,
    tenant_role: role,
  };
  clearTrustedTenantContext();
  bindTrustedTenantContext({ id: 'user-a', email: 'staff@example.com' }, context);
  mocks.invoke.mockReset().mockImplementation(async (name, payload) => {
    if (name === 'getMyTenantContext') return { data: { tenant_context: context } };
    if (name === 'getAuthorizedPatient') {
      return { data: { success: true, purpose: payload.purpose, patient: project(payload.purpose), scope } };
    }
    throw new Error(`Unexpected function: ${name}`);
  });
  mocks.listAuthorizedVisits.mockReset().mockResolvedValue({
    success: true,
    purpose: 'schedule',
    visits: [],
    scope: { ...scope, patient_id: 'patient-a', access_basis: 'care_team_assignment' },
    page: { page_size: 50, sort: 'id_asc', after_id: null, has_more: false, next_cursor: null },
  });
}

function brokerPurposes() {
  return mocks.invoke.mock.calls
    .filter(([name]) => name === 'getAuthorizedPatient')
    .map(([, payload]) => payload.purpose);
}

// Let any re-check that mounting the chart provoked run to completion.
async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

beforeEach(() => {
  mocks.authMe.mockReset().mockResolvedValue({ id: 'user-a', email: 'staff@example.com' });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  clearTrustedTenantContext();
});

describe('PatientDetails with the real authorization hook', () => {
  it.each([
    ['clinician', ['smart_note_context', 'oasis_analysis_context']],
    ['social_worker', ['selector', 'visit_summary']],
  ])('opens the chart for a %s once and keeps the information card mounted', async (role, purposes) => {
    setRole(role);
    renderWithProviders(<PatientDetails />, {
      route: '/PatientDetails?id=patient-a&agencyId=agency-a',
    });

    await waitFor(() => expect(screen.getByText('MRN-1')).toBeInTheDocument());
    const identityChecks = mocks.authMe.mock.calls.length;
    await settle();

    // The chart stays open and stops re-checking: no remount loop.
    expect(screen.getByText('MRN-1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.queryByText('Verifying chart access')).not.toBeInTheDocument();
    expect(mocks.authMe.mock.calls.length).toBe(identityChecks);
    // One identity check for the whole page: the card's readers share it.
    expect(identityChecks).toBe(1);

    const requested = brokerPurposes();
    expect(requested.filter((entry) => entry === 'display')).toHaveLength(1);
    for (const purpose of purposes) {
      expect(requested.filter((entry) => entry === purpose)).toHaveLength(1);
    }
    expect(new Set(requested)).toEqual(new Set(['display', ...purposes]));

    // A focus re-check closes the gate once, then the same chart and card
    // come back with the same projections and the page goes quiet again.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(mocks.authMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('MRN-1')).toBeInTheDocument());
    await settle();
    expect(mocks.authMe).toHaveBeenCalledTimes(2);
    expect(screen.getByText('MRN-1')).toBeInTheDocument();
    expect(new Set(brokerPurposes())).toEqual(new Set(['display', ...purposes]));
  });
});
