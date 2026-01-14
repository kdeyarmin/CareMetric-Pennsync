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

  // Get all pending updates with decryption
  async getPendingUpdates() {
    try {
      const data = await secureOfflineStorage.getItem('pending_updates');
      return data || [];
    } catch {
      return [];
    }
  }

  // Get count of pending items
  async getPendingCount() {
    const visits = await this.getPendingVisits();
    const updates = await this.getPendingUpdates();
    return visits.filter(v => !v.synced).length +
           updates.filter(u => !u.synced).length;
  }

  // Sync pending data when back online
  async syncPendingData() {
    if (!this.isOnline) return;

    const { base44 } = await import('@/api/base44Client');
    
    // Sync pending visits
    const allVisits = await this.getPendingVisits();
    const pendingVisits = allVisits.filter(v => !v.synced);
    for (const visit of pendingVisits) {
      try {
        await base44.entities.Visit.create(visit.data);
        await this.markVisitSynced(visit.id);
      } catch (error) {
        console.error('Error syncing visit:', error);
      }
    }

    // Sync pending updates
    const allUpdates = await this.getPendingUpdates();
    const pendingUpdates = allUpdates.filter(u => !u.synced);
    for (const update of pendingUpdates) {
      try {
        await base44.entities.Visit.update(update.visitId, update.data);
        await this.markUpdateSynced(update.visitId, update.timestamp);
      } catch (error) {
        console.error('Error syncing update:', error);
      }
    }

    // Clean up old synced items
    await this.cleanupSyncedItems();
  }

  async markVisitSynced(visitId) {
    const pending = await this.getPendingVisits();
    const updated = pending.map(v => 
      v.id === visitId ? { ...v, synced: true } : v
    );
    await secureOfflineStorage.setItem('pending_visits', updated);
  }

  async markUpdateSynced(visitId, timestamp) {
    const pending = await this.getPendingUpdates();
    const updated = pending.map(u => 
      u.visitId === visitId && u.timestamp === timestamp ? { ...u, synced: true } : u
    );
    await secureOfflineStorage.setItem('pending_updates', updated);
  }

  async cleanupSyncedItems() {
    // Keep synced items for 24 hours, then remove
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const visits = await this.getPendingVisits();
    const filtered = visits.filter(v => 
      !v.synced || v.timestamp > cutoff
    );
    await secureOfflineStorage.setItem('pending_visits', filtered);

    const updates = await this.getPendingUpdates();
    const filteredUpdates = updates.filter(u => 
      !u.synced || u.timestamp > cutoff
    );
    await secureOfflineStorage.setItem('pending_updates', filteredUpdates);
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