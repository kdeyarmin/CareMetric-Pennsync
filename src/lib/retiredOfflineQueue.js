import { base44 } from '@/api/base44Client';
import { logger } from '@/lib/logger';
import { migrateLegacyOfflineQueues } from '@/lib/offlineMigration';
import { OFFLINE_RETIRED_FLAG } from '@/lib/localPhiKeys';
import { saveDraftNoteLocally, getDraftNoteLocally } from '@/lib/draftNotes';

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
/**
 * Marks the retirement as done for this browser, so it runs at most once — and
 * tells the logout/idle PHI purge that the retired queues are now safe to remove
 * (see lib/localPhiKeys.js, which owns the constant).
 */
const DONE_FLAG = OFFLINE_RETIRED_FLAG;
/** The legacy Smart Note autosave store, which lived in the same database. */
const LEGACY_DRAFT_STORE = 'draft_notes';
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

/**
 * Read one store from the legacy database without creating it if it is gone.
 *
 * Resolves [] ONLY when there is genuinely nothing to read — no IndexedDB at all,
 * or the store does not exist. Every real failure (the open erroring, a
 * transaction or getAll erroring) REJECTS, because the caller treats an empty
 * result as "nothing left to save" and goes on to delete the database and set the
 * permanent retirement flag. Resolving [] on a transient storage error therefore
 * destroyed queued clinical work and guaranteed it would never be retried.
 */
function readLegacyStore(storeName) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve([]);
    let open;
    try {
      // No version argument: opens the CURRENT version, and never triggers an
      // upgrade — so this cannot recreate a database the user no longer has.
      open = indexedDB.open(LEGACY_DB_NAME);
    } catch (error) {
      return reject(error instanceof Error ? error : new Error('IndexedDB open threw'));
    }
    open.onerror = () => reject(open.error || new Error('IndexedDB open failed'));
    open.onblocked = () => reject(new Error('IndexedDB open blocked'));
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        return resolve([]); // the store never existed — genuinely nothing here
      }
      try {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => { db.close(); resolve(request.result || []); };
        request.onerror = () => { db.close(); reject(request.error || new Error('IndexedDB read failed')); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction aborted')); };
      } catch (error) {
        db.close();
        reject(error instanceof Error ? error : new Error('IndexedDB read threw'));
      }
    };
  });
}

const readLegacyQueue = () => readLegacyStore(LEGACY_QUEUE_STORE);

/**
 * Rescue Smart Note autosave drafts before the legacy database is deleted.
 *
 * The retired `indexedDB.js` kept those drafts in a `draft_notes` store INSIDE
 * `base44-offline-db`; the replacement (lib/draftNotes.js) uses its own
 * `pennsync-drafts` database. Deleting the old database without this step threw
 * away the only durable copy of a note a nurse left unfinished before upgrading,
 * and the new restore path would never find it. An existing draft under the same
 * id is left alone — it is newer than anything being recovered.
 */
async function migrateLegacyDraftNotes({ saveDraft = saveDraftNoteLocally, getDraft = getDraftNoteLocally } = {}) {
  const drafts = await readLegacyStore(LEGACY_DRAFT_STORE);
  let copied = 0;
  for (const draft of drafts) {
    if (!draft || draft.id === undefined || draft.id === null) continue;
    if (await getDraft(draft.id)) continue;
    await saveDraft(draft);
    copied += 1;
  }
  return copied;
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
  rescueDrafts = migrateLegacyDraftNotes,
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
    // A read failure is NOT an empty queue: the database may still hold queued
    // clinical work. Retire nothing and retry on the next load.
    logger.error('[offline-retire] could not read the legacy queue; deferring retirement', error);
    return { retired: false, flushed: 0, pending: pendingWrites.length };
  }

  const queue = pendingWrites;

  // Shared teardown. The legacy database also holds the Smart Note autosave
  // drafts, which are local-only and have no server copy to fall back on, so they
  // are rescued into the new draft database FIRST; if that fails nothing is
  // deleted and the whole retirement retries next load. Re-flushing on that retry
  // is safe — every action carries an idempotency key.
  const retire = async () => {
    try {
      await rescueDrafts();
    } catch (error) {
      logger.error('[offline-retire] could not rescue local note drafts; keeping the legacy storage', error);
      return false;
    }
    await unregisterWorker();
    await deleteDatabase();
    clearLegacyStores();
    markRetired();
    return true;
  };

  // Nothing left to save: retire immediately, whatever the connection state.
  if (!queue.length) {
    return { retired: await retire(), flushed: 0, pending: 0 };
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
  return { retired: await retire(), flushed, pending: 0 };
}

export default flushAndRetireOfflineQueue;
