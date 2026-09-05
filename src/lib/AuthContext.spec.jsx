import { useEffect, useLayoutEffect } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMe: vi.fn(),
  authLogout: vi.fn(),
  getPublicSettings: vi.fn(),
  getTenantContext: vi.fn(),
  listMemberships: vi.fn(),
  clearCachedPhi: vi.fn(),
  invalidateDraftLease: vi.fn(),
  invalidatePersistedDraftMarkers: vi.fn(),
  purgeAuthorityDrafts: vi.fn(),
  reconcileAuthorityDrafts: vi.fn(),
  cancelQueries: vi.fn(),
  clearQueries: vi.fn(),
  queryCacheEntries: vi.fn(),
  mutationCacheEntries: vi.fn(),
  mutationCacheSubscribe: vi.fn(),
  setQueryData: vi.fn(),
  resetAgencyRoster: vi.fn(),
  dismissSonnerToasts: vi.fn(),
  clearShadcnToasts: vi.fn(),
  closeTenantSdkRealm: vi.fn(),
  openTenantSdkRealm: vi.fn(),
  poisonTenantSdkRealm: vi.fn(),
  hasPinnedTenantSdkRealm: vi.fn(),
  sdkRealm: { pin: null, poisoned: false },
}));

vi.mock('sonner', () => ({
  toast: { dismiss: mocks.dismissSonnerToasts },
}));

vi.mock('@/components/ui/use-toast', () => ({
  clearAllToasts: mocks.clearShadcnToasts,
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: {
      me: mocks.authMe,
      logout: mocks.authLogout,
      redirectToLogin: vi.fn(),
    },
  },
  tenantAuthorityClient: {
    me: (...args) => mocks.authMe(...args),
  },
}));

vi.mock('@/lib/app-params', () => ({
  appParams: {
    appId: 'app-test',
    serverUrl: 'https://example.test',
    token: 'test-token',
  },
  plantLoginReturnState: vi.fn((url) => url),
}));

vi.mock('@/lib/base44AxiosClient', () => ({
  createAxiosClient: vi.fn(() => ({ get: mocks.getPublicSettings })),
}));

vi.mock('@/lib/query-client', () => ({
  queryClientInstance: {
    cancelQueries: mocks.cancelQueries,
    clear: mocks.clearQueries,
    getQueryCache: () => ({ getAll: mocks.queryCacheEntries }),
    getMutationCache: () => ({
      getAll: mocks.mutationCacheEntries,
      subscribe: mocks.mutationCacheSubscribe,
    }),
    setQueryData: mocks.setQueryData,
  },
}));

vi.mock('@/lib/phiStorage', () => ({
  invalidateAuthorityDraftLeaseForTransition: mocks.invalidateDraftLease,
  invalidatePersistedAuthorityDraftMarkersForLogout: mocks.invalidatePersistedDraftMarkers,
  purgeAuthorityBoundDrafts: mocks.purgeAuthorityDrafts,
  purgeRefetchablePhiForAuthorityTransition: mocks.clearCachedPhi,
  reconcileAuthorityBoundDrafts: mocks.reconcileAuthorityDrafts,
}));

vi.mock('@/lib/agencyRoster', () => ({
  resetAgencyRosterCache: mocks.resetAgencyRoster,
}));

vi.mock('@/lib/tenantSdkRealmGate', () => ({
  closeTenantSdkRealm: (...args) => mocks.closeTenantSdkRealm(...args),
  hasPinnedTenantSdkRealm: (...args) => mocks.hasPinnedTenantSdkRealm(...args),
  openTenantSdkRealm: (...args) => mocks.openTenantSdkRealm(...args),
  poisonTenantSdkRealm: (...args) => mocks.poisonTenantSdkRealm(...args),
}));

vi.mock('@/functions/getMyTenantContext', () => ({
  bootstrapMyTenantContext: mocks.getTenantContext,
  getMyTenantContext: mocks.getTenantContext,
}));

vi.mock('@/functions/listMyTenantMemberships', () => ({
  listMyTenantMemberships: mocks.listMemberships,
}));

import {
  AuthProvider,
  TENANT_AUTHORITY_STATES,
  TenantAuthorityBoundary,
  useAuth,
} from './AuthContext';
import { getRoleView, getTrustedTenantContext } from './roles';

