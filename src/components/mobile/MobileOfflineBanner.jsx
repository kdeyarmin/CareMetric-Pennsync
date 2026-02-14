import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WifiOff, RefreshCw, CheckCircle, Database, Loader2 } from "lucide-react";
import { useOfflineDataManager } from "./OfflineDataManager";
import { toast } from "sonner";
import CollapsibleMobileSection from "./CollapsibleMobileSection";

export default function MobileOfflineBanner() {
  const { isOnline, isSyncing, pendingSyncCount, lastSync, cachePatients, flushPendingWrites } = useOfflineDataManager();
  const [caching, setCaching] = useState(false);

  const handleSync = async () => {
    setCaching(true);
    try {
      const count = await cachePatients();
      await flushPendingWrites();
      toast.success(`${count} patients cached for offline use`);
    } catch {
      toast.error("Sync failed");
    } finally {
      setCaching(false);
    }
  };

  return (
    <CollapsibleMobileSection
      title="Offline & Sync"
      icon={Database}
      defaultOpen={!isOnline || pendingSyncCount > 0}
      badge={
        !isOnline ? <Badge className="bg-orange-500 text-white text-[9px] h-4 px-1.5">Offline</Badge> :
        pendingSyncCount > 0 ? <Badge className="bg-blue-500 text-white text-[9px] h-4 px-1.5">{pendingSyncCount}</Badge> :
        <Badge className="bg-green-500 text-white text-[9px] h-4 px-1.5">Synced</Badge>
      }
    >
      <div className="space-y-3">
        {/* Status */}
        <div className="flex items-center gap-2">
          {isOnline ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <WifiOff className="w-4 h-4 text-orange-500" />
          )}
          <span className="text-xs text-slate-700 dark:text-slate-300">
            {isOnline ? "Connected" : "Working offline"}
          </span>
          {lastSync && (
            <span className="text-[10px] text-slate-400 ml-auto">
              Last sync: {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>

        {pendingSyncCount > 0 && (
          <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 p-2 rounded-lg">
            {pendingSyncCount} change{pendingSyncCount > 1 ? "s" : ""} waiting to sync
          </div>
        )}

        <Button
          onClick={handleSync}
          disabled={!isOnline || caching || isSyncing}
          size="sm"
          className="w-full h-9 text-xs touch-target"
          variant={isOnline ? "default" : "outline"}
        >
          {caching || isSyncing ? (
            <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Syncing...</>
          ) : (
            <><RefreshCw className="w-3 h-3 mr-1.5" /> Sync Patient Data</>
          )}
        </Button>
      </div>
    </CollapsibleMobileSection>
  );
}