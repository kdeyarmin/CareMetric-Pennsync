import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WifiOff, RefreshCw, CheckCircle, Database, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import CollapsibleMobileSection from "./CollapsibleMobileSection";

export default function MobileOfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [caching, setCaching] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [cachedCount, setCachedCount] = useState(0);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    
    // Check last sync time
    const t = localStorage.getItem("cm_last_full_sync");
    if (t) setLastSync(new Date(t));
    
    // Check cached patients
    try {
      const cached = JSON.parse(localStorage.getItem("cm_offline_patients") || "[]");
      setCachedCount(cached.length);
    } catch { /* ignore */ }
    
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const handleSync = async () => {
    setCaching(true);
    try {
      const patients = await base44.entities.Patient.list("-updated_date", 100);
      const slim = patients.map(p => ({
        id: p.id, first_name: p.first_name, last_name: p.last_name,
        primary_diagnosis: p.primary_diagnosis, status: p.status,
        medical_record_number: p.medical_record_number,
      }));
      localStorage.setItem("cm_offline_patients", JSON.stringify(slim));
      const now = new Date();
      localStorage.setItem("cm_last_full_sync", now.toISOString());
      setLastSync(now);
      setCachedCount(slim.length);
      toast.success(`${slim.length} patients cached for offline use`);
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
      defaultOpen={!isOnline}
      badge={
        !isOnline ? <Badge className="bg-orange-500 text-white text-[9px] h-4 px-1.5">Offline</Badge> :
        cachedCount > 0 ? <Badge className="bg-green-500 text-white text-[9px] h-4 px-1.5">Synced</Badge> :
        null
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

        {cachedCount > 0 && (
          <div className="text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950 p-2 rounded-lg">
            {cachedCount} patient{cachedCount > 1 ? "s" : ""} available offline
          </div>
        )}

        <Button
          onClick={handleSync}
          disabled={!isOnline || caching}
          size="sm"
          className="w-full h-9 text-xs touch-target"
          variant={isOnline ? "default" : "outline"}
        >
          {caching ? (
            <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Syncing...</>
          ) : (
            <><RefreshCw className="w-3 h-3 mr-1.5" /> Sync Patient Data</>
          )}
        </Button>
      </div>
    </CollapsibleMobileSection>
  );
}