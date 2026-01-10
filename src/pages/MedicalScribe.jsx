import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mic, ArrowRight, Info, CheckCircle2 } from "lucide-react";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
import { todayEastern } from "../components/utils/timezone";
import { getVisitTypesForProvider } from "../components/utils/providerVisitTypeMapping";
import MedicalScribeWithReview from "../components/smartNote/MedicalScribeWithReview";
import SearchablePatientSelect from "../components/ui/SearchablePatientSelect";
import QuickPatientAddDialog from "../components/patient/QuickPatientAddDialog";

const commonDiagnoses = [
  "CHF (Congestive Heart Failure)",
  "COPD (Chronic Obstructive Pulmonary Disease)",
  "Diabetes Mellitus Type 2",
  "Hypertension",
  "Post-operative care",
  "Wound care",
  "Stroke/CVA",
  "Dementia/Alzheimer's",
  "Custom (type below)"
];

export default function MedicalScribe() {
  const queryClient = useQueryClient();
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [visitType, setVisitType] = useState("routine_visit");
  const [diagnosis, setDiagnosis] = useState("");
  const [customDiagnosis, setCustomDiagnosis] = useState("");
  const [generatedNote, setGeneratedNote] = useState("");
  const [showAddPatientDialog, setShowAddPatientDialog] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    },
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: [],
  });

  const finalDiagnosis = diagnosis === "Custom (type below)" ? customDiagnosis : diagnosis;
  const isReady = visitType && finalDiagnosis;

  const handleNoteGenerated = (note) => {
    setGeneratedNote(note);
    logActivity(ActivityActions.NOTE_ENHANCED, {
      patient_id: selectedPatientId,
      visit_type: visitType,
      diagnosis: finalDiagnosis,
      source: 'medical_scribe',
      page: 'MedicalScribe'
    });
  };

  const handlePatientCreated = (newPatient) => {
    queryClient.invalidateQueries({ queryKey: ['patients'] });
    setSelectedPatientId(newPatient.id);
  };

  const handleUseNote = () => {
    if (generatedNote) {
      const noteText = generatedNote;
      const patientParam = selectedPatientId && selectedPatientId !== 'anonymous' ? `&patientId=${selectedPatientId}` : '';
      window.location.href = `/app?redirect=SmartNoteAssistant${patientParam}&preFilledNote=${encodeURIComponent(noteText)}`;
    }
  };

  return (
    <>
    <QuickPatientAddDialog
      open={showAddPatientDialog}
      onOpenChange={setShowAddPatientDialog}
      onPatientCreated={handlePatientCreated}
    />
    <div className="w-full max-w-full overflow-hidden min-w-0">
      <div className="p-2.5 sm:p-4 md:p-6 max-w-5xl mx-auto pb-24 sm:pb-8 w-full overflow-hidden">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-blue-100 rounded-full">
              <Mic className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Medical Scribe</h1>
              <p className="text-sm text-gray-600 mt-1">Record or upload visit audio to auto-generate clinical notes</p>
            </div>
          </div>
        </div>

        {/* Info Card */}
        <Alert className="mb-4 sm:mb-6 bg-blue-50 border-blue-200">
          <Info className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-sm text-blue-800">
            Record your patient visit conversation or upload an audio file. Our AI will transcribe it and generate a Medicare-compliant clinical note that you can review and refine.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Setup Section */}
          <div className="lg:col-span-1">
            <Card className="sticky top-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Setup</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                   <Label className="text-xs sm:text-sm mb-2 block">Patient</Label>
                   <Select value={selectedPatientId} onValueChange={(id) => {
                     if (id === '__add_new__') {
                       setShowAddPatientDialog(true);
                       return;
                     }
                     setSelectedPatientId(id);
                   }}>
                     <SelectTrigger className="h-10 text-sm">
                       <SelectValue placeholder="Select patient..." />
                     </SelectTrigger>
                     <SelectContent>
                       <SelectItem value="__add_new__" className="text-sm font-bold text-blue-600 border-b mb-1">
                         ➕ Add New Patient
                       </SelectItem>
                       <SelectItem value="anonymous" className="text-sm font-medium text-purple-600">
                         🔒 Anonymous (No data saved)
                       </SelectItem>
                       {patients.map(p => (
                         <SelectItem key={p.id} value={p.id} className="text-sm">
                           {p.first_name} {p.last_name}
                         </SelectItem>
                       ))}
                     </SelectContent>
                   </Select>
                 </div>

                <div>
                   <Label className="text-xs sm:text-sm mb-2 block">Visit Type</Label>
                   <Select value={visitType} onValueChange={setVisitType}>
                     <SelectTrigger className="h-10 text-sm">
                       <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                       {getVisitTypesForProvider(currentUser?.credential_type || 'RN').map(vt => (
                         <SelectItem key={vt.id} value={vt.id} className="text-sm" title={vt.description}>
                           {vt.label}
                         </SelectItem>
                       ))}
                     </SelectContent>
                   </Select>
                 </div>

                <div>
                  <Label className="text-xs sm:text-sm mb-2 block">Diagnosis</Label>
                  <Select value={diagnosis} onValueChange={setDiagnosis}>
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {commonDiagnoses.map((dx) => (
                        <SelectItem key={dx} value={dx} className="text-sm">
                          {dx}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {diagnosis === "Custom (type below)" && (
                  <input
                    type="text"
                    placeholder="Enter custom diagnosis"
                    value={customDiagnosis}
                    onChange={(e) => setCustomDiagnosis(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-md"
                  />
                )}

                {!isReady && (
                  <Alert className="bg-yellow-50 border-yellow-200">
                    <AlertDescription className="text-xs text-yellow-800">
                      Select visit type and diagnosis to get started. Patient is optional.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recording Section */}
          <div className="lg:col-span-2">
            {isReady ? (
              <div className="space-y-4">
                <MedicalScribeWithReview
                  diagnosis={finalDiagnosis}
                  visitType={visitType}
                  patientId={selectedPatientId}
                  onNoteGenerated={handleNoteGenerated}
                />
              </div>
            ) : (
              <Card className="border-gray-200 bg-gray-50 h-96 flex items-center justify-center">
                <CardContent className="text-center space-y-3">
                  <div className="p-4 bg-gray-200 rounded-full w-fit mx-auto">
                    <Mic className="w-8 h-8 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Select patient details to begin</p>
                    <p className="text-xs text-gray-600 mt-1">Choose a patient, visit type, and diagnosis from the left panel</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}