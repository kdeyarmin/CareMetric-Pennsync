import { addToSyncQueue } from '@/lib/indexedDB';
import { OFFLINE_KEYS } from '@/lib/offlineKeys';

/**
 * offlineMigration — one-time replay of pending offline writes left in the RETIRED
 * localStorage queues into the canonical IndexedDB sync_queue.
 *
 * The offline subsystems that used these localStorage stores were deleted when the
 * queue was unified on IndexedDB. Their *keys* are still preserved by the PHI purge
 * (a returning nurse's stale PHI must still be wiped on logout), but nothing
 * replays them anymore — so a nurse who documented a visit/incident offline right
 * before upgrading would have that clinical work stranded on the device forever.
 * This moves it into the canonical queue so the single global drainer uploads it.
 *
 * Idempotent: each store is cleared after its items are enqueued, and every
 * CREATE_VISIT/UPDATE_VISIT carries a client_request_id / visit_id derived from the
 * legacy item id, so even a crash between enqueue and clear can't create a
 * duplicate visit (the drain dedupes on those keys). Safe to run on every startup.
 */

// Stable idempotency key from a legacy item id (falls back to a random one only
// when the legacy item had no id, which can't be deduped anyway).
const reqId = (prefix, id) =>
  id ? `${prefix}:${id}` : `${prefix}:${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Drop local-only bookkeeping fields so only real entity fields reach the backend.
const stripLocal = (data = {}) => {
  const {
    id: _id, created_offline: _co, entityType: _et, lastSaved: _ls,
    synced: _s, syncAttempts: _sa, retryCount: _rc, ...rest
  } = data;
  return rest;
};

// ── Per-store mappers: legacy items → [action, payload] pairs ──────────────────

// offline_sync_queue (OfflineSyncService): { id, type: 'visit'|'note'|'vitals'|'task', data }
function mapSyncQueue(items) {
  const out = [];
  for (const it of items) {
    const data = it?.data || {};
    if (it?.type === 'visit') {
      out.push(['CREATE_VISIT', { client_request_id: reqId('legacy-sq', it.id), status: 'completed', ...stripLocal(data) }]);
    } else if (it?.type === 'task') {
      out.push(['CREATE_TASK', stripLocal(data)]);
    }
    // 'note'/'vitals' referenced (often offline_) visit ids whose id-mapping is
    // gone with the old subsystem; there's nothing safe to attach them to — skip.
  }
  return out;
}

// offline_pending (OfflineStorage.addPendingChange): { id, type: 'visit_create'|'incident_create'|'visit_update', data, entityId, status }
function mapPending(items) {
  const out = [];
  for (const c of items) {
    if (c?.status === 'synced') continue;
    const data = stripLocal(c?.data || {});
    if (c?.type === 'visit_create') {
      out.push(['CREATE_VISIT', { client_request_id: reqId('legacy-pending', c.id), status: 'completed', ...data }]);
    } else if (c?.type === 'incident_create') {
      out.push(['CREATE_INCIDENT', data]);
    } else if (c?.type === 'visit_update' && c?.entityId) {
      out.push(['UPDATE_VISIT', { visit_id: c.entityId, ...data }]);
    }
  }
  return out;
}

// penn_sync_offline_pending_visits (OfflineStorage.saveVisit): [{ id, data, synced }]
function mapPennVisits(items) {
  const out = [];
  for (const v of items) {
    if (v?.synced) continue;
    out.push(['CREATE_VISIT', { client_request_id: reqId('legacy-penn', v.id), status: 'completed', ...stripLocal(v?.data || {}) }]);
  }
  return out;
}

// penn_sync_offline_pending_updates (OfflineStorage.saveUpdate): [{ visitId, data, synced }]
function mapPennUpdates(items) {
  const out = [];
  for (const u of items) {
    // Can only replay updates that target a real server id; an unsynced offline_
    // placeholder has no record to update.
    if (u?.synced || !u?.visitId || String(u.visitId).startsWith('offline_')) continue;
    out.push(['UPDATE_VISIT', { visit_id: u.visitId, ...stripLocal(u?.data || {}) }]);
  }
  return out;
}

// offline_visit_drafts (OfflineNoteEditor): [{ ...visitData, id, lastSaved }]
function mapDrafts(items) {
  const out = [];
  for (const d of items) {
    const data = stripLocal(d || {});
    if (!data.patient_id) continue; // an empty/blank draft isn't a real visit
    out.push(['CREATE_VISIT', { client_request_id: reqId('legacy-draft', d?.id), status: 'completed', ...data }]);
  }
  return out;
}

/**
 * Read one legacy store, enqueue its mapped items, then remove the key so it isn't
 * re-migrated. A malformed (unparseable) value is left untouched — it's unsynced
 * PHI we can't safely interpret, and the PHI purge still owns cleaning it up.
 * Returns the number of items enqueued.
 */
async function migrateStore(storage, key, mapper, enqueue) {
  let raw;
  try { raw = storage.getItem(key); } catch { return 0; }
  if (!raw) return 0;

  let items;
  try { items = JSON.parse(raw); } catch { return 0; /* malformed — leave for the purge */ }
  if (!Array.isArray(items)) { try { storage.removeItem(key); } catch { /* ignore */ } return 0; }

  const actions = mapper(items);
  for (const [action, payload] of actions) {
    await enqueue(action, payload);
  }
  // Only reached once every item was enqueued (a throw aborts and leaves the store
  // for the next startup). Clearing here moves the stranded PHI off the device.
  try { storage.removeItem(key); } catch { /* ignore */ }
  return actions.length;
}

/**
 * Migrate every retired localStorage offline queue into the canonical IndexedDB
 * queue. Deps are injectable for tests. Returns `{ migrated }`.
 */
export async function migrateLegacyOfflineQueues({ enqueue = addToSyncQueue, storage } = {}) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return { migrated: 0 };

  const jobs = [
    [OFFLINE_KEYS.SYNC_QUEUE, mapSyncQueue],
    [OFFLINE_KEYS.PENDING, mapPending],
    [OFFLINE_KEYS.PENN_PENDING_VISITS, mapPennVisits],
    [OFFLINE_KEYS.PENN_PENDING_UPDATES, mapPennUpdates],
    [OFFLINE_KEYS.VISIT_DRAFTS, mapDrafts],
  ];

  let migrated = 0;
  for (const [key, mapper] of jobs) {
    migrated += await migrateStore(store, key, mapper, enqueue);
  }
  return { migrated };
}