const USER = {
  id: 'user-a',
  email: 'Admin@Agency.test',
  role: 'user',
  account_type: 'user',
};

function membership({
  agencyId = 'agency-a',
  membershipId = 'membership-a',
  membershipVersion = 2,
  tenantRole = 'agency_admin',
  agencyName = 'Agency A',
} = {}) {
  return {
    membership_id: membershipId,
    membership_key: `${agencyId}:user-a`,
    membership_version: membershipVersion,
    agency_id: agencyId,
    tenant_role: tenantRole,
    membership_status: 'active',
    agency: { id: agencyId, name: agencyName, status: 'active' },
  };
}

function contextFor(option, overrides = {}) {
  return {
    user_id: 'user-a',
    user_email: 'admin@agency.test',
    membership_id: option.membership_id,
    membership_key: option.membership_key,
    membership_version: option.membership_version,
    agency_id: option.agency_id,
    tenant_role: option.tenant_role,
    membership_status: option.membership_status,
    is_platform_owner: false,
    agency: { ...option.agency },
    ...overrides,
  };
}

function membershipResult(memberships, overrides = {}) {
  return {
    subject: {
      user_id: 'user-a',
      user_email: 'admin@agency.test',
      is_platform_owner: false,
    },
    memberships,
    ...overrides,
  };
}

