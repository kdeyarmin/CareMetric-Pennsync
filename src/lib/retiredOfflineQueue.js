import { base44 } from '@/api/base44Client';
import { logger } from '@/lib/logger';
import { migrateLegacyOfflineQueues } from '@/lib/offlineMigration';

/**
 * ONE-TIME migration for the retired offline feature. DELETE AFTER ONE RELEASE.
 *
 * Offline mode (the `/OfflineMode` page, the IndexedDB mutation queue, the
 * offline service worker) has been removed. A device that ran the previous
 * version may still hold UNSYNCED clinical documentation — visit notes and
 * incident reports a nurse captured in the field that never reached the server.
 * Deleting the database outright would destroy that documentation silently, so
 * this module flushes whatever is left exactly once, then retires the storage:
 *
 *   1. collect anything still stranded in the even older localStorage queues,
 *   2. drain those plus the legacy IndexedDB `sync_queue` to the server (online only),
 *   3. delete the `base44-offline-db` database,
 *   4. unregister the offline service worker and drop its caches.
 *
 * Deliberately self-contained: it reads IndexedDB directly rather than importing
 * the deleted offline modules, so nothing else in the app depends on the retired
 * feature. The drain preserves the idempotency the old worker had —
 * `client_request_id` for creates, `visit_id` for updates — so an interrupted
 * run cannot double-write a clinical record on the next attempt.
 *
 * Once every active device has loaded a build containing this module, the whole
 * file (and its call in App.jsx) can be removed.
 */

const LEGACY_DB_NAME = 'base44-offline-db';
const LEGACY_QUEUE_STORE = 'sync_queue';
/** Marks the retirement as done for this browser, so it runs at most once. */
const DONE_FLAG = 'pennsync_offline_retired';
/** The cache the retired service worker created (see the deleted public/sw.js). */
const LEGACY_CACHE_PREFIX = 'base44-offline';

const alreadyRetired = () => {
  try {
    return localStorage.getItem(DONE_FLAG) === '1';
  } catch {
    return false; // storage unavailable — safe to attempt, the drain is idempotent
  }
};

const markRetired = () => {
  try {
    localStorage.setItem(DONE_FLAG, '1');
  } catch {
    /* storage unavailable — the drain is idempotent, so a repeat is harmless */
  }
};

/** Read the legacy queue without creating the database if it is already gone. */
function readLegacyQueue() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve([]);
    let open;
    try {
      // No version argument: opens the CURRENT version, and never triggers an
      // upgrade — so this cannot recreate a database the user no longer has.
      open = indexedDB.open(LEGACY_DB_NAME);
    } catch {
      return resolve([]);
    }
    open.onerror = () => resolve([]);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(LEGACY_QUEUE_STORE)) {
        db.close();
        return resolve([]);
      }
      try {
        const tx = db.transaction(LEGACY_QUEUE_STORE, 'readonly');
        const request = tx.objectStore(LEGACY_QUEUE_STORE).getAll();
        request.onsuccess = () => { db.close(); resolve(request.result || []); };
        request.onerror = () => { db.close(); resolve([]); };
      } catch {
        db.close();
        resolve([]);
      }
    };
  });
}

function deleteLegacyDatabase() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve();
    let request;
    try {
      request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    } catch {
      return resolve();
    }
    // `onblocked` fires when another tab still holds the database open. Resolve
    // anyway: the delete is queued and completes when that tab closes, and the
    // retirement flag stops us from retrying forever.
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/**
 * Unregister the retired offline service worker and drop its caches, so an
 * existing install stops serving the cached app shell. Without this a browser
 * that registered the old worker keeps it — and its stale shell — indefinitely,
 * because deleting sw.js from the build does not unregister anything.
 */
async function unregisterOfflineServiceWorker() {
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.getRegistrations) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    /* unsupported or blocked — nothing further to do */
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith(LEGACY_CACHE_PREFIX)).map((key) => caches.delete(key)),
      );
    }
  } catch {
    /* Cache Storage unavailable */
  }
}

