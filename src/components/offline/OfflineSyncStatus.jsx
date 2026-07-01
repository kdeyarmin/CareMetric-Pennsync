import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff, Upload, Loader2 } from 'lucide-react';
import { useOfflineQueue } from '@/lib/offlineSync';

/**
 * OfflineSyncStatus — the single sync-status widget for the canonical IndexedDB
 * offline queue. Replaces the old per-subsystem widgets (OfflineSyncService et al)
 * that each read a different, sometimes-empty store. Because it reads
 * useOfflineQueue(), it reflects EVERY offline write — including the main SmartNote
 * / Visit Scribe flow, which previously had no visible pending indicator anywhere.
 *
 * Renders nothing while online with an empty queue so it stays out of the way; the
 * global drain (OfflineManager) syncs automatically on reconnect, and this widget
 * only surfaces a manual "Sync now" as a convenience.
 */
export default function OfflineSyncStatus() {
  const { isOnline, pendingCount, isSyncing, syncNow } = useOfflineQueue();

  if (isOnline && pendingCount === 0) return null;

  return (
    <Card className="border-2">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
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
                {pendingCount > 0
                  ? `${pendingCount} item${pendingCount > 1 ? 's' : ''} pending sync`
                  : 'All synced'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
                {pendingCount} pending
              </Badge>
            )}
            {isOnline && pendingCount > 0 && (
              <Button onClick={syncNow} size="sm" disabled={isSyncing}>
                {isSyncing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Sync now
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
