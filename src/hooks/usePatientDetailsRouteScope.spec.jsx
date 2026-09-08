import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { authMe, getTenantContext } = vi.hoisted(() => ({
  authMe: vi.fn(),
  getTenantContext: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: { auth: { me: authMe } },
}));

vi.mock('@/functions/getMyTenantContext', () => ({
  getMyTenantContext: getTenantContext,
}));

const { usePatientDetailsRouteScope } = await import('./usePatientDetailsRouteScope.js');
const {
  bindTrustedTenantContext,
  clearTrustedTenantContext,
} = await import('@/lib/roles.js');

function tenantContext({
  userId = 'user-a',
  agencyId = 'agency-a',
  membershipId = 'membership-a',
  membershipVersion = 4,
} = {}) {
  return {
    user_id: userId,
    user_email: `${userId}@example.com`,
    membership_id: membershipId,
    membership_key: `${agencyId}:${userId}`,
    membership_version: membershipVersion,
    agency_id: agencyId,
    tenant_role: 'clinician',
    membership_status: 'active',
    is_platform_owner: false,
    agency: { id: agencyId, name: 'Agency', status: 'active' },
  };
}

function createHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
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

describe('usePatientDetailsRouteScope', () => {
  beforeEach(() => {
    clearTrustedTenantContext();
    bindTrustedTenantContext(
      { id: 'user-a', email: 'user-a@example.com' },
      tenantContext(),
    );
    authMe.mockReset().mockResolvedValue({
      id: 'user-a',
      email: 'user-a@example.com',
      agency_id: 'mutable-user-agency-must-not-authorize',
    });
    getTenantContext.mockReset().mockResolvedValue({
      tenant_context: tenantContext(),
    });
  });

  afterEach(() => {
    clearTrustedTenantContext();
    onlineManager.setOnline(true);
  });

  it('exposes the server-resolved singleton agency only after fresh settled proof', async () => {
    const { client, wrapper } = createHarness();
    const { result } = renderHook(() => usePatientDetailsRouteScope(), { wrapper });

    expect(result.current.agencyId).toBeNull();
    await waitFor(() => expect(result.current.agencyId).toBe('agency-a'));
    expect(result.current.isSuccess).toBe(true);
    expect(getTenantContext).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      expectedMembershipId: 'membership-a',
      expectedMembershipVersion: 4,
    });

    const tenantQuery = client.getQueryCache().find({
      predicate: (query) => query.queryKey[0] === 'tenant-context'
        && query.queryKey[1] === 'patient-details-route',
    });
    expect(tenantQuery).toBeTruthy();
    expect(tenantQuery.options.staleTime).toBe(0);
    expect(tenantQuery.options.refetchOnMount).toBe('always');
    expect(tenantQuery.options.refetchOnReconnect).toBe('always');
    expect(tenantQuery.options.refetchOnWindowFocus).toBe('always');
  });

  it('never exposes a seeded tenant cache while mandatory rechecks are in flight', async () => {
    const authStep = deferred();
    const tenantStep = deferred();
    authMe.mockReturnValue(authStep.promise);
    getTenantContext.mockReturnValue(tenantStep.promise);
    const { client, wrapper } = createHarness();
    client.setQueryData(['currentUser'], { id: 'user-a' });
    client.setQueryData(
      ['tenant-context', 'patient-details-route', 'user-a'],
      { tenant_context: tenantContext({ agencyId: 'agency-stale' }) },
    );

    const exposedAgencyIds = [];
    const { result } = renderHook(() => {
      const value = usePatientDetailsRouteScope();
      exposedAgencyIds.push(value.agencyId);
      return value;
    }, { wrapper });

    expect(result.current.agencyId).toBeNull();
    await act(async () => {
      authStep.resolve({ id: 'user-a', email: 'user-a@example.com' });
      await authStep.promise;
    });
    await waitFor(() => expect(getTenantContext).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      expectedMembershipId: 'membership-a',
      expectedMembershipVersion: 4,
    }));
    expect(result.current.agencyId).toBeNull();

    await act(async () => {
      tenantStep.resolve({
        tenant_context: tenantContext(),
      });
      await tenantStep.promise;
    });
    await waitFor(() => expect(result.current.agencyId).toBe('agency-a'));
    expect(exposedAgencyIds).not.toContain('agency-stale');
  });

  it('does not treat a paused seeded-cache recheck as current authority', () => {
    const { client, wrapper } = createHarness();
    client.setQueryData(['currentUser'], { id: 'user-a' });
    client.setQueryData(
      ['tenant-context', 'patient-details-route', 'user-a'],
      { tenant_context: tenantContext() },
    );
    onlineManager.setOnline(false);

    const { result, unmount } = renderHook(
      () => usePatientDetailsRouteScope(),
      { wrapper },
    );

    expect(result.current.isPaused).toBe(true);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.agencyId).toBeNull();
    expect(authMe).not.toHaveBeenCalled();
    expect(getTenantContext).not.toHaveBeenCalled();
    unmount();
  });

  it('rejects a tenant context belonging to a different immutable subject', async () => {
    getTenantContext.mockResolvedValueOnce({
      tenant_context: tenantContext({ userId: 'user-b' }),
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => usePatientDetailsRouteScope(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.agencyId).toBeNull();
    expect(result.current.error.message).toMatch(/integrity/);
  });

  it('never exposes prior-subject scope during an identity transition', async () => {
    const contextB = tenantContext({
      userId: 'user-b',
      agencyId: 'agency-b',
      membershipId: 'membership-b',
      membershipVersion: 1,
    });
    const { client, wrapper } = createHarness();
    client.setQueryData(['currentUser'], { id: 'user-a' });
    client.setQueryData(
      ['tenant-context', 'patient-details-route', 'user-a'],
      { tenant_context: tenantContext() },
    );
    clearTrustedTenantContext();
    bindTrustedTenantContext(
      { id: 'user-b', email: 'user-b@example.com' },
      contextB,
    );
    authMe.mockResolvedValueOnce({ id: 'user-b', email: 'user-b@example.com' });
    getTenantContext.mockResolvedValueOnce({ tenant_context: contextB });

    const exposedAgencyIds = [];
    const { result } = renderHook(() => {
      const value = usePatientDetailsRouteScope();
      exposedAgencyIds.push(value.agencyId);
      return value;
    }, { wrapper });

    expect(result.current.agencyId).toBeNull();
    await waitFor(() => expect(result.current.agencyId).toBe('agency-b'));
    expect(exposedAgencyIds).not.toContain('agency-a');
    await waitFor(() => expect(client.getQueryData(
      ['tenant-context', 'patient-details-route', 'user-a'],
    )).toBeUndefined());
  });

  it('fails closed on tenant resolution errors', async () => {
    getTenantContext.mockRejectedValueOnce(new Error('membership ambiguous'));
    const { wrapper } = createHarness();
    const { result } = renderHook(() => usePatientDetailsRouteScope(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.agencyId).toBeNull();
    expect(result.current.error.message).toBe('membership ambiguous');
  });

  it('keeps an unscoped platform owner disabled', async () => {
    clearTrustedTenantContext();
    const { wrapper } = createHarness();
    const { result } = renderHook(() => usePatientDetailsRouteScope(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.agencyId).toBeNull();
    expect(result.current.error.message).toMatch(/Trusted tenant selection/);
    expect(getTenantContext).not.toHaveBeenCalled();
  });
});
