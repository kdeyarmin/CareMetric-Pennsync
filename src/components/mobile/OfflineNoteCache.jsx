import { useState, useEffect } from 'react';

const CACHE_KEY = 'caremetric_offline_notes';
const CACHE_VERSION = 'v1';

export const OfflineNoteCache = {
  // Save note draft to local storage
  saveNoteDraft: (noteData) => {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{"version":"v1","drafts":[]}');
      
      // Add timestamp and unique ID
      const draft = {
        id: Date.now().toString(),
        ...noteData,
        timestamp: new Date().toISOString(),
        synced: false
      };
      
      cache.drafts.push(draft);
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      return draft.id;
    } catch (error) {
      console.error('Error saving offline note:', error);
      return null;
    }
  },

  // Get all unsynced drafts
  getUnsyncedDrafts: () => {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{"version":"v1","drafts":[]}');
      return cache.drafts.filter(d => !d.synced);
    } catch (error) {
      console.error('Error retrieving drafts:', error);
      return [];
    }
  },

  // Mark draft as synced
  markAsSynced: (draftId) => {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{"version":"v1","drafts":[]}');
      const draft = cache.drafts.find(d => d.id === draftId);
      if (draft) {
        draft.synced = true;
        draft.syncedAt = new Date().toISOString();
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      console.error('Error marking draft as synced:', error);
    }
  },

  // Delete synced drafts older than 7 days
  cleanupOldDrafts: () => {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{"version":"v1","drafts":[]}');
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      cache.drafts = cache.drafts.filter(d => {
        if (d.synced && new Date(d.syncedAt) < sevenDaysAgo) {
          return false;
        }
        return true;
      });
      
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      console.error('Error cleaning up drafts:', error);
    }
  },

  // Get cache status
  getCacheStatus: () => {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{"version":"v1","drafts":[]}');
      return {
        totalDrafts: cache.drafts.length,
        unsyncedCount: cache.drafts.filter(d => !d.synced).length,
        syncedCount: cache.drafts.filter(d => d.synced).length
      };
    } catch (error) {
      return { totalDrafts: 0, unsyncedCount: 0, syncedCount: 0 };
    }
  }
};

// React hook for offline note management
export function useOfflineNotes() {
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    // Update online status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Update unsynced count
    const updateCount = () => {
      const status = OfflineNoteCache.getCacheStatus();
      setUnsyncedCount(status.unsyncedCount);
    };
    
    updateCount();
    const interval = setInterval(updateCount, 5000);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const saveOfflineNote = (noteData) => {
    return OfflineNoteCache.saveNoteDraft(noteData);
  };

  const syncNotes = async (syncFunction) => {
    const drafts = OfflineNoteCache.getUnsyncedDrafts();
    const results = [];
    
    for (const draft of drafts) {
      try {
        await syncFunction(draft);
        OfflineNoteCache.markAsSynced(draft.id);
        results.push({ success: true, draft });
      } catch (error) {
        results.push({ success: false, draft, error });
      }
    }
    
    return results;
  };

  return {
    isOnline,
    unsyncedCount,
    saveOfflineNote,
    syncNotes,
    getUnsyncedDrafts: OfflineNoteCache.getUnsyncedDrafts,
    cleanupOldDrafts: OfflineNoteCache.cleanupOldDrafts
  };
}