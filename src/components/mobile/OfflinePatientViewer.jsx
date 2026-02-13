import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Download, WifiOff, User, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

const OFFLINE_PATIENTS_KEY = "caremetric_offline_patients";
const OFFLINE_CAREPLANS_KEY = "caremetric_offline_careplans";

export function useOfflinePatients() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const getCachedPatients = () => {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_PATIENTS_KEY) || "[]");
    } catch { return []; }
  };

  const getCachedCarePlans = () => {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_CAREPLANS_KEY) || "[]");
    } catch { return []; }
  };

  const cachePatientData = async (patients, carePlans) => {
    try {
      // Only store essential fields to reduce storage size
      const essentialPatients = patients.map(p => ({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        primary_diagnosis: p.primary_diagnosis,
        secondary_diagnoses: p.secondary_diagnoses,
        allergies: p.allergies,
        current_medications: p.current_medications,
        date_of_birth: p.date_of_birth,
        medical_record_number: p.medical_record_number,
        status: p.status,
        baseline_vitals: p.baseline_vitals,
        functional_status: p.functional_status,
        advance_directives: p.advance_directives,
      }));

      localStorage.setItem(OFFLINE_PATIENTS_KEY, JSON.stringify(essentialPatients));
      localStorage.setItem(OFFLINE_CAREPLANS_KEY, JSON.stringify(carePlans || []));
      return essentialPatients.length;
    } catch (e) {
      console.error("Cache error:", e);
      return 0;
    }
  };

  return { isOnline, getCachedPatients, getCachedCarePlans, cachePatientData };
}

export default function OfflinePatientViewer({ userEmail }) {
  const { isOnline, getCachedPatients, getCachedCarePlans, cachePatientData } = useOfflinePatients();
  const [syncing, setSyncing] = useState(false);
  const [cachedCount, setCachedCount] = useState(0);
  const [lastSync, setLastSync] = useState(null);

  useEffect(() => {
    const cached = getCachedPatients();
    setCachedCount(cached.length);
    const syncTime = localStorage.getItem("caremetric_last_offline_sync");
    if (syncTime) setLastSync(new Date(syncTime));
  }, []);

  const syncForOffline = async () => {
    setSyncing(true);
    try {
      const patients = await base44.entities.Patient.list("-updated_date", 50);
      const carePlans = await base44.entities.CarePlan.filter({ status: "active" });
      const count = await cachePatientData(patients, carePlans);
      setCachedCount(count);
      const now = new Date();
      setLastSync(now);
      localStorage.setItem("caremetric_last_offline_sync", now.toISOString());
      toast.success(`${count} patient profiles cached for offline use`);
    } catch (e) {
      toast.error("Failed to sync data");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2 p-3 sm:p-4">
        <CardTitle className="text-sm flex items-center gap-2">
          {isOnline ? <Download className="h-4 w-4 text-blue-600" /> : <WifiOff className="h-4 w-4 text-orange-500" />}
          Offline Patient Access
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 pt-0 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-600">
              {cachedCount > 0 ? (
                <><CheckCircle className="h-3 w-3 inline text-green-500 mr-1" />{cachedCount} patients available offline</>
              ) : (
                "No data cached yet"
              )}
            </p>
            {lastSync && (
              <p className="text-[10px] text-slate-400 mt-0.5">
                Last synced: {lastSync.toLocaleString()}
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={syncForOffline}
            disabled={syncing || !isOnline}
            className="h-7 text-xs"
          >
            {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Download className="h-3 w-3 mr-1" />}
            {syncing ? "Syncing..." : "Sync Now"}
          </Button>
        </div>
        {!isOnline && cachedCount > 0 && (
          <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">
            <WifiOff className="h-3 w-3 mr-1" /> Offline mode — viewing cached data
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}