import { useState, useEffect } from 'react';
import { toast } from 'sonner';

const DB_NAME = 'CareMetricOfflineDB';
const DB_VERSION = 2;
const STORES = {
  PATIENTS: 'patients',
  NOTES: 'offline_notes',
  VISITS: 'visits',
  CARE_PLANS: 'care_plans',
  SYNC_QUEUE: 'sync_queue'
};

class OfflineStorage {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create stores if they don't exist
        if (!db.objectStoreNames.contains(STORES.PATIENTS)) {
          db.createObjectStore(STORES.PATIENTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.NOTES)) {
          const notesStore = db.createObjectStore(STORES.NOTES, { keyPath: 'local_id', autoIncrement: true });
          notesStore.createIndex('sync_status', 'sync_status', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.VISITS)) {
          db.createObjectStore(STORES.VISITS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.CARE_PLANS)) {
          db.createObjectStore(STORES.CARE_PLANS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
          const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'queue_id', autoIncrement: true });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async savePatients(patients) {
    const transaction = this.db.transaction([STORES.PATIENTS], 'readwrite');
    const store = transaction.objectStore(STORES.PATIENTS);
    
    for (const patient of patients) {
      await store.put(patient);
    }
    
    return transaction.complete;
  }

  async getPatients() {
    const transaction = this.db.transaction([STORES.PATIENTS], 'readonly');
    const store = transaction.objectStore(STORES.PATIENTS);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveOfflineNote(noteData) {
    const transaction = this.db.transaction([STORES.NOTES], 'readwrite');
    const store = transaction.objectStore(STORES.NOTES);
    
    const note = {
      ...noteData,
      sync_status: 'pending',
      created_offline: true,
      timestamp: new Date().toISOString()
    };
    
    return new Promise((resolve, reject) => {
      const request = store.add(note);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingNotes() {
    const transaction = this.db.transaction([STORES.NOTES], 'readonly');
    const store = transaction.objectStore(STORES.NOTES);
    const index = store.index('sync_status');
    
    return new Promise((resolve, reject) => {
      const request = index.getAll('pending');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async markNoteSynced(localId) {
    const transaction = this.db.transaction([STORES.NOTES], 'readwrite');
    const store = transaction.objectStore(STORES.NOTES);
    
    return new Promise((resolve, reject) => {
      const getRequest = store.get(localId);
      getRequest.onsuccess = () => {
        const note = getRequest.result;
        if (note) {
          note.sync_status = 'synced';
          note.synced_at = new Date().toISOString();
          const updateRequest = store.put(note);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async addToSyncQueue(action, data) {
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    
    const queueItem = {
      action,
      data,
      timestamp: new Date().toISOString(),
      retry_count: 0
    };
    
    return new Promise((resolve, reject) => {
      const request = store.add(queueItem);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getSyncQueue() {
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readonly');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clearSyncQueue(queueId) {
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    
    return new Promise((resolve, reject) => {
      const request = store.delete(queueId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const offlineStorage = new OfflineStorage();

export function useOfflineStorage() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    offlineStorage.init().then(() => {
      setIsInitialized(true);
      checkPendingSync();
    });
  }, []);

  const checkPendingSync = async () => {
    const pending = await offlineStorage.getPendingNotes();
    const queue = await offlineStorage.getSyncQueue();
    setPendingSync(pending.length + queue.length);
  };

  return { isInitialized, pendingSync, checkPendingSync };
}