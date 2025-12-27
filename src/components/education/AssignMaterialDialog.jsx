import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2 } from "lucide-react";

export default function AssignMaterialDialog({ material, patients, onClose, onAssigned }) {
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [notes, setNotes] = useState("");
  const [success, setSuccess] = useState(false);

  const assignMutation = useMutation({
    mutationFn: async () => {
      return base44.entities.PatientEducationAssignment.create({
        patient_id: selectedPatientId,
        material_id: material.id,
        material_title: material.title,
        material_category: material.category,
        assigned_by: (await base44.auth.me()).email,
        status: "assigned",
        notes,
      });
    },
    onSuccess: () => {
      setSuccess(true);
      setTimeout(() => {
        onAssigned();
      }, 1500);
    },
  });

  const activePatients = patients.filter(p => p.status === 'active' || !p.status);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Educational Material</DialogTitle>
        </DialogHeader>

        {success ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Material successfully assigned to patient!
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-blue-900">{material.title}</p>
              <p className="text-xs text-blue-700 mt-1">{material.category}</p>
            </div>

            <div>
              <Label>Select Patient *</Label>
              <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a patient" />
                </SelectTrigger>
                <SelectContent>
                  {activePatients.map(patient => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.first_name} {patient.last_name}
                      {patient.primary_diagnosis && ` - ${patient.primary_diagnosis}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any specific instructions or context for this patient..."
                rows={3}
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => assignMutation.mutate()}
                disabled={!selectedPatientId || assignMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {assignMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Assigning...
                  </>
                ) : (
                  "Assign Material"
                )}
              </Button>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}