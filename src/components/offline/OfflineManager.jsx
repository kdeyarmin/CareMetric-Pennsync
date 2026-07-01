import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import {
  getSyncQueue,
  removeFromSyncQueue,
  savePatients
} from '@/lib/indexedDB';
import { toast } from 'sonner';

export default function OfflineManager() {
  const { isAuthenticated } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // Guards the drain against concurrent/re-entrant runs so two `online` events
  // (or a re-mount) don't both drain the same queue and double-create visits.
  const isDrainingRef = useRef(false);

  useEffect(() => {
    // Drains the IndexedDB sync queue. Called both from the `online` event AND
    // once on mount when already online — otherwise a visit queued offline in a
    // prior session (tab closed before reconnect) never syncs, because no
    // `online` event fires when the app simply loads already-connected.
    const drainQueue = async () => {
      if (isDrainingRef.current) return;
      isDrainingRef.current = true;

      let syncedCount = 0;
      try {
        const queue = await getSyncQueue();
        for (const item of queue) {
          if (item.action === 'CREATE_VISIT') {
            // Idempotency: if a Visit with this client_request_id already exists
            // (e.g. created on a prior interrupted drain), reuse it instead of
            // creating a duplicate clinical record.
            const key = item.payload?.client_request_id;
            const existing = key
              ? await base44.entities.Visit.filter({ client_request_id: key })
              : [];
            // `__audit` is reporting meta, not a Visit field — peel it off before
            // the create so the offline visit also produces a ComplianceAudit and
            // shows up in the compliance dashboards (older items simply lack it).
            const { __audit, ...visitPayload } = item.payload || {};
            const visit = (existing && existing.length > 0)
              ? existing[0]
              : await base44.entities.Visit.create(visitPayload);
            // Guarantee the ComplianceAudit exists for this visit. A prior drain
            // may have created the Visit but died before creating the audit (tab
            // close, audit-create failure) — in which case clearing the queue here
            // would otherwise leave the offline visit invisible to the dashboards.
            // Runs whether the visit is new or pre-existing, keyed on visit_id so
            // it never double-creates the audit.
            if (__audit) {
              const audits = await base44.entities.ComplianceAudit.filter({ visit_id: visit.id });
              if (!audits || audits.length === 0) {
                await base44.entities.ComplianceAudit.create({
                  visit_id: visit.id, patient_id: visitPayload.patient_id,
                  audit_date: new Date().toISOString(), audit_type: 'automated',
                  ...__audit,
                });
              }
            }
            await removeFromSyncQueue(item.id);
            syncedCount += 1;
          } else if (item.action === 'UPDATE_VISIT') {
            // A visit that already exists server-side was edited/documented offline
            // (a same-session online save edited offline, or a deep-linked scheduled
            // visit documented offline). UPDATE it in place instead of creating a
            // duplicate. `visit_id` is the real server id; `__audit` is reporting
            // meta peeled off the Visit fields, same as the CREATE_VISIT path.
            const { __audit, visit_id, ...visitPayload } = item.payload || {};
            if (!visit_id) {
              // A malformed UPDATE_VISIT (no target id) can never be processed —
              // drop it so it doesn't re-warn and clog the queue on every drain.
              console.warn('Dropping UPDATE_VISIT with no visit_id:', item.id);
              await removeFromSyncQueue(item.id);
              continue;
            }
            await base44.entities.Visit.update(visit_id, visitPayload);
            // Reconcile the ComplianceAudit for this visit, keyed on visit_id so a
            // retried drain never double-creates: update the existing audit (clears
            // any stale `critical` status the edit resolved), or create one if the
            // visit had none yet (e.g. a scheduled visit first documented offline).
            if (__audit) {
              const { audit_id: _ignoredAuditId, ...auditPayload } = __audit;
              const audits = await base44.entities.ComplianceAudit.filter({ visit_id });
              if (audits && audits.length > 0) {
                await base44.entities.ComplianceAudit.update(audits[0].id, auditPayload);
              } else {
                await base44.entities.ComplianceAudit.create({
                  visit_id, patient_id: visitPayload.patient_id,
                  audit_date: new Date().toISOString(), audit_type: 'automated',
                  ...auditPayload,
                });
              }
            }
            await removeFromSyncQueue(item.id);
            syncedCount += 1;
          } else if (item.action === 'CREATE_TASK') {
            // A provider follow-up escalated while offline (critical chart conflict
            // or vital). Create the Task on reconnect so the follow-up isn't lost.
            await base44.entities.Task.create(item.payload);
            await removeFromSyncQueue(item.id);
            syncedCount += 1;
          } else {
            // Unknown action types have no handler; log so they aren't invisibly
            // stuck in the queue forever. Left in place (not removed) for inspection.
            console.warn('Skipping unknown sync action; no handler:', item.action, item.id);
          }
        }

        if (syncedCount > 0) {
            toast.success(`Successfully synced ${syncedCount} items.`);
        }
      } catch (err) {
        console.error('Error syncing data:', err);
        toast.error('Some items failed to sync.');
      } finally {
        isDrainingRef.current = false;
      }
    };

    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online! Syncing data...');
      drainQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline. Changes will be saved locally and synced when you reconnect.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial cache of patients. OfflineManager is mounted outside the auth gate,
    // so guard this PHI query on authentication to avoid firing it on the login screen.
    if (isOnline && isAuthenticated) {
      base44.entities.Patient.filter({ status: "active" }, "first_name", 200)
        .then(patients => {
          savePatients(patients);
        })
        .catch(console.error);

      // Drain any items left in the queue from a prior session. No `online` event
      // fires when the app loads already-connected, so without this an offline
      // visit captured last session would sit unsynced until the next reconnect.
      drainQueue();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isOnline, isAuthenticated]);

  return null;
}