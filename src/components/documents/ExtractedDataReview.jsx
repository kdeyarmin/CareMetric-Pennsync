import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { 
  Database, 
  CheckCircle2, 
  AlertTriangle,
  Pill,
  Activity,
  FileText,
  User
} from "lucide-react";

export default function ExtractedDataReview({ extractedData, patientId, onApply }) {
  const [selected, setSelected] = useState({
    demographics: true,
    diagnoses: true,
    medications: true,
    allergies: true,
    vitals: true,
    procedures: true
  });
  const [applying, setApplying] = useState(false);

  if (!extractedData) return null;

  const hasData = (category) => {
    const data = extractedData[category];
    return data && (Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0);
  };

  const handleApply = async () => {
    if (!patientId) {
      toast.error('Please select a patient first');
      return;
    }

    setApplying(true);
    try {
      const patient = await base44.entities.Patient.get(patientId);
      const updates = {};

      // Demographics
      if (selected.demographics && hasData('demographics')) {
        Object.assign(updates, extractedData.demographics);
      }

      // Diagnoses
      if (selected.diagnoses && hasData('diagnoses')) {
        const newDiagnoses = extractedData.diagnoses.filter(d => d.is_new);
        if (newDiagnoses.length > 0) {
          const currentSecondary = patient.secondary_diagnoses || [];
          updates.secondary_diagnoses = [...currentSecondary, ...newDiagnoses.map(d => d.diagnosis)];
        }
      }

      // Medications
      if (selected.medications && hasData('medications')) {
        const currentMeds = patient.current_medications || [];
        const newMeds = extractedData.medications.filter(m => m.is_new);
        updates.current_medications = [...currentMeds, ...newMeds];
      }

      // Allergies
      if (selected.allergies && hasData('allergies')) {
        const currentAllergies = patient.allergies || '';
        const newAllergies = extractedData.allergies.join(', ');
        updates.allergies = currentAllergies ? `${currentAllergies}, ${newAllergies}` : newAllergies;
      }

      // Vitals
      if (selected.vitals && hasData('vitals')) {
        updates.baseline_vitals = {
          ...patient.baseline_vitals,
          ...extractedData.vitals
        };
      }

      await base44.entities.Patient.update(patientId, updates);
      
      toast.success('Patient data updated successfully');
      onApply?.();
    } catch (error) {
      toast.error('Failed to apply data: ' + error.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Card className="border-2 border-indigo-200 dark:border-indigo-800">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950 dark:to-blue-950">
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5 text-indigo-600" />
          Extracted Patient Data
        </CardTitle>
        <CardDescription>
          Review and approve data to populate patient record
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <Alert>
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>
            Review extracted data carefully before applying. Uncheck any incorrect information.
          </AlertDescription>
        </Alert>

        {/* Demographics */}
        {hasData('demographics') && (
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
            <Checkbox
              checked={selected.demographics}
              onCheckedChange={(checked) => setSelected({ ...selected, demographics: checked })}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <User className="w-4 h-4 text-indigo-600" />
                <span className="font-medium">Demographics</span>
                <Badge variant="outline">Updated</Badge>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                {Object.entries(extractedData.demographics).map(([key, value]) => (
                  <div key={key}>{key.replace(/_/g, ' ')}: {value}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Diagnoses */}
        {hasData('diagnoses') && (
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
            <Checkbox
              checked={selected.diagnoses}
              onCheckedChange={(checked) => setSelected({ ...selected, diagnoses: checked })}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-red-600" />
                <span className="font-medium">Diagnoses</span>
                <Badge className="bg-red-100 text-red-800">
                  {extractedData.diagnoses.filter(d => d.is_new).length} New
                </Badge>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                {extractedData.diagnoses.map((d, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {d.is_new && <Badge variant="outline" className="text-xs">NEW</Badge>}
                    {d.diagnosis} {d.icd10_code && `(${d.icd10_code})`}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Medications */}
        {hasData('medications') && (
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
            <Checkbox
              checked={selected.medications}
              onCheckedChange={(checked) => setSelected({ ...selected, medications: checked })}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Pill className="w-4 h-4 text-green-600" />
                <span className="font-medium">Medications</span>
                <Badge className="bg-green-100 text-green-800">
                  {extractedData.medications.filter(m => m.is_new).length} New
                </Badge>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                {extractedData.medications.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {m.is_new && <Badge variant="outline" className="text-xs">NEW</Badge>}
                    {m.name} {m.dosage} - {m.frequency}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Allergies */}
        {hasData('allergies') && (
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
            <Checkbox
              checked={selected.allergies}
              onCheckedChange={(checked) => setSelected({ ...selected, allergies: checked })}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <span className="font-medium">Allergies</span>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                {extractedData.allergies.join(', ')}
              </div>
            </div>
          </div>
        )}

        {/* Vitals */}
        {hasData('vitals') && (
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
            <Checkbox
              checked={selected.vitals}
              onCheckedChange={(checked) => setSelected({ ...selected, vitals: checked })}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-blue-600" />
                <span className="font-medium">Vital Signs</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm text-slate-600 dark:text-slate-400">
                {Object.entries(extractedData.vitals).map(([key, value]) => (
                  <div key={key}>{key.replace(/_/g, ' ')}: {value}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        <Button 
          onClick={handleApply} 
          disabled={applying || !patientId}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {applying ? 'Applying...' : 'Apply Selected Data to Patient Record'}
        </Button>
      </CardContent>
    </Card>
  );
}