import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindTrustedTenantContext,
  clearTrustedTenantContext,
  getTenantAuthorityKey,
} from './roles.js';

const { userList, authMe } = vi.hoisted(() => ({
  userList: vi.fn(),
  authMe: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    entities: { User: { list: userList } },
    auth: { me: authMe },
  },
}));

const {
  loadAgencyRoster,
  loadCurrentCaller,
  resetAgencyRosterCache,
  scopePatientsToCallerAgency,
  scopePatientsForCurrentCaller,
  describeCallerPatientScope,
  agencyQueryKey,
} = await import('./agencyRoster.js');

const CALLER = {
  id: 'caller-acme',
  email: 'admin@acme.test',
  role: 'admin',
  agency_id: 'mutable-other',
  agency_name: 'Mutable Other',
};

const OWNER = {
  id: 'platform-owner',
  email: 'owner@example.test',
  role: 'admin',
};

const ROSTER = [
  { email: 'a@x.com', agency_id: 'ag_acme', agency_name: 'Acme' },
  { email: 'b@x.com', agency_id: 'ag_other', agency_name: 'Other' },
];

function regularContext(user, {
  agencyId = 'ag_acme',
  agencyName = 'Acme',
  membershipId = 'membership-acme',
  membershipVersion = 2,
  tenantRole = 'agency_admin',
} = {}) {
  return {
    user_id: user.id,
    user_email: user.email.toLowerCase(),
    membership_id: membershipId,
    membership_key: `${agencyId}:${user.id}`,
    membership_version: membershipVersion,
    agency_id: agencyId,
    membership_status: 'active',
    tenant_role: tenantRole,
    is_platform_owner: false,
    agency: { id: agencyId, name: agencyName, status: 'active' },
  };
}

function bindRegular(user = CALLER, options) {
  bindTrustedTenantContext(user, regularContext(user, options));
  return user;
}

