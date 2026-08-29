// Regression tests for the HIPAA logout/idle-timeout PHI purge.
//
// The purge must (1) remove re-fetchable cached PHI, (2) remove the synced
// (already-uploaded) copies of offline work, and (3) PRESERVE work still pending
// sync — wiping unsynced field documentation on a 15-min idle timeout would be
// silent loss of care. These cases lock that contract in.
//
// clearCachedPHI also clears the retired IndexedDB patient roster. jsdom has no
// IndexedDB, so that branch is inert here and these cases cover the localStorage
// half plus the retirement gate.
import { describe, it, expect, beforeEach } from 'vitest';

import { OFFLINE_RETIRED_FLAG } from './localPhiKeys';
import { clearCachedPHI } from './phiStorage';

describe('clearCachedPHI', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('purges re-fetchable cached PHI keys', async () => {
    localStorage.setItem('offline_patients', '[{"id":"p1"}]');
    localStorage.setItem('recentPatients_user1', '["p1"]');
    localStorage.setItem('oasis_data_abc', '{"m0":1}');
    localStorage.setItem('penn_sync_offline_cache_roster', '{"data":[]}');

    await clearCachedPHI();

    expect(localStorage.getItem('offline_patients')).toBeNull();
    expect(localStorage.getItem('recentPatients_user1')).toBeNull();
    expect(localStorage.getItem('oasis_data_abc')).toBeNull();
    expect(localStorage.getItem('penn_sync_offline_cache_roster')).toBeNull();
  });

  it('purges the sync-error log (full item PHI + stack traces)', async () => {
    localStorage.setItem(
      'penn_sync_offline_sync_errors',
      JSON.stringify([{ itemData: { nurse_notes: 'PHI' }, stack: 'Error: ...' }])
    );
    localStorage.setItem('penn_sync_offline_sync_status', '{"isSyncing":false}');

    await clearCachedPHI();

    expect(localStorage.getItem('penn_sync_offline_sync_errors')).toBeNull();
    expect(localStorage.getItem('penn_sync_offline_sync_status')).toBeNull();
  });

  it('preserves an in-progress local draft', async () => {
    // The OASIS assessment autosave. Wiping it on a 15-minute idle timeout
    // mid-assessment would be silent loss of documented care.
    localStorage.setItem('visit_draft_42', '{"notes":"still being written"}');

    await clearCachedPHI();

    expect(localStorage.getItem('visit_draft_42')).not.toBeNull();
  });

  const seedRetiredQueues = () => {
    localStorage.setItem('offline_pending', '[{"id":"c1"}]');
    localStorage.setItem('offline_visit_drafts', '{"v1":"draft"}');
    localStorage.setItem('offline_sync_queue', '[{"id":"q1"}]');
    localStorage.setItem('offline_conflicts', '[{"id":"x1"}]');
  };
  const retiredQueueValues = () => [
    localStorage.getItem('offline_pending'),
    localStorage.getItem('offline_visit_drafts'),
    localStorage.getItem('offline_sync_queue'),
    localStorage.getItem('offline_conflicts'),
  ];

  it('purges the retired offline queues ONCE their contents reached the server', async () => {
    // retiredOfflineQueue.js sets this flag only after a complete flush. After
    // that these are duplicates of server state, and leaving them on a shared
    // device is pure exposure.
    seedRetiredQueues();
    localStorage.setItem(OFFLINE_RETIRED_FLAG, '1');

    await clearCachedPHI();

    expect(retiredQueueValues()).toEqual([null, null, null, null]);
  });

  it('KEEPS the retired offline queues until retirement has completed', async () => {
    // Regression: these were purged unconditionally. The recovery flush needs a
    // connection, so a nurse who documented a visit offline and then logged out
    // (or idled out) had that documentation destroyed before it was ever sent —
    // including the stores the migration deliberately preserved because an item
    // could not be safely mapped.
    seedRetiredQueues();
    // no retirement flag: the flush has not confirmed anything reached the server

    await clearCachedPHI();

    expect(retiredQueueValues()).toEqual([
      '[{"id":"c1"}]',
      '{"v1":"draft"}',
      '[{"id":"q1"}]',
      '[{"id":"x1"}]',
    ]);
  });

  it('drops synced offline visits but keeps unsynced ones', async () => {
    localStorage.setItem(
      'penn_sync_offline_pending_visits',
      JSON.stringify([
        { id: 'offline_1', synced: true, data: { nurse_notes: 'sent' } },
        { id: 'offline_2', synced: false, data: { nurse_notes: 'pending' } },
      ])
    );

    await clearCachedPHI();

    const remaining = JSON.parse(
      localStorage.getItem('penn_sync_offline_pending_visits')
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('offline_2');
    expect(remaining[0].synced).toBe(false);
  });

  it('removes the pending-visits key entirely when every entry is synced', async () => {
    localStorage.setItem(
      'penn_sync_offline_pending_updates',
      JSON.stringify([
        { visitId: 'v1', synced: true },
        { visitId: 'v2', synced: true },
      ])
    );

    await clearCachedPHI();

    expect(localStorage.getItem('penn_sync_offline_pending_updates')).toBeNull();
  });

  it('leaves a malformed offline-queue value untouched rather than throwing', async () => {
    localStorage.setItem('penn_sync_offline_pending_visits', 'not-json');

    await expect(clearCachedPHI()).resolves.toBeUndefined();
    expect(localStorage.getItem('penn_sync_offline_pending_visits')).toBe('not-json');
  });
});
