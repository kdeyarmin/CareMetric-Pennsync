import { LOCAL_PHI_KEYS } from '@/lib/localPhiKeys';

/**
 * offlineMigration — recovery of pending offline writes left in the RETIRED
 * localStorage queues. DELETE ALONGSIDE retiredOfflineQueue.js.
 *
 * Offline mode is gone. Several older localStorage queues predate even the
 * IndexedDB queue it used, and a nurse who documented a visit or incident right
 * before one of those upgrades can still have that clinical work stranded on the
 * device. This maps whatever is left into canonical write actions, which
 * `flushAndRetireOfflineQueue` sends to the server once, before the local
 * storage is deleted for good. `enqueue` is now supplied by that caller — there
 * is no longer a queue to write into.
 *
 * Safety principle, in two phases. A store is only ever a candidate for deletion
 * when every item in it was confidently mapped to a canonical action: if it holds
 * anything we can't faithfully migrate (an unknown item type, or a note/vitals/
 * update that references an offline_ visit id we can't resolve), the whole store is
 * left untouched — nothing is enqueued from it and nothing is deleted, so no
 * clinical data is lost to a partial migration. Mapping cleanly is NOT enough to
 * delete, though: `enqueue` only stages a write in memory. So this function never
 * deletes anything itself — it returns `clearMigratedStores`, which the caller
 * invokes only once those writes have reached the server. Deleting at map time
 * destroyed the queue whenever the send that followed was skipped (offline) or
 * failed part-way. Interdependent items are handled the way the old workers did:
 * a queued note/vitals is folded into its visit's create (or applied as an update
 * once the visit's real id is known via the persisted offline_->real id map), and a
 * visit carrying a real server id is replayed as an edit, not a duplicate create.
 *
 * Idempotent: every enqueued action carries a stable key derived from the legacy
 * id — CREATE_VISIT a client_request_id, UPDATE_VISIT the real visit_id, and
 * CREATE_TASK/CREATE_INCIDENT a client_request_id — so re-running (or a crash
 * between enqueue and clear) can't create a duplicate record; the drain dedupes on
 * those keys. Safe to run on every startup.
 */

