/**
 * Offline Storage Utility for Penn Sync
 * Handles local storage of visit data when offline
 */

import { OFFLINE_KEYS } from '@/lib/offlineKeys';

// Keys sourced from the single offline-key registry so the PHI purge
// (phiStorage.js) can't drift from what this module writes.
const PENDING_VISITS_KEY = OFFLINE_KEYS.PENN_PENDING_VISITS;
const PENDING_UPDATES_KEY = OFFLINE_KEYS.PENN_PENDING_UPDATES;
const SYNC_ERRORS_KEY = OFFLINE_KEYS.PENN_SYNC_ERRORS;
const SYNC_STATUS_KEY = OFFLINE_KEYS.PENN_SYNC_STATUS;
// Shared offline_->real id map (same key the offline/OfflineSyncService uses) so a
// queued update against an offline visit id can be retargeted to the real server id
// once the visit itself has synced — otherwise Visit.update('offline_...') 404s.
const ID_MAP_KEY = OFFLINE_KEYS.ID_MAP;

class OfflineStorage {
  constructor() {
    this.isOnline = navigator.onLine;
    this.isSyncing = false;
    this.syncInterval = null;
    this.setupListeners();
    this.startBackgroundSync();
  }

  setupListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      setTimeout(() => this.syncPendingData(), 2000);
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  // Start background sync every 30 seconds when online
  startBackgroundSync() {
    this.syncInterval = setInterval(() => {
      if (this.isOnline && !this.isSyncing && this.getPendingCount() > 0) {
        this.syncPendingData();
      }
    }, 30000);
  }

  stopBackgroundSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // Save visit data locally
  saveVisit(visitData) {
    try {
      const pending = this.getPendingVisits();
      const visitId = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      pending.push({
        id: visitId,
        data: visitData,
        timestamp: new Date().toISOString(),
        synced: false,
        syncAttempts: 0,
        lastSyncAttempt: null,
        conflictResolution: 'server_wins' // default strategy
      });

      localStorage.setItem(PENDING_VISITS_KEY, JSON.stringify(pending));
      this.updateSyncStatus();
      return visitId;
    } catch (error) {
      console.error('Error saving offline visit:', error);
      throw error;
    }
  }

