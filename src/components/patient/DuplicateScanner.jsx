import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { 
  Loader2, 
  CheckCircle2, 
  AlertTriangle,
  Trash2,
  Shield,
  Settings,
  Zap,
  Database
} from "lucide-react";
import { toast } from "sonner";
import {
  similarity,
  levenshtein,
  normalizeName,
  digitsOnly,
} from "@/components/patient/patientDuplicateUtils";
import { mergePatientInto } from "@/components/patient/mergePatients";

// Demographic fields on Patient that count toward "how complete is this chart".
// Used to pick the survivor of a duplicate group by completeness (not by newest),
// so a sparse stub created moments ago never wins over an older, fully-documented
// record.
// MRN / date_of_birth are weighted separately below. The earlier list scored
// city/state/zip/insurance_provider/gender, none of which exist on Patient, so
// they always contributed 0 while the backend's clinical/insurance fields were
// never counted — the two surfaces could pick different survivors.
const SURVIVOR_FIELDS = [
  "first_name", "last_name", "middle_name", "address", "phone", "email",
  "payor", "emergency_contact_name", "emergency_contact_phone",
  "physician_name", "physician_phone", "caregiver_name", "caregiver_email",
  "primary_diagnosis", "secondary_diagnoses", "allergies", "current_medications",
  "insurance_primary", "insurance_secondary", "admission_date", "care_type",
  "advance_directives", "functional_status", "assigned_nurses",
  "enhanced_notes_history", "clinical_notes", "goals_of_care",
];
// System / merge-bookkeeping fields never copied when back-filling the survivor.
const SYSTEM_FIELDS = new Set([
  "id", "created_date", "updated_date", "created_by", "is_archived",
  "merged_into_id", "merged_at", "merged_by", "status",
]);

