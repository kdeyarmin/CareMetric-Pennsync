import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mic, ArrowRight, Info, CheckCircle2, User, FileText, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
import { todayEastern } from "../components/utils/timezone";
import { getVisitTypesForProvider } from "../components/utils/providerVisitTypeMapping";
import MedicalScribeWithReview from "../components/smartNote/MedicalScribeWithReview";
import SearchablePatientSelect from "../components/ui/SearchablePatientSelect";
import QuickPatientAddDialog from "../components/patient/QuickPatientAddDialog";
import NoteTemplateSelector from "../components/smartNote/NoteTemplateSelector";
import LanguageSelector from "../components/scribe/LanguageSelector";
import TerminologyGlossaryManager from "../components/scribe/TerminologyGlossaryManager";
import { Badge } from "@/components/ui/badge";

const commonDiagnoses = [
"CHF (Congestive Heart Failure)",
"COPD (Chronic Obstructive Pulmonary Disease)",
"Diabetes Mellitus Type 2",
"Hypertension",
"Post-operative care",
"Wound care",
"Stroke/CVA",
"Dementia/Alzheimer's",
"Custom (type below)"];


export default function MedicalScribe() {
  const queryClient = useQueryClient();
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [visitType, setVisitType] = useState("routine_visit");
  const [diagnosis, setDiagnosis] = useState("");
  const [customDiagnosis, setCustomDiagnosis] = useState("");
  const [generatedNote, setGeneratedNote] = useState("");
  const [showAddPatientDialog, setShowAddPatientDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const navigate = useNavigate();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    }
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  // Fetch selected patient data for context
  const { data: selectedPatient } = useQuery({
    queryKey: ['patient', selectedPatientId],
    queryFn: () => base44.entities.Patient.get(selectedPatientId),
    enabled: !!selectedPatientId && selectedPatientId !== 'anonymous',
  });

  // Fetch recent visits for context
  const { data: recentVisits = [] } = useQuery({
    queryKey: ['recentVisits', selectedPatientId],
    queryFn: async () => {
      const visits = await base44.entities.Visit.filter({ patient_id: selectedPatientId });
      return visits.slice(0, 3); // Last 3 visits
    },
    enabled: !!selectedPatientId && selectedPatientId !== 'anonymous',
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
      sessionStorage.setItem('preFilledNote', generatedNote);
      const patientParam = selectedPatientId && selectedPatientId !== 'anonymous' ? `&patientId=${selectedPatientId}` : '';
      navigate(`${createPageUrl("SmartNoteAssistant")}?fromScribe=true${patientParam}`);
    }
  };

  return (
    <>
    <QuickPatientAddDialog
        open={showAddPatientDialog}
        onOpenChange={setShowAddPatientDialog}
        onPatientCreated={handlePatientCreated} />

    <div className="w-full max-w-full overflow-hidden min-w-0">
      <div className="p-2 sm:p-4 md:p-6 max-w-5xl mx-auto pb-24 sm:pb-8 w-full overflow-hidden">
         {/* Header */}
         <div className="mb-3 sm:mb-6">
           <div className="flex items-center gap-2 sm:gap-3 mb-2">
             <div className="p-2 sm:p-2.5 bg-slate-200 dark:bg-slate-700 rounded-full flex-shrink-0">
               <Mic className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700 dark:text-slate-300" />
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 truncate">Visit Scribe</h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 hidden sm:block">Record or upload visit audio to auto-generate clinical notes</p>
            </div>
          </div>
        </div>

        {/* Info Card */}
        <Alert className="mb-3 sm:mb-6 bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-600">
          <Info className="w-4 h-4 text-slate-700 dark:text-slate-400 flex-shrink-0" />
          <AlertDescription className="text-xs sm:text-sm text-slate-900 dark:text-slate-100 ml-2">
            Record your patient visit conversation or upload an audio file. Our AI will transcribe it and generate a Medicare-compliant clinical note that you can review and refine.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6 w-full overflow-hidden">
          {/* Setup Section */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="lg:sticky lg:top-4 overflow-hidden">
              <CardHeader className="bg-slate-200 pb-2 p-6 flex flex-col space-y-1.5 sm:pb-3">
                <CardTitle className="text-sm sm:text-base">Setup</CardTitle>
              </CardHeader>
              <CardContent className="bg-slate-100 pt-0 p-6 space-y-3 sm:space-y-4">
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
                       <SelectItem value="__add_new__" className="text-sm font-bold text-slate-700 dark:text-slate-300 border-b mb-1">
                         ➕ Add New Patient
                       </SelectItem>
                       <SelectItem value="anonymous" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                         🔒 Anonymous (No data saved)
                       </SelectItem>
                       {patients.map((p) =>
                        <SelectItem key={p.id} value={p.id} className="text-sm">
                           {p.first_name} {p.last_name}
                         </SelectItem>
                        )}
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
                       {getVisitTypesForProvider(currentUser?.credential_type || 'RN').map((vt) =>
                        <SelectItem key={vt.id} value={vt.id} className="text-sm" title={vt.description}>
                           {vt.label}
                         </SelectItem>
                        )}
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
                      {commonDiagnoses.map((dx) =>
                        <SelectItem key={dx} value={dx} className="text-sm">
                          {dx}
                        </SelectItem>
                        )}
                    </SelectContent>
                  </Select>
                </div>

                {diagnosis === "Custom (type below)" &&
                  <input
                    type="text"
                    placeholder="Enter custom diagnosis"
                    value={customDiagnosis}
                    onChange={(e) => setCustomDiagnosis(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-md" />

                  }

                <LanguageSelector
                    value={selectedLanguage}
                    onChange={setSelectedLanguage} />


                {!isReady &&
                  <Alert className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-600">
                    <AlertDescription className="text-xs text-slate-900 dark:text-slate-100">
                      Select visit type and diagnosis to get started. Patient is optional.
                    </AlertDescription>
                  </Alert>
                  }
              </CardContent>
              </Card>

              {/* Patient Context Card */}
              {selectedPatient && (
              <Card>
                <CardHeader className="bg-blue-50 dark:bg-blue-950 pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Patient Context
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  <div className="text-xs space-y-2">
                    <div>
                      <span className="font-semibold">Age:</span>{' '}
                      {selectedPatient.date_of_birth 
                        ? Math.floor((Date.now() - new Date(selectedPatient.date_of_birth)) / 31557600000) 
                        : 'N/A'} years
                    </div>
                    {selectedPatient.primary_diagnosis && (
                      <div>
                        <span className="font-semibold">Primary Dx:</span>{' '}
                        {selectedPatient.primary_diagnosis}
                      </div>
                    )}
                    {selectedPatient.allergies && (
                      <div>
                        <span className="font-semibold">Allergies:</span>{' '}
                        <span className="text-red-600 dark:text-red-400">{selectedPatient.allergies}</span>
                      </div>
                    )}
                    {selectedPatient.current_medications?.length > 0 && (
                      <div>
                        <span className="font-semibold">Current Meds:</span>
                        <ul className="ml-3 mt-1 space-y-0.5">
                          {selectedPatient.current_medications.slice(0, 5).map((med, idx) => (
                            <li key={idx}>• {med.name} {med.dosage}</li>
                          ))}
                          {selectedPatient.current_medications.length > 5 && (
                            <li className="text-blue-600 dark:text-blue-400">
                              +{selectedPatient.current_medications.length - 5} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>

                  {recentVisits.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        Recent Visits
                      </p>
                      <div className="space-y-1">
                        {recentVisits.map((visit, idx) => (
                          <div key={idx} className="text-xs bg-slate-100 dark:bg-slate-800 p-2 rounded">
                            <div className="font-medium">{visit.visit_type?.replace(/_/g, ' ')}</div>
                            <div className="text-slate-600 dark:text-slate-400">
                              {new Date(visit.visit_date).toLocaleDateString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              )}

              {currentUser && (
              <TerminologyGlossaryManager
                userEmail={currentUser.email}
                selectedLanguage={selectedLanguage}
              />
              )}
              </div>

          {/* Recording Section */}
          <div className="lg:col-span-2">
            {isReady ?
              <div className="space-y-4">
                <NoteTemplateSelector
                  visitType={visitType}
                  providerType={currentUser?.credential_type || 'RN'}
                  onTemplateSelect={setSelectedTemplate}
                  onTemplateApply={setSelectedTemplate} />

                <MedicalScribeWithReview
                  diagnosis={finalDiagnosis}
                  visitType={visitType}
                  patientId={selectedPatientId}
                  selectedTemplate={selectedTemplate}
                  selectedLanguage={selectedLanguage}
                  patientContext={selectedPatient}
                  recentVisits={recentVisits}
                  onNoteGenerated={handleNoteGenerated} />

              </div> :

              <Card className="border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 h-96 flex items-center justify-center">
                <CardContent className="text-center space-y-3">
                  <div className="p-4 bg-slate-300 dark:bg-slate-700 rounded-full w-fit mx-auto">
                    <Mic className="w-8 h-8 text-slate-700 dark:text-slate-300" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Select patient details to begin</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Choose a patient, visit type, and diagnosis from the left panel</p>
                  </div>
                </CardContent>
              </Card>
              }
          </div>
        </div>
      </div>
    </div>
    </>);

}