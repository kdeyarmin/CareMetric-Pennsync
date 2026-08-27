import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Loader2, CheckCircle2, Users, Calendar } from "lucide-react";
import { todayEastern } from "../utils/timezone";
import { savePatients } from "@/lib/indexedDB";

export default function OfflinePatientSelector({ onCacheComplete, _showDetails = false, _selectedPatientId, onSelectPatient }) {
  const [selectedPatients, setSelectedPatients] = useState([]);
  const [_dateRange, _setDateRange] = useState(1); // days
  const [isCaching, setIsCaching] = useState(false);
  const [cacheResult, setCacheResult] = useState(null);

  const { data: _currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: allVisits = [] } = useAgencyScopedQuery({
    queryKey: ['upcomingVisits'],
    fetch: async () => {
      const _today = todayEastern();
      return base44.entities.Visit.filter({ 
        status: 'scheduled'
      }, 'visit_date', 500);
    },
  });

  const { data: allPatients = [] } = useScopedPatients({ sort: '-updated_date', limit: 2000 });

  // Get patients with upcoming visits
  const patientsWithVisits = React.useMemo(() => {
    const patientIds = [...new Set(allVisits.map(v => v.patient_id))];
    return allPatients
      .filter(p => patientIds.includes(p.id))
      .map(p => {
        const visits = allVisits.filter(v => v.patient_id === p.id);
        return { ...p, upcomingVisits: visits };
      });
  }, [allPatients, allVisits]);

  const handleTogglePatient = (patientId) => {
    setSelectedPatients(prev => 
      prev.includes(patientId) 
        ? prev.filter(id => id !== patientId)
        : [...prev, patientId]
    );
  };

  const handleSelectAll = () => {
    if (selectedPatients.length === patientsWithVisits.length) {
      setSelectedPatients([]);
    } else {
      setSelectedPatients(patientsWithVisits.map(p => p.id));
    }
  };

  const handleCacheData = async () => {
    if (selectedPatients.length === 0) return;

    setIsCaching(true);
    setCacheResult(null);

    try {
      const cachedData = [];

      for (const patientId of selectedPatients) {
        const patient = allPatients.find(p => p.id === patientId);
        if (!patient) continue;

        // Fetch comprehensive patient data
        const recentVisits = await base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 5);

        const patientCache = {
          patient: {
            id: patient.id,
            first_name: patient.first_name,
            last_name: patient.last_name,
            date_of_birth: patient.date_of_birth,
            medical_record_number: patient.medical_record_number,
            primary_diagnosis: patient.primary_diagnosis,
            secondary_diagnoses: patient.secondary_diagnoses,
            allergies: patient.allergies,
            current_medications: patient.current_medications,
            address: patient.address,
            phone: patient.phone,
            emergency_contact_name: patient.emergency_contact_name,
            emergency_contact_phone: patient.emergency_contact_phone,
            physician_name: patient.physician_name,
            physician_phone: patient.physician_phone,
            care_type: patient.care_type,
            baseline_vitals: patient.baseline_vitals,
            functional_status: patient.functional_status,
            status: patient.status
          },
          recentVisits: recentVisits.map(v => ({
            id: v.id,
            visit_date: v.visit_date,
            visit_type: v.visit_type,
            nurse_notes: v.nurse_notes,
            vital_signs: v.vital_signs
          })),
          cachedAt: new Date().toISOString()
        };

        cachedData.push(patientCache);
      }

      // Store in localStorage
      let existingCache = [];
      try { existingCache = JSON.parse(localStorage.getItem('offline_patient_data') || '[]'); } catch { /* no-op */ }
      const mergedCache = [...cachedData];

      // Carry forward previously cached patients, but PURGE stale PHI: drop any
      // prior entry older than the retention window so plaintext PHI can't
      // linger indefinitely on the device (the logout/idle purge —
      // clearCachedPHI — handles the rest). Entries written just above are
      // always fresh, so this only ages out old carry-overs.
      const OFFLINE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
      const now = Date.now();
      existingCache.forEach(old => {
        const cachedAtMs = old?.cachedAt ? new Date(old.cachedAt).getTime() : 0;
        const isFresh = Number.isFinite(cachedAtMs) && (now - cachedAtMs) < OFFLINE_CACHE_TTL_MS;
        if (isFresh && !mergedCache.find(c => c.patient.id === old.patient.id)) {
          mergedCache.push(old);
        }
      });

      // Two INDEPENDENT stores, neither allowed to abort the other.
      //
      // OfflineMode.jsx reads and merges both: IndexedDB carries the canonical
      // roster (and has orders of magnitude more room), while the localStorage
      // mirror is the only home of the recent-visit detail. So each has a
      // failure mode the other survives — a full chart plus five visits of
      // nurse_notes per patient runs to hundreds of KB and can blow the ~5MB
      // localStorage quota, and IndexedDB can be blocked or unavailable
      // (private mode, corrupt store). Whichever fails, the other still gives
      // the nurse something usable in the field, so the download only counts as
      // failed when BOTH are lost.
      let rosterSaved = true;
      try {
        await savePatients(mergedCache.map((entry) => entry.patient).filter(Boolean));
      } catch (dbError) {
        rosterSaved = false;
        console.warn('Offline IndexedDB roster write failed:', dbError?.message);
      }

      let mirrored = true;
      try {
        localStorage.setItem('offline_patient_data', JSON.stringify(mergedCache));
        localStorage.setItem('offline_cache_timestamp', new Date().toISOString());
      } catch (storageError) {
        mirrored = false;
        console.warn('Offline localStorage mirror skipped:', storageError?.message);
      }

      if (!rosterSaved && !mirrored) {
        throw new Error('This device has no room to store offline data. Free up space and try again.');
      }

      window.dispatchEvent(new CustomEvent('offline-patients-updated'));

      setCacheResult({
        success: true,
        patientsCached: cachedData.length,
        totalSize: JSON.stringify(mergedCache).length,
        mirrored,
        rosterSaved
      });

      onCacheComplete?.(cachedData.length);

    } catch (error) {
      console.error('Caching error:', error);
      setCacheResult({
        success: false,
        error: error.message
      });
    }

    setIsCaching(false);
  };

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5 text-blue-600" />
          Download Data for Offline Access
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <Alert className="bg-blue-50 border-blue-200">
          <Calendar className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-sm text-blue-900">
            Select patients with scheduled visits to cache their data for offline access. 
            You'll be able to document notes even without internet.
          </AlertDescription>
        </Alert>

        {cacheResult && (
          <Alert className={cacheResult.success ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}>
            <CheckCircle2 className="w-4 h-4" />
            <AlertDescription className="text-sm">
              {cacheResult.success ? (
                <>
                  ✅ Successfully cached {cacheResult.patientsCached} patient{cacheResult.patientsCached !== 1 ? 's' : ''}
                  ({(cacheResult.totalSize / 1024).toFixed(1)} KB)
                  {/* The recent-visit detail lives only in the localStorage
                      mirror (OfflineMode merges it over the IndexedDB roster),
                      so say plainly what the nurse will and won't have in the
                      field rather than reporting an unqualified success. */}
                  {cacheResult.mirrored === false && (
                    <span className="block mt-1 text-amber-800">
                      Device storage is full, so recent-visit detail wasn’t saved. The patient
                      list is still available offline — free up space and download again to
                      include visit notes.
                    </span>
                  )}
                  {cacheResult.rosterSaved === false && (
                    <span className="block mt-1 text-amber-800">
                      This device’s offline database couldn’t be written, so only the
                      downloaded chart detail is stored. Reload the app and download again
                      to restore the full offline patient list.
                    </span>
                  )}
                </>
              ) : (
                `❌ Cache failed: ${cacheResult.error}`
              )}
            </AlertDescription>
          </Alert>
        )}

        {patientsWithVisits.length === 0 ? (
          <div className="text-center py-6 text-slate-500">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <p className="text-sm">No patients with scheduled visits</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <Label className="font-semibold">
                Select Patients ({selectedPatients.length}/{patientsWithVisits.length})
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
              >
                {selectedPatients.length === patientsWithVisits.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>

            <ScrollArea className="h-64 border rounded-lg p-3">
              <div className="space-y-2">
                {patientsWithVisits.map((patient) => (
                  <div
                    key={patient.id}
                    className="flex items-start gap-3 p-3 bg-white rounded-lg border hover:bg-blue-50 cursor-pointer"
                    onClick={() => {
                      if (onSelectPatient) {
                        onSelectPatient(patient.id, patient);
                      } else {
                        handleTogglePatient(patient.id);
                      }
                    }}
                  >
                    {!onSelectPatient && (
                      <Checkbox
                        checked={selectedPatients.includes(patient.id)}
                        onCheckedChange={() => handleTogglePatient(patient.id)}
                      />
                    )}
                    <div className="flex-1">
                      <p className="font-medium text-sm">
                        {patient.first_name} {patient.last_name}
                      </p>
                      <p className="text-xs text-slate-600">
                        {patient.primary_diagnosis || 'No diagnosis'}
                      </p>
                      <Badge variant="outline" className="text-xs mt-1">
                        {patient.upcomingVisits.length} scheduled visit{patient.upcomingVisits.length !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {!onSelectPatient && (
              <Button
                onClick={handleCacheData}
                disabled={selectedPatients.length === 0 || isCaching}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {isCaching ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Caching Data...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Cache {selectedPatients.length} Patient{selectedPatients.length !== 1 ? 's' : ''} for Offline
                  </>
                )}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}