import { base44 } from '@/api/base44Client';
import { logger } from '@/lib/logger';
import { migrateLegacyOfflineQueues } from '@/lib/offlineMigration';
import { OFFLINE_RETIRED_FLAG } from '@/lib/localPhiKeys';
import { saveDraftNoteLocally, getDraftNoteLocally } from '@/lib/draftNotes';
import { createAuthorizedVisit } from '@/functions/createAuthorizedVisit';
import { recoverLegacyVisitUpdate } from '@/functions/updateAuthorizedVisit';
import { retireLegacyBrowserCaches } from '@/lib/retiredBrowserCacheCleanup';

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
 * feature. The drain preserves the Visit idempotency the old worker had —
 * `client_request_id` for creates and `visit_id` for updates — and gives its
 * nested NoteConversion a stable authority-bound recovery key, so an interrupted
 * run cannot silently skip or double-write that conversion on the next attempt.
 *
 * This recovery path is quarantined and has no production caller because its
 * oldest records do not carry exact principal/tenant authority. Browser worker
 * and cache cleanup lives in `retiredBrowserCacheCleanup.js` and never imports
 * or invokes this module.
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
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_SOURCE_RECORD_ID_LENGTH = 512;
const MAX_RECOVERY_REQUEST_ID_LENGTH = 2_000;
const EXACT_RECOVERY_ROW_LIMIT = 2;

const alreadyRetired = () => {
  try {
    return localStorage.getItem(DONE_FLAG) === '1';
  } catch {
    return false; // storage unavailable — safe to attempt, the drain is idempotent
  }
};

const markRetired = () => {
  localStorage.setItem(DONE_FLAG, '1');
  if (localStorage.getItem(DONE_FLAG) !== '1') {
    throw new Error('Offline retirement marker could not be persisted');
  }
};

const hasQuarantinedConflicts = () => {
  try {
    const raw = localStorage.getItem('offline_conflicts');
    if (raw === null) return false;
    const parsed = JSON.parse(raw);
    return !Array.isArray(parsed) || parsed.length > 0;
  } catch {
    // Unreadable or malformed conflict data may still be the only copy of a
    // clinician's manual resolution work. Treat it as present.
    return true;
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
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve();
    let request;
    try {
      request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    } catch (error) {
      return reject(error instanceof Error ? error : new Error('IndexedDB delete threw'));
    }
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('IndexedDB delete failed'));
    request.onblocked = () => reject(new Error('IndexedDB delete blocked'));
  });
}

const canonicalEmail = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.includes('@') && !/\s/.test(normalized)
    ? normalized
    : null;
};

const exactIdentifier = (value, maxLength = MAX_IDENTIFIER_LENGTH) => {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : value;
  if (typeof normalized !== 'string') return null;
  if (
    !normalized
    || normalized.length > maxLength
    || normalized.trim() !== normalized
    || normalized.startsWith('$')
  ) return null;
  return normalized;
};

