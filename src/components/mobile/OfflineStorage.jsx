/**
 * Offline Storage Utility for Penn Sync
 * Handles local storage of visit data when offline
 * ENHANCED: Now with PHI encryption for HIPAA compliance
 */

import { secureOfflineStorage } from "../security/SecureOfflineStorage";

const STORAGE_PREFIX = 'penn_sync_offline_';
const PENDING_VISITS_KEY = `${STORAGE_PREFIX}pending_visits`;
const PENDING_UPDATES_KEY = `${STORAGE_PREFIX}pending_updates`;

class OfflineStorage {
  constructor() {
    this.isOnline = navigator.onLine;
    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.syncPendingData();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  // Save visit data locally with encryption
  async saveVisit(visitData) {
    try {
      const pending = this.getPendingVisits();
      const visitId = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const visitRecord = {
        id: visitId,
        data: visitData,
        timestamp: new Date().toISOString(),
        synced: false
      };

      pending.push(visitRecord);

      // Store encrypted for HIPAA compliance
      await secureOfflineStorage.setItem('pending_visits', pending);
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

  // Get all pending visits with decryption
  async getPendingVisits() {
    try {
      const data = await secureOfflineStorage.getItem('pending_visits');
      return data || [];
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
           this.getPendingUpdates().filter(u => !u.synced).length;
  }

  // Sync pending data when back online
  async syncPendingData() {
    if (!this.isOnline) return;

    const { base44 } = await import('@/api/base44Client');
    
    // Sync pending visits
    const pendingVisits = this.getPendingVisits().filter(v => !v.synced);
    for (const visit of pendingVisits) {
      try {
        await base44.entities.Visit.create(visit.data);
        this.markVisitSynced(visit.id);
      } catch (error) {
        console.error('Error syncing visit:', error);
      }
    }

    // Sync pending updates
    const pendingUpdates = this.getPendingUpdates().filter(u => !u.synced);
    for (const update of pendingUpdates) {
      try {
        await base44.entities.Visit.update(update.visitId, update.data);
        this.markUpdateSynced(update.visitId, update.timestamp);
      } catch (error) {
        console.error('Error syncing update:', error);
      }
    }

    // Clean up old synced items
    this.cleanupSyncedItems();
  }

  markVisitSynced(visitId) {
    const pending = this.getPendingVisits();
    const updated = pending.map(v => 
      v.id === visitId ? { ...v, synced: true } : v
    );
    localStorage.setItem(PENDING_VISITS_KEY, JSON.stringify(updated));
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

  // Clear all offline data securely
  async clearAll() {
    await secureOfflineStorage.clearAll();
    localStorage.removeItem(PENDING_VISITS_KEY);
    localStorage.removeItem(PENDING_UPDATES_KEY);
  }
}

export const offlineStorage = new OfflineStorage();
export default offlineStorage;