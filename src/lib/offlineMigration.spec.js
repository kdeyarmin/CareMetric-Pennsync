import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OFFLINE_KEYS } from './offlineKeys';

// addToSyncQueue is the default enqueue; stub the import (tests inject their own).
vi.mock('@/api/base44Client', () => ({ base44: { entities: {} } }));
vi.mock('@/lib/indexedDB', () => ({ addToSyncQueue: vi.fn(async () => {}) }));

import { migrateLegacyOfflineQueues } from './offlineMigration';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
}

describe('migrateLegacyOfflineQueues', () => {
  let enqueue;
  beforeEach(() => { enqueue = vi.fn(async () => {}); });

  const run = (initial) => migrateLegacyOfflineQueues({ enqueue, storage: makeStorage(initial) });
  const actions = () => enqueue.mock.calls.map(([a]) => a);
  const payloadFor = (action) => enqueue.mock.calls.find(([a]) => a === action)?.[1];

  it('replays offline_sync_queue visit + task items (skipping note/vitals)', async () => {
    const { migrated } = await run({
      [OFFLINE_KEYS.SYNC_QUEUE]: JSON.stringify([
        { id: 'offline_1', type: 'visit', data: { id: 'offline_1', patient_id: 'p1', nurse_notes: 'n' } },
        { id: 'offline_2', type: 'task', data: { patient_id: 'p1', task_type: 'follow_up' } },
        { id: 'offline_3', type: 'note', data: { visit_id: 'offline_1', nurse_notes: 'x' } },
      ]),
    });
    expect(migrated).toBe(2);
    expect(actions().sort()).toEqual(['CREATE_TASK', 'CREATE_VISIT']);
    const v = payloadFor('CREATE_VISIT');
    // Stable client_request_id from the legacy id; local placeholder id stripped.
    expect(v.client_request_id).toBe('legacy-sq:offline_1');
    expect(v).not.toHaveProperty('id');
    expect(v).toMatchObject({ patient_id: 'p1', nurse_notes: 'n', status: 'completed' });
  });

  it('replays offline_pending visit_create / incident_create / visit_update and skips synced', async () => {
    const { migrated } = await run({
      [OFFLINE_KEYS.PENDING]: JSON.stringify([
        { id: 'c1', type: 'visit_create', status: 'pending', data: { patient_id: 'p1', created_offline: true } },
        { id: 'c2', type: 'incident_create', status: 'pending', data: { patient_id: 'p1', incident_type: 'fall', created_offline: true } },
        { id: 'c3', type: 'visit_update', status: 'pending', entityId: 'v9', data: { nurse_notes: 'e' } },
        { id: 'c4', type: 'visit_create', status: 'synced', data: { patient_id: 'p2' } },
      ]),
    });
    expect(migrated).toBe(3);
    expect(actions().sort()).toEqual(['CREATE_INCIDENT', 'CREATE_VISIT', 'UPDATE_VISIT']);
    // created_offline bookkeeping stripped from the incident payload.
    expect(payloadFor('CREATE_INCIDENT')).not.toHaveProperty('created_offline');
    expect(payloadFor('UPDATE_VISIT')).toMatchObject({ visit_id: 'v9', nurse_notes: 'e' });
  });

  it('replays penn_sync_offline pending visits/updates (skipping synced + offline_ update targets)', async () => {
    const { migrated } = await run({
      [OFFLINE_KEYS.PENN_PENDING_VISITS]: JSON.stringify([
        { id: 'offline_a', synced: false, data: { patient_id: 'p1' } },
        { id: 'offline_b', synced: true, data: { patient_id: 'p2' } },
      ]),
      [OFFLINE_KEYS.PENN_PENDING_UPDATES]: JSON.stringify([
        { visitId: 'real-1', synced: false, data: { nurse_notes: 'u' } },
        { visitId: 'offline_c', synced: false, data: { nurse_notes: 'skip' } },
      ]),
    });
    expect(migrated).toBe(2);
    expect(payloadFor('CREATE_VISIT')).toMatchObject({ client_request_id: 'legacy-penn:offline_a', patient_id: 'p1' });
    expect(payloadFor('UPDATE_VISIT')).toMatchObject({ visit_id: 'real-1', nurse_notes: 'u' });
  });

  it('replays offline_visit_drafts with a patient_id (skips blank drafts)', async () => {
    const { migrated } = await run({
      [OFFLINE_KEYS.VISIT_DRAFTS]: JSON.stringify([
        { id: 'd1', patient_id: 'p1', nurse_notes: 'draft', lastSaved: 'x' },
        { id: 'd2', nurse_notes: 'no patient' },
      ]),
    });
    expect(migrated).toBe(1);
    expect(payloadFor('CREATE_VISIT')).toMatchObject({ client_request_id: 'legacy-draft:d1', patient_id: 'p1', status: 'completed' });
    expect(payloadFor('CREATE_VISIT')).not.toHaveProperty('lastSaved');
  });

  it('clears each store after migration so a second run is a no-op (idempotent)', async () => {
    const storage = makeStorage({
      [OFFLINE_KEYS.SYNC_QUEUE]: JSON.stringify([{ id: 'x', type: 'visit', data: { patient_id: 'p1' } }]),
    });
    const first = await migrateLegacyOfflineQueues({ enqueue, storage });
    expect(first.migrated).toBe(1);
    expect(storage.has(OFFLINE_KEYS.SYNC_QUEUE)).toBe(false);

    enqueue.mockClear();
    const second = await migrateLegacyOfflineQueues({ enqueue, storage });
    expect(second.migrated).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('leaves a malformed store untouched (never destroys unparseable PHI)', async () => {
    const storage = makeStorage({ [OFFLINE_KEYS.SYNC_QUEUE]: '{not json' });
    const { migrated } = await migrateLegacyOfflineQueues({ enqueue, storage });
    expect(migrated).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(storage.has(OFFLINE_KEYS.SYNC_QUEUE)).toBe(true);
  });
});
