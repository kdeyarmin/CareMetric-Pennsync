import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff, Upload, AlertCircle, Clock } from 'lucide-react';
import { OFFLINE_KEYS } from '@/lib/offlineKeys';
import { toast } from 'sonner';

// Local storage keys (sourced from the single offline-key registry so the PHI
// purge in phiStorage.js can't drift from what this service actually writes).
const STORAGE_KEYS = {
  PENDING_VISITS: OFFLINE_KEYS.PENDING_VISITS,
  PENDING_NOTES: OFFLINE_KEYS.PENDING_NOTES,
  PENDING_VITALS: OFFLINE_KEYS.PENDING_VITALS,
  PENDING_TASKS: OFFLINE_KEYS.PENDING_TASKS,
  SYNC_QUEUE: OFFLINE_KEYS.SYNC_QUEUE,
  LAST_SYNC: OFFLINE_KEYS.LAST_SYNC,
  CONFLICT_LOG: OFFLINE_KEYS.CONFLICTS,
  // Maps an offline_ placeholder id (e.g. an offline visit) to the real server
  // id it received once synced. Persisted so dependent items (notes/vitals) can
  // resolve their parent even when the visit synced on an earlier run.
  ID_MAP: OFFLINE_KEYS.ID_MAP,
};

// Offline storage manager
class OfflineStorageManager {
  static saveToQueue(type, data) {
    try {
      const queue = this.getQueue();
      const item = {
        id: `offline_${Date.now()}_${Math.random()}`,
        type,
        data,
        timestamp: new Date().toISOString(),
        status: 'pending',
        retryCount: 0
      };
      queue.push(item);
      localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
      return item.id;
    } catch (error) {
      console.error('Failed to save to offline queue:', error);
      return null;
    }
  }

  static getQueue() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static updateQueueItem(id, updates) {
    const queue = this.getQueue();
    const index = queue.findIndex(item => item.id === id);
    if (index !== -1) {
      queue[index] = { ...queue[index], ...updates };
      try { localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue)); } catch {}
    }
  }

  static removeFromQueue(id) {
    const queue = this.getQueue().filter(item => item.id !== id);
    try { localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue)); } catch {}
  }

  static clearQueue() {
    try { localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify([])); } catch {}
  }

  static saveConflict(conflict) {
    try {
      const conflicts = this.getConflicts();
      conflicts.push({
        ...conflict,
        timestamp: new Date().toISOString()
      });
      localStorage.setItem(STORAGE_KEYS.CONFLICT_LOG, JSON.stringify(conflicts));
    } catch (error) {
      console.error('Failed to save conflict:', error);
    }
  }

  static getConflicts() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CONFLICT_LOG);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static clearConflicts() {
    try { localStorage.setItem(STORAGE_KEYS.CONFLICT_LOG, JSON.stringify([])); } catch {}
  }

  static getLastSync() {
    try { return localStorage.getItem(STORAGE_KEYS.LAST_SYNC); } catch { return null; }
  }

  static setLastSync() {
    try { localStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString()); } catch {}
  }

  static getIdMap() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ID_MAP);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  // Record that an offline placeholder id now maps to a real server id.
  static setIdMapping(offlineId, realId) {
    if (!offlineId || !realId) return;
    try {
      const map = this.getIdMap();
      map[offlineId] = realId;
      localStorage.setItem(STORAGE_KEYS.ID_MAP, JSON.stringify(map));
    } catch (error) {
      console.error('Failed to persist offline id mapping:', error);
    }
  }

  // Resolve a possibly-offline id to its real server id (returns null if a still
  // -unsynced offline id has no mapping yet).
  static resolveId(id) {
    if (typeof id !== 'string' || !id.startsWith('offline_')) return id;
    const map = this.getIdMap();
    return map[id] || null;
  }
}

// Idempotent Visit create keyed on the queue item's id. If a prior sync run (or a
// concurrent one) already created the Visit server-side but died before
// removeFromQueue, reuse that record instead of creating a duplicate clinical
// visit. Mirrors the client_request_id idempotency in OfflineManager.
async function createVisitIdempotent(visitData, requestKey) {
  if (requestKey) {
    const existing = await base44.entities.Visit
      .filter({ client_request_id: requestKey }, '-created_date', 1)
      .catch(() => []);
    if (Array.isArray(existing) && existing.length > 0) return existing[0];
    return base44.entities.Visit.create({ ...visitData, client_request_id: requestKey });
  }
  return base44.entities.Visit.create(visitData);
}

