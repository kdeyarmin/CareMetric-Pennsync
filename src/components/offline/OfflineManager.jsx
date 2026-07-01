import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { savePatients } from '@/lib/indexedDB';
import { drainSyncQueue } from '@/lib/offlineSync';
import { toast } from 'sonner';

export default function OfflineManager() {
  const { isAuthenticated } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    // Drains the canonical IndexedDB sync queue. Called both from the `online`
    // event AND once on mount when already online — otherwise a visit queued
    // offline in a prior session (tab closed before reconnect) never syncs,
    // because no `online` event fires when the app simply loads already-connected.
    // The drain worker + its concurrency guard + idempotency live in
    // src/lib/offlineSync.js so the same logic backs every manual "Sync now".
    const drainQueue = async () => {
      const { synced, error } = await drainSyncQueue();
      if (synced > 0) toast.success(`Successfully synced ${synced} items.`);
      if (error) toast.error('Some items failed to sync.');
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