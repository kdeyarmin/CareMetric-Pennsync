import { useState } from "react";
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
import {
  mergePatientGroup,
  PatientMergeIncompleteError,
  PATIENT_MERGES_PAUSED,
  PATIENT_MERGE_PAUSED_MESSAGE,
  scanDuplicatePatients,
} from "@/components/patient/mergePatients";

const PATIENT_DEDUPE_UI_ENABLED = true;

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
// Scoring-only predicate mirroring the backend's isPopulated: an untouched
// object slot ({} insurance_primary) and a whitespace-only string are not
// completeness.
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

function EnabledDuplicateScanner() {
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
    closeInactiveOnly: false
  });
  const queryClient = useQueryClient();


  // Advanced scanning reads the roster through the authorized, agency-bound
  // Patient list broker. The 'deduplication' purpose projects exactly the
  // identifiers the matcher compares (name, DOB, MRN, phone, email, address).
  const allPatientsQuery = useScopedPatients({ purpose: 'deduplication', sort: '-created_date', limit: 10000, enabled: scanMode === 'advanced' });
  const allPatients = allPatientsQuery.isSuccess ? allPatientsQuery.data : [];
  const advancedAgencyId = allPatientsQuery.tenantScope?.agency_id || null;

  // Both modes only PREVIEW. Nothing is merged until the admin reviews the
  // proposed groups and confirms (applyReviewedMerge), and then exactly the
  // reviewed groups are sent to the server merge broker by id.
  const scanForDuplicates = async () => {
    if (PATIENT_MERGES_PAUSED) {
      toast.error(PATIENT_MERGE_PAUSED_MESSAGE);
      return;
    }
    setIsScanning(true);
    toast.info('Starting comprehensive duplicate scan...');

    try {
      if (scanMode === 'standard') {
        // Server dry-run preview scoped to the caller's agency.
        const data = await scanDuplicatePatients();
        setResults({ ...data, scan_mode: 'standard' });
      } else {
        if (!allPatientsQuery.isSuccess) {
          toast.error('Patient access is still being verified. Try again in a moment.');
          setIsScanning(false);
          return;
        }
        // Phase 1: Identify duplicate groups (no API calls). allPatients is
        // ordered by -created_date; grouping is order-independent — the survivor is
        // chosen by completeness in Phase 2, not by position in the list.
        // Exclude already-archived/merged records from the scan. A previously
        // merged duplicate keeps its MRN and would otherwise re-match (MRN=100) on
        // every rescan, and (via pickSurvivor) could even be chosen as survivor.
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

        // Phase 2: choose the survivor by completeness. The merge itself happens
        // only after review, through the server broker, which moves every linked
        // record onto the survivor and archives the duplicate last.
        const details = groups.map(group => {
          const members = [group.primary, ...group.duplicates.map(d => d.patient)];
          const survivor = pickSurvivor(members);
          const scoreById = new Map(group.duplicates.map(d => [d.patient.id, d]));
          const removed = members
            .filter(m => m.id !== survivor.id)
            // Honor "only close inactive duplicates": leave an active duplicate be.
            .filter(m => !advancedOptions.closeInactiveOnly || m.status !== 'active')
            .map(m => ({
              id: m.id,
              name: `${m.first_name} ${m.last_name}`,
              mrn: m.medical_record_number,
              match_score: Math.min(100, scoreById.get(m.id)?.score ?? 100),
              match_reasons: scoreById.get(m.id)?.reasons ?? ['reselected as duplicate (survivor chosen by completeness)'],
            }));
          return {
            kept: {
              id: survivor.id,
              name: `${survivor.first_name} ${survivor.last_name}`,
              mrn: survivor.medical_record_number,
            },
            removed,
            average_match_score: removed.length
              ? Math.round(removed.reduce((sum, d) => sum + d.match_score, 0) / removed.length)
              : 0,
          };
        }).filter(detail => detail.removed.length > 0);

        setResults({
          dry_run: true,
          duplicate_groups_found: details.length,
          patients_to_remove: details.reduce((sum, d) => sum + d.removed.length, 0),
          patients_removed: 0,
          details,
          scan_mode: 'advanced',
          agency_id: advancedAgencyId,
          algorithms_used: Object.entries(advancedOptions)
            .filter(([k, v]) => v && k.startsWith('match'))
            .map(([k]) => k.replace('matchBy', ''))
        });
        toast.success('Advanced scan complete. Review the groups below before merging.');
      }
    } catch (error) {
      // Keep backend/internal detail in logs only — this is an admin tool calling
      // privileged functions; show a generic message in the UI.
      console.error('Scan error:', error);
      toast.error('Failed to scan for duplicates. Please try again.');
    }
    setIsScanning(false);
  };

  // Apply exactly the reviewed groups. Each group is one broker call naming the
  // survivor and its duplicates; a group that cannot finish leaves its
  // duplicates active and is reported (re-running the merge resumes it).
  const applyReviewedMerge = async () => {
    if (PATIENT_MERGES_PAUSED) {
      toast.error(PATIENT_MERGE_PAUSED_MESSAGE);
      return;
    }
    if (!results?.dry_run || !Array.isArray(results.details)) return;
    setIsApplying(true);
    toast.info('Merging the reviewed duplicates...');
    const agencyId = results.agency_id || null;
    let mergedCount = 0;
    let failedCount = 0;
    const mergedDetails = [];
    for (const detail of results.details) {
      const duplicateIds = (detail.removed || []).map(r => r.id).filter(Boolean);
      if (!detail.kept?.id || duplicateIds.length === 0) continue;
      let mergedIds = [];
      try {
        const { result } = await mergePatientGroup(detail.kept.id, duplicateIds, { agencyId });
        mergedIds = result?.merged_ids || duplicateIds;
      } catch (error) {
        mergedIds = error instanceof PatientMergeIncompleteError ? (error.result?.merged_ids || []) : [];
        console.error('Merge failed for a duplicate group:', error?.message);
      }
      const merged = new Set(mergedIds);
      const removed = detail.removed.filter(r => merged.has(r.id));
      const failed = detail.removed.filter(r => !merged.has(r.id)).map(({ id, name, mrn }) => ({ id, name, mrn }));
      mergedCount += removed.length;
      failedCount += failed.length;
      mergedDetails.push({ ...detail, removed, failed });
    }
    setResults({
      ...results,
      dry_run: false,
      patients_removed: mergedCount,
      patients_to_remove: 0,
      merge_failures: failedCount,
      details: mergedDetails,
    });
    queryClient.invalidateQueries({ queryKey: ['patients'] });
    if (failedCount > 0) {
      toast.warning(`${failedCount} duplicate record(s) could not be merged and are still active.`);
    }
    toast.success(`Merged ${mergedCount} duplicate record(s).`);
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
                  ? 'Fast server-side scan using MRN, name and DOB matching'
                  : 'Comprehensive multi-algorithm scan with fuzzy matching. You review every group before anything is merged.'}
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

            {PATIENT_MERGES_PAUSED && (
              <Alert className="border-amber-300 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-900">
                  {PATIENT_MERGE_PAUSED_MESSAGE} This scanner will not run a scan
                  or merge any chart.
                </AlertDescription>
              </Alert>
            )}

            <Button
              onClick={scanForDuplicates}
              disabled={isScanning || PATIENT_MERGES_PAUSED || (scanMode === 'advanced' && !allPatientsQuery.isSuccess)}
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
            {/* merge_failures counts too: when every merge in a confirmed run
                fails, patients_removed is 0 and patients_to_remove is reset, so
                without it this fell through to the "No duplicates found" card —
                hiding the failed rows and leaving still-active duplicates with
                no visible way to retry them. */}
            {(results.patients_removed > 0 || results.patients_to_remove > 0 || results.merge_failures > 0) ? (
              <>
                {results.dry_run ? (
                  <Alert className="bg-amber-50 border-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <AlertDescription className="text-amber-900">
                      <strong>Review required — nothing has been changed yet</strong>
                      <div className="mt-2 text-sm">
                        Found {results.duplicate_groups_found} duplicate group(s); {results.patients_to_remove} record(s) would be merged. Merging moves every linked record (visits, OASIS, documents, care team, notes) onto the kept record and archives the duplicate (it is hidden from lists but recoverable). Review below, then confirm.
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
                                      <span>{results.dry_run ? 'Will merge' : 'Merged'}: {removed.name}</span>
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
                                    <span>Merge did not finish (still active — confirm again to retry): {failed.name}</span>
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
                  <div className="space-y-2">
                    {PATIENT_MERGES_PAUSED && (
                      <p className="text-sm text-amber-800">{PATIENT_MERGE_PAUSED_MESSAGE}</p>
                    )}
                    <Button
                      onClick={applyReviewedMerge}
                      disabled={isApplying || PATIENT_MERGES_PAUSED || !results.patients_to_remove}
                      className="w-full"
                    >
                      {isApplying ? 'Merging…' : `Confirm & merge ${results.patients_to_remove} duplicate(s)`}
                    </Button>
                  </div>
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

export default function DuplicateScanner() {
  if (PATIENT_DEDUPE_UI_ENABLED) return <EnabledDuplicateScanner />;
  return (
    <Card className="border-2 border-amber-300 bg-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-950">
          <Shield className="h-5 w-5 text-amber-700" aria-hidden="true" />
          Patient Duplicate Scanner Paused
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-6 text-amber-900">
        No patient data or service-role preview is loaded while tenant-bound
        duplicate detection and an atomic merge broker are being validated.
      </CardContent>
    </Card>
  );
}