// Stable idempotency key from a legacy item id (falls back to a random one only
// when the legacy item had no id, which can't be deduped anyway).
const reqId = (prefix, id) =>
  id ? `${prefix}:${id}` : `${prefix}:${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Drop local-only bookkeeping + placeholder ids so only real entity fields are sent.
const stripLocal = (data = {}) => {
  const {
    id: _id, visit_id: _vid, created_offline: _co, entityType: _et, lastSaved: _ls,
    synced: _s, syncAttempts: _sa, retryCount: _rc, ...rest
  } = data;
  return rest;
};

// Resolve a possibly-offline visit id to a REAL server id using the persisted
// offline_->real map (written by the old workers during partial syncs). Returns a
// real id unchanged, a mapped real id for an offline_ id, or null when an offline_
// id has no mapping yet (its visit never synced) — signalling "can't migrate this".
const resolveVisitId = (id, idMap) => {
  if (typeof id !== 'string' || id === '') return null;
  if (!id.startsWith('offline_')) return id;
  return idMap[id] || null;
};

// A rejected mapping: the store must be preserved intact.
const PRESERVE = { ok: false, actions: [] };

// ── Per-store mappers → { ok, actions:[[action, payload]] } ────────────────────

// offline_sync_queue (OfflineSyncService): { id, type: 'visit'|'note'|'vitals'|'task', data }
function mapSyncQueue(items, idMap) {
  const actions = [];
  // Index in-queue visit creates by their offline id so a following note/vitals
  // item for the same visit folds into the create instead of being lost.
  const createByOfflineId = new Map();
  const deferred = []; // note/vitals handled after every visit is indexed

  for (const it of items) {
    const data = it?.data || {};
    if (it?.type === 'visit') {
      // OfflineVisitNoteCapture wrote no id; OfflineVisitDocumentation put the
      // (real or offline_) target in visit_id — treat a real id as an edit.
      const rawId = data.id || data.visit_id;
      if (rawId && !String(rawId).startsWith('offline_')) {
        actions.push(['UPDATE_VISIT', { visit_id: rawId, ...stripLocal(data) }]);
      } else {
        const payload = { client_request_id: reqId('legacy-sq', it.id), status: 'completed', ...stripLocal(data) };
        actions.push(['CREATE_VISIT', payload]);
        if (rawId) createByOfflineId.set(rawId, payload);
      }
    } else if (it?.type === 'task') {
      // Stable idempotency key from the legacy item id so a crash between enqueue
      // and clear (or a re-run) can't create a duplicate task on the drain.
      actions.push(['CREATE_TASK', { client_request_id: reqId('legacy-task', it.id), ...stripLocal(data) }]);
    } else if (it?.type === 'note' || it?.type === 'vitals') {
      deferred.push(it);
    } else {
      return PRESERVE; // unknown type
    }
  }

  for (const it of deferred) {
    const data = it.data || {};
    const patch = it.type === 'note' ? { nurse_notes: data.nurse_notes } : { vital_signs: data.vital_signs };
    const target = createByOfflineId.get(data.visit_id);
    if (target) {
      Object.assign(target, patch); // fold into the pending create for that visit
    } else {
      const rid = resolveVisitId(data.visit_id, idMap);
      if (!rid) return PRESERVE; // references an offline_ visit we can't resolve
      actions.push(['UPDATE_VISIT', { visit_id: rid, ...patch }]);
    }
  }

  return { ok: true, actions };
}

// offline_pending (OfflineStorage.addPendingChange): { id, type, data, entityId, status }
function mapPending(items, idMap) {
  const actions = [];
  for (const c of items) {
    if (c?.status === 'synced') continue;
    const data = stripLocal(c?.data || {});
    if (c?.type === 'visit_create') {
      actions.push(['CREATE_VISIT', { client_request_id: reqId('legacy-pending', c.id), status: 'completed', ...data }]);
    } else if (c?.type === 'incident_create') {
      // Stable idempotency key from the legacy change id so a crash between enqueue
      // and clear (or a re-run) can't create a duplicate safety incident.
      actions.push(['CREATE_INCIDENT', { client_request_id: reqId('legacy-incident', c.id), ...data }]);
    } else if (c?.type === 'visit_update') {
      const rid = resolveVisitId(c?.entityId, idMap);
      if (!rid) return PRESERVE;
      actions.push(['UPDATE_VISIT', { visit_id: rid, ...data }]);
    } else {
      return PRESERVE; // unknown change type
    }
  }
  return { ok: true, actions };
}

// penn_sync_offline_pending_visits (OfflineStorage.saveVisit): [{ id, data, synced }]
function mapPennVisits(items) {
  const actions = [];
  for (const v of items) {
    if (v?.synced) continue;
    actions.push(['CREATE_VISIT', { client_request_id: reqId('legacy-penn', v.id), status: 'completed', ...stripLocal(v?.data || {}) }]);
  }
  return { ok: true, actions };
}

// penn_sync_offline_pending_updates (OfflineStorage.saveUpdate): [{ visitId, data, synced }]
function mapPennUpdates(items, idMap) {
  const actions = [];
  for (const u of items) {
    if (u?.synced) continue;
    const rid = resolveVisitId(u?.visitId, idMap);
    if (!rid) return PRESERVE; // unresolved offline_ update target — preserve, don't drop
    actions.push(['UPDATE_VISIT', { visit_id: rid, ...stripLocal(u?.data || {}) }]);
  }
  return { ok: true, actions };
}

// offline_visit_drafts (OfflineNoteEditor): [{ ...visitData, id, lastSaved }]
function mapDrafts(items) {
  const actions = [];
  for (const d of items) {
    const data = stripLocal(d || {});
    if (!data.patient_id) continue; // an empty/blank draft isn't a real visit
    actions.push(['CREATE_VISIT', { client_request_id: reqId('legacy-draft', d?.id), status: 'completed', ...data }]);
  }
  return { ok: true, actions };
}

function readIdMap(storage) {
  try {
    const raw = storage.getItem(LOCAL_PHI_KEYS.ID_MAP);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

/**
 * Read one legacy store and, only if EVERY item maps cleanly, enqueue the mapped
 * actions and remove the key. A malformed value, an unexpected (non-array) shape,
 * or any item that can't be safely migrated leaves the store untouched — it's
 * unsynced PHI we won't risk destroying; the PHI purge still owns cleaning it up.
 * Returns the number of items enqueued.
 */
async function migrateStore(storage, key, mapper, enqueue, idMap) {
  const preserved = { count: 0, clearKey: null };
  let raw;
  try { raw = storage.getItem(key); } catch { return preserved; }
  if (!raw) return preserved;

  let items;
  try { items = JSON.parse(raw); } catch { return preserved; /* malformed — leave for the purge */ }
  if (!Array.isArray(items)) return preserved; // unexpected shape — leave untouched

  const { ok, actions } = mapper(items, idMap);
  if (!ok) {
    console.warn(`Offline migration: leaving ${key} in place (holds items that can't be safely migrated).`);
    return preserved;
  }

  for (const [action, payload] of actions) {
    await enqueue(action, payload);
  }
  // Every item mapped and was handed to `enqueue` — but enqueue only STAGES the
  // write, it does not send it. Deleting the store here would destroy stranded
  // field documentation any time the send later failed, so the key is only
  // reported; the caller commits it once the work has reached the server.
  return { count: actions.length, clearKey: key };
}

/**
 * Migrate every retired localStorage offline queue into the canonical IndexedDB
 * queue. Deps are injectable for tests. Returns `{ migrated }`.
 */
export async function migrateLegacyOfflineQueues({ enqueue, storage } = {}) {
  const nothingToDo = { migrated: 0, clearMigratedStores: () => {} };
  if (typeof enqueue !== 'function') return nothingToDo;
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return nothingToDo;

  const idMap = readIdMap(store);
  const jobs = [
    [LOCAL_PHI_KEYS.SYNC_QUEUE, mapSyncQueue],
    [LOCAL_PHI_KEYS.PENDING, mapPending],
    [LOCAL_PHI_KEYS.PENN_PENDING_VISITS, mapPennVisits],
    [LOCAL_PHI_KEYS.PENN_PENDING_UPDATES, mapPennUpdates],
    [LOCAL_PHI_KEYS.VISIT_DRAFTS, mapDrafts],
  ];

  let migrated = 0;
  const clearKeys = [];
  for (const [key, mapper] of jobs) {
    const { count, clearKey } = await migrateStore(store, key, mapper, enqueue, idMap);
    migrated += count;
    if (clearKey) clearKeys.push(clearKey);
  }

  return {
    migrated,
    // Call ONLY after the migrated actions have actually reached the server.
    clearMigratedStores: () => {
      for (const key of clearKeys) {
        try { store.removeItem(key); } catch { /* ignore */ }
      }
    },
  };
}
