import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  authMe, collectVisits, getTenantContext,
} = vi.hoisted(() => ({
  authMe: vi.fn(),
  collectVisits: vi.fn(),
  getTenantContext: vi.fn(),
}));

// Deliberately expose no Visit or Patient entity SDK. Both populations must
// cross reviewed brokers.
vi.mock('@/api/base44Client', () => ({ base44: { auth: { me: authMe } } }));
vi.mock('@/functions/getMyTenantContext', () => ({ getMyTenantContext: getTenantContext }));
vi.mock('@/functions/listAuthorizedVisits', () => {
  const fields = {
    activity: new Set(['id', 'patient_id', 'visit_date', 'created_date']),
    documentation: new Set(['id', 'patient_id', 'visit_date', 'nurse_notes']),
  };
  return {
    collectAuthorizedVisits: collectVisits,
    isAuthorizedVisitListPurpose: (purpose) => Object.hasOwn(fields, purpose),
    isAuthorizedVisitListSort: (purpose, sort) => (
      Object.hasOwn(fields, purpose)
      && (sort == null || (typeof sort === 'string' && fields[purpose].has(sort.replace(/^-/, ''))))
    ),
  };
});

const { useAuthorizedVisits } = await import('./useAuthorizedVisits.js');
const {
  bindTrustedTenantContext,
  clearTrustedTenantContext,
} = await import('@/lib/roles.js');

const AUTH_USER = { id: 'user-a', email: 'user-a@example.com', role: 'admin' };
const ADMIN_CONTEXT = {
  user_id: 'user-a',
  user_email: 'user-a@example.com',
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_key: 'agency-a:user-a',
  membership_version: 4,
  tenant_role: 'agency_admin',
  membership_status: 'active',
  is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Acme', status: 'active' },
};

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    Wrapper({ children }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    },
  };
}

describe('useAuthorizedVisits', () => {
  beforeEach(() => {
    clearTrustedTenantContext();
    bindTrustedTenantContext(AUTH_USER, ADMIN_CONTEXT);
    authMe.mockReset().mockResolvedValue(AUTH_USER);
    getTenantContext.mockReset().mockResolvedValue({ tenant_context: ADMIN_CONTEXT });
    collectVisits.mockReset().mockResolvedValue([]);
  });

  afterEach(() => clearTrustedTenantContext());

  it('loads only through the purpose broker with verified tenant scope', async () => {
    collectVisits.mockResolvedValueOnce([{ id: 'v1', patient_id: 'p1', visit_date: '2026-09-01' }]);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAuthorizedVisits({
      patientId: 'p1', purpose: 'activity', sort: '-visit_date', limit: 20,
    }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(collectVisits).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      patientId: 'p1',
      purpose: 'activity',
      status: null,
      sort: '-visit_date',
      limit: 20,
      expectedScope: ADMIN_CONTEXT,
    });
  });

  it('keys PHI by purpose, filters, and immutable membership identity', async () => {
    const { client, Wrapper } = createWrapper();
    renderHook(() => useAuthorizedVisits({ purpose: 'activity' }), { wrapper: Wrapper });
    await waitFor(() => expect(collectVisits).toHaveBeenCalled());
    const keys = client.getQueryCache().getAll().map((query) => query.queryKey);
    expect(keys).toContainEqual([
      'visits', 'authorized-list', 'activity', null, null, '-visit_date', 500,
      ['user-a', 'agency-a', 'membership-a', 4, 'agency_admin'],
    ]);
  });

  it('fails closed instead of issuing an N+1 global clinician fanout', async () => {
    const clinician = { ...ADMIN_CONTEXT, tenant_role: 'clinician' };
    clearTrustedTenantContext();
    bindTrustedTenantContext(AUTH_USER, clinician);
    getTenantContext.mockResolvedValue({ tenant_context: clinician });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useAuthorizedVisits({ purpose: 'activity', limit: 10 }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toMatch(/Agency-wide Visit metrics require manager/);
    expect(result.current.data).toEqual([]);
    expect(collectVisits).not.toHaveBeenCalled();
  });

  it('withholds cached rows throughout authority revalidation and evicts on denial', async () => {
    collectVisits.mockResolvedValueOnce([{ id: 'v1', patient_id: 'p1', visit_date: '2026-09-01' }]);
    const { client, Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useAuthorizedVisits({ purpose: 'activity' }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    getTenantContext.mockRejectedValueOnce(Object.assign(new Error('membership revoked'), { status: 403 }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['tenant-context', 'visit-list'] });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
    await waitFor(() => expect(client.getQueryCache().findAll({
      queryKey: ['visits', 'authorized-list'],
    })).toHaveLength(0));
  });

  it('does nothing while disabled', async () => {
    const { Wrapper } = createWrapper();
    renderHook(
      () => useAuthorizedVisits({ purpose: 'activity', enabled: false }),
      { wrapper: Wrapper },
    );
    await Promise.resolve();
    expect(authMe).not.toHaveBeenCalled();
    expect(getTenantContext).not.toHaveBeenCalled();
    expect(collectVisits).not.toHaveBeenCalled();
  });

  it('rejects unknown purposes, arbitrary filters, operators, unsafe sorts, and caps', () => {
    const { Wrapper } = createWrapper();
    for (const options of [
      {},
      { purpose: 'full_record' },
      { purpose: 'activity', patientId: { $ne: null } },
      { purpose: 'activity', status: { $in: ['completed'] } },
      { purpose: 'activity', sort: 'nurse_notes' },
      { purpose: 'activity', where: { status: 'completed' } },
      { purpose: 'activity', filter: {} },
      { purpose: 'activity', limit: 10_001 },
      { purpose: 'activity', refetchInterval: 999 },
      { purpose: 'activity', refetchInterval: 30_000 },
      { purpose: 'activity', refetchInterval: false },
    ]) {
      expect(() => renderHook(() => useAuthorizedVisits(options), { wrapper: Wrapper })).toThrow();
    }
    expect(collectVisits).not.toHaveBeenCalled();
  });
});