function bindOwner(user = OWNER) {
  bindTrustedTenantContext(user, {
    user_id: user.id,
    user_email: user.email.toLowerCase(),
    membership_id: null,
    membership_key: null,
    membership_version: null,
    agency_id: null,
    membership_status: null,
    tenant_role: 'platform_owner',
    is_platform_owner: true,
    agency: null,
  });
  return user;
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

describe('agencyRoster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
    resetAgencyRosterCache();
    clearTrustedTenantContext();
    bindRegular();
    userList.mockReset().mockResolvedValue(ROSTER);
    authMe.mockReset().mockResolvedValue({ ...CALLER });
  });

  afterEach(() => {
    clearTrustedTenantContext();
    vi.useRealTimers();
  });

  describe('loadAgencyRoster', () => {
    it('fetches once and reuses the result inside the TTL', async () => {
      expect(await loadAgencyRoster()).toEqual(ROSTER);
      expect(await loadAgencyRoster()).toEqual(ROSTER);
      expect(userList).toHaveBeenCalledTimes(1);
    });

    it('refetches once the TTL has elapsed', async () => {
      await loadAgencyRoster();
      vi.setSystemTime(new Date('2026-08-15T12:01:01Z'));
      await loadAgencyRoster();
      expect(userList).toHaveBeenCalledTimes(2);
    });

    it('shares one request between concurrent callers', async () => {
      const [first, second] = await Promise.all([loadAgencyRoster(), loadAgencyRoster()]);
      expect(first).toEqual(ROSTER);
      expect(second).toEqual(ROSTER);
      expect(userList).toHaveBeenCalledTimes(1);
    });

    it('never rejects, and does not cache a failure', async () => {
      userList.mockRejectedValueOnce(new Error('offline'));
      await expect(loadAgencyRoster()).resolves.toEqual([]);

      userList.mockResolvedValue(ROSTER);
      expect(await loadAgencyRoster()).toEqual(ROSTER);
      expect(userList).toHaveBeenCalledTimes(2);
    });

    it('keeps serving the last good roster when a refresh fails', async () => {
      await loadAgencyRoster();
      vi.setSystemTime(new Date('2026-08-15T12:01:01Z'));
      userList.mockRejectedValueOnce(new Error('flaky'));
      expect(await loadAgencyRoster()).toEqual(ROSTER);
    });

    it('tolerates a non-array response', async () => {
      userList.mockResolvedValueOnce(null);
      expect(await loadAgencyRoster()).toEqual([]);
    });

    it('does not let a pre-transition roster response repopulate the cache', async () => {
      const staleResult = deferred();
      const freshResult = deferred();
      const freshRoster = [{ email: 'new@x.com', agency_id: 'ag_other', agency_name: 'Other' }];
      userList
        .mockReset()
        .mockReturnValueOnce(staleResult.promise)
        .mockReturnValueOnce(freshResult.promise);

      const staleLoad = loadAgencyRoster();
      resetAgencyRosterCache();
      const freshLoad = loadAgencyRoster();

      freshResult.resolve(freshRoster);
      expect(await freshLoad).toEqual(freshRoster);
      staleResult.resolve(ROSTER);
      expect(await staleLoad).toEqual([]);
      expect(await loadAgencyRoster()).toEqual(freshRoster);
      expect(userList).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadCurrentCaller', () => {
    it('memoizes the signed-in user', async () => {
      await loadCurrentCaller();
      await loadCurrentCaller();
      expect(authMe).toHaveBeenCalledTimes(1);
    });

    it('resolves to null while auth is unavailable, which fails closed', async () => {
      authMe.mockRejectedValue(new Error('401'));
      expect(await loadCurrentCaller()).toBeNull();
      expect(await scopePatientsForCurrentCaller([{ id: '1' }])).toEqual([]);
    });

    it('retries after a transient auth failure rather than caching the miss', async () => {
      authMe.mockRejectedValueOnce(new Error('flaky'));
      expect(await loadCurrentCaller()).toBeNull();
      expect(await loadCurrentCaller()).toEqual(CALLER);
    });

    it('does not let a pre-transition auth response replace the current caller', async () => {
      const staleResult = deferred();
      const freshResult = deferred();
      const freshCaller = { ...CALLER, care_scope: 'hospice' };
      authMe
        .mockReset()
        .mockReturnValueOnce(staleResult.promise)
        .mockReturnValueOnce(freshResult.promise);

      const staleLoad = loadCurrentCaller();
      resetAgencyRosterCache();
      const freshLoad = loadCurrentCaller();

      freshResult.resolve(freshCaller);
      expect(await freshLoad).toEqual(freshCaller);
      staleResult.resolve({ ...CALLER, care_scope: 'home_health' });
      expect(await staleLoad).toBeNull();
      expect(await loadCurrentCaller()).toEqual(freshCaller);
      expect(authMe).toHaveBeenCalledTimes(2);
    });
  });

  describe('scoping', () => {
    const patients = [
      { id: 'ours', created_by: 'a@x.com' },
      { id: 'theirs', created_by: 'b@x.com' },
      { id: 'orphan', created_by: 'service@no-reply.base44.com' },
    ];

    it('filters against the shared roster using the trusted tenant', async () => {
      const out = await scopePatientsToCallerAgency(patients, CALLER);
      expect(out.map((patient) => patient.id)).toEqual(['ours', 'orphan']);
    });

    it('resolves a freshly fetched caller only when it matches the binding', async () => {
      const out = await scopePatientsForCurrentCaller(patients);
      expect(out.map((patient) => patient.id)).toEqual(['ours', 'orphan']);

      resetAgencyRosterCache();
      authMe.mockResolvedValueOnce({ ...CALLER, id: 'other-account' });
      expect(await scopePatientsForCurrentCaller(patients)).toEqual([]);
    });

    it('reports the unattributable backlog for the trusted tenant', async () => {
      expect(await describeCallerPatientScope(patients, CALLER)).toEqual({
        scoped: true, total: 3, visible: 2, hidden: 1, unattributable: 1,
      });
    });

    it('fails closed after trusted authority is cleared', async () => {
      clearTrustedTenantContext();
      expect(await scopePatientsToCallerAgency(patients, CALLER)).toEqual([]);
    });
  });

  describe('agencyQueryKey', () => {
    it('is null without an exact trusted context', () => {
      expect(agencyQueryKey(null)).toBeNull();
      expect(agencyQueryKey(undefined)).toBeNull();
      expect(agencyQueryKey({ ...CALLER, id: 'stale-principal' })).toBeNull();

      clearTrustedTenantContext();
      expect(agencyQueryKey(CALLER)).toBeNull();
      expect(agencyQueryKey({ role: 'admin', account_type: 'super_admin' })).toBeNull();
    });

    it('is exactly the trusted authority key, not a mutable User field', () => {
      const expected = getTenantAuthorityKey(CALLER);
      expect(agencyQueryKey(CALLER)).toBe(expected);
      expect(agencyQueryKey({
        ...CALLER,
        role: 'user',
        account_type: 'super_admin',
        agency_id: 'ag_other',
        agency_name: 'Other',
      })).toBe(expected);
    });

    it('changes when the membership version or tenant role changes', () => {
      const original = agencyQueryKey(CALLER);

      bindRegular(CALLER, { membershipVersion: 3 });
      const versionChanged = agencyQueryKey(CALLER);
      expect(versionChanged).not.toBe(original);

      bindRegular(CALLER, { membershipVersion: 3, tenantRole: 'manager' });
      expect(agencyQueryKey(CALLER)).not.toBe(versionChanged);
    });

    it('changes when the trusted agency or membership changes', () => {
      const original = agencyQueryKey(CALLER);
      bindRegular(CALLER, {
        agencyId: 'ag_other',
        agencyName: 'Other',
        membershipId: 'membership-other',
      });
      const switched = agencyQueryKey(CALLER);
      expect(switched).not.toBe(original);
      expect(switched).toContain('ag_other');
      expect(switched).toContain('membership-other');
    });

    it('separates a validated owner authority from regular tenant authority', () => {
      const regular = agencyQueryKey(CALLER);
      const owner = bindOwner();
      const ownerKey = agencyQueryKey(owner);
      expect(ownerKey).not.toBeNull();
      expect(ownerKey).not.toBe(regular);
      expect(ownerKey).toContain('platform_owner');
    });

    it('changes across authenticated principals', () => {
      const first = agencyQueryKey(CALLER);
      const secondCaller = {
        id: 'caller-second',
        email: 'second@acme.test',
        role: 'admin',
      };
      bindRegular(secondCaller, { membershipId: 'membership-second' });
      expect(agencyQueryKey(secondCaller)).not.toBe(first);
      expect(agencyQueryKey(CALLER)).toBeNull();
    });
  });
});
