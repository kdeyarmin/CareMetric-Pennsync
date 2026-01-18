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
  const [selectedItems, setSelectedItems] = useState({});
  const [applying, setApplying] = useState(false);
  const [appliedChanges, setAppliedChanges] = useState([]);
  const [showChangeLog, setShowChangeLog] = useState(false);

  const { data: currentUser } = base44.auth.me?.() || {};

  // Initialize selections on first render
  React.useEffect(() => {
    const initSelections = {};
    if (extractedData?.diagnoses?.length) {
      extractedData.diagnoses.forEach((_, idx) => {
        initSelections[`diagnosis_${idx}`] = true;
      });
    }
    if (extractedData?.medications?.length) {
      extractedData.medications.forEach((_, idx) => {
        initSelections[`medication_${idx}`] = true;
      });
    }
    if (extractedData?.allergies?.length) {
      extractedData.allergies.forEach((_, idx) => {
        initSelections[`allergy_${idx}`] = true;
      });
    }
    if (extractedData?.vital_signs) {
      Object.keys(extractedData.vital_signs).forEach(key => {
        initSelections[`vital_${key}`] = true;
      });
    }
    if (extractedData?.lab_results?.length) {
      extractedData.lab_results.forEach((_, idx) => {
        initSelections[`lab_${idx}`] = true;
      });
    }
    if (extractedData?.demographics) {
      initSelections['demographics'] = true;
    }
    if (extractedData?.clinical_summary) {
      initSelections['clinical_notes'] = true;
    }
    setSelectedItems(initSelections);
  }, [extractedData]);

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

    const selectedCount = Object.values(selectedItems).filter(Boolean).length;
    if (selectedCount === 0) {
      toast.error('Please select at least one item to apply');
      return;
    }

    setApplying(true);
    const changes = [];

    try {
      const patient = await base44.entities.Patient.get(patientId);
      const updates = {};

      // Demographics
      if (selectedItems.demographics && extractedData?.demographics) {
        Object.assign(updates, extractedData.demographics);
        changes.push({
          type: 'demographics',
          item: 'Patient Demographics',
          action: 'update',
          newValue: extractedData.demographics
        });
      }

      // Diagnoses
      if (extractedData?.diagnoses?.length) {
        const selectedDiagnoses = extractedData.diagnoses.filter((d, idx) =>
          selectedItems[`diagnosis_${idx}`]
        );
        if (selectedDiagnoses.length > 0) {
          const currentSecondary = patient.secondary_diagnoses || [];
          const newDiagnosisTexts = selectedDiagnoses.map(d => d.diagnosis);
          updates.secondary_diagnoses = [...currentSecondary, ...newDiagnosisTexts];

          selectedDiagnoses.forEach(d => {
            changes.push({
              type: 'diagnosis',
              item: d.diagnosis,
              action: 'append',
              newValue: { diagnosis: d.diagnosis, icd10_code: d.icd10_code }
            });
          });
        }
      }

      // Medications
      if (extractedData?.medications?.length) {
        const selectedMeds = extractedData.medications.filter((m, idx) =>
          selectedItems[`medication_${idx}`]
        );
        if (selectedMeds.length > 0) {
          const currentMeds = patient.current_medications || [];
          updates.current_medications = [...currentMeds, ...selectedMeds];

          selectedMeds.forEach(m => {
            changes.push({
              type: 'medication',
              item: m.name,
              action: 'append',
              newValue: { name: m.name, dosage: m.dosage, frequency: m.frequency }
            });
          });
        }
      }

      // Allergies
      if (extractedData?.allergies?.length) {
        const selectedAllergies = extractedData.allergies.filter((_, idx) =>
          selectedItems[`allergy_${idx}`]
        );
        if (selectedAllergies.length > 0) {
          const currentAllergies = patient.allergies || '';
          const newAllergiesText = selectedAllergies.join(', ');
          updates.allergies = currentAllergies ? `${currentAllergies}, ${newAllergiesText}` : newAllergiesText;

          selectedAllergies.forEach(allergy => {
            changes.push({
              type: 'allergy',
              item: allergy,
              action: 'append',
              newValue: allergy
            });
          });
        }
      }

      // Vital Signs
      if (extractedData?.vital_signs) {
        const selectedVitals = {};
        Object.entries(extractedData.vital_signs).forEach(([key, value]) => {
          if (selectedItems[`vital_${key}`]) {
            selectedVitals[key] = value;
            changes.push({
              type: 'vital_sign',
              item: key.replace(/_/g, ' '),
              action: 'update',
              newValue: value
            });
          }
        });
        if (Object.keys(selectedVitals).length > 0) {
          updates.baseline_vitals = {
            ...patient.baseline_vitals,
            ...selectedVitals
          };
        }
      }

      // Lab Results
      if (extractedData?.lab_results?.length && selectedItems.clinical_notes) {
        const selectedLabs = extractedData.lab_results.filter((_, idx) =>
          selectedItems[`lab_${idx}`]
        );
        selectedLabs.forEach(lab => {
          changes.push({
            type: 'lab_result',
            item: lab.test_name,
            action: 'create',
            newValue: lab
          });
        });
      }

      // Clinical Notes
      if (selectedItems.clinical_notes && extractedData?.clinical_summary) {
        const currentNotes = patient.clinical_notes || "";
        const timestamp = new Date().toISOString();
        const noteEntry = `\n\n[${timestamp} - Document Analyzer]\n${extractedData.clinical_summary}`;
        updates.clinical_notes = currentNotes + noteEntry;
        changes.push({
          type: 'clinical_note',
          item: 'Clinical Notes',
          action: 'append',
          newValue: extractedData.clinical_summary
        });
      }

      // Apply updates to patient
      if (Object.keys(updates).length > 0) {
        await base44.entities.Patient.update(patientId, updates);
      }

      // Log all changes
      const user = await base44.auth.me();
      for (const change of changes) {
        try {
          await base44.asServiceRole.entities.AppliedDataLog.create({
            patient_id: patientId,
            data_type: change.type,
            item_name: change.item,
            new_value: change.newValue,
            action: change.action,
            target_entity: 'Patient',
            applied_by: user?.email,
            applied_date: new Date().toISOString(),
            notes: `Applied from document analysis`
          });
        } catch (logErr) {
          console.warn('Failed to log change:', logErr);
        }
      }

      setAppliedChanges(changes);
      setShowChangeLog(true);
      toast.success(`Applied ${changes.length} data item(s) to patient record`);
      setTimeout(() => onApply?.(), 1500);
    } catch (error) {
      console.error('Apply error:', error);
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
        {extractedData?.diagnoses?.length > 0 && (
          <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg space-y-2 border border-red-200 dark:border-red-800">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-red-600" />
              <span className="font-semibold text-red-900 dark:text-red-100">Diagnoses</span>
              <Badge className="bg-red-100 text-red-800 text-xs">
                {extractedData.diagnoses.filter((_, idx) => selectedItems[`diagnosis_${idx}`]).length} selected
              </Badge>
            </div>
            <div className="space-y-2 ml-6">
              {extractedData.diagnoses.map((d, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <Checkbox
                    id={`diagnosis_${idx}`}
                    checked={selectedItems[`diagnosis_${idx}`] || false}
                    onCheckedChange={(checked) => setSelectedItems({
                      ...selectedItems,
                      [`diagnosis_${idx}`]: checked
                    })}
                    className="mt-1"
                  />
                  <label htmlFor={`diagnosis_${idx}`} className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer flex-1">
                    <span className="font-medium">{d.diagnosis}</span>
                    {d.icd10_code && <span className="text-slate-500"> ({d.icd10_code})</span>}
                    {d.is_new && <Badge variant="outline" className="ml-2 text-xs">NEW</Badge>}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Medications */}
        {extractedData?.medications?.length > 0 && (
          <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg space-y-2 border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2">
              <Pill className="w-4 h-4 text-green-600" />
              <span className="font-semibold text-green-900 dark:text-green-100">Medications</span>
              <Badge className="bg-green-100 text-green-800 text-xs">
                {extractedData.medications.filter((_, idx) => selectedItems[`medication_${idx}`]).length} selected
              </Badge>
            </div>
            <div className="space-y-2 ml-6">
              {extractedData.medications.map((m, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <Checkbox
                    id={`medication_${idx}`}
                    checked={selectedItems[`medication_${idx}`] || false}
                    onCheckedChange={(checked) => setSelectedItems({
                      ...selectedItems,
                      [`medication_${idx}`]: checked
                    })}
                    className="mt-1"
                  />
                  <label htmlFor={`medication_${idx}`} className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer flex-1">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-slate-500">{m.dosage} • {m.frequency}</div>
                    {m.prescriber && <div className="text-xs text-slate-500">Prescriber: {m.prescriber}</div>}
                    {m.is_new && <Badge variant="outline" className="mt-1 text-xs">NEW</Badge>}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Allergies */}
        {extractedData?.allergies?.length > 0 && (
          <div className="p-3 bg-orange-50 dark:bg-orange-950 rounded-lg space-y-2 border border-orange-200 dark:border-orange-800">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <span className="font-semibold text-orange-900 dark:text-orange-100">Allergies</span>
              <Badge className="bg-orange-100 text-orange-800 text-xs">
                {extractedData.allergies.filter((_, idx) => selectedItems[`allergy_${idx}`]).length} selected
              </Badge>
            </div>
            <div className="space-y-2 ml-6">
              {extractedData.allergies.map((allergy, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Checkbox
                    id={`allergy_${idx}`}
                    checked={selectedItems[`allergy_${idx}`] || false}
                    onCheckedChange={(checked) => setSelectedItems({
                      ...selectedItems,
                      [`allergy_${idx}`]: checked
                    })}
                  />
                  <label htmlFor={`allergy_${idx}`} className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer flex-1">
                    {allergy}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vital Signs */}
        {extractedData?.vital_signs && Object.keys(extractedData.vital_signs).length > 0 && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg space-y-2 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              <span className="font-semibold text-blue-900 dark:text-blue-100">Vital Signs</span>
              <Badge className="bg-blue-100 text-blue-800 text-xs">
                {Object.keys(extractedData.vital_signs).filter(key => selectedItems[`vital_${key}`]).length} selected
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 ml-6">
              {Object.entries(extractedData.vital_signs).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`vital_${key}`}
                    checked={selectedItems[`vital_${key}`] || false}
                    onCheckedChange={(checked) => setSelectedItems({
                      ...selectedItems,
                      [`vital_${key}`]: checked
                    })}
                  />
                  <label htmlFor={`vital_${key}`} className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                    {key.replace(/_/g, ' ')}: <span className="font-medium">{value}</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clinical Notes */}
        {extractedData?.clinical_summary && (
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950 rounded-lg space-y-2 border border-indigo-200 dark:border-indigo-800">
            <div className="flex items-start gap-2">
              <Checkbox
                id="clinical_notes"
                checked={selectedItems.clinical_notes || false}
                onCheckedChange={(checked) => setSelectedItems({
                  ...selectedItems,
                  clinical_notes: checked
                })}
                className="mt-1"
              />
              <div className="flex-1">
                <label htmlFor="clinical_notes" className="flex items-center gap-2 cursor-pointer mb-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span className="font-semibold text-indigo-900 dark:text-indigo-100">Clinical Notes</span>
                </label>
                <p className="text-sm text-indigo-800 dark:text-indigo-200 line-clamp-3">
                  {extractedData.clinical_summary}
                </p>
              </div>
            </div>
          </div>
        )}

        <Button 
          onClick={handleApply} 
          disabled={applying || !patientId || !Object.values(selectedItems).some(Boolean)}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {applying ? 'Applying...' : `Apply ${Object.values(selectedItems).filter(Boolean).length} Selected Item(s)`}
        </Button>

        {showChangeLog && appliedChanges.length > 0 && (
          <Card className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 mt-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Applied Changes ({appliedChanges.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {appliedChanges.map((change, idx) => (
                <div key={idx} className="text-sm p-2 bg-white dark:bg-slate-900 rounded">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{change.item}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {change.action.charAt(0).toUpperCase() + change.action.slice(1)} • {change.type.replace(/_/g, ' ')}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}