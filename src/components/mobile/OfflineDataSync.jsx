import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  WifiOff, 
  Wifi,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Loader2,
  Upload,
  Download
} from 'lucide-react';
import { toast } from 'sonner';

const OFFLINE_STORAGE_KEY = 'caremetric_offline_data';
const SYNC_QUEUE_KEY = 'caremetric_sync_queue';

export default function OfflineDataSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncQueue, setSyncQueue] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online - syncing data...');
      syncOfflineData();
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.error('You are offline - data will be cached locally');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Load sync queue from localStorage
    loadSyncQueue();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadSyncQueue = () => {
    try {
      const queue = localStorage.getItem(SYNC_QUEUE_KEY);
      if (queue) {
        setSyncQueue(JSON.parse(queue));
      }
    } catch (error) {
      console.error('Failed to load sync queue:', error);
    }
  };

  const saveSyncQueue = (queue) => {
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
      setSyncQueue(queue);
    } catch (error) {
      console.error('Failed to save sync queue:', error);
    }
  };

  const addToSyncQueue = (operation) => {
    const newQueue = [...syncQueue, {
      ...operation,
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      status: 'pending'
    }];
    saveSyncQueue(newQueue);
  };

  const syncOfflineData = async () => {
    if (!isOnline || syncQueue.length === 0) return;

    setIsSyncing(true);
    const results = [];

    for (const operation of syncQueue) {
      try {
        let result;
        
        switch (operation.type) {
          case 'create':
            result = await base44.entities[operation.entity].create(operation.data);
            break;
          case 'update':
            result = await base44.entities[operation.entity].update(
              operation.recordId,
              operation.data
            );
            break;
          case 'delete':
            result = await base44.entities[operation.entity].delete(operation.recordId);
            break;
          default:
            throw new Error(`Unknown operation type: ${operation.type}`);
        }

        results.push({ ...operation, status: 'success', result });
      } catch (error) {
        console.error('Sync failed for operation:', operation, error);
        results.push({ ...operation, status: 'failed', error: error.message });
      }
    }

    // Remove successful operations from queue
    const failedOperations = results.filter(r => r.status === 'failed');
    saveSyncQueue(failedOperations);

    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    if (successCount > 0) {
      toast.success(`Synced ${successCount} changes successfully`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} changes failed to sync`);
    }

    setLastSyncTime(new Date());
    setIsSyncing(false);
  };

  const handleManualSync = () => {
    if (isOnline) {
      syncOfflineData();
    } else {
      toast.error('Cannot sync while offline');
    }
  };

  const clearSyncQueue = () => {
    saveSyncQueue([]);
    toast.success('Sync queue cleared');
  };

  // Cache data for offline access
  const cacheDataForOffline = async (entityName, data) => {
    try {
      const cached = JSON.parse(localStorage.getItem(OFFLINE_STORAGE_KEY) || '{}');
      cached[entityName] = {
        data,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(cached));
    } catch (error) {
      console.error('Failed to cache data:', error);
    }
  };

  // Get cached data when offline
  const getCachedData = (entityName) => {
    try {
      const cached = JSON.parse(localStorage.getItem(OFFLINE_STORAGE_KEY) || '{}');
      return cached[entityName]?.data || null;
    } catch (error) {
      console.error('Failed to get cached data:', error);
      return null;
    }
  };

  const pendingCount = syncQueue.filter(op => op.status === 'pending').length;
  const failedCount = syncQueue.filter(op => op.status === 'failed').length;

  return (
    <Card className={`border-2 ${!isOnline ? 'border-yellow-300 bg-yellow-50' : 'border-green-300 bg-green-50'}`}>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${isOnline ? 'bg-green-100' : 'bg-yellow-100'}`}>
            {isOnline ? (
              <Wifi className="h-5 w-5 text-green-600" />
            ) : (
              <WifiOff className="h-5 w-5 text-yellow-600" />
            )}
          </div>

          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">
                {isOnline ? 'Online' : 'Offline Mode'}
              </h3>
              <Badge variant={isOnline ? 'default' : 'outline'} className="text-xs">
                {pendingCount} pending
              </Badge>
            </div>

            <p className="text-xs text-slate-600 mb-3">
              {isOnline 
                ? 'All changes are being synced automatically' 
                : 'Changes will be saved locally and synced when online'}
            </p>

            {syncQueue.length > 0 && (
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">Sync Queue:</span>
                  <div className="flex gap-2">
                    {pendingCount > 0 && (
                      <Badge variant="outline" className="bg-blue-50">
                        <Upload className="h-3 w-3 mr-1" />
                        {pendingCount} pending
                      </Badge>
                    )}
                    {failedCount > 0 && (
                      <Badge variant="outline" className="bg-red-50">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {failedCount} failed
                      </Badge>
                    )}
                  </div>
                </div>

                {failedCount > 0 && (
                  <div className="p-2 bg-red-50 border border-red-200 rounded text-xs">
                    <p className="text-red-800">
                      Some changes failed to sync. They will be retried automatically.
                    </p>
                  </div>
                )}
              </div>
            )}

            {lastSyncTime && (
              <p className="text-xs text-slate-500 mb-3">
                Last synced: {lastSyncTime.toLocaleTimeString()}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleManualSync}
                disabled={!isOnline || isSyncing || syncQueue.length === 0}
                className="flex-1"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-2" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 mr-2" />
                    Sync Now
                  </>
                )}
              </Button>

              {syncQueue.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearSyncQueue}
                >
                  Clear Queue
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Export utility functions for use in other components
export const useOfflineStorage = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const saveOffline = (key, data) => {
    try {
      localStorage.setItem(`offline_${key}`, JSON.stringify({
        data,
        timestamp: new Date().toISOString()
      }));
      return true;
    } catch (error) {
      console.error('Failed to save offline:', error);
      return false;
    }
  };

  const getOffline = (key) => {
    try {
      const stored = localStorage.getItem(`offline_${key}`);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      return parsed.data;
    } catch (error) {
      console.error('Failed to get offline data:', error);
      return null;
    }
  };

  const queueOperation = (operation) => {
    try {
      const queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
      queue.push({
        ...operation,
        id: `${Date.now()}-${Math.random()}`,
        timestamp: new Date().toISOString(),
        status: 'pending'
      });
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
      return true;
    } catch (error) {
      console.error('Failed to queue operation:', error);
      return false;
    }
  };

  return {
    isOnline,
    saveOffline,
    getOffline,
    queueOperation
  };
};