const A = membership();
const B = membership({
  agencyId: 'agency-b',
  membershipId: 'membership-b',
  membershipVersion: 5,
  tenantRole: 'manager',
  agencyName: 'Agency B',
});

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('AuthProvider tenant authority state machine', () => {
  let consoleError;

  beforeEach(() => {
    sessionStorage.clear();
    mocks.authMe.mockReset().mockResolvedValue({ ...USER });
    mocks.authLogout.mockReset();
    mocks.getPublicSettings.mockReset().mockResolvedValue({
      id: 'app-test',
      public_settings: {},
    });
    mocks.listMemberships.mockReset().mockResolvedValue(membershipResult([A]));
    mocks.getTenantContext.mockReset().mockImplementation(async (options) => {
      const option = options.agencyId === 'agency-b' ? B : A;
      return { tenant_context: contextFor(option) };
    });
    mocks.clearCachedPhi.mockReset().mockResolvedValue(undefined);
    mocks.invalidateDraftLease.mockReset();
    mocks.invalidatePersistedDraftMarkers.mockReset();
    mocks.purgeAuthorityDrafts.mockReset().mockImplementation(async () => {
      sessionStorage.clear();
    });
    mocks.reconcileAuthorityDrafts.mockReset().mockResolvedValue({
      preserved: true,
      marker: 'sha256:test-authority',
    });
    mocks.cancelQueries.mockReset().mockResolvedValue(undefined);
    mocks.clearQueries.mockReset();
    mocks.queryCacheEntries.mockReset().mockReturnValue([]);
    mocks.mutationCacheEntries.mockReset().mockReturnValue([]);
    mocks.mutationCacheSubscribe.mockReset().mockReturnValue(() => {});
    mocks.setQueryData.mockReset();
    mocks.resetAgencyRoster.mockReset();
    mocks.dismissSonnerToasts.mockReset();
    mocks.clearShadcnToasts.mockReset();
    mocks.sdkRealm.pin = null;
    mocks.sdkRealm.poisoned = false;
    mocks.closeTenantSdkRealm.mockReset();
    mocks.hasPinnedTenantSdkRealm.mockReset().mockImplementation(
      () => mocks.sdkRealm.pin !== null,
    );
    mocks.openTenantSdkRealm.mockReset().mockImplementation((snapshot) => {
      if (mocks.sdkRealm.poisoned) return false;
      if (mocks.sdkRealm.pin === null) mocks.sdkRealm.pin = snapshot;
      if (mocks.sdkRealm.pin !== snapshot) {
        mocks.sdkRealm.poisoned = true;
        return false;
      }
      return true;
    });
    mocks.poisonTenantSdkRealm.mockReset().mockImplementation(() => {
      mocks.sdkRealm.poisoned = true;
    });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    sessionStorage.clear();
  });

  it('keeps an initial public route usable without starting staff authority brokers', async () => {
    function InitialPublicProbe() {
      const { setPublicRouteActive } = useAuth();
      useLayoutEffect(() => {
        void setPublicRouteActive(true);
      }, [setPublicRouteActive]);
      return <div>public-token-content</div>;
    }

    const { getByText } = render(
      <AuthProvider>
        <InitialPublicProbe />
      </AuthProvider>,
    );
    expect(getByText('public-token-content')).not.toBeNull();
    await waitFor(() => expect(mocks.getPublicSettings).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.authMe).not.toHaveBeenCalled();
    expect(mocks.listMemberships).not.toHaveBeenCalled();
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
  });

  it('lists after auth and auto-resolves one exact active membership', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));

    expect(mocks.authMe.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listMemberships.mock.invocationCallOrder[0],
    );
    expect(mocks.getTenantContext).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      expectedMembershipId: 'membership-a',
      expectedMembershipVersion: 2,
    });
    expect(result.current.tenantContext).toEqual(contextFor(A));
    expect(result.current.tenantAuthorityKey).toContain('membership-a');
    expect(getTrustedTenantContext(result.current.user)).toEqual(contextFor(A));
    expect(getRoleView(result.current.user)).toBe('facility_admin');
    expect(mocks.invalidateDraftLease).toHaveBeenCalled();
  });

  it('blocks a regular principal with zero active memberships', async () => {
    mocks.listMemberships.mockResolvedValue(membershipResult([]));
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.tenantContext).toBeNull();
    expect(result.current.tenantContextError).toMatchObject({
      type: 'no_active_tenant_membership',
    });
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
    expect(getTrustedTenantContext(result.current.user)).toBeNull();
  });

  it('requires an explicit choice for multiple memberships and re-lists before binding it', async () => {
    mocks.listMemberships.mockResolvedValue(membershipResult([A, B]));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.SELECTION_REQUIRED,
    ));
    expect(result.current.tenantMemberships).toHaveLength(2);
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
    expect(mocks.purgeAuthorityDrafts).not.toHaveBeenCalled();
    expect(mocks.reconcileAuthorityDrafts).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.selectTenant('agency-b');
    });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));

    expect(mocks.authMe).toHaveBeenCalledTimes(2);
    expect(mocks.listMemberships).toHaveBeenCalledTimes(2);
    expect(mocks.getTenantContext).toHaveBeenCalledWith({
      agencyId: 'agency-b',
      expectedMembershipId: 'membership-b',
      expectedMembershipVersion: 5,
    });
    expect(result.current.tenantContext.agency_id).toBe('agency-b');
    expect(mocks.reconcileAuthorityDrafts).toHaveBeenCalledTimes(1);
  });

  it('refuses an in-document tenant switch after the first READY authority', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    const identityCalls = mocks.authMe.mock.calls.length;
    const contextCalls = mocks.getTenantContext.mock.calls.length;

    await act(async () => {
      await result.current.selectTenant('agency-b');
    });

    expect(result.current.tenantAuthorityState).toBe(TENANT_AUTHORITY_STATES.BLOCKED);
    expect(result.current.tenantAuthorityKey).toBeNull();
    expect(result.current.tenantContext).toBeNull();
    expect(result.current.tenantContextError).toMatchObject({
      type: 'browser_authority_change_requires_restart',
    });
    expect(mocks.authMe).toHaveBeenCalledTimes(identityCalls);
    expect(mocks.getTenantContext).toHaveBeenCalledTimes(contextCalls);
    expect(mocks.poisonTenantSdkRealm).toHaveBeenCalled();
  });

  it('supports the membership-free protected platform-owner path', async () => {
    const ownerContext = {
      user_id: 'user-a',
      user_email: 'admin@agency.test',
      membership_id: null,
      membership_key: null,
      membership_version: null,
      agency_id: null,
      tenant_role: 'platform_owner',
      membership_status: null,
      is_platform_owner: true,
      agency: null,
    };
    mocks.listMemberships.mockResolvedValue({
      subject: {
        user_id: 'user-a',
        user_email: 'admin@agency.test',
        is_platform_owner: true,
      },
      memberships: [],
    });
    mocks.getTenantContext.mockResolvedValue({ tenant_context: ownerContext });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    expect(mocks.getTenantContext).toHaveBeenCalledWith({});
    expect(result.current.tenantContext).toEqual(ownerContext);
  });

  it('rejects a tenant-bearing owner context when no owner agency was selected', async () => {
    mocks.listMemberships.mockResolvedValue({
      subject: {
        user_id: 'user-a',
        user_email: 'admin@agency.test',
        is_platform_owner: true,
      },
      memberships: [],
    });
    mocks.getTenantContext.mockResolvedValue({
      tenant_context: {
        user_id: 'user-a',
        user_email: 'admin@agency.test',
        membership_id: null,
        membership_key: null,
        membership_version: null,
        agency_id: 'agency-a',
        tenant_role: 'platform_owner',
        membership_status: null,
        is_platform_owner: true,
        agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
      },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    expect(result.current.tenantContext).toBeNull();
    expect(result.current.tenantAuthorityKey).toBeNull();
  });

  it('blocks exact subject and selected-context mismatches instead of falling back to nurse', async () => {
    mocks.getTenantContext.mockResolvedValue({
      tenant_context: contextFor(A, { membership_version: 99 }),
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    expect(result.current.tenantContext).toBeNull();
    expect(result.current.tenantAuthorityKey).toBeNull();
    expect(result.current.tenantContextError).toMatchObject({
      type: 'tenant_context_unavailable',
    });
    expect(getTrustedTenantContext(result.current.user)).toBeNull();
  });

  it('blocks before identity resolution when the query cache cannot be cleared', async () => {
    mocks.clearQueries.mockImplementationOnce(() => {
      throw new Error('query cache locked');
    });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    expect(result.current.tenantAuthorityKey).toBeNull();
    expect(mocks.authMe).not.toHaveBeenCalled();
    expect(mocks.clearQueries).toHaveBeenCalledTimes(1);
  });

  it('blocks and retries strict refetchable-PHI destruction before identity resolution', async () => {
    mocks.clearCachedPhi.mockRejectedValueOnce(new Error('legacy IndexedDB clear blocked'));
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    expect(result.current.tenantAuthorityKey).toBeNull();
    expect(mocks.authMe).not.toHaveBeenCalled();
    expect(mocks.clearCachedPhi).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.retryTenantAuthority();
    });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    expect(mocks.clearCachedPhi).toHaveBeenCalledTimes(2);
    expect(mocks.authMe).toHaveBeenCalledTimes(1);
  });

  it('blocks before identity resolution when a mutation survives cache clear', async () => {
    mocks.mutationCacheEntries.mockReturnValue([{
      mutationId: 1,
      state: { status: 'success' },
    }]);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    expect(result.current.tenantAuthorityKey).toBeNull();
    expect(mocks.authMe).not.toHaveBeenCalled();
    expect(mocks.mutationCacheEntries.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('drains an old pending mutation and clears its late cache write before public entry completes', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));

    const mutation = { state: { status: 'pending' } };
    let mutationListener = null;
    mocks.mutationCacheEntries.mockImplementation(() => (
      mutation.state.status === 'pending' ? [mutation] : []
    ));
    mocks.mutationCacheSubscribe.mockImplementation((listener) => {
      mutationListener = listener;
      return () => { mutationListener = null; };
    });
    const clearsBeforeRefresh = mocks.clearQueries.mock.calls.length;
    const sonnerDismissalsBeforeRefresh = mocks.dismissSonnerToasts.mock.calls.length;
    const shadcnClearsBeforeRefresh = mocks.clearShadcnToasts.mock.calls.length;
    const emitLatePatientToast = vi.fn();

    let refreshPromise;
    act(() => {
      refreshPromise = result.current.setPublicRouteActive(true);
    });
    await waitFor(() => expect(mocks.mutationCacheSubscribe).toHaveBeenCalledTimes(1));
    expect(result.current.tenantAuthorityState).toBe(TENANT_AUTHORITY_STATES.SWITCHING);
    expect(mocks.authMe).toHaveBeenCalledTimes(1);
    expect(mocks.clearQueries).toHaveBeenCalledTimes(clearsBeforeRefresh);
    expect(mocks.dismissSonnerToasts).toHaveBeenCalledTimes(
      sonnerDismissalsBeforeRefresh + 1,
    );
    expect(mocks.clearShadcnToasts).toHaveBeenCalledTimes(shadcnClearsBeforeRefresh + 1);

    await act(async () => {
      // This models the old mutation's retained onSuccess callback. It runs
      // while the gate is closed; only after it settles may teardown clear the
      // write and finish closing the staff realm.
      mocks.setQueryData(['messages'], [{ id: 'old-tenant-message' }]);
      emitLatePatientToast('Saved care plan for Patient A');
      mutation.state.status = 'success';
      mutationListener();
      await refreshPromise;
    });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.SWITCHING,
    ));
    expect(mocks.authMe).toHaveBeenCalledTimes(1);
    expect(mocks.setQueryData.mock.invocationCallOrder.at(-2)).toBeLessThan(
      mocks.clearQueries.mock.invocationCallOrder.at(-1),
    );
    expect(mocks.queryCacheEntries()).toEqual([]);
    expect(mocks.mutationCacheEntries()).toEqual([]);
    expect(emitLatePatientToast.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dismissSonnerToasts.mock.invocationCallOrder.at(-1),
    );
    expect(emitLatePatientToast.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearShadcnToasts.mock.invocationCallOrder.at(-1),
    );
    expect(mocks.dismissSonnerToasts.mock.calls.length).toBeGreaterThanOrEqual(
      sonnerDismissalsBeforeRefresh + 2,
    );
    expect(mocks.clearShadcnToasts.mock.calls.length).toBeGreaterThanOrEqual(
      shadcnClearsBeforeRefresh + 2,
    );
  });

  it('rechecks and drains a mutation that begins while public-entry cancellation is in flight', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));

    const cancelStep = deferred();
    mocks.cancelQueries.mockReturnValueOnce(cancelStep.promise);
    let mutation = null;
    let mutationListener = null;
    mocks.mutationCacheEntries.mockImplementation(() => (
      mutation?.state?.status === 'pending' ? [mutation] : []
    ));
    mocks.mutationCacheSubscribe.mockImplementation((listener) => {
      mutationListener = listener;
      return () => { mutationListener = null; };
    });

    let refreshPromise;
    act(() => {
      refreshPromise = result.current.setPublicRouteActive(true);
    });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.SWITCHING,
    ));
    expect(mocks.authMe).toHaveBeenCalledTimes(1);

    await act(async () => {
      mutation = { state: { status: 'pending' } };
      cancelStep.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.mutationCacheSubscribe).toHaveBeenCalledTimes(1));
    expect(mocks.authMe).toHaveBeenCalledTimes(1);

    await act(async () => {
      mutation.state.status = 'success';
      mutationListener();
      await refreshPromise;
    });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.SWITCHING,
    ));
    expect(mocks.authMe).toHaveBeenCalledTimes(1);
    expect(mocks.queryCacheEntries()).toEqual([]);
    expect(mocks.mutationCacheEntries()).toEqual([]);
  });

  it('tears down runtime authority before a tenant-switch broker can run', async () => {
    mocks.listMemberships.mockResolvedValue(membershipResult([A, B]));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.SELECTION_REQUIRED,
    ));

    const purge = deferred();
    mocks.clearCachedPhi.mockReturnValueOnce(purge.promise);
    let selectionPromise;
    act(() => {
      selectionPromise = result.current.selectTenant('agency-b');
    });

    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.SWITCHING,
    ));
    expect(mocks.authMe).toHaveBeenCalledTimes(1);
    expect(mocks.cancelQueries).toHaveBeenCalledTimes(2);
    expect(mocks.clearQueries).toHaveBeenCalledTimes(4);
    expect(mocks.resetAgencyRoster).toHaveBeenCalledTimes(2);

    await act(async () => {
      purge.resolve();
      await selectionPromise;
    });
    expect(result.current.tenantAuthorityState).toBe(TENANT_AUTHORITY_STATES.READY);
  });

  it('requires a fresh document for refresh while keeping unclassified drafts locked', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    sessionStorage.setItem('smart-note-draft', 'keep-me');
    const persistentPurges = mocks.clearCachedPhi.mock.calls.length;
    const runtimeClears = mocks.clearQueries.mock.calls.length;

    await act(async () => {
      await result.current.refreshUser();
    });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));

    expect(sessionStorage.getItem('smart-note-draft')).toBe('keep-me');
    expect(mocks.clearCachedPhi.mock.calls.length).toBeGreaterThan(persistentPurges);
    expect(mocks.clearQueries.mock.calls.length).toBeGreaterThan(runtimeClears);
    expect(result.current.tenantContextError).toMatchObject({
      type: 'browser_authority_change_requires_restart',
    });
  });

  it('keeps drafts locked across a pre-realm transient broker failure and retry', async () => {
    sessionStorage.setItem('smart_note_draft_v2:patient-a', '{"note":"recoverable"}');
    mocks.listMemberships.mockRejectedValueOnce(new Error('temporary network failure'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    expect(result.current.tenantContextError).toMatchObject({
      type: 'tenant_memberships_unavailable',
    });
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-a')).toBe(
      '{"note":"recoverable"}',
    );
    expect(mocks.purgeAuthorityDrafts).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retryTenantAuthority();
    });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    expect(sessionStorage.getItem('smart_note_draft_v2:patient-a')).toBe(
      '{"note":"recoverable"}',
    );
  });

  it('keeps repeated refresh requests terminal for the pinned document realm', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    await act(async () => {
      await result.current.refreshUser();
    });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    const brokerCalls = mocks.authMe.mock.calls.length;
    const clearsAtBlock = mocks.clearQueries.mock.calls.length;
    await act(async () => {
      await result.current.refreshUser();
    });
    expect(result.current.tenantAuthorityState).toBe(TENANT_AUTHORITY_STATES.BLOCKED);
    expect(mocks.clearQueries.mock.calls.length).toBeGreaterThan(clearsAtBlock);
    const clearsAfterRepeat = mocks.clearQueries.mock.calls.length;
    await act(async () => { await Promise.resolve(); });
    expect(mocks.clearQueries).toHaveBeenCalledTimes(clearsAfterRepeat);
    expect(getTrustedTenantContext(result.current.user)).toBeNull();
    expect(mocks.authMe).toHaveBeenCalledTimes(brokerCalls);
  });

  it('purges persistent PHI and requires a fresh document on refresh', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    const oldKey = result.current.tenantAuthorityKey;
    sessionStorage.setItem('smart-note-draft', 'old-tenant-state');
    const priorPurges = mocks.clearCachedPhi.mock.calls.length;

    await act(async () => {
      await result.current.refreshUser();
    });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));

    expect(oldKey).toContain('membership-a');
    expect(result.current.tenantAuthorityKey).toBeNull();
    expect(result.current.tenantContext).toBeNull();
    expect(result.current.tenantContextError).toMatchObject({
      type: 'browser_authority_change_requires_restart',
    });
    expect(sessionStorage.getItem('smart-note-draft')).toBe('old-tenant-state');
    expect(mocks.clearCachedPhi.mock.calls.length).toBeGreaterThan(priorPurges);
    expect(mocks.poisonTenantSdkRealm).toHaveBeenCalled();
  });

  it('cannot reuse READY after a public route without a fresh document', async () => {
    let latestAuth;
    function ProtectedProbe() {
      latestAuth = useAuth();
      return (
        <TenantAuthorityBoundary
          authorityState={latestAuth.tenantAuthorityState}
          authorityKey={latestAuth.tenantAuthorityKey}
          fallback={<div>authority-gate</div>}
        >
          <div>protected-child</div>
        </TenantAuthorityBoundary>
      );
    }

    const { queryByText } = render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(queryByText('protected-child')).not.toBeNull());
    expect(latestAuth.tenantAuthorityState).toBe(TENANT_AUTHORITY_STATES.READY);
    await act(async () => {
      await latestAuth.setPublicRouteActive(true);
    });
    expect(latestAuth.tenantAuthorityState).toBe(TENANT_AUTHORITY_STATES.SWITCHING);
    expect(latestAuth.tenantAuthorityKey).toBeNull();
    expect(queryByText('protected-child')).toBeNull();
    expect(getTrustedTenantContext(latestAuth.user)).toBeNull();

    await act(async () => {
      await latestAuth.setPublicRouteActive(false);
    });
    await waitFor(() => expect(latestAuth.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    expect(queryByText('protected-child')).toBeNull();
    expect(mocks.authMe).toHaveBeenCalledTimes(1);
    expect(mocks.listMemberships).toHaveBeenCalledTimes(1);
    expect(mocks.getTenantContext).toHaveBeenCalledTimes(1);
    expect(latestAuth.tenantAuthorityKey).toBeNull();
    expect(latestAuth.tenantContext).toBeNull();
    expect(latestAuth.tenantContextError).toMatchObject({
      type: 'browser_authority_change_requires_restart',
    });
  });

  it('does not run membership brokers on an in-document public-route return', async () => {
    let latestAuth;
    function ProtectedProbe() {
      latestAuth = useAuth();
      return (
        <TenantAuthorityBoundary
          authorityState={latestAuth.tenantAuthorityState}
          authorityKey={latestAuth.tenantAuthorityKey}
          fallback={<div>authority-gate</div>}
        >
          <div>protected-child</div>
        </TenantAuthorityBoundary>
      );
    }

    const { queryByText } = render(
      <AuthProvider>
        <ProtectedProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(queryByText('protected-child')).not.toBeNull());

    await act(async () => {
      await latestAuth.setPublicRouteActive(true);
    });
    await act(async () => {
      await latestAuth.setPublicRouteActive(false);
    });

    await waitFor(() => expect(latestAuth.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.BLOCKED,
    ));
    expect(latestAuth.tenantContextError).toMatchObject({
      type: 'browser_authority_change_requires_restart',
    });
    expect(latestAuth.tenantAuthorityKey).toBeNull();
    expect(queryByText('protected-child')).toBeNull();
    expect(mocks.authMe).toHaveBeenCalledTimes(1);
    expect(mocks.listMemberships).toHaveBeenCalledTimes(1);
    expect(mocks.getTenantContext).toHaveBeenCalledTimes(1);
  });

  it('does not let a selection that resolves after logout restore stale authority', async () => {
    mocks.listMemberships.mockResolvedValue(membershipResult([A, B]));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.SELECTION_REQUIRED,
    ));

    const contextStep = deferred();
    mocks.getTenantContext.mockReturnValueOnce(contextStep.promise);
    let selectionPromise;
    act(() => {
      selectionPromise = result.current.selectTenant('agency-b');
    });
    await waitFor(() => expect(mocks.getTenantContext).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.logout(false);
    });
    await act(async () => {
      contextStep.resolve({ tenant_context: contextFor(B) });
      await selectionPromise;
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.tenantContext).toBeNull();
    expect(result.current.tenantAuthorityState).toBe(TENANT_AUTHORITY_STATES.SWITCHING);
    expect(mocks.authLogout).toHaveBeenCalledWith();
  });

  it('latches logout so later refresh work cannot skip provider token removal', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    const logoutPurge = deferred();
    mocks.clearCachedPhi.mockReturnValueOnce(logoutPurge.promise);

    let logoutPromise;
    act(() => {
      logoutPromise = result.current.logout(false);
    });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.SWITCHING,
    ));
    await expect(result.current.refreshUser()).resolves.toBe(false);
    await expect(logoutPromise).resolves.toBeUndefined();
    expect(mocks.authLogout).toHaveBeenCalledTimes(1);
    expect(mocks.invalidatePersistedDraftMarkers).toHaveBeenCalledTimes(1);
    expect(result.current.isAuthenticated).toBe(false);

    await act(async () => {
      logoutPurge.resolve();
      await Promise.resolve();
    });
    expect(mocks.authLogout).toHaveBeenCalledTimes(1);
    expect(mocks.authLogout).toHaveBeenCalledWith();
  });

  it('removes the provider token without waiting for a hung pending mutation', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));

    const immediateDraftPurge = deferred();
    let immediateDraftPurgeCompleted = false;
    mocks.purgeAuthorityDrafts.mockImplementationOnce(async () => {
      await immediateDraftPurge.promise;
      immediateDraftPurgeCompleted = true;
    });
    const persistentPurgesBeforeLogout = mocks.clearCachedPhi.mock.calls.length;
    const immediatePersistentPurge = deferred();
    let immediatePersistentPurgeCompleted = false;
    mocks.clearCachedPhi.mockImplementationOnce(async () => {
      await immediatePersistentPurge.promise;
      immediatePersistentPurgeCompleted = true;
    });
    const mutation = { state: { status: 'pending' } };
    let mutationListener = null;
    mocks.mutationCacheEntries.mockImplementation(() => (
      mutation.state.status === 'pending' ? [mutation] : []
    ));
    mocks.mutationCacheSubscribe.mockImplementation((listener) => {
      mutationListener = listener;
      return () => { mutationListener = null; };
    });

    await act(async () => {
      await result.current.logout(false);
    });

    expect(mocks.authLogout).toHaveBeenCalledTimes(1);
    expect(mocks.authLogout).toHaveBeenCalledWith();
    expect(mocks.invalidatePersistedDraftMarkers).toHaveBeenCalledTimes(1);
    expect(mocks.purgeAuthorityDrafts).toHaveBeenCalledTimes(1);
    expect(mocks.purgeAuthorityDrafts.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.authLogout.mock.invocationCallOrder[0],
    );
    expect(mocks.clearCachedPhi).toHaveBeenCalledTimes(persistentPurgesBeforeLogout + 1);
    expect(
      mocks.clearCachedPhi.mock.invocationCallOrder[persistentPurgesBeforeLogout],
    ).toBeLessThan(mocks.authLogout.mock.invocationCallOrder[0]);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.tenantAuthorityState).toBe(TENANT_AUTHORITY_STATES.SWITCHING);

    await waitFor(() => expect(mocks.mutationCacheSubscribe).toHaveBeenCalledTimes(1));
    await act(async () => {
      immediateDraftPurge.resolve();
      immediatePersistentPurge.resolve();
      await immediateDraftPurge.promise;
      await immediatePersistentPurge.promise;
    });
    expect(immediateDraftPurgeCompleted).toBe(true);
    expect(immediatePersistentPurgeCompleted).toBe(true);
    expect(mutation.state.status).toBe('pending');
    expect(mocks.purgeAuthorityDrafts).toHaveBeenCalledTimes(1);

    await act(async () => {
      mutation.state.status = 'success';
      mutationListener();
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.purgeAuthorityDrafts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.clearCachedPhi).toHaveBeenCalledTimes(
      persistentPurgesBeforeLogout + 2,
    ));
  });

  it('always removes the provider token when strict local draft destruction fails', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    mocks.purgeAuthorityDrafts.mockRejectedValueOnce(new Error('IndexedDB blocked'));

    await act(async () => {
      await result.current.logout(false);
    });

    expect(mocks.authLogout).toHaveBeenCalledTimes(1);
    expect(mocks.authLogout).toHaveBeenCalledWith();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.tenantAuthorityKey).toBeNull();
    await waitFor(() => expect(mocks.purgeAuthorityDrafts).toHaveBeenCalled());
  });

  it('always removes the provider token when synchronous logout marker fencing fails', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.tenantAuthorityState).toBe(
      TENANT_AUTHORITY_STATES.READY,
    ));
    mocks.invalidatePersistedDraftMarkers.mockImplementationOnce(() => {
      throw new Error('localStorage marker removal blocked');
    });

    await act(async () => {
      await result.current.logout(false);
    });

    expect(mocks.authLogout).toHaveBeenCalledTimes(1);
    expect(mocks.authLogout).toHaveBeenCalledWith();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.tenantAuthorityKey).toBeNull();
  });
});