  // Save update to existing visit
  saveUpdate(visitId, updateData) {
    try {
      const pending = this.getPendingUpdates();
      
      pending.push({
        visitId,
        data: updateData,
        timestamp: new Date().toISOString(),
        synced: false
      });

      localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(pending));
      return true;
    } catch (error) {
      console.error('Error saving offline update:', error);
      throw error;
    }
  }

  // Get all pending visits
  getPendingVisits() {
    try {
      const data = localStorage.getItem(PENDING_VISITS_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // Get all pending updates
  getPendingUpdates() {
    try {
      const data = localStorage.getItem(PENDING_UPDATES_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // Get count of pending items
  getPendingCount() {
    return this.getPendingVisits().filter(v => !v.synced).length +
           this.getPendingUpdates().filter(u => !u.synced).length +
           this.getPendingChanges().filter(c => c.status !== 'synced').length;
  }

  // Get sync status summary
  getSyncStatus() {
    const visits = this.getPendingVisits();
    const updates = this.getPendingUpdates();
    const all = [...visits, ...updates];
    
    return {
      total: all.length,
      pending: all.filter(i => !i.synced).length,
      syncing: 0,
      failed: 0,
      synced: all.filter(i => i.synced).length
    };
  }

  // Store data for offline access
  cacheData(key, data) {
    try {
      const timestamp = new Date().toISOString();
      localStorage.setItem(`${OFFLINE_KEYS.PENN_CACHE_PREFIX}${key}`, JSON.stringify({ data, timestamp }));
    } catch (error) {
      console.error('Cache storage error:', error);
    }
  }

  // Retrieve cached data
  getCachedData(key) {
    try {
      const cached = localStorage.getItem(`${OFFLINE_KEYS.PENN_CACHE_PREFIX}${key}`);
      if (!cached) return null;
      const { data, timestamp } = JSON.parse(cached);
      return { data, timestamp };
    } catch (error) {
      console.error('Cache retrieval error:', error);
      return null;
    }
  }

  // Store pending changes to sync later
  addPendingChange(type, data, entityId = null) {
    try {
      const pending = JSON.parse(localStorage.getItem(OFFLINE_KEYS.PENDING) || '[]');
      const change = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        type,
        entityType: data.entityType || type,
        data,
        entityId,
        timestamp: new Date().toISOString(),
        status: 'pending',
        retryCount: 0
      };
      pending.push(change);
      localStorage.setItem(OFFLINE_KEYS.PENDING, JSON.stringify(pending));
      
      window.dispatchEvent(new CustomEvent('offline-change-added', { detail: change }));
      
      return change.id;
    } catch (error) {
      console.error('Pending change storage error:', error);
      return null;
    }
  }

  // Get all pending changes
  getPendingChanges() {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_KEYS.PENDING) || '[]');
    } catch (error) {
      console.error('Pending changes retrieval error:', error);
      return [];
    }
  }

  // Clear pending changes after sync
  clearPendingChanges() {
    try {
      localStorage.setItem(OFFLINE_KEYS.PENDING, '[]');
      window.dispatchEvent(new CustomEvent('offline-changes-cleared'));
    } catch (error) {
      console.error('Clear pending error:', error);
    }
  }

  // Log sync error
  logSyncError(item, error, type = 'visit') {
    try {
      const errors = this.getSyncErrors();
      errors.push({
        id: Date.now().toString(),
        itemId: item.id,
        type,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        itemData: item,
        resolved: false
      });
      
      // Keep only last 50 errors
      if (errors.length > 50) {
        errors.splice(0, errors.length - 50);
      }
      
      localStorage.setItem(SYNC_ERRORS_KEY, JSON.stringify(errors));
      window.dispatchEvent(new CustomEvent('sync-error', { detail: { item, error } }));
    } catch (err) {
      console.error('Error logging sync error:', err);
    }
  }

  getSyncErrors() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_ERRORS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  clearSyncErrors() {
    localStorage.setItem(SYNC_ERRORS_KEY, '[]');
  }

  // Update sync status
  updateSyncStatus(status = {}) {
    try {
      const currentStatus = {
        lastSyncAttempt: new Date().toISOString(),
        isSyncing: this.isSyncing,
        ...status
      };
      localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(currentStatus));
      window.dispatchEvent(new CustomEvent('sync-status-changed', { detail: currentStatus }));
    } catch (err) {
      console.error('Error updating sync status:', err);
    }
  }

  // Conflict resolution strategies
  async resolveConflict(localData, serverData, strategy = 'server_wins') {
    switch (strategy) {
      case 'server_wins':
        return serverData;
      case 'client_wins':
        return localData;
      case 'merge':
        // Merge by taking newer fields
        return {
          ...serverData,
          ...Object.keys(localData).reduce((acc, key) => {
            const localDate = new Date(localData.updated_date || localData.timestamp);
            const serverDate = new Date(serverData.updated_date || serverData.timestamp);
            if (localDate > serverDate) {
              acc[key] = localData[key];
            }
            return acc;
          }, {})
        };
      case 'manual':
        // Store for manual resolution
        this.storeConflict(localData, serverData);
        return null;
      default:
        return serverData;
    }
  }

  storeConflict(localData, serverData) {
    let conflicts = [];
    try { conflicts = JSON.parse(localStorage.getItem(OFFLINE_KEYS.CONFLICTS) || '[]'); } catch {}
    conflicts.push({
      id: Date.now().toString(),
      localData,
      serverData,
      timestamp: new Date().toISOString(),
      resolved: false
    });
    localStorage.setItem(OFFLINE_KEYS.CONFLICTS, JSON.stringify(conflicts));
  }

  getConflicts() {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_KEYS.CONFLICTS) || '[]');
    } catch {
      return [];
    }
  }

  // Map a generic change type like "visit_create" / "care_plan_update" to its
  // entity name ("Visit" / "CarePlan") and action ("create" / "update").
  parseChangeType(type) {
    const parts = String(type || '').split('_');
    const action = parts.pop();
    const entityName = parts
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join('');
    return { entityName, action };
  }

  // Replay the generic offline_pending queue (written by addPendingChange, e.g.
  // OfflineTaskManager's offline visit notes and incident reports). Previously
  // nothing drained this queue, so anything saved through addPendingChange was
  // never uploaded — silent clinical data loss. Successfully-synced changes are
  // dropped; failures are retained with an incremented retryCount.
  async syncPendingChanges(base44) {
    const all = this.getPendingChanges();
    if (all.length === 0) return { success: 0, failed: 0, errors: [] };

    let success = 0;
    let failed = 0;
    const errors = [];
    const resolvedIds = new Set();   // changes sent (or already synced) → drop
    const retryById = new Map();     // id → incremented retry metadata for failures

    for (const change of all) {
      if (change.status === 'synced') { resolvedIds.add(change.id); continue; }
      try {
        const { entityName, action } = this.parseChangeType(change.type);
        const Entity = base44.entities[entityName];
        if (!Entity) throw new Error(`No entity mapping for change type "${change.type}"`);

        // Strip local-only bookkeeping before sending to the server.
        const payload = { ...(change.data || {}) };
        delete payload.created_offline;
        delete payload.entityType;

        if (action === 'update' && change.entityId) {
          await Entity.update(change.entityId, payload);
        } else {
          await Entity.create(payload);
        }
        success++;
        resolvedIds.add(change.id);
      } catch (error) {
        console.error('Error syncing pending change:', error);
        this.logSyncError(change, error, 'change');
        failed++;
        errors.push({ id: change.id, error: error.message });
        retryById.set(change.id, { retryCount: (change.retryCount || 0) + 1, lastError: error.message });
      }
    }

    // Re-read the queue immediately before writing so a change appended DURING
    // this async drain (a nurse saving a note while the 30s background sync runs)
    // isn't clobbered by the stale pre-sync snapshot — that was silent loss of
    // documented care. Drop only the ids we resolved, apply incremented retry
    // metadata to failures, and keep everything else (incl. new entries) intact.
    const current = this.getPendingChanges();
    const next = current
      .filter((c) => !resolvedIds.has(c.id))
      .map((c) => (retryById.has(c.id) ? { ...c, ...retryById.get(c.id) } : c));
    localStorage.setItem(OFFLINE_KEYS.PENDING, JSON.stringify(next));
    return { success, failed, errors };
  }

  // Enhanced sync with conflict resolution and detailed status
  async syncPendingData() {
    if (!this.isOnline || this.isSyncing) return;

    this.isSyncing = true;
    this.updateSyncStatus({ isSyncing: true, startTime: new Date().toISOString() });

    const { base44 } = await import('@/api/base44Client');
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    try {
      // Sync pending visits
      const pendingVisits = this.getPendingVisits().filter(v => !v.synced);
      
      for (const visit of pendingVisits) {
        try {
          // Check if visit was modified on server (conflict detection)
          let existingVisit = null;
          if (visit.data.id && !visit.id.startsWith('offline_')) {
            try {
              existingVisit = await base44.entities.Visit.filter({ id: visit.data.id });
              existingVisit = existingVisit[0];
            } catch {
              // Visit doesn't exist on server
            }
          }

          let dataToSync = visit.data;
          
          // Handle conflicts if server version exists
          if (existingVisit) {
            const localTimestamp = new Date(visit.timestamp);
            const serverTimestamp = new Date(existingVisit.updated_date);
            
            if (serverTimestamp > localTimestamp) {
              // Conflict detected
              dataToSync = await this.resolveConflict(
                visit.data, 
                existingVisit, 
                visit.conflictResolution || 'server_wins'
              );
              
              if (!dataToSync) {
                // Manual resolution needed - skip this item
                continue;
              }
            }
          }

          // Sync the visit
          if (visit.id.startsWith('offline_')) {
            // Capture the real server id so queued updates that reference this
            // offline visit id (saveUpdate('offline_...')) can be retargeted to
            // the real record instead of 404ing on the placeholder id.
            const created = await base44.entities.Visit.create(dataToSync);
            this.setIdMapping(visit.id, created?.id);
          } else {
            await base44.entities.Visit.update(visit.data.id, dataToSync);
          }

          this.markVisitSynced(visit.id);
          successCount++;
          
        } catch (error) {
          console.error('Error syncing visit:', error);
          this.logSyncError(visit, error, 'visit');
          this.incrementSyncAttempts(visit.id, 'visit');
          errorCount++;
          errors.push({ id: visit.id, error: error.message });
        }
      }

      // Sync pending updates
      const pendingUpdates = this.getPendingUpdates().filter(u => !u.synced);
      
      for (const update of pendingUpdates) {
        try {
          // An update may target an offline visit id; resolve it to the real
          // server id (set when that visit synced, possibly this same run since
          // visits are processed first). If the visit hasn't synced yet there's
          // no mapping, so leave the update pending rather than 404 on 'offline_'.
          const realVisitId = this.resolveId(update.visitId);
          if (!realVisitId) {
            continue;
          }
          await base44.entities.Visit.update(realVisitId, update.data);
          this.markUpdateSynced(update.visitId, update.timestamp);
          successCount++;
        } catch (error) {
          console.error('Error syncing update:', error);
          this.logSyncError(update, error, 'update');
          errorCount++;
          errors.push({ id: update.visitId, error: error.message });
        }
      }

      // Replay the generic offline_pending queue (offline notes/incidents).
      const changeResult = await this.syncPendingChanges(base44);
      successCount += changeResult.success;
      errorCount += changeResult.failed;
      errors.push(...changeResult.errors);

      this.updateSyncStatus({
        isSyncing: false,
        lastSyncSuccess: new Date().toISOString(),
        successCount,
        errorCount,
        errors
      });

      window.dispatchEvent(new CustomEvent('sync-complete', {
        detail: { success: successCount, failed: errorCount, errors }
      }));

      // Clean up old synced items
      this.cleanupSyncedItems();
      
    } catch (error) {
      console.error('Sync error:', error);
      const pVisits = this.getPendingVisits().filter(v => !v.synced);
      const pUpdates = this.getPendingUpdates().filter(u => !u.synced);
      this.updateSyncStatus({
        isSyncing: false,
        lastSyncError: error.message,
        errorCount: pVisits.length + pUpdates.length
      });
    }

    this.isSyncing = false;
  }

  incrementSyncAttempts(itemId, type = 'visit') {
    if (type === 'visit') {
      const pending = this.getPendingVisits();
      const updated = pending.map(v => {
        if (v.id === itemId) {
          return {
            ...v,
            syncAttempts: (v.syncAttempts || 0) + 1,
            lastSyncAttempt: new Date().toISOString()
          };
        }
        return v;
      });
      localStorage.setItem(PENDING_VISITS_KEY, JSON.stringify(updated));
    }
  }

  markVisitSynced(visitId) {
    const pending = this.getPendingVisits();
    const updated = pending.map(v =>
      v.id === visitId ? { ...v, synced: true } : v
    );
    localStorage.setItem(PENDING_VISITS_KEY, JSON.stringify(updated));
  }

  // ── offline_ -> real server id mapping ──────────────────────────────────────
  getIdMap() {
    try {
      const data = localStorage.getItem(ID_MAP_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  // Record that an offline placeholder id now maps to a real server id.
  setIdMapping(offlineId, realId) {
    if (!offlineId || !realId) return;
    try {
      const map = this.getIdMap();
      map[offlineId] = realId;
      localStorage.setItem(ID_MAP_KEY, JSON.stringify(map));
    } catch (error) {
      console.error('Failed to persist offline id mapping:', error);
    }
  }

  // Resolve a possibly-offline id to its real server id. Non-offline ids pass
  // through unchanged; an unsynced offline id with no mapping yet returns null.
  resolveId(id) {
    if (typeof id !== 'string' || !id.startsWith('offline_')) return id;
    const map = this.getIdMap();
    return map[id] || null;
  }

  markUpdateSynced(visitId, timestamp) {
    const pending = this.getPendingUpdates();
    const updated = pending.map(u => 
      u.visitId === visitId && u.timestamp === timestamp ? { ...u, synced: true } : u
    );
    localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(updated));
  }

  cleanupSyncedItems() {
    // Keep synced items for 24 hours, then remove
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const visits = this.getPendingVisits().filter(v => 
      !v.synced || v.timestamp > cutoff
    );
    localStorage.setItem(PENDING_VISITS_KEY, JSON.stringify(visits));

    const updates = this.getPendingUpdates().filter(u => 
      !u.synced || u.timestamp > cutoff
    );
    localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(updates));
  }

  // Clear all offline data
  clearAll() {
    localStorage.removeItem(PENDING_VISITS_KEY);
    localStorage.removeItem(PENDING_UPDATES_KEY);
  }
}

export const offlineStorage = new OfflineStorage();
export default offlineStorage;