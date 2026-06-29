// Regression tests for the HIPAA logout/idle-timeout PHI purge.
//
// The purge must (1) remove re-fetchable cached PHI, (2) remove the synced
// (already-uploaded) copies of offline work, and (3) PRESERVE work still pending
// sync — wiping unsynced field documentation on a 15-min idle timeout would be
// silent loss of care. These cases lock that contract in.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// clearCachedPHI also clears the IndexedDB patient cache; that path is covered
// elsewhere and needs a real IndexedDB, so stub it here to a no-op resolve.
vi.mock('./indexedDB', () => ({
  clearCachedPatients: vi.fn().mockResolvedValue(undefined),
}));

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

  it('preserves work still pending sync', async () => {
    localStorage.setItem('offline_pending', '[{"id":"c1"}]');
    localStorage.setItem('offline_visit_drafts', '{"v1":"draft"}');
    localStorage.setItem('offline_sync_queue', '[{"id":"q1"}]');
    localStorage.setItem('visit_draft_42', '{"notes":"unsynced"}');

    await clearCachedPHI();

    expect(localStorage.getItem('offline_pending')).not.toBeNull();
    expect(localStorage.getItem('offline_visit_drafts')).not.toBeNull();
    expect(localStorage.getItem('offline_sync_queue')).not.toBeNull();
    expect(localStorage.getItem('visit_draft_42')).not.toBeNull();
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
