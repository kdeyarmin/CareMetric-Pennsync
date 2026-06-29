import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  AlertTriangle,
  Trash2,
  Merge,
  CheckCircle2,
  X,
  Loader2,
  RefreshCw
} from "lucide-react";
import { findDuplicateGroups } from "@/components/patient/patientDuplicateUtils";

export default function DuplicatePatientManager() {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [primaryPatientId, setPrimaryPatientId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dismissedGroups, setDismissedGroups] = useState(new Set());
  
  const queryClient = useQueryClient();

  const { data: patients = [], isLoading, refetch } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Patient.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    }
  });

  // Find duplicate groups using the shared, unit-tested matching engine so this
  // widget stays consistent with the main Duplicate Patients page.
  const duplicateGroups = useMemo(() => {
    if (!patients.length) return [];

    return findDuplicateGroups(patients)
      .map((group) => ({
        id: `group-${group.primary.id}`,
        patients: [
          { patient: group.primary, score: 100, matchReasons: ["Primary"] },
          ...group.duplicates.map((d) => ({
            patient: d.patient,
            score: d.confidencePercent,
            matchReasons: d.matches,
          })),
        ],
        highestScore: Math.max(...group.duplicates.map((d) => d.confidencePercent)),
        matchReasons: [...new Set(group.duplicates.flatMap((d) => d.matches))],
      }))
      .filter((g) => !dismissedGroups.has(g.id));
  }, [patients, dismissedGroups]);

  const _handleDeleteDuplicate = async (patientId) => {
    setIsProcessing(true);
    try {
      await deleteMutation.mutateAsync(patientId);
    } catch (error) {
      console.error("Error deleting patient:", error);
    }
    setIsProcessing(false);
  };

  const handleMergePatients = async () => {
    if (!selectedGroup || !primaryPatientId) return;
    
    setIsProcessing(true);
    try {
      // Get the primary patient's data
      const primaryPatient = selectedGroup.patients.find(p => p.patient.id === primaryPatientId)?.patient;
      if (!primaryPatient) return;

      // Reassign each duplicate's clinical records to the primary BEFORE deleting,
      // then delete. The previous code deleted the duplicates outright, orphaning
      // their Visits/CarePlans (lost clinical history). Mirrors PatientMergeDialog.
      const otherPatients = selectedGroup.patients.filter(p => p.patient.id !== primaryPatientId);
      for (const { patient } of otherPatients) {
        const [visits, carePlans, alerts, pendingUpdates] = await Promise.all([
          base44.entities.Visit.filter({ patient_id: patient.id }),
          base44.entities.CarePlan.filter({ patient_id: patient.id }),
          base44.entities.PatientAlert.filter({ patient_id: patient.id }),
          base44.entities.PendingPatientUpdate.filter({ patient_id: patient.id }),
        ]);
        for (const visit of (visits || [])) {
          await base44.entities.Visit.update(visit.id, { patient_id: primaryPatientId });
        }
        for (const carePlan of (carePlans || [])) {
          await base44.entities.CarePlan.update(carePlan.id, { patient_id: primaryPatientId });
        }
        for (const alert of (alerts || [])) {
          await base44.entities.PatientAlert.update(alert.id, { patient_id: primaryPatientId });
        }
        for (const pendingUpdate of (pendingUpdates || [])) {
          await base44.entities.PendingPatientUpdate.update(pendingUpdate.id, { patient_id: primaryPatientId });
        }
        await deleteMutation.mutateAsync(patient.id);
      }

      queryClient.invalidateQueries({ queryKey: ['patientVisits'] });
      queryClient.invalidateQueries({ queryKey: ['patientCarePlans'] });
      queryClient.invalidateQueries({ queryKey: ['patientAlerts'] });
      queryClient.invalidateQueries({ queryKey: ['pendingPatientUpdates'] });
      setMergeDialogOpen(false);
      setSelectedGroup(null);
      setPrimaryPatientId(null);
    } catch (error) {
      console.error("Error merging patients:", error);
    }
    setIsProcessing(false);
  };

  const handleDismissGroup = (groupId) => {
    setDismissedGroups(prev => new Set([...prev, groupId]));
  };

  const getConfidenceLevel = (score) => {
    if (score >= 80) return { label: "High", color: "bg-red-100 text-red-800" };
    if (score >= 60) return { label: "Medium", color: "bg-yellow-100 text-yellow-800" };
    return { label: "Low", color: "bg-blue-100 text-blue-800" };
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-orange-600" />
            Duplicate Patient Detection
          </div>
          <div className="flex items-center gap-2">
            {duplicateGroups.length > 0 && (
              <Badge variant="destructive">{duplicateGroups.length} potential duplicate{duplicateGroups.length !== 1 ? 's' : ''}</Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {duplicateGroups.length === 0 ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              No duplicate patients detected. All records appear unique.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {duplicateGroups.map((group) => {
              const confidence = getConfidenceLevel(group.highestScore);
              
              return (
                <div key={group.id} className="border rounded-lg p-3 bg-orange-50 border-orange-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                      <span className="text-sm font-medium">
                        {group.patients.length} matching records
                      </span>
                      <Badge className={confidence.color}>{confidence.label} confidence</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setSelectedGroup(group);
                          setPrimaryPatientId(group.patients[0].patient.id);
                          setMergeDialogOpen(true);
                        }}
                      >
                        <Merge className="w-3 h-3 mr-1" />
                        Review & Merge
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-slate-400"
                        onClick={() => handleDismissGroup(group.id)}
                        title="Dismiss - not duplicates"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-1 mb-2">
                    {group.matchReasons.map((reason, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs bg-white">
                        {reason}
                      </Badge>
                    ))}
                  </div>

                  <div className="space-y-1">
                    {group.patients.map(({ patient, score }) => (
                      <div key={patient.id} className="flex items-center justify-between bg-white p-2 rounded text-sm">
                        <div className="flex items-center gap-3">
                          <span className="font-medium">
                            {patient.first_name} {patient.last_name}
                          </span>
                          <span className="text-slate-500 text-xs">
                            MRN: {patient.medical_record_number || 'N/A'}
                          </span>
                          <span className="text-slate-500 text-xs">
                            DOB: {patient.date_of_birth || 'N/A'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {score}% match
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {dismissedGroups.size > 0 && (
          <div className="text-xs text-slate-500 text-center">
            {dismissedGroups.size} group{dismissedGroups.size !== 1 ? 's' : ''} dismissed •{" "}
            <button 
              className="text-blue-600 hover:underline"
              onClick={() => setDismissedGroups(new Set())}
            >
              Show all
            </button>
          </div>
        )}
      </CardContent>

      {/* Merge Dialog */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review & Merge Duplicate Records</DialogTitle>
          </DialogHeader>
          
          {selectedGroup && (
            <div className="space-y-4">
              <Alert className="bg-yellow-50 border-yellow-200">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800">
                  Select the primary record to keep. All other records will be deleted.
                  Make sure to verify the data before merging.
                </AlertDescription>
              </Alert>

              <div>
                <label htmlFor="primary-record-select" className="text-sm font-medium mb-2 block">
                  Select Primary Record to Keep:
                </label>
                <Select value={primaryPatientId} onValueChange={setPrimaryPatientId}>
                  <SelectTrigger id="primary-record-select">
                    <SelectValue placeholder="Select primary record" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedGroup.patients.map(({ patient }) => (
                      <SelectItem key={patient.id} value={patient.id}>
                        {patient.first_name} {patient.last_name} - MRN: {patient.medical_record_number || 'N/A'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Records Comparison:</p>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {selectedGroup.patients.map(({ patient }) => (
                    <div 
                      key={patient.id} 
                      className={`p-3 rounded-lg border ${
                        patient.id === primaryPatientId 
                          ? 'bg-green-50 border-green-300' 
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">
                          {patient.first_name} {patient.last_name}
                          {patient.id === primaryPatientId && (
                            <Badge className="ml-2 bg-green-100 text-green-800">Primary - Will Keep</Badge>
                          )}
                          {patient.id !== primaryPatientId && (
                            <Badge className="ml-2 bg-red-100 text-red-800">Will Delete</Badge>
                          )}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                        <div><strong>MRN:</strong> {patient.medical_record_number || 'N/A'}</div>
                        <div><strong>DOB:</strong> {patient.date_of_birth || 'N/A'}</div>
                        <div><strong>Phone:</strong> {patient.phone || 'N/A'}</div>
                        <div><strong>Email:</strong> {patient.email || 'N/A'}</div>
                        <div className="col-span-2"><strong>Address:</strong> {patient.address || 'N/A'}</div>
                        <div className="col-span-2"><strong>Diagnosis:</strong> {patient.primary_diagnosis || 'N/A'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleMergePatients}
              disabled={!primaryPatientId || isProcessing}
              className="bg-red-600 hover:bg-red-700"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete Duplicates & Keep Primary
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}