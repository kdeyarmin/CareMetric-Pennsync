import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { authMe, getTenantContext, listAuthorized } = vi.hoisted(() => ({
  authMe: vi.fn(),
  getTenantContext: vi.fn(),
  listAuthorized: vi.fn(),
}));

// Deliberately expose no Patient entity. A regression to a direct SDK read
// fails immediately instead of being hidden behind a permissive mock.
vi.mock('@/api/base44Client', () => ({
  base44: { auth: { me: authMe } },
}));

vi.mock('@/functions/getMyTenantContext', () => ({
  getMyTenantContext: getTenantContext,
}));

vi.mock('@/functions/listAuthorizedPatients', () => {
  const fields = {
    roster: new Set(['id', 'first_name', 'last_name', 'status', 'updated_date']),
    contact: new Set(['id', 'first_name', 'last_name', 'phone', 'email']),
    patient_management: new Set(['id', 'first_name', 'last_name', 'created_date', 'updated_date']),
  };
  const sizes = { roster: 50, contact: 25, patient_management: 50 };
  return {
    listAuthorizedPatients: listAuthorized,
    authorizedPatientListPageSize: (purpose) => sizes[purpose] ?? null,
    isAuthorizedPatientListPurpose: (purpose) => Object.hasOwn(fields, purpose),
    isAuthorizedPatientListSort: (purpose, sort) => (
      Object.hasOwn(fields, purpose)
      && (sort == null || (typeof sort === 'string' && fields[purpose].has(sort.replace(/^-/, ''))))
    ),
  };
});

const {
  activeAndNotArchived,
  excludeArchived,
  onlyActive,
  useScopedPatients,
} = await import('./useScopedPatients.js');
const {
  bindTrustedTenantContext,
  clearTrustedTenantContext,
} = await import('@/lib/roles.js');

const TENANT_CONTEXT = {
  user_id: 'user-a',
  user_email: 'user-a@example.com',
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_key: 'agency-a:user-a',
  membership_version: 4,
  tenant_role: 'clinician',
  membership_status: 'active',
  is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Acme', status: 'active' },
};
const AUTH_USER = {
  id: 'user-a',
  email: 'user-a@example.com',
  role: 'admin',
  // Mutable profile values must never select the tenant.
  agency_id: 'attacker-controlled-agency',
  agency_name: 'Attacker Controlled',
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createWrapper(client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
})) {
  return {
    client,
    Wrapper({ children }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    },
  };
}

