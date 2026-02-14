import { useState, useEffect, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";

const PATIENT_CACHE_KEY = "cm_offline_patients";
const VISIT_CACHE_KEY = "cm_offline_visits";
const CAREPLAN_CACHE_KEY = "cm_offline_careplans";
const PENDING_WRITES_KEY = "cm_pending_writes";
const LAST_SYNC_KEY = "cm_last_full_sync";
const SYNC_INTERVAL_MS = 60_000; // 1 minute

function getStored(key, fallback = []) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}
function setStored(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Hook: manages offline patient data, visit data, and pending writes with background sync.
 */
export function useOfflineDataManager() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const syncTimerRef = useRef(null);

  // Track online status
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Count pending writes
  useEffect(() => {
    const update = () => {
      const pending = getStored(PENDING_WRITES_KEY, []);
      setPendingSyncCount(pending.length);
    };
    update();
    const id = setInterval(update, 3000);
    return () => clearInterval(id);
  }, []);

  // Load last sync time
  useEffect(() => {
    const t = localStorage.getItem(LAST_SYNC_KEY);
    if (t) setLastSync(new Date(t));
  }, []);

  // Background sync loop
  useEffect(() => {
    if (!isOnline) return;
    const run = async () => {
      await flushPendingWrites();
    };
    run();
    syncTimerRef.current = setInterval(run, SYNC_INTERVAL_MS);
    return () => clearInterval(syncTimerRef.current);
  }, [isOnline]);

  // Cache patients for offline access
  const cachePatients = useCallback(async () => {
    if (!isOnline) return;
    setIsSyncing(true);
    try {
      const patients = await base44.entities.Patient.list("-updated_date", 100);
      const slim = patients.map(p => ({
        id: p.id, first_name: p.first_name, last_name: p.last_name,
        primary_diagnosis: p.primary_diagnosis, secondary_diagnoses: p.secondary_diagnoses,
        allergies: p.allergies, current_medications: p.current_medications,
        date_of_birth: p.date_of_birth, medical_record_number: p.medical_record_number,
        status: p.status, baseline_vitals: p.baseline_vitals,
        functional_status: p.functional_status, phone: p.phone, address: p.address,
      }));
      setStored(PATIENT_CACHE_KEY, slim);

      const plans = await base44.entities.CarePlan.filter({ status: "active" });
      setStored(CAREPLAN_CACHE_KEY, plans);

      const now = new Date();
      localStorage.setItem(LAST_SYNC_KEY, now.toISOString());
      setLastSync(now);
      return slim.length;
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline]);

  // Queue a write for later sync
  const queueWrite = useCallback((entityName, operation, data) => {
    const pending = getStored(PENDING_WRITES_KEY, []);
    pending.push({ id: Date.now().toString(), entityName, operation, data, createdAt: new Date().toISOString() });
    setStored(PENDING_WRITES_KEY, pending);
    setPendingSyncCount(pending.length);
  }, []);

  // Flush all pending writes to server
  const flushPendingWrites = useCallback(async () => {
    if (!isOnline) return;
    const pending = getStored(PENDING_WRITES_KEY, []);
    if (pending.length === 0) return;

    setIsSyncing(true);
    const remaining = [];
    for (const item of pending) {
      try {
        const entity = base44.entities[item.entityName];
        if (!entity) { remaining.push(item); continue; }
        if (item.operation === "create") await entity.create(item.data);
        else if (item.operation === "update") await entity.update(item.data.id, item.data);
      } catch {
        remaining.push(item);
      }
    }
    setStored(PENDING_WRITES_KEY, remaining);
    setPendingSyncCount(remaining.length);
    setIsSyncing(false);
  }, [isOnline]);

  // Get cached data (works offline)
  const getCachedPatients = useCallback(() => getStored(PATIENT_CACHE_KEY, []), []);
  const getCachedCarePlans = useCallback(() => getStored(CAREPLAN_CACHE_KEY, []), []);

  return {
    isOnline, isSyncing, pendingSyncCount, lastSync,
    cachePatients, queueWrite, flushPendingWrites,
    getCachedPatients, getCachedCarePlans,
  };
}