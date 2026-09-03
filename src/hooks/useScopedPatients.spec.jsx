import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  patientList, patientFilter, userList, authMe, getTenantContext, listAuthorized,
} = vi.hoisted(() => ({
  patientList: vi.fn(),
  patientFilter: vi.fn(),
  userList: vi.fn(),
  authMe: vi.fn(),
  getTenantContext: vi.fn(),
  listAuthorized: vi.fn(),
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

vi.mock('@/functions/getMyTenantContext', () => ({
  getMyTenantContext: getTenantContext,
}));

vi.mock('@/functions/listAuthorizedPatients', () => ({
  listAuthorizedPatients: listAuthorized,
}));

const {
  useScopedPatients, excludeArchived, onlyActive, activeAndNotArchived,
} = await import('./useScopedPatients.js');
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
const TENANT_CONTEXT = {
  user_id: 'user-a',
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 4,
  tenant_role: 'clinician',
};

function authorizedPage(patients, {
  hasMore = false,
  nextCursor = null,
  scope = TENANT_CONTEXT,
} = {}) {
  return {
    patients,
    scope: {
      agency_id: scope.agency_id,
      membership_id: scope.membership_id,
      membership_version: scope.membership_version,
      tenant_role: scope.tenant_role,
    },
    page: { has_more: hasMore, next_cursor: nextCursor },
  };
}

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
    authMe.mockReset().mockResolvedValue({
      id: 'user-a', role: 'admin', agency_id: 'agency-a', agency_name: 'Acme',
    });
    getTenantContext.mockReset().mockResolvedValue({ tenant_context: TENANT_CONTEXT });
    listAuthorized.mockReset().mockResolvedValue(authorizedPage([]));
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

  describe('shared selectors', () => {
    const rows = [
      { id: 'live', status: 'active', is_archived: false },
      { id: 'archived', status: 'active', is_archived: true },
      { id: 'discharged', status: 'discharged', is_archived: false },
    ];

    it('excludeArchived drops merged/archived charts', () => {
      expect(excludeArchived(rows).map((p) => p.id)).toEqual(['live', 'discharged']);
    });

    it('onlyActive keeps active charts regardless of archive flag', () => {
      expect(onlyActive(rows).map((p) => p.id)).toEqual(['live', 'archived']);
    });

    it('activeAndNotArchived requires both', () => {
      expect(activeAndNotArchived(rows).map((p) => p.id)).toEqual(['live']);
    });

    // The reason the selectors are module-level at all, and the reason
    // queryKeyContract rejects inline arrows: React Query memoizes `select` by
    // reference (queryObserver: `options.select === selectFn`). A fresh arrow
    // per render re-filters the entire roster on every render.
    it('runs once per fetch, not once per render', async () => {
      const spy = vi.fn(excludeArchived);
      const { result } = renderHook(() => {
        const [, force] = useState(0);
        const query = useScopedPatients({ select: spy });
        return { query, force };
      }, { wrapper });

      // Wait for the FETCHED rows, not merely for `data` to exist — initialData
      // makes it defined on the first render, well before the roster lands.
      await waitFor(() => expect(result.current.query.data).toHaveLength(2));
      const afterLoad = spy.mock.calls.length;
      act(() => result.current.force((n) => n + 1));
      act(() => result.current.force((n) => n + 1));
      expect(spy.mock.calls.length).toBe(afterLoad);
    });

    // The other half of the contract: this is what the stable reference buys.
    // If React Query ever memoizes `select` by something other than identity,
    // this test starts failing and the queryKeyContract guard can be dropped.
    it('re-runs on every render when the reference is NOT stable', async () => {
      const spy = vi.fn(excludeArchived);
      const { result } = renderHook(() => {
        const [, force] = useState(0);
        const query = useScopedPatients({ select: (r) => spy(r) });
        return { query, force };
      }, { wrapper });

      await waitFor(() => expect(result.current.query.data).toHaveLength(2));
      const afterLoad = spy.mock.calls.length;
      act(() => result.current.force((n) => n + 1));
      act(() => result.current.force((n) => n + 1));
      expect(spy.mock.calls.length).toBeGreaterThan(afterLoad);
    });
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

  it('uses the server-owned roster projection without issuing a direct Patient read', async () => {
    listAuthorized.mockResolvedValueOnce(authorizedPage([
      { id: 'p2', first_name: 'Zoe', last_name: 'Zulu', status: 'active' },
      { id: 'p1', first_name: 'Amy', last_name: 'Alpha', status: 'active' },
    ]));

    const { result } = renderHook(() => useScopedPatients({
      status: 'active',
      sort: 'first_name',
      limit: 100,
      readMode: 'authorized-roster',
    }), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data.map((patient) => patient.id)).toEqual(['p1', 'p2']);
    expect(getTenantContext).toHaveBeenCalledWith({ agencyId: 'agency-a' });
    expect(listAuthorized).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      mode: 'page',
      purpose: 'roster',
      status: 'active',
      sort: 'id_asc',
      pageSize: 50,
      cursor: null,
    });
    expect(patientList).not.toHaveBeenCalled();
    expect(patientFilter).not.toHaveBeenCalled();
    expect(userList).not.toHaveBeenCalled();
  });

  it('walks every keyset page before sorting and applying the UI limit', async () => {
    const cursor = { after_id: 'p2' };
    listAuthorized
      .mockResolvedValueOnce(authorizedPage([
        { id: 'p1', first_name: 'Charlie', last_name: 'C', status: 'active' },
        { id: 'p2', first_name: 'Delta', last_name: 'D', status: 'active' },
      ], { hasMore: true, nextCursor: cursor }))
      .mockResolvedValueOnce(authorizedPage([
        { id: 'p3', first_name: 'Alpha', last_name: 'A', status: 'active' },
        { id: 'p4', first_name: 'Bravo', last_name: 'B', status: 'active' },
      ]));

    const { result } = renderHook(() => useScopedPatients({
      sort: 'first_name',
      limit: 2,
      readMode: 'authorized-roster',
    }), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data.map((patient) => patient.id)).toEqual(['p3', 'p4']);
    expect(listAuthorized).toHaveBeenCalledTimes(2);
    expect(listAuthorized.mock.calls[1][0].cursor).toBe(cursor);
  });

  it('fails closed when the broker scope does not match the query-key authority', async () => {
    listAuthorized.mockResolvedValueOnce(authorizedPage([
      { id: 'p1', first_name: 'Amy', last_name: 'Alpha', status: 'active' },
    ], {
      scope: { ...TENANT_CONTEXT, membership_version: 5 },
    }));

    const { result } = renderHook(() => useScopedPatients({
      readMode: 'authorized-roster',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toMatch(/authority changed/);
    expect(result.current.data).toEqual([]);
    expect(patientList).not.toHaveBeenCalled();
  });

  it('fails closed instead of falling back when no agency is selected', async () => {
    authMe.mockResolvedValueOnce({ id: 'owner-a', role: 'admin' });
    getTenantContext.mockResolvedValueOnce({
      tenant_context: { ...TENANT_CONTEXT, agency_id: null },
    });

    const { result } = renderHook(() => useScopedPatients({
      readMode: 'authorized-roster',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toMatch(/Select an agency/);
    expect(result.current.data).toEqual([]);
    expect(listAuthorized).not.toHaveBeenCalled();
    expect(patientList).not.toHaveBeenCalled();
  });

  it('keys the authorized roster by immutable membership identity', async () => {
    listAuthorized.mockResolvedValueOnce(authorizedPage([]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    renderHook(() => useScopedPatients({ readMode: 'authorized-roster' }), { wrapper: shared });
    await waitFor(() => expect(listAuthorized).toHaveBeenCalled());
    const patientKeys = client.getQueryCache().getAll()
      .map((query) => query.queryKey)
      .filter((key) => key[0] === 'patients' && key[1] === 'authorized-roster');
    expect(patientKeys).toContainEqual([
      'patients', 'authorized-roster', 'all', '-updated_date', 2000,
      ['user-a', 'agency-a', 'membership-a', 4, 'clinician'],
    ]);
  });

  it('does not let a misspelled broker mode fall back to a direct read', () => {
    expect(() => renderHook(() => useScopedPatients({ readMode: 'authorised-roster' }), {
      wrapper,
    })).toThrow(/readMode is invalid/);
    expect(patientList).not.toHaveBeenCalled();
    expect(patientFilter).not.toHaveBeenCalled();
  });

  it('rejects legacy query overrides and out-of-contract roster shapes', () => {
    for (const input of [
      { readMode: 'authorized-roster', staleTime: 60000 },
      { readMode: 'authorized-roster', initialData: ROWS },
      { readMode: 'authorized-roster', sort: 'date_of_birth' },
      { readMode: 'authorized-roster', status: 'archived' },
      { readMode: 'authorized-roster', limit: 10001 },
    ]) {
      expect(() => renderHook(() => useScopedPatients(input), { wrapper })).toThrow();
    }
    expect(patientList).not.toHaveBeenCalled();
    expect(patientFilter).not.toHaveBeenCalled();
    expect(listAuthorized).not.toHaveBeenCalled();
  });
});
