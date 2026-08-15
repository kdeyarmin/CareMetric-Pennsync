import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const ROSTER = [
  { email: 'a@x.com', agency_name: 'Acme' },
  { email: 'b@x.com', agency_name: 'Other' },
];

describe('agencyRoster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
    resetAgencyRosterCache();
    userList.mockReset().mockResolvedValue(ROSTER);
    authMe.mockReset().mockResolvedValue({ role: 'admin', agency_name: 'Acme' });
  });

  afterEach(() => {
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
      vi.setSystemTime(new Date('2026-08-15T12:01:01Z')); // 61s later
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
      // A rejection here would surface as an unhandled query error; worse, an []
      // result cached as "this agency has no staff" would hide every chart.
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
      expect(await loadCurrentCaller()).toEqual({ role: 'admin', agency_name: 'Acme' });
    });
  });

  describe('scoping', () => {
    const patients = [
      { id: 'ours', created_by: 'a@x.com' },
      { id: 'theirs', created_by: 'b@x.com' },
      { id: 'orphan', created_by: 'service@no-reply.base44.com' },
    ];

    it('filters against the shared roster', async () => {
      const out = await scopePatientsToCallerAgency(patients, { role: 'admin', agency_name: 'Acme' });
      expect(out.map((p) => p.id)).toEqual(['ours', 'orphan']);
    });

    it('resolves the caller itself when none is passed', async () => {
      const out = await scopePatientsForCurrentCaller(patients);
      expect(out.map((p) => p.id)).toEqual(['ours', 'orphan']);
    });

    it('reports the unattributable backlog', async () => {
      const summary = await describeCallerPatientScope(patients, {
        role: 'admin',
        agency_name: 'Acme',
      });
      expect(summary).toEqual({
        scoped: true, total: 3, visible: 2, hidden: 1, unattributable: 1,
      });
    });
  });

  describe('agencyQueryKey', () => {
    it('is null while the caller is unknown, so the key changes once it loads', () => {
      expect(agencyQueryKey(null)).toBeNull();
      expect(agencyQueryKey(undefined)).toBeNull();
    });

    it('separates super_admin from an agency-scoped caller', () => {
      // super_admin sees everything, so its cache entry must not be shared with
      // an admin of the agency it happens to be tagged with.
      expect(agencyQueryKey({ account_type: 'super_admin', agency_name: 'Acme' })).toBe('super_admin');
      expect(agencyQueryKey({ role: 'admin', agency_name: 'Acme' })).toBe('Acme');
    });

    it('prefers agency_id, which survives a rename', () => {
      expect(agencyQueryKey({ agency_id: 'ag_1', agency_name: 'Acme' })).toBe('ag_1');
    });

    it('marks a caller with no agency as platform-wide', () => {
      expect(agencyQueryKey({ role: 'admin' })).toBe('platform');
      expect(agencyQueryKey({ role: 'admin', agency_name: '   ' })).toBe('platform');
    });
  });
});
