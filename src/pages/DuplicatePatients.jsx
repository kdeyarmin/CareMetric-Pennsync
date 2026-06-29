import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Users,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  GitMerge,
  RefreshCw,
} from "lucide-react";
import {
  buildVisitsByPatient,
  findDuplicateGroups,
} from "@/components/patient/patientDuplicateUtils";
import { mergePatientGroup } from "@/components/patient/mergePatients";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export default function DuplicatePatients() {
  const confirm = useConfirm();
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [mergingKey, setMergingKey] = useState(null);
  const [isMergingAll, setIsMergingAll] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['all-patients-duplicate-scan'],
    queryFn: async () => {
      const all = await base44.entities.Patient.list('-created_date', 10000);
      // Don't surface already-archived/merged records as fresh duplicates.
      return all.filter((p) => !p.is_archived);
    },
    // Always pull a fresh roster when the page mounts. Caching let the page show
    // duplicate groups computed from a STALE roster (and from before matching-logic
    // fixes deployed), which looked like "the fix didn't work" when it actually had.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: allVisits = [], isLoading: visitsLoading } = useQuery({
    queryKey: ['all-visits-duplicate-analysis'],
    queryFn: () => base44.entities.Visit.list('-created_date', 5000),
    enabled: patients.length > 0
  });

  const runScan = (patientList, visitList) => {
    setIsScanning(true);
    setDuplicateGroups([]);
    // Yield so the "Scanning..." state paints before the (synchronous) matching
    // work runs.
    setTimeout(() => {
      const visitsByPatient = buildVisitsByPatient(visitList);
      const groups = findDuplicateGroups(patientList, { visitsByPatient });
      setDuplicateGroups(groups);
      setHasScanned(true);
      setIsScanning(false);
    }, 0);
  };

  // Auto-scan once the roster (and its visits, for corroboration) have loaded —
  // the admin shouldn't have to click a button to find out the database is dirty.
  // Keyed off the actual data identity so a fresh fetch re-scans instead of
  // reusing groups computed from an earlier (possibly stale) roster.
  useEffect(() => {
    if (isLoading || visitsLoading) return;
    if (patients.length === 0) return;
    runScan(patients, allVisits);
  }, [isLoading, visitsLoading, patients, allVisits]);

  const rescan = () => runScan(patients, allVisits);

  // Merge an entire group into one surviving record: reassign that record's
  // clinical history onto the survivor and archive the rest. `survivor` is the
  // record the admin chose to keep (defaults to the group's primary).
  const handleMergeGroup = async (group, groupKey, survivor) => {
    const others = [group.primary, ...group.duplicates.map((d) => d.patient)].filter(
      (p) => p.id !== survivor.id
    );
    const ok = await confirm({
      title: "Merge duplicates?",
      description:
        `Keep "${survivor.first_name} ${survivor.last_name}" and merge ${others.length} ` +
        `other record(s) into it? Their visits and care plans move to the kept record, ` +
        `and the duplicates are archived (recoverable).`,
      confirmText: "Merge",
      destructive: true,
    });
    if (!ok) return;

    setMergingKey(groupKey);
    try {
      const { patientsMerged, reassigned } = await mergePatientGroup(
        survivor.id,
        others.map((p) => p.id),
        { mergedBy: currentUser?.email }
      );
      const moved = Object.values(reassigned).reduce((a, b) => a + b, 0);
      toast.success(
        `Merged ${patientsMerged} record(s) into ${survivor.first_name} ${survivor.last_name}` +
          (moved > 0 ? ` and moved ${moved} related record(s).` : '.')
      );
      setDuplicateGroups((prev) => prev.filter((_, i) => `group-${i}` !== groupKey));
      queryClient.invalidateQueries({ queryKey: ['all-patients-duplicate-scan'] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    } catch (error) {
      console.error('Merge error:', error);
      toast.error('Failed to merge the duplicates. Please try again.');
    } finally {
      setMergingKey(null);
    }
  };

  const dismissGroup = (groupKey) => {
    setDuplicateGroups((prev) => prev.filter((_, i) => `group-${i}` !== groupKey));
  };

  // One-click "fix everything": for every group, keep the suggested record and
  // merge the rest into it. Same per-group logic as the manual button, just run
  // across all groups so the admin doesn't have to do it one at a time.
  const handleMergeAll = async () => {
    const totalExtra = duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0);
    const ok = await confirm({
      title: "Merge all duplicates?",
      description:
        `This will combine every duplicate group into a single record each, merging ` +
        `${totalExtra} extra record(s) across ${duplicateGroups.length} group(s). The kept ` +
        `record absorbs all visits and care plans; the duplicates are archived (recoverable).`,
      confirmText: "Merge all",
      destructive: true,
    });
    if (!ok) return;

    setIsMergingAll(true);
    let mergedGroups = 0;
    let mergedRecords = 0;
    // Track groups that failed so the loop continues instead of aborting on the
    // first error (e.g. one related record the user can't write). Failed groups
    // stay on screen so the admin can retry or merge them individually.
    const failedKeys = new Set();
    for (let i = 0; i < duplicateGroups.length; i++) {
      const group = duplicateGroups[i];
      const survivor = group.primary;
      const others = group.duplicates.map((d) => d.patient).filter((p) => p.id !== survivor.id);
      try {
        const { patientsMerged } = await mergePatientGroup(
          survivor.id,
          others.map((p) => p.id),
          { mergedBy: currentUser?.email }
        );
        mergedGroups += 1;
        mergedRecords += patientsMerged;
      } catch (error) {
        console.error(`Merge all: group ${i} failed:`, error);
        failedKeys.add(`group-${i}`);
      }
    }

    // Drop only the groups that merged; keep failures visible for retry.
    setDuplicateGroups((prev) => prev.filter((_, i) => failedKeys.has(`group-${i}`)));
    queryClient.invalidateQueries({ queryKey: ['all-patients-duplicate-scan'] });
    queryClient.invalidateQueries({ queryKey: ['patients'] });

    if (failedKeys.size === 0) {
      toast.success(`Merged ${mergedRecords} duplicate record(s) across ${mergedGroups} group(s).`);
    } else if (mergedGroups > 0) {
      toast.warning(
        `Merged ${mergedGroups} group(s); ${failedKeys.size} could not be merged and remain below for you to retry.`
      );
    } else {
      toast.error('Could not merge the duplicates. Please rescan and try again.');
    }
    setIsMergingAll(false);
  };

  const totalDuplicateRecords = duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0);

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Card>
          <CardContent className="p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Loading patients...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Users}
        eyebrow="Patient Care"
        title="Duplicate Patients"
        description="Automatically scans the database for likely duplicate records and merges them — moving visits and care plans onto the record you keep."
        favoritePage="DuplicatePatients"
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <GitMerge className="w-5 h-5" />
              Duplicate scan
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={rescan}
              disabled={isScanning || patients.length === 0}
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Rescan
                </>
              )}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            We checked all <strong>{patients.length}</strong> patients.
            {hasScanned && !isScanning && (
              <>
                {' '}
                {duplicateGroups.length > 0 ? (
                  <span className="text-orange-600 font-medium">
                    We found {duplicateGroups.length} {duplicateGroups.length === 1 ? 'patient who appears' : 'patients who appear'}{' '}
                    more than once ({totalDuplicateRecords} extra record{totalDuplicateRecords !== 1 ? 's' : ''} that look like duplicates).
                  </span>
                ) : (
                  <span className="text-emerald-600 font-medium">No duplicates found — every patient appears only once.</span>
                )}
              </>
            )}
          </p>

          {hasScanned && !isScanning && duplicateGroups.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="text-sm text-orange-900 flex-1">
                If these are the same patient, you can combine all of their records into one with a single click.
              </p>
              <Button
                onClick={handleMergeAll}
                disabled={isMergingAll}
                className="bg-emerald-600 hover:bg-emerald-700 whitespace-nowrap"
              >
                {isMergingAll ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Merging…
                  </>
                ) : (
                  <>
                    <GitMerge className="w-4 h-4 mr-2" />
                    Merge all duplicates
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isScanning && (
        <Card>
          <CardContent className="p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Scanning {patients.length} patients for duplicates...</p>
          </CardContent>
        </Card>
      )}

      {hasScanned && duplicateGroups.length === 0 && !isScanning && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-emerald-900 mb-2">No Duplicates Found</h3>
            <p className="text-sm text-emerald-700">
              The database is clean. No duplicate patient records detected.
            </p>
          </CardContent>
        </Card>
      )}

      {duplicateGroups.length > 0 && !isScanning && (
        <div className="space-y-6">
          <Alert className="bg-orange-50 border-orange-200">
            <AlertTriangle className="w-4 h-4 text-orange-600" />
            <AlertDescription className="text-orange-900">
              <strong>{duplicateGroups.length} {duplicateGroups.length === 1 ? 'patient appears' : 'patients appear'} more than once.</strong>{' '}
              Use <strong>Merge all duplicates</strong> above to fix them all at once, or review each group
              below and pick the record to keep — its visits and care plans move onto it, and the others
              are archived (recoverable).
            </AlertDescription>
          </Alert>

          {duplicateGroups.map((group, idx) => {
            const groupKey = `group-${idx}`;
            const isMerging = mergingKey === groupKey || isMergingAll;
            const records = [
              { patient: group.primary, isPrimary: true, confidencePercent: null, confidenceLevel: null, matches: [] },
              ...group.duplicates.map((d) => ({ patient: d.patient, isPrimary: false, ...d })),
            ];

            return (
              <Card key={groupKey} className="border-2 border-orange-300">
                <CardHeader className="bg-orange-50">
                  <CardTitle className="text-lg flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Users className="w-5 h-5 text-orange-600" />
                      Duplicate Group {idx + 1}
                      <Badge variant="outline" className="bg-white">{records.length} records</Badge>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-500"
                      onClick={() => dismissGroup(groupKey)}
                      disabled={isMerging}
                      title="Not duplicates — dismiss"
                    >
                      <X className="w-4 h-4 mr-1" />
                      Not duplicates
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6 space-y-3">
                  <p className="text-xs text-slate-500">
                    Pick the most complete record to keep. The other{records.length > 2 ? 's' : ''} will
                    be merged into it.
                  </p>
                  {records.map(({ patient, isPrimary, confidencePercent, confidenceLevel, matches }) => (
                    <Card
                      key={patient.id}
                      className={isPrimary ? 'border-2 border-blue-300 bg-blue-50' : 'bg-slate-50'}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <h4 className="font-bold text-slate-900">
                                {patient.first_name} {patient.last_name}
                              </h4>
                              {isPrimary ? (
                                <Badge className="bg-blue-600">Suggested keep</Badge>
                              ) : (
                                confidencePercent != null && (
                                  <Badge
                                    className={
                                      confidenceLevel === 'high' ? 'bg-red-100 text-red-800' :
                                      confidenceLevel === 'medium' ? 'bg-orange-100 text-orange-800' :
                                      'bg-amber-100 text-amber-800'
                                    }
                                  >
                                    {confidencePercent}% match
                                  </Badge>
                                )
                              )}
                              <Badge className={
                                patient.status === 'active' ? 'bg-emerald-600' :
                                patient.status === 'discharged' ? 'bg-slate-600' :
                                'bg-orange-600'
                              }>
                                {patient.status || 'unknown'}
                              </Badge>
                            </div>
                            <div className="text-sm text-slate-600 space-y-0.5">
                              <p>DOB: {patient.date_of_birth || 'N/A'}</p>
                              <p>MRN: {patient.medical_record_number || 'N/A'}</p>
                              <p>Phone: {patient.phone || 'N/A'}</p>
                              <p>Diagnosis: {patient.primary_diagnosis || 'N/A'}</p>
                            </div>
                            {!isPrimary && matches?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {matches.slice(0, 5).map((reason, mIdx) => (
                                  <Badge key={mIdx} variant="outline" className="text-xs bg-white">
                                    {reason}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex-shrink-0">
                            <Button
                              size="sm"
                              onClick={() => handleMergeGroup(group, groupKey, patient)}
                              disabled={isMerging}
                              className="bg-emerald-600 hover:bg-emerald-700 whitespace-nowrap"
                            >
                              {isMerging ? (
                                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                              ) : (
                                <GitMerge className="w-4 h-4 mr-1" />
                              )}
                              Keep &amp; merge others
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}