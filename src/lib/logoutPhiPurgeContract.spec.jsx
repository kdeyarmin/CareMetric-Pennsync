// What logout actually removes from browser storage, driven through AuthContext.logout
// with the REAL phiStorage.
//
// AuthContext.spec.jsx mocks '@/lib/phiStorage' wholesale, so it proves logout CALLS a
// purge; phiStorage.spec.js calls each purge directly, so it proves the purge WORKS.
// Neither proves that the two meet, and that gap is what let the retired-queue cleanup
// sit in clearCachedPHI — a function with no production caller — while every suite stayed
// green. This file is the seam: real logout, real storage, assertions on the bytes.
//
// So mock only what cannot run in jsdom (the provider client, the query client, the SDK
// realm gate) and NEVER '@/lib/phiStorage'.
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMe: vi.fn(),
  authLogout: vi.fn(),
  getPublicSettings: vi.fn(),
  getTenantContext: vi.fn(),
  listMemberships: vi.fn(),
  cancelQueries: vi.fn(),
  clearQueries: vi.fn(),
  queryCacheEntries: vi.fn(() => []),
  mutationCacheEntries: vi.fn(() => []),
  mutationCacheSubscribe: vi.fn(() => () => {}),
  setQueryData: vi.fn(),
}));

// This suite is the Base44 path, where neither is present. Both are declared
// rather than left off, because an absent export is a thrown error at the call
// site rather than the `null` this suite means.
vi.mock('@/lib/independentStagingSession', () => ({
  get independentStagingAuth() { return null; },
  get ownedBackendAuth() { return null; },
}));

vi.mock('sonner', () => ({ toast: { dismiss: vi.fn() } }));
vi.mock('@/components/ui/use-toast', () => ({ clearAllToasts: vi.fn() }));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: mocks.authMe, logout: mocks.authLogout, redirectToLogin: vi.fn() },
  },
  tenantAuthorityClient: { me: (...args) => mocks.authMe(...args) },
}));

vi.mock('@/lib/app-params', () => ({
  appParams: { appId: 'app-test', serverUrl: 'https://example.test', token: 'test-token' },
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

vi.mock('@/lib/agencyRoster', () => ({ resetAgencyRosterCache: vi.fn() }));

vi.mock('@/lib/tenantSdkRealmGate', () => ({
  closeTenantSdkRealm: vi.fn(),
  hasPinnedTenantSdkRealm: vi.fn(() => false),
  openTenantSdkRealm: vi.fn(),
  poisonTenantSdkRealm: vi.fn(),
}));

vi.mock('@/functions/getMyTenantContext', () => ({
  bootstrapMyTenantContext: mocks.getTenantContext,
  getMyTenantContext: mocks.getTenantContext,
}));

vi.mock('@/functions/listMyTenantMemberships', () => ({
  listMyTenantMemberships: mocks.listMemberships,
}));

const { AuthProvider, useAuth } = await import('@/lib/AuthContext');

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('what logout removes from browser storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.authMe.mockRejectedValue(new Error('not authenticated'));
    mocks.getPublicSettings.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const logoutOnce = async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await result.current.logout(false); });
  };

  it('removes the re-fetchable patient caches a returning nurse would otherwise find', async () => {
    localStorage.setItem('offline_patients', '[{"id":"patient-1","first_name":"Sensitive"}]');
    localStorage.setItem('recentPatients_user-a', '["patient-1"]');

    await logoutOnce();

    expect(localStorage.getItem('offline_patients')).toBeNull();
    expect(localStorage.getItem('recentPatients_user-a')).toBeNull();
  });

  it('removes the retired queue entries the server acknowledged and keeps the rest', async () => {
    // `synced` was written by the removed mobile/OfflineStorage.jsx only after the awaited
    // Visit.create/update resolved, so a marked entry is a duplicate of a server record.
    localStorage.setItem('penn_sync_offline_pending_visits', JSON.stringify([
      { id: 'offline_1', synced: true, data: { nurse_notes: 'reached the server' } },
      { id: 'offline_2', synced: false, data: { nurse_notes: 'only on this device' } },
    ]));
    localStorage.setItem('penn_sync_offline_pending_updates', JSON.stringify([
      { visitId: 'v1', synced: true, data: { vital_signs: { bp: '120/80' } } },
    ]));

    await logoutOnce();

    expect(JSON.parse(localStorage.getItem('penn_sync_offline_pending_visits'))).toEqual([
      { id: 'offline_2', synced: false, data: { nurse_notes: 'only on this device' } },
    ]);
    expect(localStorage.getItem('penn_sync_offline_pending_updates')).toBeNull();
  });

  // The other half of the same contract, and the reason the purge is gated rather than
  // unconditional: no marker was ever written into these three, so logging out must not
  // decide that the work in them reached the server.
  it('leaves the unmarked retired queues and the quarantined conflicts in place', async () => {
    localStorage.setItem('offline_pending', '[{"id":"c1","status":"pending"}]');
    localStorage.setItem('offline_sync_queue', '[{"id":"q1","type":"visit"}]');
    localStorage.setItem('offline_visit_drafts', '[{"id":"d1","patient_id":"p1"}]');
    localStorage.setItem('offline_conflicts', '[{"id":"x1"}]');

    await logoutOnce();

    expect(localStorage.getItem('offline_pending')).toBe('[{"id":"c1","status":"pending"}]');
    expect(localStorage.getItem('offline_sync_queue')).toBe('[{"id":"q1","type":"visit"}]');
    expect(localStorage.getItem('offline_visit_drafts')).toBe('[{"id":"d1","patient_id":"p1"}]');
    expect(localStorage.getItem('offline_conflicts')).toBe('[{"id":"x1"}]');
  });

  it('removes the provider token even when a retired queue cannot be interpreted', async () => {
    localStorage.setItem('penn_sync_offline_pending_visits', 'not json at all');

    await logoutOnce();

    expect(localStorage.getItem('penn_sync_offline_pending_visits')).toBe('not json at all');
    expect(mocks.authLogout).toHaveBeenCalled();
  });

  // Two call sites reach the same purge during logout — the immediate one and the
  // serialized tenant teardown — so with mutations idle, deleting EITHER leaves the cases
  // above green and neither is pinned. A hung mutation is the state that separates them:
  // it is why the immediate call exists, and it blocks the teardown's copy, so this is the
  // only case in which the shared-device guarantee rests on one named call site.
  it('purges on a shared device even while a hung mutation blocks the tenant teardown', async () => {
    mocks.mutationCacheEntries.mockReturnValue([{ state: { status: 'pending' } }]);
    localStorage.setItem('offline_patients', '[{"id":"patient-1","first_name":"Sensitive"}]');
    localStorage.setItem('penn_sync_offline_pending_visits', JSON.stringify([
      { id: 'offline_1', synced: true, data: { nurse_notes: 'reached the server' } },
      { id: 'offline_2', synced: false, data: { nurse_notes: 'only on this device' } },
    ]));

    await logoutOnce();

    expect(localStorage.getItem('offline_patients')).toBeNull();
    expect(JSON.parse(localStorage.getItem('penn_sync_offline_pending_visits'))).toEqual([
      { id: 'offline_2', synced: false, data: { nurse_notes: 'only on this device' } },
    ]);
    expect(mocks.authLogout).toHaveBeenCalled();
  });
});