/** Write one queued item to the server, reusing its original idempotency key. */
async function flushItem(item, entities, functions) {
  const payload = item?.payload || {};
  const {
    __audit: audit,
    __history: history,
    __noteConversion: noteConversion,
    visit_id: visitId,
    created_offline: _createdOffline,
    ...fields
  } = payload;

  const applyHistory = async (targetVisitId) => {
    if (!history || !functions?.invoke) return;
    const entry = { ...(history.entry || {}) };
    if (targetVisitId && !entry.visit_id) entry.visit_id = targetVisitId;
    await functions.invoke('appendPatientNoteHistory', {
      patient_id: history.patient_id,
      mode: history.mode === 'update' ? 'update' : 'append',
      clinical_notes: history.clinical_notes,
      entry,
    });
  };

  const reconcileAudit = async (targetVisitId, patientId) => {
    if (!audit) return;
    const { audit_id: _ignored, ...auditFields } = audit;
    const existing = await entities.ComplianceAudit.filter({ visit_id: targetVisitId });
    if (existing?.length) {
      await entities.ComplianceAudit.update(existing[0].id, auditFields);
      return;
    }
    await entities.ComplianceAudit.create({
      visit_id: targetVisitId,
      patient_id: patientId,
      audit_date: new Date().toISOString(),
      audit_type: 'automated',
      ...auditFields,
    });
  };

  switch (item.action) {
    case 'CREATE_VISIT': {
      // Reuse a visit a prior (interrupted) drain already created rather than
      // writing a duplicate clinical record.
      const key = fields.client_request_id;
      const existing = key ? await entities.Visit.filter({ client_request_id: key }) : [];
      const isNew = !existing?.length;
      const visit = isNew ? await entities.Visit.create(fields) : existing[0];
      if (isNew && noteConversion && entities.NoteConversion?.create) {
        await entities.NoteConversion.create(noteConversion);
      }
      await reconcileAudit(visit.id, fields.patient_id);
      await applyHistory(visit.id);
      return;
    }
    case 'UPDATE_VISIT': {
      if (!visitId) return; // malformed; nothing to target
      await entities.Visit.update(visitId, fields);
      await reconcileAudit(visitId, fields.patient_id);
      await applyHistory(visitId);
      return;
    }
    case 'CREATE_TASK': {
      const key = fields.client_request_id;
      const existing = key ? await entities.Task.filter({ client_request_id: key }) : [];
      if (!existing?.length) await entities.Task.create(fields);
      return;
    }
    case 'CREATE_INCIDENT': {
      const key = fields.client_request_id;
      const existing = key ? await entities.Incident.filter({ client_request_id: key }) : [];
      // Incident writes are service-role-only, so creation goes through the backend.
      if (!existing?.length) await functions.invoke('submitIncidentReport', fields);
      return;
    }
    default:
      // Unknown action from an even older build — nothing can be done with it.
      logger.debug('[offline-retire] skipping unknown queued action', item.action);
  }
}

/**
 * Flush anything left in the retired offline queue, then delete its storage.
 *
 * Never throws and never blocks app start — call it and forget it.
 *
 * @param {object} [deps] injectable seams for tests
 * @returns {Promise<{ retired: boolean, flushed: number, pending: number }>}
 *   `retired` false means the queue could not be fully flushed (offline, or a
 *   write failed), so the storage was left in place for the next attempt.
 */
export async function flushAndRetireOfflineQueue({
  entities = base44.entities,
  functions = base44.functions,
  getQueue = readLegacyQueue,
  deleteDatabase = deleteLegacyDatabase,
  unregisterWorker = unregisterOfflineServiceWorker,
  isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
} = {}) {
  if (alreadyRetired()) return { retired: true, flushed: 0, pending: 0 };

  // Older localStorage queues predate the IndexedDB one; recover them into the
  // same flush. NOTHING is deleted here: `enqueue` only stages an item in memory,
  // so the migration hands back `clearLegacyStores` and we call it further down,
  // after every staged write has actually reached the server. Clearing at map time
  // destroyed stranded field documentation whenever the send that followed was
  // skipped (device offline) or failed part-way.
  const pendingWrites = [];
  let clearLegacyStores = () => {};
  try {
    const migration = await migrateLegacyOfflineQueues({
      enqueue: async (action, payload) => { pendingWrites.push({ action, payload }); },
    });
    if (typeof migration?.clearMigratedStores === 'function') {
      clearLegacyStores = migration.clearMigratedStores;
    }
  } catch (error) {
    logger.debug('[offline-retire] could not read the legacy localStorage queues', error);
  }

  try {
    for (const item of await getQueue()) pendingWrites.push(item);
  } catch (error) {
    logger.debug('[offline-retire] could not read the legacy queue', error);
    return { retired: false, flushed: 0, pending: pendingWrites.length };
  }

  const queue = pendingWrites;

  // Nothing left to save: retire immediately, whatever the connection state.
  if (!queue.length) {
    await unregisterWorker();
    await deleteDatabase();
    clearLegacyStores();
    markRetired();
    return { retired: true, flushed: 0, pending: 0 };
  }

  // There IS unsynced clinical work. Only destroy the queue once every item has
  // reached the server — otherwise leave it untouched and try again next load.
  if (!isOnline()) return { retired: false, flushed: 0, pending: queue.length };

  let flushed = 0;
  for (const item of queue) {
    try {
      await flushItem(item, entities, functions);
      flushed += 1;
    } catch (error) {
      logger.error('[offline-retire] could not sync queued offline work', error);
      return { retired: false, flushed, pending: queue.length - flushed };
    }
  }

  // Everything reached the server — only now is it safe to destroy local copies.
  await unregisterWorker();
  await deleteDatabase();
  clearLegacyStores();
  markRetired();
  return { retired: true, flushed, pending: 0 };
}

export default flushAndRetireOfflineQueue;