// Sync worker
class OfflineSyncWorker {
  static async syncItem(item) {
    try {
      let result;
      
      switch (item.type) {
        case 'visit':
          if (item.data.id && item.data.id.startsWith('offline_')) {
            // New visit - create, then remember offline_id -> real id so queued
            // notes/vitals referencing this visit can be attached on this or a
            // later sync run (previously they were orphaned and lost forever).
            const { id, ...visitData } = item.data;
            result = await createVisitIdempotent(visitData, item.id);
            OfflineStorageManager.setIdMapping(id, result?.id);
          } else if (item.data.id) {
            // Update existing visit
            const { id, ...visitData } = item.data;
            result = await base44.entities.Visit.update(id, visitData);
          } else {
            // Create new visit
            result = await createVisitIdempotent(item.data, item.id);
          }
          break;

        case 'note': {
          let noteVisitId = item.data.visit_id;
          if (typeof noteVisitId === 'string' && noteVisitId.startsWith('offline_')) {
            // Resolve to the real visit id once its visit has synced; stay
            // pending only while no mapping exists yet.
            noteVisitId = OfflineStorageManager.resolveId(noteVisitId);
            if (!noteVisitId) {
              return { status: 'pending', reason: 'waiting_for_visit' };
            }
          }
          result = await base44.entities.Visit.update(noteVisitId, {
            nurse_notes: item.data.nurse_notes
          });
          break;
        }

        case 'vitals': {
          let vitalsVisitId = item.data.visit_id;
          if (typeof vitalsVisitId === 'string' && vitalsVisitId.startsWith('offline_')) {
            vitalsVisitId = OfflineStorageManager.resolveId(vitalsVisitId);
            if (!vitalsVisitId) {
              return { status: 'pending', reason: 'waiting_for_visit' };
            }
          }
          result = await base44.entities.Visit.update(vitalsVisitId, {
            vital_signs: item.data.vital_signs
          });
          break;
        }

        case 'task':
          if (item.data.id && item.data.id.startsWith('offline_')) {
            const { id: _offlineId, ...taskData } = item.data;
            result = await base44.entities.Task.create(taskData);
          } else if (item.data.id) {
            const { id, ...taskData } = item.data;
            result = await base44.entities.Task.update(id, taskData);
          } else {
            result = await base44.entities.Task.create(item.data);
          }
          break;

        default:
          throw new Error(`Unknown sync type: ${item.type}`);
      }

      return { status: 'success', result };
    } catch (error) {
      // Check for conflicts
      if (error.status === 409 || error.message?.includes('conflict')) {
        return { status: 'conflict', error };
      }
      return { status: 'error', error };
    }
  }

  static async syncAll(onProgress) {
    const queue = OfflineStorageManager.getQueue();
    const results = {
      success: 0,
      failed: 0,
      conflicts: 0,
      pending: 0
    };

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];

      // A 'failed' item has exhausted its retry budget and a 'conflict' item is
      // awaiting manual resolution. Re-running syncItem on them every cycle would
      // silently bypass the 3-retry cap and re-POST conflicting writes, so leave
      // them in place for an explicit user-driven retry/resolve.
      if (item.status === 'failed' || item.status === 'conflict') {
        continue;
      }

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: queue.length,
          item
        });
      }

      const result = await this.syncItem(item);

      switch (result.status) {
        case 'success':
          results.success++;
          OfflineStorageManager.removeFromQueue(item.id);
          break;

        case 'pending':
          results.pending++;
          OfflineStorageManager.updateQueueItem(item.id, {
            status: 'pending',
            pendingReason: result.reason
          });
          break;

        case 'conflict':
          results.conflicts++;
          OfflineStorageManager.saveConflict({
            item,
            error: result.error
          });
          OfflineStorageManager.updateQueueItem(item.id, {
            status: 'conflict',
            error: result.error.message
          });
          break;

        case 'error':
          results.failed++;
          const retryCount = (item.retryCount || 0) + 1;
          if (retryCount >= 3) {
            OfflineStorageManager.updateQueueItem(item.id, {
              status: 'failed',
              error: result.error.message,
              retryCount
            });
          } else {
            OfflineStorageManager.updateQueueItem(item.id, {
              retryCount,
              lastError: result.error.message
            });
          }
          break;
      }
    }

    OfflineStorageManager.setLastSync();
    return results;
  }
}