describe('useScopedPatients', () => {
  beforeEach(() => {
    clearTrustedTenantContext();
    bindTrustedTenantContext(AUTH_USER, TENANT_CONTEXT);
    authMe.mockReset().mockResolvedValue({ ...AUTH_USER });
    getTenantContext.mockReset().mockResolvedValue({ tenant_context: TENANT_CONTEXT });
    listAuthorized.mockReset().mockResolvedValue(authorizedPage([]));
  });

  afterEach(() => clearTrustedTenantContext());

  it('loads only through the named broker purpose and verified immutable tenant scope', async () => {
    listAuthorized.mockResolvedValueOnce(authorizedPage([
      { id: 'p2', first_name: 'Zoe', last_name: 'Zulu', status: 'active' },
      { id: 'p1', first_name: 'Amy', last_name: 'Alpha', status: 'active' },
    ]));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useScopedPatients({
      agencyId: 'agency-a',
      purpose: 'roster',
      status: 'active',
      sort: 'first_name',
      limit: 100,
    }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data.map((row) => row.id)).toEqual(['p1', 'p2']));
    expect(getTenantContext).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      expectedMembershipId: 'membership-a',
      expectedMembershipVersion: 4,
    });
    expect(listAuthorized).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      mode: 'page',
      purpose: 'roster',
      status: 'active',
      sort: 'id_asc',
      pageSize: 50,
      cursor: null,
    });
  });

  it('uses a purpose-specific page cap and walks all keyset pages before UI sort/limit', async () => {
    const nextCursor = { after_id: 'p2' };
    listAuthorized
      .mockResolvedValueOnce(authorizedPage([
        { id: 'p1', first_name: 'Charlie', last_name: 'C' },
        { id: 'p2', first_name: 'Delta', last_name: 'D' },
      ], { hasMore: true, nextCursor }))
      .mockResolvedValueOnce(authorizedPage([
        { id: 'p3', first_name: 'Alpha', last_name: 'A' },
        { id: 'p4', first_name: 'Bravo', last_name: 'B' },
      ]));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useScopedPatients({
      purpose: 'contact',
      sort: 'first_name',
      limit: 2,
    }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data.map((row) => row.id)).toEqual(['p3', 'p4']));
    expect(listAuthorized).toHaveBeenCalledTimes(2);
    expect(listAuthorized.mock.calls[0][0]).toMatchObject({ purpose: 'contact', pageSize: 25 });
    expect(listAuthorized.mock.calls[1][0].cursor).toBe(nextCursor);
  });

  it('fails closed if the broker scope drifts from the verified membership', async () => {
    listAuthorized.mockResolvedValueOnce(authorizedPage([{ id: 'p1' }], {
      scope: { ...TENANT_CONTEXT, membership_version: 5 },
    }));
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useScopedPatients({ purpose: 'roster' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toMatch(/authority changed/);
    expect(result.current.data).toEqual([]);
  });

  it('keys cached PHI by purpose and immutable membership identity', async () => {
    const { client, Wrapper } = createWrapper();
    renderHook(() => useScopedPatients({ purpose: 'roster' }), { wrapper: Wrapper });
    await waitFor(() => expect(listAuthorized).toHaveBeenCalled());

    const patientKeys = client.getQueryCache().getAll()
      .map((query) => query.queryKey)
      .filter((key) => key[0] === 'patients' && key[1] === 'authorized-list');
    expect(patientKeys).toContainEqual([
      'patients', 'authorized-list', 'roster', 'all', '-updated_date', 2000,
      ['user-a', 'agency-a', 'membership-a', 4, 'clinician'],
    ]);
  });

  it.each([
    ['membership revocation', Object.assign(new Error('membership revoked'), { status: 403 })],
    ['tenant verification outage', new Error('tenant broker unavailable')],
  ])('withholds and evicts cached PHI during a %s', async (_label, failure) => {
    listAuthorized.mockResolvedValueOnce(authorizedPage([{ id: 'p1', status: 'active' }]));
    const { client, Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useScopedPatients({ purpose: 'roster' }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.data.map((row) => row.id)).toEqual(['p1']));

    const recheck = deferred();
    getTenantContext.mockReturnValueOnce(recheck.promise);
    let invalidation;
    act(() => {
      invalidation = client.invalidateQueries({ queryKey: ['tenant-context', 'patient-list'] });
    });
    await waitFor(() => expect(getTenantContext).toHaveBeenCalledTimes(2));
    expect(result.current.data).toEqual([]);

    await act(async () => {
      recheck.reject(failure);
      await invalidation;
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
    await waitFor(() => expect(client.getQueryCache().findAll({
      queryKey: ['patients', 'authorized-list'],
    })).toHaveLength(0));
  });

  it('does not request identity, authority, or PHI while disabled', async () => {
    const { Wrapper } = createWrapper();
    renderHook(
      () => useScopedPatients({ purpose: 'roster', enabled: false }),
      { wrapper: Wrapper },
    );
    await Promise.resolve();
    expect(authMe).not.toHaveBeenCalled();
    expect(getTenantContext).not.toHaveBeenCalled();
    expect(listAuthorized).not.toHaveBeenCalled();
  });

  it('fails closed when no exact tenant is selected', async () => {
    clearTrustedTenantContext();
    authMe.mockResolvedValueOnce({ ...AUTH_USER });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useScopedPatients({ purpose: 'roster' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toMatch(/trusted tenant selection/);
    expect(getTenantContext).not.toHaveBeenCalled();
    expect(listAuthorized).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
  });

  it('rejects unknown purposes, operator filters, unsafe sorts, and query overrides', () => {
    const { Wrapper } = createWrapper();
    for (const options of [
      {},
      { purpose: 'full_record' },
      { purpose: 'roster', agencyId: '$ne' },
      { purpose: 'roster', status: { $ne: 'discharged' } },
      { purpose: 'roster', sort: 'date_of_birth' },
      { purpose: 'roster', where: { status: 'active' } },
      { purpose: 'roster', filter: { assigned_nurses: 'a@example.test' } },
      { purpose: 'roster', staleTime: 60_000 },
      { purpose: 'roster', limit: 10_001 },
      { purpose: 'roster', readMode: 'authorized-roster' },
    ]) {
      expect(() => renderHook(() => useScopedPatients(options), { wrapper: Wrapper })).toThrow();
    }
    expect(listAuthorized).not.toHaveBeenCalled();
  });

  describe('shared selectors', () => {
    const rows = [
      { id: 'live', status: 'active', is_archived: false },
      { id: 'archived', status: 'active', is_archived: true },
      { id: 'discharged', status: 'discharged', is_archived: false },
    ];

    it('keeps their documented filters', () => {
      expect(excludeArchived(rows).map((row) => row.id)).toEqual(['live', 'discharged']);
      expect(onlyActive(rows).map((row) => row.id)).toEqual(['live', 'archived']);
      expect(activeAndNotArchived(rows).map((row) => row.id)).toEqual(['live']);
    });

    it('keeps a stable selector memoized across unrelated renders', async () => {
      listAuthorized.mockResolvedValueOnce(authorizedPage(rows));
      const spy = vi.fn(excludeArchived);
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => {
        const [, force] = useState(0);
        return { query: useScopedPatients({ purpose: 'roster', select: spy }), force };
      }, { wrapper: Wrapper });
      await waitFor(() => expect(result.current.query.data).toHaveLength(2));
      const callsAfterLoad = spy.mock.calls.length;
      act(() => result.current.force((value) => value + 1));
      act(() => result.current.force((value) => value + 1));
      expect(spy.mock.calls.length).toBe(callsAfterLoad);
    });
  });
});
