import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

const { invoke, entityAccess, toastError, toastSuccess } = vi.hoisted(() => ({
  invoke: vi.fn(),
  entityAccess: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    functions: { invoke },
    entities: new Proxy({}, { get: (_t, name) => entityAccess(name) }),
    auth: { me: async () => ({ id: 'admin-1', email: 'admin@agency.test', role: 'user' }) },
  },
}));
const NO_VISITS = Object.freeze({ data: Object.freeze([]), isSuccess: true });
vi.mock('@/hooks/useAuthorizedVisits', () => ({ useAuthorizedVisits: () => NO_VISITS }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));

import PatientMergeDialog from './PatientMergeDialog';

const P1 = { id: 'p1', first_name: 'John', last_name: 'Smith', medical_record_number: 'M1', created_date: '2026-01-01' };
const P2 = { id: 'p2', first_name: 'Jon', last_name: 'Smith', medical_record_number: 'M1', created_date: '2026-02-01' };

async function confirmMerge() {
  renderWithProviders(
    <PatientMergeDialog open onOpenChange={() => {}} patient1={P1} patient2={P2} agencyId="agency-a" />,
  );
  fireEvent.click(screen.getByText('John Smith'));
  fireEvent.click(screen.getByRole('button', { name: /Next: Review/i }));
  fireEvent.click(screen.getByRole('button', { name: /Next: Confirm/i }));
  fireEvent.click(screen.getByRole('button', { name: /^Merge Patients$/i }));
}

describe('PatientMergeDialog', () => {
  beforeEach(() => {
    invoke.mockReset();
    entityAccess.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it('merges the secondary into the chosen primary through the server broker', async () => {
    invoke.mockResolvedValueOnce({
      data: { complete: true, keep_id: 'p1', merged_ids: ['p2'], incomplete: [], reassigned: { 'Visit.patient_id': 4 } },
    });
    await confirmMerge();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith('deduplicatePatients', {
      action: 'merge', keep_id: 'p1', duplicate_ids: ['p2'], agency_id: 'agency-a',
    });
    expect(toastSuccess.mock.calls[0][0]).toMatch(/4 linked record\(s\) moved/);
    expect(entityAccess).not.toHaveBeenCalled();
  });

  it('reports a merge that did not finish so it can be retried', async () => {
    invoke.mockResolvedValueOnce({
      data: { complete: false, merged_ids: [], incomplete: [{ duplicate_id: 'p2', failed: {}, pending: ['Visit.patient_id'] }] },
    });
    await confirmMerge();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/Run the merge again/i);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
