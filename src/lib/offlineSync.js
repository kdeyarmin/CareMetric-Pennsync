import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { getSyncQueue, removeFromSyncQueue } from '@/lib/indexedDB';

/**
 * offlineSync — the ONE drain path + status source for the canonical offline
 * mutation queue (the IndexedDB `sync_queue`, written via addToSyncQueue).
 *
 * The app historically carried several parallel offline queues (a localStorage
 * `offline_sync_queue`, an `offline_visit_drafts` list, a `penn_sync_offline_*`
 * store) each with its own drainer and its own pending-count UI. A note captured
 * through one path was invisible to another's sync widget, and the main clinical
 * flow (SmartNote / Visit Scribe → addToSyncQueue) had NO visible pending
 * indicator at all. This module makes the IndexedDB queue the single source of
 * truth: every offline write goes through addToSyncQueue, this one worker drains
 * it, and every widget reads its count from here.
 *
 * The drain logic was lifted verbatim from OfflineManager so the proven
 * idempotency (client_request_id for CREATE_VISIT, visit_id for UPDATE_VISIT) and
 * ComplianceAudit reconciliation are unchanged; CREATE_INCIDENT was added for the
 * OfflineMode incident form that previously wrote to its own queue.
 */

// Fired whenever the queue changes (an item enqueued or drained) so any mounted
// status widget re-reads the count without waiting for its poll tick.
export const QUEUE_CHANGED_EVENT = 'offline-queue-changed';

export function notifyQueueChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT));
  }
}

// Module-level in-flight guard shared by every caller (the global OfflineManager
// mount AND any manual "Sync now" button). syncItem has no per-item lock and the
// idempotency checks are read-then-write, so two concurrent drains could both
// create the same record; one flag serializes them regardless of caller.
let draining = false;

/**
 * Drain the canonical IndexedDB sync queue once. Idempotent per item and safe to
 * call concurrently (re-entrant calls no-op while a drain is in flight). Returns
 * `{ synced, error }`; the caller owns any user-facing toast. `deps` is injectable
 * so the worker can be unit-tested without IndexedDB or the real SDK.
 */
export async function drainSyncQueue(deps = {}) {
  const {
    entities = base44.entities,
    getQueue = getSyncQueue,
    removeItem = removeFromSyncQueue,
  } = deps;

  if (draining) return { synced: 0, error: null };
  draining = true;

  let synced = 0;
  let error = null;
  try {
    const queue = await getQueue();
    for (const item of queue) {
      if (item.action === 'CREATE_VISIT') {
        // Idempotency: if a Visit with this client_request_id already exists
        // (created on a prior interrupted drain), reuse it instead of creating a
        // duplicate clinical record.
        const key = item.payload?.client_request_id;
        const existing = key
          ? await entities.Visit.filter({ client_request_id: key })
          : [];
        // `__audit` is reporting meta, not a Visit field — peel it off before the
        // create so the offline visit also produces a ComplianceAudit.
        const { __audit, ...visitPayload } = item.payload || {};
        const visit = (existing && existing.length > 0)
          ? existing[0]
          : await entities.Visit.create(visitPayload);
        // Guarantee the ComplianceAudit exists for this visit, keyed on visit_id
        // so a retried drain never double-creates it.
        if (__audit) {
          const audits = await entities.ComplianceAudit.filter({ visit_id: visit.id });
          if (!audits || audits.length === 0) {
            await entities.ComplianceAudit.create({
              visit_id: visit.id, patient_id: visitPayload.patient_id,
              audit_date: new Date().toISOString(), audit_type: 'automated',
              ...__audit,
            });
          }
        }
        await removeItem(item.id);
        synced += 1;
      } else if (item.action === 'UPDATE_VISIT') {
        // A visit that already exists server-side was edited/documented offline.
        // UPDATE it in place instead of creating a duplicate. `visit_id` is the
        // real server id; `__audit` is reporting meta peeled off the Visit fields.
        const { __audit, visit_id, ...visitPayload } = item.payload || {};
        if (!visit_id) {
          // A malformed UPDATE_VISIT (no target id) can never be processed — drop
          // it so it doesn't re-warn and clog the queue on every drain.
          console.warn('Dropping UPDATE_VISIT with no visit_id:', item.id);
          await removeItem(item.id);
          continue;
        }
        await entities.Visit.update(visit_id, visitPayload);
        // Reconcile the ComplianceAudit for this visit, keyed on visit_id so a
        // retried drain never double-creates: update the existing audit (clears any
        // stale `critical` status the edit resolved), or create one if none exists.
        if (__audit) {
          const { audit_id: _ignoredAuditId, ...auditPayload } = __audit;
          const audits = await entities.ComplianceAudit.filter({ visit_id });
          if (audits && audits.length > 0) {
            await entities.ComplianceAudit.update(audits[0].id, auditPayload);
          } else {
            await entities.ComplianceAudit.create({
              visit_id, patient_id: visitPayload.patient_id,
              audit_date: new Date().toISOString(), audit_type: 'automated',
              ...auditPayload,
            });
          }
        }
        await removeItem(item.id);
        synced += 1;
      } else if (item.action === 'CREATE_TASK') {
        // A provider follow-up escalated while offline (critical chart conflict or
        // vital). Create the Task on reconnect so the follow-up isn't lost.
        await entities.Task.create(item.payload);
        await removeItem(item.id);
        synced += 1;
      } else if (item.action === 'CREATE_INCIDENT') {
        // An incident reported offline (OfflineMode). Create it on reconnect so the
        // safety event isn't lost. `created_offline` is local bookkeeping — strip it.
        const { created_offline: _createdOffline, ...incidentPayload } = item.payload || {};
        await entities.Incident.create(incidentPayload);
        await removeItem(item.id);
        synced += 1;
      } else {
        // Unknown action types have no handler; log so they aren't invisibly stuck
        // in the queue forever. Left in place (not removed) for inspection.
        console.warn('Skipping unknown sync action; no handler:', item.action, item.id);
      }
    }
  } catch (err) {
    // A single failing item aborts the remainder of this pass; the unprocessed
    // items stay queued and are retried on the next drain. Surface to the caller.
    console.error('Error draining sync queue:', err);
    error = err;
  } finally {
    draining = false;
  }

  if (synced > 0) notifyQueueChanged();
  return { synced, error };
}

/** Current number of items waiting in the canonical queue (0 on any failure). */
export async function getQueueCount() {
  try {
    const queue = await getSyncQueue();
    return Array.isArray(queue) ? queue.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Hook exposing the canonical offline queue to any widget: `{ isOnline,
 * pendingCount, isSyncing, syncNow }`. The count refreshes on the queue-changed
 * event, on connectivity changes, and on a slow poll (a safety net for writes
 * that happen in another tab). `syncNow` triggers the shared drain.
 */
export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setPendingCount(await getQueueCount());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const count = await getQueueCount();
      if (!cancelled) setPendingCount(count);
    };
    tick();

    const onOnline = () => { setIsOnline(true); tick(); };
    const onOffline = () => setIsOnline(false);
    const onChanged = () => tick();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(QUEUE_CHANGED_EVENT, onChanged);
    const interval = setInterval(tick, 5000);

    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(QUEUE_CHANGED_EVENT, onChanged);
      clearInterval(interval);
    };
  }, []);

  const syncNow = useCallback(async () => {
    setIsSyncing(true);
    try {
      return await drainSyncQueue();
    } finally {
      setIsSyncing(false);
      await refresh();
    }
  }, [refresh]);

  return { isOnline, pendingCount, isSyncing, syncNow };
}
