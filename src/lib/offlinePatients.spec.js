import { describe, it, expect } from 'vitest';
import { mergeOfflinePatientCaches, withOfflineRosterFallback } from './offlinePatients';

const boom = () => Promise.reject(new Error('network down'));

describe('withOfflineRosterFallback', () => {
  it('returns the remote result when the fetch succeeds', async () => {
    const remote = [{ id: 'p1' }];
    const result = await withOfflineRosterFallback(async () => remote, {
      isOffline: () => true,
      getLocal: async () => [{ id: 'local' }],
    });
    expect(result).toBe(remote);
  });

  it('serves the local cache when offline and the fetch fails', async () => {
    const local = [{ id: 'cached-1' }, { id: 'cached-2' }];
    const result = await withOfflineRosterFallback(boom, {
      isOffline: () => true,
      getLocal: async () => local,
    });
    expect(result).toBe(local);
  });

  it('rethrows an ONLINE failure instead of masking it with stale data', async () => {
    await expect(
      withOfflineRosterFallback(boom, {
        isOffline: () => false,
        getLocal: async () => [{ id: 'cached' }],
      })
    ).rejects.toThrow('network down');
  });

  it('rethrows when offline but the local cache is empty', async () => {
    await expect(
      withOfflineRosterFallback(boom, {
        isOffline: () => true,
        getLocal: async () => [],
      })
    ).rejects.toThrow('network down');
  });

  it('rethrows when offline and the local cache read itself fails', async () => {
    await expect(
      withOfflineRosterFallback(boom, {
        isOffline: () => true,
        getLocal: async () => { throw new Error('idb unavailable'); },
      })
    ).rejects.toThrow('network down');
  });
});


describe('mergeOfflinePatientCaches', () => {
  it('merges legacy detailed cache entries with IndexedDB roster patients', () => {
    const merged = mergeOfflinePatientCaches(
      [{ patient: { id: 'p1', first_name: 'Ada' }, recentVisits: [{ id: 'v1' }], cachedAt: 'now' }],
      [{ id: 'p2', first_name: 'Grace' }]
    );

    expect(merged).toEqual([
      { patient: { id: 'p1', first_name: 'Ada' }, recentVisits: [{ id: 'v1' }], cachedAt: 'now' },
      { patient: { id: 'p2', first_name: 'Grace' }, recentVisits: [], carePlans: [], cachedAt: null },
    ]);
  });

  it('dedupes by patient id and keeps richer legacy entries first', () => {
    const merged = mergeOfflinePatientCaches(
      [{ patient: { id: 'p1', first_name: 'Legacy' }, recentVisits: [{ id: 'v1' }] }],
      [{ id: 'p1', first_name: 'IndexedDB' }]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].patient.first_name).toBe('Legacy');
    expect(merged[0].recentVisits).toEqual([{ id: 'v1' }]);
  });
});
