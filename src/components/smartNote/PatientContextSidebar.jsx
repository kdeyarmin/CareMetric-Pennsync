import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, TrendingUp, Target, Pill, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function PatientContextSidebar({ patientId, onInsertContext }) {
  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.get(patientId),
    enabled: !!patientId && patientId !== 'no_patient'
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['activeCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({
      patient_id: patientId,
      status: 'active'
    }),
    enabled: !!patientId && patientId !== 'no_patient'
  });

  const recentNotes = patient?.enhanced_notes_history?.slice(-3) || [];

  if (!patient) return null;

  const insertCarePlanProgress = () => {
    const carePlanText = carePlans.map((cp, i) => 
      `Care Plan ${i + 1}: ${cp.problem}\nGoal: ${cp.goal}\nProgress: [document patient's current status toward this goal]`
    ).join('\n\n');
    onInsertContext(carePlanText);
    toast.success('Care plan goals inserted');
  };

  const insertRecentHistory = () => {
    const historyText = recentNotes.map((note, i) => 
      `Previous Visit ${i + 1} (${new Date(note.date).toLocaleDateString()}):\n${note.enhanced_note?.substring(0, 150)}...`
    ).join('\n\n');
    onInsertContext(historyText);
    toast.success('Previous visit context inserted');
  };

  const insertMedicationList = () => {
    const medsText = patient.current_medications?.map(m => 
      `${m.name} ${m.dosage || ''}`
    ).join('\n') || 'No current medications documented';
    onInsertContext(`Current Medications:\n${medsText}`);
    toast.success('Medication list inserted');
  };

  return (
    <div className="space-y-3">
      <Card className="border-blue-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            Patient Context
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Quick Insert Buttons */}
          <div className="space-y-2">
            {carePlans.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={insertCarePlanProgress}
                className="w-full justify-start text-xs"
              >
                <Target className="w-3 h-3 mr-2" />
                Insert Care Plan Goals ({carePlans.length})
              </Button>
            )}

            {recentNotes.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={insertRecentHistory}
                className="w-full justify-start text-xs"
              >
                <TrendingUp className="w-3 h-3 mr-2" />
                Insert Previous Visits ({recentNotes.length})
              </Button>
            )}

            {patient.current_medications?.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={insertMedicationList}
                className="w-full justify-start text-xs"
              >
                <Pill className="w-3 h-3 mr-2" />
                Insert Medications ({patient.current_medications.length})
              </Button>
            )}
          </div>

          {/* Summary Info */}
          <div className="pt-3 border-t space-y-2 text-xs">
            {patient.allergies && (
              <div className="p-2 bg-red-50 rounded border border-red-200">
                <span className="font-semibold text-red-900">Allergies:</span>
                <p className="text-red-800">{patient.allergies}</p>
              </div>
            )}

            {carePlans.length > 0 && (
              <div>
                <p className="font-semibold mb-1">Active Goals:</p>
                {carePlans.slice(0, 2).map((cp, idx) => (
                  <div key={idx} className="p-2 bg-blue-50 rounded mb-1">
                    <p className="font-medium">{cp.problem}</p>
                    <p className="text-blue-700">{cp.goal}</p>
                  </div>
                ))}
                {carePlans.length > 2 && (
                  <p className="text-blue-600">+{carePlans.length - 2} more</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}