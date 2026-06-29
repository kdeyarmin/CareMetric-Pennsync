import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Wifi, WifiOff, Cloud, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import offlineStorage from "./OfflineStorage";

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState({ total: 0, pending: 0, syncing: 0, failed: 0 });
  const [isSyncing, setIsSyncing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastSyncResult, setLastSyncResult] = useState(null);

  const performSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncProgress(0);

    const total = syncStatus.pending || 1;
    let synced = 0;

    // Simulate progress updates
    const progressInterval = setInterval(() => {
      synced = Math.min(synced + 1, total);
      setSyncProgress((synced / total) * 100);
    }, 500);

    try {
      const result = await offlineStorage.syncPendingData();
      setSyncProgress(100);
      setLastSyncResult(result);
    } catch (error) {
      console.error('Sync error:', error);
    } finally {
      clearInterval(progressInterval);
    }

    setIsSyncing(false);
    setTimeout(() => setSyncProgress(0), 2000);
  }, [syncStatus.pending]);

  useEffect(() => {
    const updateStatus = () => {
      try {
        // Check if method exists
        if (offlineStorage && typeof offlineStorage.getSyncStatus === 'function') {
          const status = offlineStorage.getSyncStatus();
          setSyncStatus(status);
        } else if (offlineStorage && typeof offlineStorage.getPendingCount === 'function') {
          // Fallback to pending count
          const pending = offlineStorage.getPendingCount();
          setSyncStatus({ total: pending, pending, syncing: 0, failed: 0, synced: 0 });
        } else {
          // No methods available - use default
          setSyncStatus({ total: 0, pending: 0, syncing: 0, failed: 0, synced: 0 });
        }
      } catch (error) {
        console.error('Error updating offline status:', error);
        setSyncStatus({ total: 0, pending: 0, syncing: 0, failed: 0, synced: 0 });
      }
    };

    const handleOnline = async () => {
      setIsOnline(true);
      // Read the live pending count — this handler is registered once (empty
      // deps), so closing over syncStatus.pending captured the initial 0 and the
      // reconnect auto-sync never fired.
      const pending = typeof offlineStorage.getPendingCount === 'function'
        ? offlineStorage.getPendingCount()
        : 0;
      if (pending > 0) {
        await performSync();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      updateStatus();
    };

    const handleChangeAdded = () => {
      updateStatus();
    };

    let syncResultTimer;
    const handleSyncComplete = (event) => {
      setLastSyncResult(event.detail);
      clearTimeout(syncResultTimer);
      syncResultTimer = setTimeout(() => setLastSyncResult(null), 5000);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('offline-change-added', handleChangeAdded);
    // OfflineStorage.syncPendingData dispatches 'sync-complete' (not
    // 'offline-sync-complete'), so the old name never fired.
    window.addEventListener('sync-complete', handleSyncComplete);

    // Update status every 3 seconds
    const interval = setInterval(updateStatus, 3000);
    updateStatus();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('offline-change-added', handleChangeAdded);
      window.removeEventListener('sync-complete', handleSyncComplete);
      clearInterval(interval);
      clearTimeout(syncResultTimer);
    };
  }, [performSync]);

  // Always show indicator with current status
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom max-w-sm print:hidden">
      {expanded ? (
        <Card className="shadow-2xl border-2 border-blue-300">
          <CardContent className="p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <Wifi className="w-5 h-5 text-green-600" />
                ) : (
                  <WifiOff className="w-5 h-5 text-red-600" />
                )}
                <span className="font-semibold">{isOnline ? 'Online' : 'Offline Mode'}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(false)}
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>

            {/* Sync Progress */}
            {isSyncing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Syncing...</span>
                  <span className="font-medium">{Math.round(syncProgress)}%</span>
                </div>
                <Progress value={syncProgress} className="h-2" />
              </div>
            )}

            {/* Last Sync Result */}
            {lastSyncResult && (
              <div className={`p-3 rounded-lg ${
                lastSyncResult.failed === 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'
              }`}>
                <div className="flex items-start gap-2">
                  {lastSyncResult.failed === 0 ? (
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
                  )}
                  <div className="text-sm">
                    <p className="font-medium">
                      {lastSyncResult.success} items synced successfully
                    </p>
                    {lastSyncResult.failed > 0 && (
                      <p className="text-slate-600">
                        {lastSyncResult.failed} items failed
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Status Details */}
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-slate-50 rounded">
                <span className="text-sm text-slate-600">Connection</span>
                <Badge className={isOnline ? 'bg-green-600' : 'bg-red-600'}>
                  {isOnline ? 'Online' : 'Offline'}
                </Badge>
              </div>
              <div className="flex items-center justify-between p-2 bg-slate-50 rounded">
                <span className="text-sm text-slate-600">Pending Sync</span>
                <Badge variant="outline" className={syncStatus.pending > 0 ? 'bg-yellow-100' : ''}>
                  {syncStatus.pending} items
                </Badge>
              </div>
              {syncStatus.failed > 0 && (
                <div className="flex items-center justify-between p-2 bg-red-50 rounded">
                  <span className="text-sm text-slate-600">Failed</span>
                  <Badge className="bg-red-600">{syncStatus.failed}</Badge>
                </div>
              )}
              {syncStatus.synced > 0 && (
                <div className="flex items-center justify-between p-2 bg-green-50 rounded">
                  <span className="text-sm text-slate-600">Synced</span>
                  <Badge className="bg-green-600">{syncStatus.synced}</Badge>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {isOnline && syncStatus.pending > 0 && !isSyncing && (
                <Button
                  onClick={performSync}
                  size="sm"
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  <RefreshCw className="w-3 h-3 mr-2" />
                  Sync Now
                </Button>
              )}
              {syncStatus.failed > 0 && (
                <Button
                  onClick={performSync}
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={!isOnline || isSyncing}
                >
                  Retry Failed
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button
          onClick={() => setExpanded(true)}
          className={`shadow-lg ${
            !isOnline ? 'bg-red-600 hover:bg-red-700' :
            isSyncing ? 'bg-blue-600 hover:bg-blue-700' :
            syncStatus.pending > 0 ? 'bg-yellow-600 hover:bg-yellow-700' :
            'bg-green-600 hover:bg-green-700'
          }`}
        >
          {!isOnline ? (
            <WifiOff className="w-4 h-4 mr-2" />
          ) : isSyncing ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : syncStatus.pending > 0 ? (
            <Cloud className="w-4 h-4 mr-2" />
          ) : (
            <CheckCircle className="w-4 h-4 mr-2" />
          )}
          <span className="font-medium">
            {!isOnline ? 'Offline' :
             isSyncing ? 'Syncing...' :
             syncStatus.pending > 0 ? `${syncStatus.pending} pending` :
             'Synced'}
          </span>
          <ChevronUp className="w-4 h-4 ml-2" />
        </Button>
      )}
    </div>
  );
}