describe('TenantAuthorityBoundary', () => {
  it('never mounts protected children before ready and remounts them for a new authority key', () => {
    const events = [];
    function ProtectedChild() {
      useEffect(() => {
        events.push('mount');
        return () => events.push('unmount');
      }, []);
      return <div>protected</div>;
    }

    const { queryByText, rerender } = render(
      <TenantAuthorityBoundary
        authorityState={TENANT_AUTHORITY_STATES.SELECTION_REQUIRED}
        authorityKey={null}
        fallback={<div>gate</div>}
      >
        <ProtectedChild />
      </TenantAuthorityBoundary>,
    );
    expect(queryByText('protected')).toBeNull();
    expect(events).toEqual([]);

    rerender(
      <TenantAuthorityBoundary
        authorityState={TENANT_AUTHORITY_STATES.READY}
        authorityKey="authority-a"
        fallback={<div>gate</div>}
      >
        <ProtectedChild />
      </TenantAuthorityBoundary>,
    );
    expect(queryByText('protected')).not.toBeNull();
    expect(events).toEqual(['mount']);

    rerender(
      <TenantAuthorityBoundary
        authorityState={TENANT_AUTHORITY_STATES.READY}
        authorityKey="authority-b"
        fallback={<div>gate</div>}
      >
        <ProtectedChild />
      </TenantAuthorityBoundary>,
    );
    expect(events).toEqual(['mount', 'unmount', 'mount']);
  });
});