const nonEmpty = (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
// Scoring-only predicate mirroring the backend's isPopulated: an untouched
// object slot ({} insurance_primary) and a whitespace-only string are not
// completeness. nonEmpty stays as-is for back-filling.
const isPopulated = (v) => {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return String(v).trim() !== "";
};
// Strong identifiers are weighted exactly as the backend weights them (MRN 3,
// DOB 2) — losing those is the worst outcome of picking the wrong survivor.
const completenessScore = (p) => {
  if (!p) return 0;
  let score = 0;
  if (isPopulated(p.medical_record_number)) score += 3;
  if (isPopulated(p.date_of_birth)) score += 2;
  return SURVIVOR_FIELDS.reduce((n, k) => n + (isPopulated(p[k]) ? 1 : 0), score);
};
// Prefer an active record, then the most complete one (mirrors the backend
// deduplicatePatients survivor rule so UI and server merges agree).
const pickSurvivor = (patients) =>
  [...patients].sort((a, b) => {
    // Never let an archived/merged record win as survivor — merging a live chart
    // into an already-archived record would hide it from every roster.
    const archived = (a.is_archived ? 1 : 0) - (b.is_archived ? 1 : 0);
    if (archived !== 0) return archived;
    const active = (a.status === "active" ? 1 : 0) - (b.status === "active" ? 1 : 0);
    if (active !== 0) return -active;
    return completenessScore(b) - completenessScore(a);
  })[0];

// Composite, per-criterion matching for the destructive advanced scan. Each
// enabled rule pairs a criterion with a corroborating identifier so a match is
// always high confidence — a name match alone is never sufficient, and
// phone/email require a matching last name (as the original scanner did).
// Scores mirror the original calibration; a pair is a duplicate at >= 70.
const ADVANCED_MATCH_THRESHOLD = 70;

const evaluateAdvancedMatch = (a, b, opts) => {
  let score = 0;
  const reasons = [];

  const firstA = normalizeName(a.first_name);
  const firstB = normalizeName(b.first_name);
  const lastA = normalizeName(a.last_name);
  const lastB = normalizeName(b.last_name);
  const sameLastName = !!lastA && lastA === lastB;

  // Exact MRN — a unique identifier, definitive on its own.
  if (opts.matchByMRN && a.medical_record_number && b.medical_record_number) {
    const mrnA = String(a.medical_record_number).trim().toUpperCase();
    const mrnB = String(b.medical_record_number).trim().toUpperCase();
    if (mrnA && mrnA === mrnB) {
      score += 100;
      reasons.push("MRN match");
    }
  }

  // Name + DOB. The fuzzy toggle controls whether names are compared by
  // similarity/typo tolerance or must be exact.
  if (
    opts.matchByNameAndDOB &&
    a.date_of_birth &&
    b.date_of_birth &&
    a.date_of_birth === b.date_of_birth
  ) {
    // Twins/siblings share last name and DOB and differ ONLY in first name —
    // 'Jayden'/'Kayden' scored 83% similar and were auto-merged here with no
    // preview. Mirror the POSSIBLE_TWINS predicate in patientDuplicateUtils
    // (scorePatientPair) so that pattern is excluded while single-edit typos
    // keeping the first letter ('Jon'/'John') still match.
    const twinsSuspect =
      firstA.length >= 3 && firstB.length >= 3 &&
      firstA !== firstB &&
      !firstA.includes(firstB) && !firstB.includes(firstA) &&
      similarity(firstA, firstB) < 85 &&
      !(levenshtein(firstA, firstB) <= 1 && firstA[0] === firstB[0]);
    const namesMatch = opts.fuzzyNameMatching
      ? !twinsSuspect && similarity(firstA, firstB) >= 80 && similarity(lastA, lastB) >= 80
      : !!firstA && firstA === firstB && sameLastName;
    if (namesMatch) {
      score += 90;
      reasons.push(opts.fuzzyNameMatching ? "Name+DOB match (fuzzy)" : "Name+DOB match");
    }
  }

  // Phone + last name.
  if (opts.matchByPhone && a.phone && b.phone && sameLastName) {
    const phoneA = digitsOnly(a.phone);
    const phoneB = digitsOnly(b.phone);
    if (phoneA.length >= 10 && phoneA === phoneB) {
      score += 70;
      reasons.push("Phone + last name match");
    }
  }

  // Email + last name.
  if (opts.matchByEmail && a.email && b.email && sameLastName) {
    if (a.email.toLowerCase().trim() === b.email.toLowerCase().trim()) {
      score += 75;
      reasons.push("Email + last name match");
    }
  }

  // Address + name similarity (corroborating only — not sufficient alone).
  if (opts.matchByAddress && a.address && b.address) {
    const addressSim = similarity(a.address, b.address);
    const nameSim = (similarity(firstA, firstB) + similarity(lastA, lastB)) / 2;
    if (addressSim >= 85 && nameSim >= 70) {
      score += 60;
      reasons.push("Address + name similarity");
    }
  }

  return { isMatch: score >= ADVANCED_MATCH_THRESHOLD, score, reasons };
};

export default function DuplicateScanner() {
  const [isScanning, setIsScanning] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [results, setResults] = useState(null);
  const [scanMode, setScanMode] = useState('standard'); // 'standard' or 'advanced'
  const [advancedOptions, setAdvancedOptions] = useState({
    matchByMRN: true,
    matchByNameAndDOB: true,
    matchByPhone: true,
    matchByEmail: true,
    matchByAddress: false,
    fuzzyNameMatching: true,
    autoMergeData: true,
    closeInactiveOnly: false
  });
  const queryClient = useQueryClient();


  // Fetch all patients for advanced scanning (agency-scoped for facility admins)
  const { data: allPatients = [] } = useScopedPatients({ sort: '-created_date', limit: 10000, enabled: scanMode === 'advanced' });

  const scanAndRemoveDuplicates = async () => {
    setIsScanning(true);
    toast.info('Starting comprehensive duplicate scan...');
    
    try {
      if (scanMode === 'standard') {
        // Standard scan = DRY-RUN preview only. The backend defaults to a preview
        // (no deletion) unless called with confirm:true; the admin reviews the
        // proposed merges and then clicks "Confirm & merge" (applyStandardMerge).
        const response = await base44.functions.invoke('deduplicatePatients');
        const data = response.data || response;
        setResults(data);
      } else {
        // Advanced client-side scanning using the shared matching engine.
        const duplicateGroups = [];

        // Phase 1: Identify duplicate groups (no API calls). allPatients is
        // ordered by -created_date; grouping is order-independent — the survivor is
        // chosen by completeness in Phase 2, not by position in the list.
        // Exclude already-archived/merged records from the scan. A previously
        // merged duplicate keeps its MRN and would otherwise re-match (MRN=100) on
        // every rescan — inflating "Records Merged", back-filling the survivor from
        // stale data, and (via pickSurvivor) potentially being chosen as survivor,
        // merging a live chart into an archived, roster-invisible record.
        const scanRoster = allPatients.filter(p => !p.is_archived && p.status !== 'merged');
        const processedIds = new Set();
        const groups = [];
        for (let i = 0; i < scanRoster.length; i++) {
          const primary = scanRoster[i];
          if (processedIds.has(primary.id)) continue;

          const matched = [];
          for (let j = i + 1; j < scanRoster.length; j++) {
            const candidate = scanRoster[j];
            if (processedIds.has(candidate.id)) continue;
            const { isMatch, score, reasons } = evaluateAdvancedMatch(primary, candidate, advancedOptions);
            if (isMatch) {
              matched.push({ patient: candidate, score, reasons });
              processedIds.add(candidate.id);
            }
          }

          if (matched.length > 0) {
            processedIds.add(primary.id);
            groups.push({ primary, duplicates: matched });
          }
        }

        // Phase 2: choose the survivor by completeness and MERGE each duplicate
        // into it through the shared safe path (mergePatientInto): it reassigns
        // every patient_id-linked record (visits, OASIS, incidents, documents, …)
        // to the survivor and soft-archives the duplicate (is_archived + status
        // 'merged' + merged_into_id) so it leaves the roster and its clinical
        // history follows the kept chart — instead of the old status-only close,
        // which orphaned history on a still-visible 'discharged' record.
        const plans = groups.map(group => {
          const members = [group.primary, ...group.duplicates.map(d => d.patient)];
          const survivor = pickSurvivor(members);
          const scoreById = new Map(group.duplicates.map(d => [d.patient.id, d]));
          const dupInfos = members
            .filter(m => m.id !== survivor.id)
            // Honor "only close inactive duplicates": leave an active duplicate be.
            .filter(m => !advancedOptions.closeInactiveOnly || m.status !== 'active')
            .map(m => ({
              patient: m,
              score: scoreById.get(m.id)?.score ?? 100,
              reasons: scoreById.get(m.id)?.reasons ?? ['reselected as duplicate (survivor chosen by completeness)'],
            }));
          return { survivor, dupInfos };
        });

        const totalToMerge = plans.reduce((n, p) => n + p.dupInfos.length, 0);
        let processedCount = 0;
        let failedCount = 0;
        toast.info(`Merging ${totalToMerge} duplicate record(s) into the most complete chart...`);

        for (const { survivor, dupInfos } of plans) {
          if (dupInfos.length === 0) continue;

          // Optionally back-fill the survivor's EMPTY demographic slots from the
          // duplicates (never overwrite a populated field, never touch system
          // fields). mergePatientInto moves the clinical records regardless.
          if (advancedOptions.autoMergeData) {
            const backfill = {};
            for (const { patient } of dupInfos) {
              for (const key of Object.keys(patient)) {
                if (SYSTEM_FIELDS.has(key)) continue;
                if (!nonEmpty(survivor[key]) && !nonEmpty(backfill[key]) && nonEmpty(patient[key])) {
                  backfill[key] = patient[key];
                }
              }
            }
            if (Object.keys(backfill).length > 0) {
              try {
                await base44.entities.Patient.update(survivor.id, backfill);
              } catch (err) {
                console.error(`Survivor back-fill failed for ${survivor.id}:`, err?.message);
              }
            }
          }

          // Report only what actually merged. A thrown mergePatientInto (RLS
          // denial, archived survivor, failed archive write) leaves the duplicate
          // live on the roster, so counting it as "removed" told the admin a
          // record was merged when it still needs attention.
          const mergedInfos = [];
          const failedInfos = [];
          for (const info of dupInfos) {
            let ok = true;
            try {
              await mergePatientInto(survivor.id, info.patient.id, { mergedBy: null });
            } catch (err) {
              // Best-effort per duplicate: log and continue so one failure doesn't
              // abort the whole scan (mergePatientInto is itself best-effort per record).
              ok = false;
              console.error(`Merge failed for duplicate ${info.patient.id}:`, err?.message);
            }
            if (ok) {
              mergedInfos.push(info);
            } else {
              failedInfos.push(info);
              failedCount += 1;
            }
            // Progress counts attempts so the bar still advances past failures.
            processedCount += 1;
            const progress = totalToMerge ? Math.min(100, Math.round((processedCount / totalToMerge) * 100)) : 100;
            toast.info(`Progress: ${progress}% (${processedCount}/${totalToMerge})`);
          }

          if (mergedInfos.length === 0 && failedInfos.length === 0) continue;

          duplicateGroups.push({
            kept: {
              name: `${survivor.first_name} ${survivor.last_name}`,
              mrn: survivor.medical_record_number,
              id: survivor.id
            },
            removed: mergedInfos.map(d => ({
              name: `${d.patient.first_name} ${d.patient.last_name}`,
              mrn: d.patient.medical_record_number,
              match_score: Math.min(100, d.score),
              match_reasons: d.reasons
            })),
            failed: failedInfos.map(d => ({
              name: `${d.patient.first_name} ${d.patient.last_name}`,
              mrn: d.patient.medical_record_number,
              id: d.patient.id
            })),
            average_match_score: mergedInfos.length
              ? Math.round(mergedInfos.reduce((sum, d) => sum + Math.min(100, d.score), 0) / mergedInfos.length)
              : 0
          });
        }

        setResults({
          duplicate_groups_found: duplicateGroups.length,
          patients_removed: duplicateGroups.reduce((sum, g) => sum + g.removed.length, 0),
          merge_failures: failedCount,
          details: duplicateGroups,
          scan_mode: 'advanced',
          algorithms_used: Object.entries(advancedOptions)
            .filter(([k, v]) => v && k.startsWith('match'))
            .map(([k]) => k.replace('matchBy', ''))
        });

        if (failedCount > 0) {
          toast.warning(`${failedCount} duplicate record(s) could not be merged and are still active.`);
        }
        toast.success('Advanced scan complete!');
      }
      
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    } catch (error) {
      // Keep backend/internal detail in logs only — this is an admin tool calling
      // privileged functions; show a generic message in the UI.
      console.error('Scan error:', error);
      toast.error('Failed to scan for duplicates. Please try again.');
    }
    setIsScanning(false);
  };

  // Apply the previewed standard-mode merges. Calls the backend with
  // confirm:true, which archives (soft-deletes) the duplicates rather than
  // hard-deleting them, so a wrong merge is recoverable.
  const applyStandardMerge = async () => {
    setIsApplying(true);
    toast.info('Merging the reviewed duplicates...');
    try {
      const response = await base44.functions.invoke('deduplicatePatients', { confirm: true });
      const data = response.data || response;
      setResults(data);
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      toast.success(`Merged ${data.patients_removed || 0} duplicate record(s).`);
    } catch (error) {
      console.error('Merge error:', error);
      toast.error('Failed to merge duplicates. Please try again.');
    }
    setIsApplying(false);
  };

  return (
    <Card className="border-2 border-indigo-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-indigo-600" />
          Enhanced Duplicate Scanner
          <Badge className="ml-auto bg-navy-600 text-white">
            {scanMode === 'advanced' ? 'Multi-Algorithm' : 'Standard'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!results ? (
          <>
            <Alert className="bg-blue-50 border-blue-300">
              <Zap className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <strong>Enhanced Detection:</strong> Scans using multiple algorithms including MRN, name+DOB, phone, email, and address matching.
              </AlertDescription>
            </Alert>

            {/* Scan Mode Selection */}
            <div className="space-y-3 p-4 bg-slate-50 rounded-lg border">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Scan Mode</Label>
                <Badge variant="outline" className="text-xs">
                  <Settings className="w-3 h-3 mr-1" />
                  Configuration
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={scanMode === 'standard' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setScanMode('standard')}
                  className={scanMode === 'standard' ? 'bg-indigo-600' : ''}
                >
                  <Database className="w-4 h-4 mr-2" />
                  Standard Scan
                </Button>
                <Button
                  variant={scanMode === 'advanced' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setScanMode('advanced')}
                  className={scanMode === 'advanced' ? 'bg-navy-600' : ''}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Advanced Scan
                </Button>
              </div>
              
              <p className="text-xs text-slate-600">
                {scanMode === 'standard' 
                  ? 'Fast server-side scan using name and DOB matching'
                  : 'Comprehensive multi-algorithm scan with fuzzy matching and auto-merge'}
              </p>
            </div>

            {/* Advanced Options */}
            {scanMode === 'advanced' && (
              <div className="space-y-3 p-4 bg-navy-50 rounded-lg border border-navy-300">
                <h4 className="font-semibold text-navy-900 text-sm flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Advanced Options
                </h4>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="matchMRN"
                      checked={advancedOptions.matchByMRN}
                      onCheckedChange={(checked) => 
                        setAdvancedOptions(prev => ({ ...prev, matchByMRN: checked }))
                      }
                    />
                    <Label htmlFor="matchMRN" className="text-xs cursor-pointer">
                      Match by MRN
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="matchNameDOB"
                      checked={advancedOptions.matchByNameAndDOB}
                      onCheckedChange={(checked) => 
                        setAdvancedOptions(prev => ({ ...prev, matchByNameAndDOB: checked }))
                      }
                    />
                    <Label htmlFor="matchNameDOB" className="text-xs cursor-pointer">
                      Match by Name+DOB
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="matchPhone"
                      checked={advancedOptions.matchByPhone}
                      onCheckedChange={(checked) => 
                        setAdvancedOptions(prev => ({ ...prev, matchByPhone: checked }))
                      }
                    />
                    <Label htmlFor="matchPhone" className="text-xs cursor-pointer">
                      Match by Phone
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="matchEmail"
                      checked={advancedOptions.matchByEmail}
                      onCheckedChange={(checked) => 
                        setAdvancedOptions(prev => ({ ...prev, matchByEmail: checked }))
                      }
                    />
                    <Label htmlFor="matchEmail" className="text-xs cursor-pointer">
                      Match by Email
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="matchAddress"
                      checked={advancedOptions.matchByAddress}
                      onCheckedChange={(checked) => 
                        setAdvancedOptions(prev => ({ ...prev, matchByAddress: checked }))
                      }
                    />
                    <Label htmlFor="matchAddress" className="text-xs cursor-pointer">
                      Match by Address
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="fuzzyMatch"
                      checked={advancedOptions.fuzzyNameMatching}
                      onCheckedChange={(checked) => 
                        setAdvancedOptions(prev => ({ ...prev, fuzzyNameMatching: checked }))
                      }
                    />
                    <Label htmlFor="fuzzyMatch" className="text-xs cursor-pointer">
                      Fuzzy Name Match
                    </Label>
                  </div>
                </div>
                
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="autoMerge"
                      checked={advancedOptions.autoMergeData}
                      onCheckedChange={(checked) => 
                        setAdvancedOptions(prev => ({ ...prev, autoMergeData: checked }))
                      }
                    />
                    <Label htmlFor="autoMerge" className="text-xs cursor-pointer font-semibold">
                      Auto-merge data from duplicates
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="closeInactive"
                      checked={advancedOptions.closeInactiveOnly}
                      onCheckedChange={(checked) => 
                        setAdvancedOptions(prev => ({ ...prev, closeInactiveOnly: checked }))
                      }
                    />
                    <Label htmlFor="closeInactive" className="text-xs cursor-pointer">
                      Only close inactive patients
                    </Label>
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={scanAndRemoveDuplicates}
              disabled={isScanning}
              className={`w-full ${scanMode === 'advanced' ? 'bg-navy-600 hover:bg-navy-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              size="lg"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scanning {allPatients.length} Patients...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Run {scanMode === 'advanced' ? 'Advanced' : 'Standard'} Scan
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            {/* merge_failures counts too: when every mergePatientInto in an
                advanced scan fails, patients_removed is 0 and the advanced path
                never sets patients_to_remove, so this fell through to the
                "No duplicates found" card — hiding the failed rows and leaving
                still-active duplicates with no visible way to retry them. */}
            {(results.patients_removed > 0 || results.patients_to_remove > 0 || results.merge_failures > 0) ? (
              <>
                {results.dry_run ? (
                  <Alert className="bg-amber-50 border-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <AlertDescription className="text-amber-900">
                      <strong>Review required — nothing has been changed yet</strong>
                      <div className="mt-2 text-sm">
                        Found {results.duplicate_groups_found} duplicate group(s); {results.patients_to_remove} record(s) would be merged. Merging archives the duplicate (it is hidden from lists but recoverable), keeping the most complete record. Review below, then confirm.
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert className="bg-green-50 border-green-300">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900">
                      <strong>✅ Deduplication Complete!</strong>
                      <div className="mt-2 text-sm">
                        Found {results.duplicate_groups_found} duplicate group(s) and merged {results.patients_removed} duplicate record(s).
                        {results.merge_failures > 0 && (
                          <div className="mt-1 font-semibold text-amber-800">
                            {results.merge_failures} record(s) could not be merged and are still active — retry or merge them manually.
                          </div>
                        )}
                        {results.scan_mode === 'advanced' && (
                          <div className="mt-1 text-xs">
                            <Badge className="bg-navy-600 text-white text-xs mt-1">
                              Advanced Multi-Algorithm Scan
                            </Badge>
                          </div>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-700 mb-1">Duplicate Groups</p>
                    <p className="text-2xl font-bold text-blue-900">{results.duplicate_groups_found}</p>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-xs text-red-700 mb-1">{results.dry_run ? 'Would Merge' : 'Records Merged'}</p>
                    <p className="text-2xl font-bold text-red-900">{results.dry_run ? results.patients_to_remove : results.patients_removed}</p>
                  </div>
                </div>

                {results.algorithms_used && (
                  <div className="p-3 bg-navy-50 rounded-lg border border-navy-200">
                    <p className="text-xs text-navy-700 mb-2 font-semibold">Algorithms Used:</p>
                    <div className="flex flex-wrap gap-1">
                      {results.algorithms_used.map((algo, idx) => (
                        <Badge key={idx} variant="outline" className="bg-navy-100 text-navy-800 text-xs">
                          {algo}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {results.details && results.details.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                      Deduplication Details
                    </h4>
                    <ScrollArea className="h-64 border rounded-lg">
                      <div className="p-4 space-y-3">
                        {results.details.map((detail, idx) => (
                          <Card key={idx} className="bg-white">
                            <CardContent className="p-3">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                                <span className="font-semibold text-sm">Kept: {detail.kept.name}</span>
                                <Badge variant="outline" className="bg-green-100 text-green-800 text-xs">
                                  MRN: {detail.kept.mrn}
                                </Badge>
                                {detail.confidence && (
                                  <Badge className={`text-xs ${
                                    detail.confidence === 'High' ? 'bg-green-600' :
                                    detail.confidence === 'Medium' ? 'bg-yellow-600' :
                                    'bg-orange-600'
                                  }`}>
                                    {detail.confidence} Confidence ({detail.average_match_score}%)
                                  </Badge>
                                )}
                              </div>
                              <div className="ml-6 space-y-1">
                                {detail.removed.map((removed, rIdx) => (
                                  <div key={rIdx} className="space-y-1">
                                    <div className="flex items-center gap-2 text-xs text-slate-600">
                                      <Trash2 className="w-3 h-3 text-red-600" />
                                      <span>Removed: {removed.name}</span>
                                      <Badge variant="outline" className="text-xs">
                                        MRN: {removed.mrn}
                                      </Badge>
                                      <Badge variant="outline" className="text-xs bg-blue-100">
                                        {removed.match_score}% match
                                      </Badge>
                                    </div>
                                    {removed.match_reasons && removed.match_reasons.length > 0 && (
                                      <div className="ml-6 flex flex-wrap gap-1">
                                        {removed.match_reasons.map((reason, rIdx2) => (
                                          <Badge key={rIdx2} className="bg-green-100 text-green-800 text-xs">
                                            ✓ {reason}
                                          </Badge>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {detail.failed?.map((failed, fIdx) => (
                                  <div key={`f-${fIdx}`} className="flex items-center gap-2 text-xs text-amber-800">
                                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                                    <span>Merge failed (still active): {failed.name}</span>
                                    <Badge variant="outline" className="text-xs">
                                      MRN: {failed.mrn}
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {results.dry_run && (
                  <Button
                    onClick={applyStandardMerge}
                    disabled={isApplying}
                    className="w-full"
                  >
                    {isApplying ? 'Merging…' : `Confirm & merge ${results.patients_to_remove} duplicate(s)`}
                  </Button>
                )}
              </>
            ) : (
              <Alert className="bg-blue-50 border-blue-300">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  <strong>✅ No duplicates found!</strong>
                  <div className="mt-1 text-sm">
                    All patient records are unique.
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <Button
              onClick={() => setResults(null)}
              variant="outline"
              className="w-full"
            >
              Scan Again
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}