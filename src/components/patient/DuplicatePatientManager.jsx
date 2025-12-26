import React, { useState, useMemo } from "react";
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
  Eye,
  Loader2,
  RefreshCw
} from "lucide-react";

export default function DuplicatePatientManager() {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [primaryPatientId, setPrimaryPatientId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dismissedGroups, setDismissedGroups] = useState(new Set());
  
  const queryClient = useQueryClient();

  const { data: patients = [], isLoading, refetch } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Patient.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    }
  });

  // Find duplicate groups based on matching criteria
  const duplicateGroups = useMemo(() => {
    if (!patients.length) return [];

    const groups = [];
    const processed = new Set();

    patients.forEach((patient, i) => {
      if (processed.has(patient.id)) return;

      const duplicates = patients.filter((other, j) => {
        if (i === j || processed.has(other.id)) return false;
        
        // Calculate match score
        let score = 0;
        let matchReasons = [];

        // Exact MRN match (strongest indicator)
        if (patient.medical_record_number && other.medical_record_number &&
            patient.medical_record_number === other.medical_record_number) {
          score += 50;
          matchReasons.push("Same MRN");
        }

        // Name matching with full name comparison
        const firstName1 = patient.first_name?.toLowerCase().trim() || '';
        const firstName2 = other.first_name?.toLowerCase().trim() || '';
        const lastName1 = patient.last_name?.toLowerCase().trim() || '';
        const lastName2 = other.last_name?.toLowerCase().trim() || '';
        const name1 = `${firstName1} ${lastName1}`;
        const name2 = `${firstName2} ${lastName2}`;
        
        // Exact full name match
        if (name1 === name2 && name1 !== ' ') {
          score += 30;
          matchReasons.push("Same name");
        } else if (firstName1 && lastName1 && firstName2 && lastName2) {
          // Exact last name + similar first name
          if (lastName1 === lastName2) {
            if (firstName1 === firstName2) {
              score += 30;
              matchReasons.push("Same name");
            } else if (firstName1.charAt(0) === firstName2.charAt(0)) {
              score += 20;
              matchReasons.push("Same last name, similar first");
            } else if (Math.abs(firstName1.length - firstName2.length) <= 2) {
              // Check for typos in first name
              let differences = 0;
              const maxLen = Math.max(firstName1.length, firstName2.length);
              for (let i = 0; i < maxLen; i++) {
                if (firstName1[i] !== firstName2[i]) differences++;
              }
              if (differences <= 2) {
                score += 18;
                matchReasons.push("Same last name, first name typo");
              }
            }
          }
          // Similar last name (typo) + exact first name
          else if (firstName1 === firstName2 && Math.abs(lastName1.length - lastName2.length) <= 2) {
            let differences = 0;
            const maxLen = Math.max(lastName1.length, lastName2.length);
            for (let i = 0; i < maxLen; i++) {
              if (lastName1[i] !== lastName2[i]) differences++;
            }
            if (differences <= 2) {
              score += 20;
              matchReasons.push("Same first name, last name typo");
            }
          }
          // Check for name reversal (first/last swapped)
          else if (firstName1 === lastName2 && lastName1 === firstName2) {
            score += 25;
            matchReasons.push("Names reversed");
          }
        }

        // Exact DOB match
        if (patient.date_of_birth && other.date_of_birth &&
            patient.date_of_birth === other.date_of_birth) {
          score += 25;
          matchReasons.push("Same DOB");
        }

        // Same address
        if (patient.address && other.address &&
            patient.address.toLowerCase().trim() === other.address.toLowerCase().trim()) {
          score += 10;
          matchReasons.push("Same address");
        }

        // Same phone
        const phone1 = patient.phone?.replace(/\D/g, '') || '';
        const phone2 = other.phone?.replace(/\D/g, '') || '';
        if (phone1 && phone2 && phone1 === phone2) {
          score += 10;
          matchReasons.push("Same phone");
        }

        return score >= 40 ? { patient: other, score, matchReasons } : null;
      }).filter(d => d && d.patient);

      if (duplicates.length > 0) {
        const group = {
          id: `group-${patient.id}`,
          patients: [
            { patient, score: 100, matchReasons: ["Primary"] },
            ...duplicates
          ],
          highestScore: Math.max(...duplicates.map(d => d.score)),
          matchReasons: [...new Set(duplicates.flatMap(d => d.matchReasons))]
        };
        
        groups.push(group);
        duplicates.forEach(d => {
          if (d && d.patient && d.patient.id) {
            processed.add(d.patient.id);
          }
        });
        processed.add(patient.id);
      }
    });

    return groups.filter(g => !dismissedGroups.has(g.id));
  }, [patients, dismissedGroups]);

  const handleDeleteDuplicate = async (patientId) => {
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

      // Delete all other patients in the group
      const otherPatients = selectedGroup.patients.filter(p => p.patient.id !== primaryPatientId);
      for (const { patient } of otherPatients) {
        await deleteMutation.mutateAsync(patient.id);
      }

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
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
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
                        className="h-7 w-7 p-0 text-gray-400"
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
                          <span className="text-gray-500 text-xs">
                            MRN: {patient.medical_record_number || 'N/A'}
                          </span>
                          <span className="text-gray-500 text-xs">
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
          <div className="text-xs text-gray-500 text-center">
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
                <label className="text-sm font-medium mb-2 block">
                  Select Primary Record to Keep:
                </label>
                <Select value={primaryPatientId} onValueChange={setPrimaryPatientId}>
                  <SelectTrigger>
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
                          : 'bg-gray-50 border-gray-200'
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
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
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