// React hook for offline sync
export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  // In-flight guard: the 5s pendingCount poll can re-fire the auto-sync effect
  // mid-sync, and syncAll reads the queue with no per-item lock — two concurrent
  // runs would both POST the same item, creating duplicate clinical records.
  const isSyncingRef = useRef(false);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    const updatePendingCount = () => {
      const queue = OfflineStorageManager.getQueue();
      setPendingCount(queue.filter(item => item.status === 'pending').length);
    };

    updatePendingCount();
    const interval = setInterval(updatePendingCount, 5000);
    return () => clearInterval(interval);
  }, []);

  const saveOffline = useCallback((type, data) => {
    const id = OfflineStorageManager.saveToQueue(type, data);
    setPendingCount(prev => prev + 1);
    toast.info('Saved offline - will sync when online');
    return id;
  }, []);

  const syncNow = useCallback(async () => {
    if (!isOnline) {
      toast.error('Cannot sync while offline');
      return;
    }
    if (isSyncingRef.current) return; // a sync is already running — don't double-POST
    isSyncingRef.current = true;

    setIsSyncing(true);
    setSyncProgress({ current: 0, total: pendingCount });

    try {
      const results = await OfflineSyncWorker.syncAll((progress) => {
        setSyncProgress(progress);
      });

      if (results.success > 0) {
        toast.success(`Synced ${results.success} item${results.success > 1 ? 's' : ''}`);
      }

      if (results.conflicts > 0) {
        toast.warning(`${results.conflicts} conflict${results.conflicts > 1 ? 's' : ''} detected`);
      }

      if (results.failed > 0) {
        toast.error(`${results.failed} item${results.failed > 1 ? 's' : ''} failed to sync`);
      }

      setPendingCount(results.pending);
    } catch (error) {
      toast.error('Sync failed: ' + error.message);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
      setSyncProgress(null);
    }
  }, [isOnline, pendingCount]);

  // Auto-sync when coming online OR when items are queued while already online.
  // pendingCount must be a dep so newly-queued items trigger a sync (the prior
  // [isOnline]-only deps left this a stale closure that only fired on
  // offline->online transitions). Declared after syncNow so it isn't referenced
  // in the dep array before initialization (temporal dead zone). The 2s debounce
  // + cleanup prevents a tight re-render loop.
  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      const timer = setTimeout(() => {
        syncNow();
      }, 2000); // Wait 2 seconds to ensure stable connection
      return () => clearTimeout(timer);
    }
  }, [isOnline, pendingCount, syncNow]);

  const clearQueue = useCallback(() => {
    OfflineStorageManager.clearQueue();
    setPendingCount(0);
    toast.success('Offline queue cleared');
  }, []);

  return {
    isOnline,
    isSyncing,
    syncProgress,
    pendingCount,
    saveOffline,
    syncNow,
    clearQueue,
    getQueue: OfflineStorageManager.getQueue,
    getConflicts: OfflineStorageManager.getConflicts
  };
}

// Offline sync status widget
export default function OfflineSyncService() {
  const {
    isOnline,
    isSyncing,
    syncProgress,
    pendingCount,
    syncNow,
    clearQueue,
    getQueue,
    getConflicts
  } = useOfflineSync();

  const [showDetails, setShowDetails] = useState(false);
  const [queue, setQueue] = useState([]);
  const [conflicts, setConflicts] = useState([]);

  useEffect(() => {
    if (showDetails) {
      setQueue(getQueue());
      setConflicts(getConflicts());
    }
  }, [showDetails, getQueue, getConflicts]);

  if (!showDetails && pendingCount === 0 && isOnline) {
    return null; // Hide when nothing to sync
  }

  return (
    <Card className="border-2">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {isOnline ? (
              <Wifi className="w-5 h-5 text-green-600" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-600" />
            )}
            <div>
              <h3 className="font-semibold text-slate-900">
                {isOnline ? 'Online' : 'Offline Mode'}
              </h3>
              <p className="text-xs text-slate-500">
                {pendingCount > 0 ? `${pendingCount} item${pendingCount > 1 ? 's' : ''} pending sync` : 'All synced'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
                {pendingCount} pending
              </Badge>
            )}
            {conflicts.length > 0 && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">
                {conflicts.length} conflicts
              </Badge>
            )}
          </div>
        </div>

        {isSyncing && syncProgress && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-slate-600">Syncing...</span>
              <span className="text-slate-900 font-medium">
                {syncProgress.current} / {syncProgress.total}
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {isOnline && pendingCount > 0 && !isSyncing && (
            <Button onClick={syncNow} size="sm" className="flex-1">
              <Upload className="w-4 h-4 mr-2" />
              Sync Now
            </Button>
          )}
          <Button
            onClick={() => setShowDetails(!showDetails)}
            variant="outline"
            size="sm"
            className="flex-1"
          >
            {showDetails ? 'Hide Details' : 'View Details'}
          </Button>
        </div>

        {showDetails && (
          <div className="mt-4 space-y-3 max-h-64 overflow-auto">
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Sync Queue</h4>
              {queue.length === 0 ? (
                <p className="text-sm text-slate-500">No pending items</p>
              ) : (
                <div className="space-y-2">
                  {queue.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-2 bg-slate-50 rounded text-xs">
                      <div className="flex items-center gap-2">
                        {item.status === 'pending' && <Clock className="w-3 h-3 text-orange-600" />}
                        {item.status === 'conflict' && <AlertCircle className="w-3 h-3 text-red-600" />}
                        {item.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-600" />}
                        <span className="font-medium capitalize">{item.type}</span>
                        <span className="text-slate-500">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          item.status === 'pending'
                            ? 'bg-orange-50 text-orange-700 border-orange-300'
                            : 'bg-red-50 text-red-700 border-red-300'
                        }
                      >
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {conflicts.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Conflicts</h4>
                <div className="space-y-2">
                  {conflicts.map((conflict, idx) => (
                    <div key={idx} className="p-2 bg-red-50 border border-red-200 rounded text-xs">
                      <div className="font-medium text-red-900 mb-1">
                        {conflict.item.type} - {new Date(conflict.timestamp).toLocaleString()}
                      </div>
                      <div className="text-red-700">{conflict.error?.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pendingCount > 0 && (
              <Button
                onClick={clearQueue}
                variant="outline"
                size="sm"
                className="w-full text-red-600 border-red-300 hover:bg-red-50"
              >
                Clear Queue
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Export utilities for use in other components
export { OfflineStorageManager, OfflineSyncWorker };