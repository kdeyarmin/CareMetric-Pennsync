import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Upload, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2,
  Wifi,
  WifiOff,
  FileText,
  XCircle,
  RefreshCw,
  AlertCircle
} from "lucide-react";
import offlineStorage from "./OfflineStorage";

export default function OfflineSyncManager() {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncResult, setSyncResult] = useState(null);
  const [pendingDrafts, setPendingDrafts] = useState([]);
  const [syncErrors, setSyncErrors] = useState([]);
  // Reentrancy guard: a reconnect auto-sync overlapping a manual "Sync Now" tap
  // would otherwise run two loops over the same drafts and create duplicate
  // visits (the `isSyncing` state is read through a stale closure in the effect).
  const isSyncingRef = useRef(false);
  const [conflicts, setConflicts] = useState([]);
  const [backgroundSyncEnabled, _setBackgroundSyncEnabled] = useState(true);

  const loadPendingDrafts = useCallback(() => {
    let drafts = [];
    try {
      drafts = JSON.parse(localStorage.getItem('offline_visit_drafts') || '[]');
    } catch (e) {
      console.warn('Failed to parse offline drafts:', e);
    }
    setPendingDrafts(drafts);
  }, []);

  const loadSyncErrors = useCallback(() => {
    const errors = offlineStorage.getSyncErrors();
    setSyncErrors(errors.filter(e => !e.resolved));
  }, []);

  const loadConflicts = useCallback(() => {
    const conflicts = offlineStorage.getConflicts();
    setConflicts(conflicts.filter(c => !c.resolved));
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleSyncComplete = (e) => {
      setSyncResult({
        success: e.detail.success,
        failed: e.detail.failed,
        errors: e.detail.errors
      });
      loadPendingDrafts();
      loadSyncErrors();
    };
    const handleSyncError = () => {
      loadSyncErrors();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sync-complete', handleSyncComplete);
    window.addEventListener('sync-error', handleSyncError);

    // Load pending drafts and errors
    loadPendingDrafts();
    loadSyncErrors();
    loadConflicts();

    // Refresh every 5 seconds
    const interval = setInterval(() => {
      loadPendingDrafts();
      loadSyncErrors();
      loadConflicts();
    }, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sync-complete', handleSyncComplete);
      window.removeEventListener('sync-error', handleSyncError);
      clearInterval(interval);
    };
  }, [loadPendingDrafts, loadSyncErrors, loadConflicts]);

  const clearErrors = () => {
    offlineStorage.clearSyncErrors();
    loadSyncErrors();
  };

  const retryFailedSync = async (errorId) => {
    const error = syncErrors.find(e => e.id === errorId);
    if (!error) return;

    try {
      // Retry the sync for this specific item
      await offlineStorage.syncPendingData();
      loadSyncErrors();
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  const syncOfflineData = useCallback(async () => {
    if (!isOnline || pendingDrafts.length === 0) return;
    if (isSyncingRef.current) return; // an overlapping run would duplicate visits
    isSyncingRef.current = true;

    setIsSyncing(true);
    setSyncResult(null);
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    // Track failures by index, not patient name: two drafts can share a name,
    // and reconstructing "remaining" via find(d => d.patient_name === e.patient)
    // collapsed duplicates and could drop a failed draft (data loss).
    const failedIndices = new Set();

    try {
      for (let i = 0; i < pendingDrafts.length; i++) {
        const draft = pendingDrafts[i];
        setSyncProgress(((i + 1) / pendingDrafts.length) * 100);

        try {
          // Create visit from draft
          await base44.entities.Visit.create({
            patient_id: draft.patient_id,
            visit_date: draft.visit_date,
            visit_type: draft.visit_type,
            status: 'completed',
            nurse_notes: draft.nurse_notes,
            raw_transcription: draft.raw_transcription,
            vital_signs: draft.vital_signs
          });

          successCount++;
        } catch (error) {
          console.error('Sync error for draft:', draft, error);
          errorCount++;
          failedIndices.add(i);
          errors.push({
            patient: draft.patient_name,
            error: error.message
          });
        }
      }

      // Drop the synced drafts by id, re-reading the store immediately before the
      // write so a draft saved DURING this async sync isn't clobbered by the stale
      // closure snapshot (that was silent loss of a documented visit). Match by the
      // stable draft.id assigned in OfflineNoteEditor.
      if (successCount > 0) {
        const syncedIds = new Set(
          pendingDrafts.filter((_, i) => !failedIndices.has(i)).map((d) => d.id).filter(Boolean)
        );
        let current = [];
        try { current = JSON.parse(localStorage.getItem('offline_visit_drafts') || '[]'); } catch { current = []; }
        const next = Array.isArray(current) ? current.filter((d) => !(d.id && syncedIds.has(d.id))) : [];
        localStorage.setItem('offline_visit_drafts', JSON.stringify(next));
        loadPendingDrafts();
      }

      setSyncResult({
        success: successCount,
        failed: errorCount,
        errors
      });

      // Refresh all queries
      queryClient.invalidateQueries({ queryKey: ['todayVisits'] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['patientVisits'] });

    } catch (error) {
      console.error('Sync error:', error);
      setSyncResult({
        success: 0,
        failed: pendingDrafts.length,
        errors: [{ patient: 'All', error: error.message }]
      });
    }

    isSyncingRef.current = false;
    setIsSyncing(false);
    setSyncProgress(0);
  }, [isOnline, pendingDrafts, queryClient, loadPendingDrafts]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline && pendingDrafts.length > 0 && !isSyncing) {
      // Wait 2 seconds to ensure connection is stable. Clear on cleanup so a
      // flapping connection or an unmount within the window doesn't fire a sync
      // (and setState) after the effect is torn down.
      const timer = setTimeout(() => {
        syncOfflineData();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, pendingDrafts.length, isSyncing, syncOfflineData]);

  return (
    <Card className={`border-2 ${isOnline ? 'border-green-300' : 'border-orange-300'}`}>
      <CardHeader className={isOnline ? 'bg-green-50' : 'bg-orange-50'}>
        <CardTitle className="text-base flex items-center gap-2">
          {isOnline ? <Wifi className="w-5 h-5 text-green-600" /> : <WifiOff className="w-5 h-5 text-orange-600" />}
          Sync Manager
          <Badge className={`ml-auto ${isOnline ? 'bg-green-600' : 'bg-orange-600'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pending">
              Pending {pendingDrafts.length > 0 && `(${pendingDrafts.length})`}
            </TabsTrigger>
            <TabsTrigger value="errors">
              Errors {syncErrors.length > 0 && `(${syncErrors.length})`}
            </TabsTrigger>
            <TabsTrigger value="conflicts">
              Conflicts {conflicts.length > 0 && `(${conflicts.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4 mt-4">
        {!isOnline && (
          <Alert className="bg-orange-50 border-orange-300">
            <WifiOff className="w-4 h-4 text-orange-600" />
            <AlertDescription className="text-sm text-orange-800">
              You're offline. Notes will be saved locally and synced when connection returns.
            </AlertDescription>
          </Alert>
        )}

        {/* Pending Drafts */}
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-600" />
              <div>
                <p className="text-sm font-semibold">Pending Drafts</p>
                <p className="text-xs text-slate-600">Waiting to sync</p>
              </div>
            </div>
            <Badge variant="outline" className={pendingDrafts.length > 0 ? 'bg-yellow-100 border-yellow-300' : ''}>
              {pendingDrafts.length}
            </Badge>
          </div>

          {/* Draft List */}
          {pendingDrafts.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {pendingDrafts.map((draft, idx) => (
                <div key={idx} className="p-2 bg-white border rounded text-xs">
                  <p className="font-medium">{draft.patient_name}</p>
                  <p className="text-slate-600">{draft.visit_date} - {draft.visit_type}</p>
                  <p className="text-slate-500">{draft.nurse_notes?.substring(0, 60)}...</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sync Button */}
        {pendingDrafts.length > 0 && (
          <>
            {isSyncing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">Syncing...</span>
                  <span className="font-semibold">{Math.round(syncProgress)}%</span>
                </div>
                <Progress value={syncProgress} className="h-2" />
              </div>
            )}

            <Button
              onClick={syncOfflineData}
              disabled={!isOnline || isSyncing}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isSyncing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Syncing {Math.round(syncProgress)}%
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Sync {pendingDrafts.length} Draft{pendingDrafts.length !== 1 ? 's' : ''} Now
                </>
              )}
            </Button>
          </>
        )}

        {/* Sync Result */}
        {syncResult && (
          <Alert className={syncResult.success > 0 ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}>
            <CheckCircle2 className="w-4 h-4" />
            <AlertDescription className="text-sm">
              <p className="font-semibold mb-1">Sync Complete</p>
              <p>✅ {syncResult.success} synced successfully</p>
              {syncResult.failed > 0 && (
                <>
                  <p className="text-red-600">❌ {syncResult.failed} failed</p>
                  {syncResult.errors.slice(0, 3).map((err, idx) => (
                    <p key={idx} className="text-xs text-red-700 mt-1">
                      • {err.patient}: {err.error}
                    </p>
                  ))}
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

          </TabsContent>

          <TabsContent value="errors" className="space-y-4 mt-4">
            {syncErrors.length === 0 ? (
              <Alert className="bg-green-50 border-green-300">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-sm">
                  No sync errors! All data synced successfully.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Alert className="bg-red-50 border-red-300">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <AlertTitle className="text-sm font-semibold">Sync Errors ({syncErrors.length})</AlertTitle>
                  <AlertDescription className="text-xs">
                    Some items failed to sync. Review and retry below.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {syncErrors.map((error) => (
                    <div key={error.id} className="p-3 bg-white border border-red-200 rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-red-900">
                            {error.type === 'visit' ? 'Visit' : 'Update'} #{(error.itemId || '').substring(0, 12)}...
                          </p>
                          <p className="text-xs text-red-700 mt-1">{error.error}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            {new Date(error.timestamp).toLocaleString()}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => retryFailedSync(error.id)}
                          disabled={!isOnline}
                          className="flex-shrink-0"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearErrors}
                  className="w-full text-red-600"
                >
                  <XCircle className="w-3 h-3 mr-2" />
                  Clear Error Log
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="conflicts" className="space-y-4 mt-4">
            {conflicts.length === 0 ? (
              <Alert className="bg-blue-50 border-blue-300">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-sm">
                  No conflicts detected. All changes merged successfully.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Alert className="bg-yellow-50 border-yellow-300">
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
                  <AlertTitle className="text-sm font-semibold">Data Conflicts ({conflicts.length})</AlertTitle>
                  <AlertDescription className="text-xs">
                    Local and server data differ. Manual resolution may be needed.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {conflicts.map((conflict) => (
                    <div key={conflict.id} className="p-3 bg-white border border-yellow-200 rounded-lg">
                      <p className="text-xs font-semibold text-yellow-900">Conflict Detected</p>
                      <p className="text-xs text-slate-600 mt-1">
                        {new Date(conflict.timestamp).toLocaleString()}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 bg-blue-50 rounded">
                          <p className="font-semibold text-blue-900">Local</p>
                          <p className="text-blue-700 truncate">{JSON.stringify(conflict.localData).substring(0, 50)}...</p>
                        </div>
                        <div className="p-2 bg-green-50 rounded">
                          <p className="font-semibold text-green-900">Server</p>
                          <p className="text-green-700 truncate">{JSON.stringify(conflict.serverData).substring(0, 50)}...</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Background Sync Toggle */}
        <div className="mt-4 p-3 bg-slate-50 rounded-lg border flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Background Sync</p>
            <p className="text-xs text-slate-600">Auto-sync every 30 seconds when online</p>
          </div>
          <Badge className={backgroundSyncEnabled ? 'bg-green-600' : 'bg-slate-400'}>
            {backgroundSyncEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}