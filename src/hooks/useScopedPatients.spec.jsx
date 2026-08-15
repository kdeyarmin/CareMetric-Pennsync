import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { patientList, patientFilter, userList, authMe } = vi.hoisted(() => ({
  patientList: vi.fn(),
  patientFilter: vi.fn(),
  userList: vi.fn(),
  authMe: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    entities: {
      Patient: { list: patientList, filter: patientFilter },
      User: { list: userList },
    },
    auth: { me: authMe },
  },
}));

const { useScopedPatients } = await import('./useScopedPatients.js');
const { resetAgencyRosterCache } = await import('@/lib/agencyRoster.js');

const ROWS = [
  { id: 'ours', created_by: 'a@x.com' },
  { id: 'theirs', created_by: 'b@x.com' },
  { id: 'orphan', created_by: 'importer@no-reply.base44.com' },
];
const ROSTER = [
  { email: 'a@x.com', agency_name: 'Acme' },
  { email: 'b@x.com', agency_name: 'Other' },
];

/**
 * A test client WITHOUT the app's `initialDataUpdatedAt: 0` default, on purpose:
 * that is the environment the hook has to work in, and the combination of
 * `initialData: []` with a non-zero staleTime is what silently suppressed the
 * fetch-on-mount before the hook set the timestamp itself.
 */
function wrapper({ children }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60000 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useScopedPatients', () => {
  beforeEach(() => {
    resetAgencyRosterCache();
    patientList.mockReset().mockResolvedValue(ROWS);
    patientFilter.mockReset().mockResolvedValue(ROWS);
    userList.mockReset().mockResolvedValue(ROSTER);
    authMe.mockReset().mockResolvedValue({ role: 'admin', agency_name: 'Acme' });
  });

  afterEach(() => {
    resetAgencyRosterCache();
  });

  it('fetches on mount even under a non-zero staleTime', async () => {
    const { result } = renderHook(() => useScopedPatients({ limit: 500 }), { wrapper });
    await waitFor(() => expect(patientList).toHaveBeenCalled());
    expect(patientList).toHaveBeenCalledWith('-updated_date', 500);
    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });

  it('applies the agency scope, keeping unattributable charts', async () => {
    const { result } = renderHook(() => useScopedPatients(), { wrapper });
    await waitFor(() => expect(result.current.data.map((p) => p.id)).toEqual(['ours', 'orphan']));
  });

  it('reads the active-only roster through filter when given a status', async () => {
    renderHook(() => useScopedPatients({ status: 'active', sort: null, limit: 50 }), { wrapper });
    await waitFor(() => expect(patientFilter).toHaveBeenCalled());
    expect(patientFilter).toHaveBeenCalledWith({ status: 'active' }, undefined, 50);
    expect(patientList).not.toHaveBeenCalled();
  });

  it('does not run before the caller is known, since scoping fails closed', async () => {
    let resolveMe;
    authMe.mockReturnValueOnce(new Promise((r) => { resolveMe = r; }));
    renderHook(() => useScopedPatients(), { wrapper });
    // Without the gate this would fetch, scope against a null caller, and cache
    // an empty roster for the whole staleTime.
    await Promise.resolve();
    expect(patientList).not.toHaveBeenCalled();
    resolveMe({ role: 'admin', agency_name: 'Acme' });
    await waitFor(() => expect(patientList).toHaveBeenCalled());
  });

  it('honours a caller-supplied enabled gate', async () => {
    renderHook(() => useScopedPatients({ enabled: false }), { wrapper });
    await Promise.resolve();
    expect(patientList).not.toHaveBeenCalled();
  });

  it('narrows with select without changing what was fetched', async () => {
    const { result } = renderHook(
      () => useScopedPatients({ select: (rows) => rows.filter((p) => p.id === 'orphan') }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data.map((p) => p.id)).toEqual(['orphan']));
    expect(patientList).toHaveBeenCalledWith('-updated_date', 2000);
  });

  it('shares one fetch between two consumers of the same sort and limit', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useScopedPatients({ sort: '-updated_date', limit: 2000 }), { wrapper: shared });
    renderHook(() => useScopedPatients({ sort: '-updated_date', limit: 2000 }), { wrapper: shared });
    await waitFor(() => expect(patientList).toHaveBeenCalled());
    expect(patientList).toHaveBeenCalledTimes(1);
  });

  it('does not share a cache entry across different limits', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useScopedPatients({ limit: 100 }), { wrapper: shared });
    renderHook(() => useScopedPatients({ limit: 2000 }), { wrapper: shared });
    await waitFor(() => expect(patientList).toHaveBeenCalledTimes(2));
  });

  it('does not share a cache entry between the full and active-only rosters', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useScopedPatients({ limit: 200 }), { wrapper: shared });
    renderHook(() => useScopedPatients({ status: 'active', limit: 200 }), { wrapper: shared });
    await waitFor(() => expect(patientFilter).toHaveBeenCalled());
    expect(patientList).toHaveBeenCalledTimes(1);
  });
});
