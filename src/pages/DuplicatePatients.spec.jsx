import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

const { invoke, entityAccess, scopes } = vi.hoisted(() => ({
  invoke: vi.fn(),
  entityAccess: vi.fn(),
  scopes: { current: null },
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    functions: { invoke },
    entities: new Proxy({}, { get: (_t, name) => entityAccess(name) }),
    auth: { me: async () => ({ id: 'admin-1', email: 'admin@agency.test', role: 'user' }) },
  },
}));

const DUPLICATES = Object.freeze([
  { id: 'p1', first_name: 'John', last_name: 'Smith', medical_record_number: 'M1', date_of_birth: '1950-01-01', status: 'active' },
  { id: 'p2', first_name: 'John', last_name: 'Smith', medical_record_number: 'M1', date_of_birth: '1950-01-01', status: 'active' },
]);
const EMPTY = Object.freeze([]);

// The hooks are the authorized broker boundary; the page receives their
// settled results. Stable objects, because the page keys its scan off them.
vi.mock('@/hooks/useScopedPatients', () => ({
  useScopedPatients: () => scopes.current.patients,
  excludeArchived: (rows) => rows.filter((row) => !row.is_archived),
}));
vi.mock('@/hooks/useAuthorizedVisits', () => ({
  useAuthorizedVisits: () => scopes.current.visits,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import DuplicatePatients from './DuplicatePatients';

function scopeFor(tenantRole) {
  const tenantScope = Object.freeze({
    user_id: 'admin-1', agency_id: 'agency-a', membership_id: 'm-1', membership_version: 1, tenant_role: tenantRole,
  });
  return {
    patients: { isSuccess: true, isPending: false, isError: false, data: DUPLICATES, tenantScope },
    visits: { isSuccess: true, isPending: false, isError: false, data: EMPTY, tenantScope },
  };
}

describe('DuplicatePatients page', () => {
  beforeEach(() => {
    invoke.mockReset();
    entityAccess.mockReset();
  });

  it('finds the duplicate group and merges it through the broker for an agency administrator', async () => {
    scopes.current = scopeFor('agency_admin');
    invoke.mockResolvedValueOnce({
      data: {
        success: true, complete: true, keep_id: 'p1', merged_ids: ['p2'], incomplete: [],
        reassigned: { 'Visit.patient_id': 2 },
      },
    });
    renderWithProviders(<DuplicatePatients />);

    await screen.findByText(/Duplicate Group 1/);
    const keepButtons = screen.getAllByRole('button', { name: /Keep & merge others/i });
    expect(keepButtons[0]).toBeEnabled();
    fireEvent.click(keepButtons[0]);
    fireEvent.click(await screen.findByRole('button', { name: /^Merge$/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith('deduplicatePatients', {
      action: 'merge', keep_id: 'p1', duplicate_ids: ['p2'], agency_id: 'agency-a',
    });
    await waitFor(() => expect(screen.queryByText(/Duplicate Group 1/)).not.toBeInTheDocument());
    expect(entityAccess).not.toHaveBeenCalled();
  });

  it('lets other roles review duplicates but not merge them', async () => {
    scopes.current = scopeFor('clinician');
    renderWithProviders(<DuplicatePatients />);

    await screen.findByText(/Duplicate Group 1/);
    for (const button of screen.getAllByRole('button', { name: /Keep & merge others/i })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: /Merge all duplicates/i })).toBeDisabled();
    expect(screen.getByText(/Only agency administrators and managers can merge/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});
