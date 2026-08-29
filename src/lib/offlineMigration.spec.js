import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LOCAL_PHI_KEYS } from './localPhiKeys';


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

  // Migrating no longer deletes anything on its own — the caller commits the clear
  // once the migrated writes have reached the server. These cases describe the
  // POST-commit state, so the helper performs that commit; the deferral itself is
  // covered by its own test below.
  const run = (initial) => {
    const storage = makeStorage(initial);
    return migrateLegacyOfflineQueues({ enqueue, storage }).then((r) => {
      r.clearMigratedStores();
      return { ...r, storage };
    });
  };
  const actions = () => enqueue.mock.calls.map(([a]) => a);
  const calls = (action) => enqueue.mock.calls.filter(([a]) => a === action).map(([, p]) => p);
  const one = (action) => calls(action)[0];

  it('replays offline_sync_queue visit + task items and clears the store', async () => {
    const { migrated, storage } = await run({
      [LOCAL_PHI_KEYS.SYNC_QUEUE]: JSON.stringify([
        { id: 'offline_1', type: 'visit', data: { patient_id: 'p1', nurse_notes: 'n' } },
        { id: 'offline_2', type: 'task', data: { patient_id: 'p1', task_type: 'follow_up' } },
      ]),
    });
    expect(migrated).toBe(2);
    expect(actions().sort()).toEqual(['CREATE_TASK', 'CREATE_VISIT']);
    expect(one('CREATE_VISIT')).toMatchObject({ client_request_id: 'legacy-sq:offline_1', patient_id: 'p1', status: 'completed' });
    // The migrated task carries a stable idempotency key so a crash-retry can't duplicate it.
    expect(one('CREATE_TASK')).toMatchObject({ client_request_id: 'legacy-task:offline_2', patient_id: 'p1' });
    expect(storage.has(LOCAL_PHI_KEYS.SYNC_QUEUE)).toBe(false);
  });

  it('replays a real-id visit edit as UPDATE_VISIT, not a duplicate create', async () => {
    const { migrated } = await run({
      [LOCAL_PHI_KEYS.SYNC_QUEUE]: JSON.stringify([
        { id: 'offline_x', type: 'visit', data: { visit_id: 'real-9', nurse_notes: 'edited' } },
      ]),
    });
    expect(migrated).toBe(1);
    expect(actions()).toEqual(['UPDATE_VISIT']);
    expect(one('UPDATE_VISIT')).toMatchObject({ visit_id: 'real-9', nurse_notes: 'edited' });
    expect(one('UPDATE_VISIT')).not.toHaveProperty('visit_id', 'offline_x');
  });

  it('folds a queued note/vitals into its visit create (same offline id)', async () => {
    const { migrated } = await run({
      [LOCAL_PHI_KEYS.SYNC_QUEUE]: JSON.stringify([
        { id: 'v', type: 'visit', data: { id: 'offline_v1', patient_id: 'p1' } },
        { id: 'n', type: 'note', data: { visit_id: 'offline_v1', nurse_notes: 'folded note' } },
        { id: 'vi', type: 'vitals', data: { visit_id: 'offline_v1', vital_signs: { heart_rate: 80 } } },
      ]),
    });
    // One CREATE_VISIT carrying the folded note + vitals — no orphaned updates.
    expect(migrated).toBe(1);
    expect(actions()).toEqual(['CREATE_VISIT']);
    expect(one('CREATE_VISIT')).toMatchObject({
      patient_id: 'p1', nurse_notes: 'folded note', vital_signs: { heart_rate: 80 },
    });
  });

  it('resolves a note that references an already-synced offline visit via the id map', async () => {
    const { migrated } = await run({
      [LOCAL_PHI_KEYS.ID_MAP]: JSON.stringify({ offline_gone: 'real-77' }),
      [LOCAL_PHI_KEYS.SYNC_QUEUE]: JSON.stringify([
        { id: 'n', type: 'note', data: { visit_id: 'offline_gone', nurse_notes: 'late note' } },
      ]),
    });
    expect(migrated).toBe(1);
    expect(one('UPDATE_VISIT')).toMatchObject({ visit_id: 'real-77', nurse_notes: 'late note' });
  });

  it('PRESERVES the store (enqueues nothing, deletes nothing) when an item cannot be migrated', async () => {
    const { migrated, storage } = await run({
      [LOCAL_PHI_KEYS.SYNC_QUEUE]: JSON.stringify([
        { id: 'offline_1', type: 'visit', data: { patient_id: 'p1' } },
        // note referencing an offline_ visit that is neither in-queue nor in the id map
        { id: 'n', type: 'note', data: { visit_id: 'offline_unknown', nurse_notes: 'x' } },
      ]),
    });
    expect(migrated).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(storage.has(LOCAL_PHI_KEYS.SYNC_QUEUE)).toBe(true); // nothing deleted
  });

  it('replays offline_pending visit_create / incident_create / visit_update, resolving update ids', async () => {
    const { migrated } = await run({
      [LOCAL_PHI_KEYS.ID_MAP]: JSON.stringify({ offline_u: 'real-u' }),
      [LOCAL_PHI_KEYS.PENDING]: JSON.stringify([
        { id: 'c1', type: 'visit_create', status: 'pending', data: { patient_id: 'p1', created_offline: true } },
        { id: 'c2', type: 'incident_create', status: 'pending', data: { patient_id: 'p1', incident_type: 'fall', created_offline: true } },
        { id: 'c3', type: 'visit_update', status: 'pending', entityId: 'offline_u', data: { nurse_notes: 'e' } },
        { id: 'c4', type: 'visit_create', status: 'synced', data: { patient_id: 'p2' } },
      ]),
    });
    expect(migrated).toBe(3);
    expect(actions().sort()).toEqual(['CREATE_INCIDENT', 'CREATE_VISIT', 'UPDATE_VISIT']);
    expect(one('CREATE_INCIDENT')).not.toHaveProperty('created_offline');
    // The migrated incident carries a stable idempotency key (crash-retry safe).
    expect(one('CREATE_INCIDENT')).toMatchObject({ client_request_id: 'legacy-incident:c2', patient_id: 'p1', incident_type: 'fall' });
    expect(one('UPDATE_VISIT')).toMatchObject({ visit_id: 'real-u', nurse_notes: 'e' });
  });

  it('replays penn pending visits and updates (skipping synced + unresolved offline_ targets)', async () => {
    // penn_updates targeting an offline_ id with NO mapping must preserve that store.
    const { migrated, storage } = await run({
      [LOCAL_PHI_KEYS.PENN_PENDING_VISITS]: JSON.stringify([
        { id: 'offline_a', synced: false, data: { patient_id: 'p1' } },
        { id: 'offline_b', synced: true, data: { patient_id: 'p2' } },
      ]),
      [LOCAL_PHI_KEYS.PENN_PENDING_UPDATES]: JSON.stringify([
        { visitId: 'offline_c', synced: false, data: { nurse_notes: 'u' } },
      ]),
    });
    expect(migrated).toBe(1); // only the penn visit create
    expect(one('CREATE_VISIT')).toMatchObject({ client_request_id: 'legacy-penn:offline_a', patient_id: 'p1' });
    expect(storage.has(LOCAL_PHI_KEYS.PENN_PENDING_VISITS)).toBe(false); // fully migrated
    expect(storage.has(LOCAL_PHI_KEYS.PENN_PENDING_UPDATES)).toBe(true); // unresolved → preserved
  });

  it('replays offline_visit_drafts with a patient_id (skips blank drafts)', async () => {
    const { migrated } = await run({
      [LOCAL_PHI_KEYS.VISIT_DRAFTS]: JSON.stringify([
        { id: 'd1', patient_id: 'p1', nurse_notes: 'draft', lastSaved: 'x' },
        { id: 'd2', nurse_notes: 'no patient' },
      ]),
    });
    expect(migrated).toBe(1);
    expect(one('CREATE_VISIT')).toMatchObject({ client_request_id: 'legacy-draft:d1', patient_id: 'p1', status: 'completed' });
    expect(one('CREATE_VISIT')).not.toHaveProperty('lastSaved');
  });

  it('is idempotent: a second run after a clean migration is a no-op', async () => {
    const storage = makeStorage({
      [LOCAL_PHI_KEYS.SYNC_QUEUE]: JSON.stringify([{ id: 'x', type: 'visit', data: { patient_id: 'p1' } }]),
    });
    const first = await migrateLegacyOfflineQueues({ enqueue, storage });
    expect(first.migrated).toBe(1);
    first.clearMigratedStores();
    expect(storage.has(LOCAL_PHI_KEYS.SYNC_QUEUE)).toBe(false);

    enqueue.mockClear();
    const second = await migrateLegacyOfflineQueues({ enqueue, storage });
    expect(second.migrated).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('leaves a malformed or non-array store untouched (never destroys unparseable PHI)', async () => {
    const storage = makeStorage({
      [LOCAL_PHI_KEYS.SYNC_QUEUE]: '{not json',
      [LOCAL_PHI_KEYS.PENDING]: JSON.stringify({ shape: 'unexpected object' }),
    });
    const { migrated } = await migrateLegacyOfflineQueues({ enqueue, storage });
    expect(migrated).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(storage.has(LOCAL_PHI_KEYS.SYNC_QUEUE)).toBe(true);
    expect(storage.has(LOCAL_PHI_KEYS.PENDING)).toBe(true);
  });

  it('deletes NOTHING until the caller confirms the writes reached the server', async () => {
    // Regression: the store used to be removed as soon as its items were handed to
    // `enqueue`. But enqueue only STAGES a write in memory, so when the send that
    // followed was skipped (device offline) or failed, the queue had already been
    // destroyed and the nurse's field documentation was gone with it.
    const storage = makeStorage({
      [LOCAL_PHI_KEYS.SYNC_QUEUE]: JSON.stringify([
        { id: 'offline_1', type: 'visit', data: { patient_id: 'p1', nurse_notes: 'documented in the field' } },
      ]),
    });

    const { migrated, clearMigratedStores } = await migrateLegacyOfflineQueues({ enqueue, storage });

    expect(migrated).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    // Mapped and staged — but still on the device, because nothing has been sent.
    expect(storage.has(LOCAL_PHI_KEYS.SYNC_QUEUE)).toBe(true);

    clearMigratedStores();
    expect(storage.has(LOCAL_PHI_KEYS.SYNC_QUEUE)).toBe(false);
  });

  it('commits only the stores it fully migrated, never a preserved one', async () => {
    const storage = makeStorage({
      [LOCAL_PHI_KEYS.PENN_PENDING_VISITS]: JSON.stringify([{ id: 'offline_a', synced: false, data: { patient_id: 'p1' } }]),
      // unresolved offline_ target → preserved, so the commit must not touch it
      [LOCAL_PHI_KEYS.PENN_PENDING_UPDATES]: JSON.stringify([{ visitId: 'offline_c', synced: false, data: { nurse_notes: 'u' } }]),
    });

    const { clearMigratedStores } = await migrateLegacyOfflineQueues({ enqueue, storage });
    clearMigratedStores();

    expect(storage.has(LOCAL_PHI_KEYS.PENN_PENDING_VISITS)).toBe(false);
    expect(storage.has(LOCAL_PHI_KEYS.PENN_PENDING_UPDATES)).toBe(true);
  });
});
