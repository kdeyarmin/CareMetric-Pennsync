import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { hasAcceptedAiContentAgreement } from '@/lib/aiContentAgreement';
import { savePatients } from '@/lib/indexedDB';
import { drainSyncQueue } from '@/lib/offlineSync';
import { migrateLegacyOfflineQueues } from '@/lib/offlineMigration';
import { toast } from 'sonner';

export default function OfflineManager() {
  const { isAuthenticated, user } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Background clinical sync — draining queued Visit/Task/Incident writes and
  // caching active-patient PHI below — is itself "using the software". This
  // component is mounted in App() OUTSIDE the AuthenticatedApp route gate, so
  // gating only route rendering would still let it submit queued writes and read
  // PHI before the user signs the AI-content responsibility agreement (e.g. on
  // first login or after a version bump). Require acceptance here too, matching
  // the routed app, so no clinical data moves until the user has signed off.
  const canSync = isAuthenticated && hasAcceptedAiContentAgreement(user);

  useEffect(() => {
    // Drains the canonical IndexedDB sync queue. Called both from the `online`
    // event AND once on mount when already online — otherwise a visit queued
    // offline in a prior session (tab closed before reconnect) never syncs,
    // because no `online` event fires when the app simply loads already-connected.
    // The drain worker + its concurrency guard + idempotency live in
    // src/lib/offlineSync.js so the same logic backs every manual "Sync now".
    const drainQueue = async () => {
      const { synced, error, coalesced } = await drainSyncQueue();
      // A coalesced call joined a drain another caller started (e.g. handleOnline
      // and the post-migration drain both fire on reconnect) — let that initiator
      // own the toast so we don't show it twice for one drain.
      if (coalesced) return;
      if (synced > 0) toast.success(`Successfully synced ${synced} items.`);
      if (error) toast.error('Some items failed to sync.');
    };

    const handleOnline = () => {
      setIsOnline(true);
      // Only announce + drain once the user may sync; before sign-off we still
      // track online state but must not push queued clinical writes.
      if (canSync) {
        toast.success('Back online! Syncing data...');
        drainQueue();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline. Changes will be saved locally and synced when you reconnect.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (canSync) {
      // One-time replay of any pending writes left in the RETIRED localStorage
      // queues by a previous app version into the canonical IndexedDB queue, so an
      // upgrade doesn't strand offline visits/incidents on the device. Local-only +
      // idempotent (clears each store after enqueuing). Drain afterward so migrated
      // items upload on this same startup when online. No `online` event fires when
      // the app loads already-connected, so this mount-time drain is also what syncs
      // a visit captured last session.
      migrateLegacyOfflineQueues()
        .catch((e) => console.error('Legacy offline queue migration failed:', e))
        .finally(() => { if (navigator.onLine) drainQueue(); });
    }

    // Initial cache of patients. OfflineManager is mounted outside the auth AND
    // agreement gates, so guard this PHI query on both — never fire it on the
    // login screen or the agreement screen.
    if (isOnline && canSync) {
      base44.entities.Patient.filter({ status: "active" }, "first_name", 200)
        .then(patients => {
          savePatients(patients);
        })
        .catch(console.error);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isOnline, canSync]);

  return null;
}