const requireRows = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} returned an invalid result`);
  return value;
};

/**
 * Bind a legacy NoteConversion to the authenticated principal before any Visit
 * write starts. A queue can survive logout/account switching, so an email stored
 * on the device is evidence to validate, never current authority to trust.
 */
async function bindNoteConversionToCaller(
  noteConversion,
  item,
  visitFields,
  getAuthenticatedUser,
) {
  if (!noteConversion || typeof noteConversion !== 'object' || Array.isArray(noteConversion)) {
    throw new Error('Legacy NoteConversion recovery payload is invalid');
  }
  if (typeof getAuthenticatedUser !== 'function') {
    throw new Error('Legacy NoteConversion recovery requires authentication');
  }

  const user = await getAuthenticatedUser();
  const callerUserId = exactIdentifier(user?.id);
  const callerEmail = canonicalEmail(user?.email);
  if (
    !callerUserId
    || !callerEmail
    || user?.is_active === false
    || user?.disabled === true
    || user?.is_service === true
    || user?.is_verified === false
  ) {
    throw new Error('Legacy NoteConversion recovery requires an active authenticated user');
  }

  const sourceRecordId = exactIdentifier(item?.id, MAX_SOURCE_RECORD_ID_LENGTH);
  const visitRequestId = exactIdentifier(visitFields?.client_request_id);
  const patientId = exactIdentifier(visitFields?.patient_id);
  const visitDate = exactIdentifier(visitFields?.visit_date);
  const visitType = exactIdentifier(visitFields?.visit_type);
  const requestedAgencyId = visitFields?.agency_id == null
    ? null
    : exactIdentifier(visitFields.agency_id);
  if (!sourceRecordId || !visitRequestId || !patientId || !visitDate || !visitType) {
    throw new Error('Legacy NoteConversion recovery binding is incomplete');
  }
  if (visitFields?.agency_id != null && !requestedAgencyId) {
    throw new Error('Legacy NoteConversion recovery agency binding is invalid');
  }

  const queuedRaw = noteConversion.nurse_email;
  const queuedEmail = canonicalEmail(queuedRaw);
  if (queuedRaw != null && String(queuedRaw).trim() && !queuedEmail) {
    throw new Error('Legacy NoteConversion nurse identity is invalid');
  }
  if (queuedEmail && queuedEmail !== callerEmail) {
    throw new Error('Legacy NoteConversion belongs to a different authenticated user');
  }

  const queuedPatientId = noteConversion.patient_id == null
    || noteConversion.patient_id === ''
    ? null
    : exactIdentifier(noteConversion.patient_id);
  if (noteConversion.patient_id != null && noteConversion.patient_id !== '' && !queuedPatientId) {
    throw new Error('Legacy NoteConversion patient binding is invalid');
  }
  if (queuedPatientId && queuedPatientId !== patientId) {
    throw new Error('Legacy NoteConversion belongs to a different Visit request');
  }
  if (noteConversion.recovery_request_id != null) {
    throw new Error('Legacy NoteConversion recovery binding is already populated');
  }

  return {
    noteConversion: {
      ...noteConversion,
      patient_id: patientId,
      // Preserve the authority's exact spelling after a canonical comparison so
      // Base44's {{user.email}} create rule sees the authenticated value.
      nurse_email: String(user.email).trim(),
    },
    authority: {
      callerUserId,
      callerEmail,
      sourceRecordId,
      visitRequestId,
      patientId,
      visitDate,
      visitType,
      requestedAgencyId,
    },
  };
}

function requireAuthorizedVisit(result, authority) {
  if (result?.created !== true && result?.created !== false) {
    throw new Error('Legacy NoteConversion Visit result is uncertain');
  }
  const visit = result?.visit;
  const visitId = exactIdentifier(visit?.id);
  const agencyId = exactIdentifier(visit?.agency_id);
  if (
    !visitId
    || !agencyId
    || visit?.patient_id !== authority.patientId
    || visit?.client_request_id !== authority.visitRequestId
    || visit?.created_by_user_id !== authority.callerUserId
    || visit?.created_by_user_email_normalized !== authority.callerEmail
    || visit?.visit_date !== authority.visitDate
    || visit?.visit_type !== authority.visitType
    || (authority.requestedAgencyId && agencyId !== authority.requestedAgencyId)
  ) {
    throw new Error('Legacy NoteConversion Visit authority binding did not match');
  }
  return { ...visit, id: visitId, agency_id: agencyId };
}

function buildRecoveryRequestId(authority, visit) {
  // A loss of the NoteConversion.create response must produce the exact same key
  // on the next app load. The tuple binds the authenticated principal, durable
  // queue record, broker request, and the broker's tenant-stamped Visit result.
  const recoveryRequestId = JSON.stringify([
    'legacy-note-conversion-v1',
    authority.callerUserId,
    authority.callerEmail,
    authority.sourceRecordId,
    authority.visitRequestId,
    visit.id,
    visit.agency_id,
    visit.patient_id,
    visit.visit_date,
    visit.visit_type,
  ]);
  if (recoveryRequestId.length > MAX_RECOVERY_REQUEST_ID_LENGTH) {
    throw new Error('Legacy NoteConversion recovery binding is too large');
  }
  return recoveryRequestId;
}

function requireMatchingNoteConversion(row, expected, authority) {
  if (
    !row
    || typeof row !== 'object'
    || Array.isArray(row)
    || !exactIdentifier(row.id)
    || row.recovery_request_id !== expected.recovery_request_id
    || canonicalEmail(row.nurse_email) !== authority.callerEmail
    || row.patient_id !== authority.patientId
    || canonicalEmail(row.created_by) !== authority.callerEmail
  ) {
    throw new Error('Legacy NoteConversion recovery row did not match its authority binding');
  }
  return row;
}

async function reconcileNoteConversion(entities, boundNoteConversion, authority, visit) {
  if (
    typeof entities?.NoteConversion?.filter !== 'function'
    || typeof entities?.NoteConversion?.create !== 'function'
  ) {
    throw new Error('Legacy NoteConversion recovery is unavailable');
  }

  const recoveryRequestId = buildRecoveryRequestId(authority, visit);
  const expected = {
    ...boundNoteConversion,
    recovery_request_id: recoveryRequestId,
  };
  const rows = requireRows(
    await entities.NoteConversion.filter(
      { recovery_request_id: recoveryRequestId },
      '-created_date',
      EXACT_RECOVERY_ROW_LIMIT,
    ),
    'NoteConversion.filter',
  );
  if (rows.length >= EXACT_RECOVERY_ROW_LIMIT) {
    throw new Error('Legacy NoteConversion recovery request is ambiguous');
  }
  if (rows.some((row) => row?.recovery_request_id !== recoveryRequestId)) {
    throw new Error('Legacy NoteConversion recovery lookup was not exact');
  }
  if (rows.length === 1) {
    requireMatchingNoteConversion(rows[0], expected, authority);
    return rows[0];
  }

  // If the SDK call commits but its response is lost, this throws and the queue
  // remains. The next load performs the exact lookup above and does not duplicate
  // the conversion. A malformed success response is likewise never retirement.
  const created = await entities.NoteConversion.create(expected);
  return requireMatchingNoteConversion(created, expected, authority);
}

/** Write one queued item to the server, reusing its original idempotency key. */
async function flushItem(item, entities, functions, getAuthenticatedUser) {
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
      let noteConversionRecovery = null;
      if (noteConversion) {
        if (
          typeof entities.NoteConversion?.filter !== 'function'
          || typeof entities.NoteConversion?.create !== 'function'
        ) {
          throw new Error('Legacy NoteConversion recovery is unavailable');
        }
        // Preflight identity before createAuthorizedVisit. If a different user
        // signs into a device holding this queue, preserve it without writing
        // any portion of the prior nurse's clinical record under the new user.
        noteConversionRecovery = await bindNoteConversionToCaller(
          noteConversion,
          item,
          fields,
          getAuthenticatedUser,
        );
      }
      // The server broker owns tenant authorization, immutable provenance, and
      // client_request_id replay detection. Direct Visit create is intentionally
      // disabled, including for this one-release recovery path.
      const result = await createAuthorizedVisit(fields, functions);
      const visit = noteConversionRecovery
        ? requireAuthorizedVisit(result, noteConversionRecovery.authority)
        : result.visit;
      if (noteConversionRecovery) {
        // This runs for both a fresh Visit and an authorized Visit replay. A
        // rejection or any ambiguous lookup aborts the drain; the queue stores
        // and retirement flag remain intact for an exact subsequent retry.
        await reconcileNoteConversion(
          entities,
          noteConversionRecovery.noteConversion,
          noteConversionRecovery.authority,
          visit,
        );
      }
      await reconcileAudit(visit.id, fields.patient_id);
      await applyHistory(visit.id);
      return;
    }
    case 'UPDATE_VISIT': {
      // A malformed update may still contain the only copy of clinical work.
      // Fail the drain so its stores and retirement flag remain untouched for
      // supervised recovery; treating it as a no-op would silently delete it.
      if (!visitId) throw new Error('Legacy Visit update is missing visit_id');
      await recoverLegacyVisitUpdate({ visitId, fields, functions });
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
      // Unknown work may be the only clinical copy. Never report it as flushed,
      // because retirement would then delete the queue permanently.
      throw new Error(`Unsupported retired queue action: ${String(item.action || '')}`);
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
  getAuthenticatedUser = () => base44.auth.me(),
  getQueue = readLegacyQueue,
  deleteDatabase = deleteLegacyDatabase,
  unregisterWorker = retireLegacyBrowserCaches,
  rescueDrafts = migrateLegacyDraftNotes,
  hasConflicts = hasQuarantinedConflicts,
  isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
} = {}) {
  // Historical conflict records were created specifically for manual review
  // and were never part of the replay mapper. Keep every retirement artifact in
  // place until that review occurs; setting the completed flag would let a later
  // PHI purge silently destroy the unresolved local/server payload pair.
  if (hasConflicts()) return { retired: false, flushed: 0, pending: 1 };
  if (alreadyRetired()) return { retired: true, flushed: 0, pending: 0 };

  // Older localStorage queues predate the IndexedDB one; recover them into the
  // same flush. NOTHING is deleted here: `enqueue` only stages an item in memory,
  // so the migration hands back `clearLegacyStores` and we call it further down,
  // after every staged write has actually reached the server. Clearing at map time
  // destroyed stranded field documentation whenever the send that followed was
  // skipped (device offline) or failed part-way.
  const pendingWrites = [];
  let clearLegacyStores = () => {};
  let preservedLegacyStores = [];
  try {
    const migration = await migrateLegacyOfflineQueues({
      enqueue: async (action, payload) => {
        const stableKey = exactIdentifier(payload?.client_request_id)
          || exactIdentifier(payload?.visit_id);
        pendingWrites.push({
          id: stableKey ? `legacy-local-storage:${action}:${stableKey}` : null,
          action,
          payload,
        });
      },
    });
    if (typeof migration?.clearMigratedStores === 'function') {
      clearLegacyStores = migration.clearMigratedStores;
    }
    if (migration?.complete === false) {
      preservedLegacyStores = Array.isArray(migration.preservedStores)
        ? migration.preservedStores
        : ['unknown'];
    }
  } catch (error) {
    logger.debug('[offline-retire] could not read the legacy localStorage queues', error);
    preservedLegacyStores = ['unreadable'];
  }

  if (preservedLegacyStores.length > 0) {
    logger.debug(
      '[offline-retire] legacy stores require supervised recovery; deferring retirement',
      preservedLegacyStores,
    );
    return { retired: false, flushed: 0, pending: Math.max(1, pendingWrites.length) };
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
    try {
      await unregisterWorker();
      await deleteDatabase();
      clearLegacyStores();
      markRetired();
      return true;
    } catch (error) {
      logger.error('[offline-retire] could not prove legacy storage deletion; keeping retirement incomplete', error);
      return false;
    }
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
      await flushItem(item, entities, functions, getAuthenticatedUser);
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
