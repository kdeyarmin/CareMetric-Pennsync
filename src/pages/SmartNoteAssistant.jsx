import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertCircle,
  Brain,
  Wand2,
  Users,
  X,
  AlertTriangle,
  Loader2,
  Plus,
  ShieldAlert,
  ListTodo,
  Clock,
  Settings
  } from "lucide-react";
import { getVisitTypesForProvider } from "@/components/utils/providerVisitTypeMapping";
import { toast } from "sonner";
import { getProviderCompliancePrompt } from "@/components/utils/providerSpecificConfig";
import { getEnhanceNotePrompt } from "@/components/utils/prompts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CarePlanSuggestionsPanel from "@/components/smartNote/CarePlanSuggestionsPanel";
import NoteTemplateSelector from "@/components/smartNote/NoteTemplateSelector";

import AutoPopulateDataFields from "@/components/smartNote/AutoPopulateDataFields";
import AIFollowUpTasksGenerator from "@/components/smartNote/AIFollowUpTasksGenerator";
import EnhancedICD10Suggester from "@/components/clinical/EnhancedICD10Suggester";
import InteractiveQualitySuggestions from "@/components/smartNote/InteractiveQualitySuggestions";
import VisitTypeGuidance from "@/components/smartNote/VisitTypeGuidance";
import CodeSearchInserter from "@/components/smartNote/CodeSearchInserter";
import AIPreferencesPanel from "@/components/smartNote/AIPreferencesPanel";

import MedicalCodingAssistant from "@/components/smartNote/MedicalCodingAssistant.jsx";

import RegulatoryComplianceMonitor from "@/components/smartNote/RegulatoryComplianceMonitor";
import EducationLibraryBrowser from "@/components/education/EducationLibraryBrowser";
import PatientEducationPanel from "@/components/education/PatientEducationPanel";
import VoiceNoteRecorder from "@/components/smartNote/VoiceNoteRecorder";
import VoiceDictationInput from "@/components/smartNote/VoiceDictationInput";
import ClinicalInsightsPanel from "@/components/smartNote/ClinicalInsightsPanel";
import DocumentationQualityScore from "@/components/smartNote/DocumentationQualityScore";
import PersonalizedEducationGenerator from "@/components/education/PersonalizedEducationGenerator";
import EducationTrackingHistory from "@/components/education/EducationTrackingHistory";
import OfflineNoteCapture from "@/components/mobile/OfflineNoteCapture";

export default function SmartNoteAssistant() {
  const [selectedPatient, setSelectedPatient] = useState("no_patient");
  const [showCreatePatient, setShowCreatePatient] = useState(false);
  const [visitType, setVisitType] = useState("");
  const [selectedDiagnosis, setSelectedDiagnosis] = useState("");
  const [diagnosisSearch, setDiagnosisSearch] = useState("");
  const [roughNotes, setRoughNotes] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedNote, setEnhancedNote] = useState(null);
  const [complianceResults, setComplianceResults] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [medicareViolations, setMedicareViolations] = useState([]);
  const [regulatoryWarnings, setRegulatoryWarnings] = useState([]);
  const [clinicalInsights, setClinicalInsights] = useState(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [newPatientData, setNewPatientData] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    medical_record_number: ""
  });
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [vitalSigns, setVitalSigns] = useState({
    temperature: "",
    heart_rate: "",
    respiratory_rate: "",
    bp_systolic: "",
    bp_diastolic: "",
    oxygen_saturation: ""
  });
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedNote, setEditedNote] = useState("");
  const [savingToPatient, setSavingToPatient] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [suggestedEducation, setSuggestedEducation] = useState([]);
  const [providedEducation, setProvidedEducation] = useState([]);
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('fromScribe') === 'true') {
        const preFilledNote = sessionStorage.getItem('preFilledNote');
        if (preFilledNote) {
            setRoughNotes(preFilledNote);
            sessionStorage.removeItem('preFilledNote');
        }
    }
  }, [location]);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ["allPatients"],
    queryFn: async () => {
      return await base44.entities.Patient.list('-updated_date', 500);
    }
  });

  const { data: customComplianceRules = [] } = useQuery({
    queryKey: ['activeComplianceRules'],
    queryFn: async () => {
      const rules = await base44.entities.ComplianceRule.list('-created_date', 500);
      return rules.filter(rule => rule.is_active);
    }
  });

  // Fetch user AI preferences
  const { data: aiPreferences } = useQuery({
    queryKey: ['aiPreferences', currentUser?.email],
    queryFn: async () => {
      const prefs = await base44.entities.AIConfiguration.filter({
        user_email: currentUser?.email
      });
      return prefs[0] || null;
    },
    enabled: !!currentUser?.email
  });

  const createNewPatient = async () => {
    if (!newPatientData.first_name.trim() || !newPatientData.last_name.trim()) {
      toast.error("First and last name are required");
      return;
    }

    setCreatingPatient(true);
    try {
      const created = await base44.entities.Patient.create({
        first_name: newPatientData.first_name,
        last_name: newPatientData.last_name,
        date_of_birth: newPatientData.date_of_birth || null,
        medical_record_number: newPatientData.medical_record_number || ""
      });

      setSelectedPatient(created.id);
      setShowCreatePatient(false);
      setNewPatientData({
        first_name: "",
        last_name: "",
        date_of_birth: "",
        medical_record_number: ""
      });
      toast.success("Patient created successfully");
    } catch (error) {
      toast.error("Failed to create patient");
      console.error(error);
    } finally {
      setCreatingPatient(false);
    }
  };

  const enhanceNote = async () => {
     console.log('🔵 ENHANCE NOTE STARTED');
     if (!roughNotes.trim()) {
       toast.error("Please enter clinical notes");
       return;
     }

     if (!visitType) {
       toast.error("Please select a visit type");
       return;
     }

     if (!selectedDiagnosis) {
       toast.error("Please select a diagnosis");
       return;
     }

     const loadingToast = toast.loading("Enhancing note and analyzing quality...");
     setEnhancing(true);
     setEnhancedNote(null);
     setComplianceResults(null);
     setShowResults(false);
     setMedicareViolations([]);
     setRegulatoryWarnings([]);
     setSuggestedTasks([]);

     try {
       console.log('🔵 Getting compliance prompt for:', currentUser?.credential_type, visitType);
       const compliancePrompt = getProviderCompliancePrompt(currentUser?.credential_type || 'RN', visitType);
       console.log('✅ Compliance prompt received');

       // Filter custom rules applicable to this visit type
       const applicableRules = customComplianceRules.filter(rule => {
         if (!rule.applies_to_visit_types || rule.applies_to_visit_types.length === 0) return true;
         return rule.applies_to_visit_types.includes(visitType);
       });
       console.log('✅ Applicable rules:', applicableRules.length);

       // Gather enhanced patient context
       let patientContext = null;
       if (selectedPatient !== 'no_patient' && patientData) {
         console.log('🔵 Building patient context for:', patientData.id);
         const recentNotes = (patientData.enhanced_notes_history || []).slice(-3);
         const carePlans = await base44.entities.CarePlan.filter({
           patient_id: patientData.id,
           status: 'active'
         });

         patientContext = {
           patient_name: `${patientData.first_name} ${patientData.last_name}`,
           primary_diagnosis: patientData.primary_diagnosis,
           secondary_diagnoses: patientData.secondary_diagnoses || [],
           allergies: patientData.allergies,
           current_medications: patientData.current_medications || [],
           recent_notes: recentNotes.map(note => ({
             date: note.date,
             visit_type: note.visit_type,
             diagnosis: note.diagnosis,
             note_excerpt: note.enhanced_note?.substring(0, 300)
           })),
           active_care_plans: carePlans.map(cp => ({
             problem: cp.problem,
             goal: cp.goal,
             status: cp.status
           }))
         };
         console.log('✅ Patient context built');
       }

       // Single consolidated backend call with vital signs, patient context, and AI preferences
       console.log('🔵 Calling enhanceNoteWithQuality function...');
       const response = await base44.functions.invoke('enhanceNoteWithQuality', {
          rough_notes: roughNotes,
          visit_type: visitType,
          diagnosis: selectedDiagnosis,
          provider_type: currentUser?.credential_type || 'RN',
          compliance_prompt: compliancePrompt,
          custom_rules: applicableRules,
          patient_id: selectedPatient !== 'no_patient' ? selectedPatient : null,
          vital_signs: vitalSigns,
          patient_context: patientContext,
          ai_preferences: aiPreferences
        });

        // Apply user's learned preferences to refine the note
        let refinedResponse = response;
        try {
          const preferencesResponse = await base44.functions.invoke('applyLearnedPreferences', {
            enhanced_note: response.data?.enhanced_note || response.enhanced_note,
            provider_type: currentUser?.credential_type || 'RN',
            visit_type: visitType,
            suggested_suggestions: response.data?.quality_analysis?.suggestions || []
          });
          if (preferencesResponse.data?.enhanced_note) {
            refinedResponse.data.enhanced_note = preferencesResponse.data.enhanced_note;
            console.log('✅ Applied learned preferences to note');
          }
        } catch (prefError) {
          console.error('Warning: Could not apply learned preferences:', prefError);
          // Continue without learned preferences
        }

       console.log('✅ Function response received:', response);
       // Handle nested response structure: response.data.data contains the actual result
       const result = response.data?.data || response.data || response;
       console.log('✅ Result extracted:', result);
       console.log('📋 FULL RESULT STRUCTURE:', JSON.stringify(result, null, 2));
       
       // Debug individual fields
       console.log('🔍 enhanced_note:', result.enhanced_note);
       console.log('🔍 compliance_check:', result.compliance_check);
       console.log('🔍 quality_analysis:', result.quality_analysis);
       console.log('🔍 suggested_tasks:', result.suggested_tasks);
       console.log('🔍 suggested_education_materials:', result.suggested_education_materials);

       // Update all state with consolidated results
       console.log('🔵 Updating state...');
       const finalNote = refinedResponse.data?.enhanced_note || result.enhanced_note;
       setExtractedData(result.extracted_data);
       setEnhancedNote(finalNote);
       setEditedNote(finalNote);
       setComplianceResults({
         ...result.compliance_check,
         quality_analysis: result.quality_analysis
       });
       setMedicareViolations(result.compliance_check?.medicare_violations || []);
       setRegulatoryWarnings(result.compliance_check?.regulatory_warnings || []);
       setSuggestedTasks(result.suggested_tasks || []);
       setSuggestedEducation(result.suggested_education_materials || []);

       // Generate clinical insights in background
       generateClinicalInsights(finalNote, result.extracted_data);

       console.log('🔵 STATE AFTER UPDATES:');
       console.log('  - enhancedNote will be:', result.enhanced_note);
       console.log('  - complianceResults will be:', {...result.compliance_check, quality_analysis: result.quality_analysis});
       console.log('✅ State updated, setting showResults to true');
       setShowResults(true);
       setIsEditMode(false);

       toast.dismiss(loadingToast);
       if (result.compliance_check?.compliance_score >= 85) {
         toast.success("Note enhanced - Medicare compliant!");
       } else {
         toast.warning("Note enhanced - Review compliance warnings");
       }
       console.log('✅ ENHANCE NOTE COMPLETED SUCCESSFULLY');
     } catch (error) {
       console.error('❌ ERROR enhancing note:', error);
       console.error('Error stack:', error.stack);
       toast.dismiss(loadingToast);
       toast.error(`Failed to enhance note: ${error.message || 'Unknown error'}`);
     } finally {
       setEnhancing(false);
     }
   };

  const availableVisitTypes = currentUser?.credential_type ?
  getVisitTypesForProvider(currentUser.credential_type) :
  [];

  // Common diagnoses list
  const commonDiagnoses = [
  "Congestive Heart Failure (CHF)",
  "Chronic Obstructive Pulmonary Disease (COPD)",
  "Diabetes Mellitus Type 2",
  "Hypertension",
  "Pneumonia",
  "Urinary Tract Infection (UTI)",
  "Wound Care - Pressure Ulcer",
  "Post-Surgical Care",
  "Chronic Kidney Disease",
  "Dementia/Alzheimer's Disease",
  "Stroke/CVA Recovery",
  "Cancer Care",
  "Palliative Care",
  "Chronic Pain Management",
  "Sepsis",
  "Cellulitis",
  "Dehydration",
  "Fall Risk/Fall Injury",
  "Malnutrition",
  "Depression"];


  const filteredDiagnoses = diagnosisSearch.trim() ?
  commonDiagnoses.filter((d) =>
  d.toLowerCase().includes(diagnosisSearch.toLowerCase())
  ) :
  commonDiagnoses;

  const getSelectedPatientData = () => {
    if (selectedPatient === "no_patient" || selectedPatient === "create_new") return null;
    return allPatients.find((p) => p.id === selectedPatient);
  };

  const patientData = getSelectedPatientData();

  const saveToPatientRecord = async () => {
    if (selectedPatient === "no_patient" || !patientData) {
      toast.error("Please select a patient to save this note");
      return;
    }

    setSavingToPatient(true);
    try {
      const currentHistory = patientData.enhanced_notes_history || [];
      
      // Build education text for the note
      let educationText = '';
      if (providedEducation.length > 0) {
        educationText = '\n\nPatient Education Provided:\n' + 
          providedEducation.map(ed => `- ${ed.material.title} (via ${ed.method})`).join('\n');
      }
      
      const newEntry = {
        date: new Date().toISOString(),
        visit_type: visitType,
        diagnosis: selectedDiagnosis,
        enhanced_note: (isEditMode ? editedNote : enhancedNote) + educationText,
        rough_note: roughNotes,
        quality_score: complianceResults?.quality_analysis?.overall_quality_score,
        compliance_score: complianceResults?.compliance_score,
        nurse_email: currentUser?.email,
        vital_signs: vitalSigns
      };

      await base44.entities.Patient.update(patientData.id, {
        enhanced_notes_history: [...currentHistory, newEntry]
      });

      toast.success("Note saved to patient record" + (educationText ? " with education documented!" : "!"));
    } catch (error) {
      console.error('Error saving to patient:', error);
      toast.error("Failed to save note to patient record");
    } finally {
      setSavingToPatient(false);
    }
  };

  const recheckCompliance = async () => {
    const loadingToast = toast.loading("Re-checking compliance and quality...");
    try {
      const compliancePrompt = getProviderCompliancePrompt(currentUser?.credential_type || 'RN', visitType);
      const applicableRules = customComplianceRules.filter(rule => {
        if (!rule.applies_to_visit_types || rule.applies_to_visit_types.length === 0) return true;
        return rule.applies_to_visit_types.includes(visitType);
      });

      const response = await base44.functions.invoke('enhanceNoteWithQuality', {
        rough_notes: editedNote,
        visit_type: visitType,
        diagnosis: selectedDiagnosis,
        provider_type: currentUser?.credential_type || 'RN',
        compliance_prompt: compliancePrompt,
        custom_rules: applicableRules,
        patient_id: selectedPatient !== 'no_patient' ? selectedPatient : null,
        vital_signs: vitalSigns
      });

      const result = response.data;
      const newComplianceResults = result.compliance_check?.medicare_violations || [];
      setComplianceResults({
        ...result.compliance_check,
        quality_analysis: result.quality_analysis
      });
      setMedicareViolations(newComplianceResults);
      setRegulatoryWarnings(result.compliance_check?.regulatory_warnings || []);

      // Learn from the edits and suggestions made by the user
      if (enhancedNote !== editedNote) {
        try {
          await base44.functions.invoke('learnFromUserEdits', {
            original_enhanced_note: enhancedNote,
            edited_note: editedNote,
            visit_type: visitType,
            provider_type: currentUser?.credential_type || 'RN',
            compliance_issues_before: medicareViolations,
            compliance_issues_after: newComplianceResults
          });
          console.log('✅ Learning from user edits complete');
        } catch (learnError) {
          console.error('Error learning from edits:', learnError);
        }
      }

      toast.dismiss(loadingToast);
      toast.success("Compliance check complete!");
    } catch (error) {
      console.error('Error re-checking:', error);
      toast.dismiss(loadingToast);
      toast.error("Failed to re-check compliance");
    }
  };

  const applySuggestionToRoughNotes = (improvedText, originalExcerpt) => {
    if (originalExcerpt) {
      setRoughNotes(roughNotes.replace(originalExcerpt, improvedText));
    } else {
      setRoughNotes(roughNotes + '\n\n' + improvedText);
    }
  };

  const generateClinicalInsights = async (note, extractedData) => {
    setLoadingInsights(true);
    try {
      const response = await base44.functions.invoke('generateClinicalInsights', {
        enhanced_note: note,
        diagnoses: extractedData?.diagnoses || [selectedDiagnosis],
        symptoms: extractedData?.symptoms || [],
        medications: extractedData?.medications || [],
        vital_signs: vitalSigns,
        visit_type: visitType,
        provider_type: currentUser?.credential_type || 'RN',
        patient_context: patientData ? {
          age: patientData.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : null,
          comorbidities: patientData.secondary_diagnoses || []
        } : {}
      });
      setClinicalInsights(response.data);
    } catch (error) {
      console.error('Error generating clinical insights:', error);
    } finally {
      setLoadingInsights(false);
    }
  };

  return (
    <div className="min-h-screen p-2 sm:p-4 md:p-6 overflow-x-hidden">
      <div className="max-w-4xl mx-auto space-y-4 w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1 sm:space-y-2">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100">Smart Note Assistant</h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              AI-powered documentation with compliance checking
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreferences(!showPreferences)}
            className="w-full sm:w-auto"
          >
            <Settings className="w-4 h-4 mr-2" />
            AI Preferences
          </Button>
        </div>

        {/* AI Preferences Panel */}
        {showPreferences && (
          <AIPreferencesPanel currentUser={currentUser} />
        )}

        {/* Offline Note Capture */}
        {selectedPatient !== 'no_patient' && !navigator.onLine && (
          <OfflineNoteCapture
            patientId={selectedPatient}
            visitType={visitType}
            diagnosis={selectedDiagnosis}
            onNoteSaved={() => toast.success('Note saved locally')}
          />
        )}

        {!showResults ?
        <>
            {/* Streamlined Input Form */}
            <Card>
              <CardHeader className="bg-slate-200 p-4 sm:p-6 flex flex-col space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <Wand2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  Clinical Documentation
                </CardTitle>
              </CardHeader>
              <CardContent className="bg-slate-100 pt-0 p-4 sm:p-6 space-y-4">
                {/* Patient Selection Dropdown */}
                <div className="bg-slate-100">
                  <Label className="text-sm font-medium">Patient *</Label>
                  <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select patient..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="no_patient">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-orange-500" />
                          <span>No Patient Data (Anonymous)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="create_new">
                        <div className="flex items-center gap-2">
                          <Plus className="w-4 h-4 text-blue-500" />
                          <span>Create New Patient</span>
                        </div>
                      </SelectItem>
                      {allPatients.map((patient) =>
                    <SelectItem key={patient.id} value={patient.id}>
                          {patient.first_name} {patient.last_name} - MRN: {patient.medical_record_number}
                        </SelectItem>
                    )}
                    </SelectContent>
                  </Select>
                  {selectedPatient === "no_patient" &&
                <p className="text-xs text-orange-600 mt-1">
                      ⚠️ Note will not be saved to patient records
                    </p>
                }
                  {patientData &&
                <div className="mt-2 p-2 bg-slate-100 dark:bg-slate-800 rounded text-sm">
                      <strong>Selected:</strong> {patientData.first_name} {patientData.last_name}
                      {patientData.primary_diagnosis &&
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          Primary: {patientData.primary_diagnosis}
                        </div>
                  }
                    </div>
                }
                </div>

                {/* Visit Type & Diagnosis */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium">Visit Type *</Label>
                    <Select value={visitType} onValueChange={setVisitType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select visit type..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {availableVisitTypes.length > 0 ?
                      availableVisitTypes.map((vt) =>
                      <SelectItem key={vt.id} value={vt.id}>
                              {vt.label}
                            </SelectItem>
                      ) :

                      <SelectItem value="no_types" disabled>
                            No visit types available for your provider type
                          </SelectItem>
                      }
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Primary Diagnosis *</Label>
                    <Select value={selectedDiagnosis} onValueChange={setSelectedDiagnosis}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select diagnosis..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {commonDiagnoses.map((diagnosis, idx) =>
                      <SelectItem key={idx} value={diagnosis}>
                            {diagnosis}
                          </SelectItem>
                      )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Template Selector */}
                {visitType && currentUser?.credential_type &&
              <NoteTemplateSelector
                visitType={visitType}
                providerType={currentUser.credential_type}
                onSelectTemplate={(formattedNote, template) => {
                  setRoughNotes(formattedNote);
                  setSelectedTemplate(template);
                }} />

              }

                {/* Visit Type Guidance */}
                {visitType && <VisitTypeGuidance visitType={visitType} diagnosis={selectedDiagnosis} />}

                {/* Code Search & Inserter - Only for Physicians & NPs */}
                {(currentUser?.credential_type === 'MD' || currentUser?.credential_type === 'NP') && (
                  <CodeSearchInserter
                    onInsertCode={(code) => {
                      setRoughNotes(roughNotes + '\n\n' + code);
                      toast.success('Code inserted into notes');
                    }}
                    noteType="rough"
                  />
                )}

                {/* Vital Signs */}
                <div>
                  <Label className="text-sm font-medium">Vital Signs</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 mt-2">
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Temperature (°F)</label>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="98.6"
                        value={vitalSigns.temperature}
                        onChange={(e) => setVitalSigns({...vitalSigns, temperature: e.target.value})}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Heart Rate (bpm)</label>
                      <Input
                        type="number"
                        placeholder="72"
                        value={vitalSigns.heart_rate}
                        onChange={(e) => setVitalSigns({...vitalSigns, heart_rate: e.target.value})}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Resp Rate</label>
                      <Input
                        type="number"
                        placeholder="16"
                        value={vitalSigns.respiratory_rate}
                        onChange={(e) => setVitalSigns({...vitalSigns, respiratory_rate: e.target.value})}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">BP Systolic</label>
                      <Input
                        type="number"
                        placeholder="120"
                        value={vitalSigns.bp_systolic}
                        onChange={(e) => setVitalSigns({...vitalSigns, bp_systolic: e.target.value})}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">BP Diastolic</label>
                      <Input
                        type="number"
                        placeholder="80"
                        value={vitalSigns.bp_diastolic}
                        onChange={(e) => setVitalSigns({...vitalSigns, bp_diastolic: e.target.value})}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">O2 Sat (%)</label>
                      <Input
                        type="number"
                        placeholder="98"
                        value={vitalSigns.oxygen_saturation}
                        onChange={(e) => setVitalSigns({...vitalSigns, oxygen_saturation: e.target.value})}
                        className="h-9"
                      />
                    </div>
                  </div>
                </div>

                {/* Rough Notes Input with Voice Dictation */}
                <div>
                  <Label className="text-sm font-medium">Clinical Notes *</Label>
                  <p className="text-xs text-slate-500 mb-2">Type or dictate your clinical notes</p>
                  <VoiceDictationInput
                    value={roughNotes}
                    onChange={(e) => setRoughNotes(e.target.value)}
                    placeholder="Enter your rough clinical notes here or use voice dictation...

Example: Patient reports feeling better, pain level 2/10. Medications reviewed, compliant. Wound healing well, no signs of infection. Patient ambulating with walker..."



                  />
                </div>

                {/* Enhance Button */}
                <Button
                onClick={enhanceNote}
                disabled={enhancing || !visitType || !selectedDiagnosis || !roughNotes.trim()}
                className="w-full h-11 sm:h-12 bg-indigo-600 hover:bg-indigo-700 text-white text-sm sm:text-base"
                size="lg">

                  {enhancing ?
                <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Enhancing Note & Running Compliance Checks...
                    </> :

                <>
                      <Wand2 className="w-5 h-5 mr-2" />
                      Enhance Note
                    </>
                }
                </Button>
              </CardContent>
            </Card>
          </> :

        <>
            {/* Results Page */}
            <div className="space-y-4">
              {/* Clinical Insights Panel */}
              <ClinicalInsightsPanel insights={clinicalInsights} isLoading={loadingInsights} />

              {/* Enhanced Note Display */}
              <Card className="border-green-300 bg-green-50 dark:bg-green-950">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between flex-wrap gap-2">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      {isEditMode ? 'Edit Note' : 'Enhanced Compliant Note'}
                    </span>
                    <div className="flex gap-2">
                      {!isEditMode && (
                        <>
                          <Button
                            onClick={() => {
                              setIsEditMode(true);
                              setEditedNote(enhancedNote);
                            }}
                            variant="outline"
                            size="sm"
                          >
                            Edit Note
                          </Button>
                          <Button
                            onClick={() => {
                              navigator.clipboard.writeText(enhancedNote);
                              toast.success("Enhanced note copied");
                            }}
                            variant="outline"
                            size="sm"
                          >
                            Copy Note
                          </Button>
                          {patientData && (
                            <Button
                              onClick={saveToPatientRecord}
                              disabled={savingToPatient}
                              className="bg-green-600 hover:bg-green-700"
                              size="sm"
                            >
                              {savingToPatient ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                'Save to Patient Record'
                              )}
                            </Button>
                          )}
                        </>
                      )}
                      {isEditMode && (
                        <>
                          <Button
                            onClick={recheckCompliance}
                            variant="outline"
                            size="sm"
                          >
                            Re-check Compliance
                          </Button>
                          <Button
                            onClick={() => {
                              setEnhancedNote(editedNote);
                              setIsEditMode(false);
                            }}
                            className="bg-green-600 hover:bg-green-700"
                            size="sm"
                          >
                            Save Changes
                          </Button>
                          <Button
                            onClick={() => {
                              setEditedNote(enhancedNote);
                              setIsEditMode(false);
                            }}
                            variant="outline"
                            size="sm"
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditMode ? (
                    <textarea
                      value={editedNote}
                      onChange={(e) => setEditedNote(e.target.value)}
                      className="w-full h-96 p-4 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-green-500"
                    />
                  ) : (
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-lg text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {enhancedNote}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quality & Compliance Scores */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Medicare Compliance */}
                <Card className={complianceResults?.compliance_score >= 85 ? 'border-green-300 bg-green-50 dark:bg-green-950' : 'border-red-300 bg-red-50 dark:bg-red-950'}>
                  <CardContent className="p-4">
                    <div className="text-center">
                      {complianceResults?.compliance_score >= 85 ?
                        <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" /> :
                        <ShieldAlert className="w-8 h-8 text-red-600 mx-auto mb-2" />
                      }
                      <p className="font-semibold text-sm mb-1">Medicare Compliance</p>
                      <span className={`text-3xl font-bold ${
                        complianceResults?.compliance_score >= 85 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {complianceResults?.compliance_score || 0}%
                      </span>
                      <p className="text-xs text-gray-600 mt-1">
                        {complianceResults?.compliance_score >= 85 ? '✓ Meets threshold' : '✗ Below 85%'}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Quality Score */}
                {complianceResults?.quality_analysis && (
                  <>
                    <Card className="border-purple-300 bg-purple-50 dark:bg-purple-950">
                      <CardContent className="p-4">
                        <div className="text-center">
                          <Brain className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                          <p className="font-semibold text-sm mb-1">Documentation Quality</p>
                          <span className={`text-3xl font-bold ${
                            complianceResults.quality_analysis.overall_quality_score >= 90 ? 'text-green-600' :
                            complianceResults.quality_analysis.overall_quality_score >= 75 ? 'text-yellow-600' :
                            'text-red-600'
                          }`}>
                            {complianceResults.quality_analysis.overall_quality_score}%
                          </span>
                          <p className="text-xs text-gray-600 mt-1">Overall quality</p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950">
                      <CardContent className="p-4">
                        <div className="text-center">
                          <CheckCircle2 className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                          <p className="font-semibold text-sm mb-1">Completeness</p>
                          <span className={`text-3xl font-bold ${
                            complianceResults.quality_analysis.completeness_score >= 90 ? 'text-green-600' :
                            complianceResults.quality_analysis.completeness_score >= 75 ? 'text-yellow-600' :
                            'text-red-600'
                          }`}>
                            {complianceResults.quality_analysis.completeness_score}%
                          </span>
                          <p className="text-xs text-gray-600 mt-1">Documentation complete</p>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>

              {/* Documentation Quality Score Component */}
              {complianceResults?.quality_analysis && (
                <DocumentationQualityScore 
                  qualityAnalysis={complianceResults.quality_analysis}
                  noteText={isEditMode ? editedNote : enhancedNote}
                  visitType={visitType}
                  providerType={currentUser?.credential_type}
                  onFeedbackSubmitted={() => {
                    toast.success('Your feedback helps improve our AI suggestions!');
                  }}
                />
              )}

              {/* Medicare Violations */}
              {medicareViolations && medicareViolations.length > 0 &&
            <Card className="border-red-300 bg-red-50 dark:bg-red-950">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-red-800 dark:text-red-400">
                      <ShieldAlert className="w-5 h-5" />
                      Medicare Compliance Violations ({medicareViolations.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {medicareViolations.map((violation, idx) =>
                <div key={idx} className="bg-white dark:bg-gray-900 p-3 rounded-lg border-l-4 border-red-600">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="font-semibold text-sm text-red-800 dark:text-red-400">{violation.violation}</p>
                          <Badge className={
                    violation.severity === 'critical' ? 'bg-red-700' :
                    violation.severity === 'high' ? 'bg-orange-600' :
                    'bg-yellow-600'
                    }>
                            {violation.severity}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                          <strong>42 CFR Reference:</strong> {violation.cop_reference}
                        </p>
                        <div className="bg-green-50 dark:bg-green-900 p-2 rounded">
                          <p className="text-xs font-medium text-green-800 dark:text-green-300">
                            <strong>How to Fix:</strong> {violation.remediation}
                          </p>
                        </div>
                      </div>
                )}
                  </CardContent>
                </Card>
            }

              {/* Regulatory Warnings */}
              {regulatoryWarnings && regulatoryWarnings.length > 0 &&
            <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-400">
                      <AlertTriangle className="w-5 h-5" />
                      Regulatory Warnings ({regulatoryWarnings.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {regulatoryWarnings.map((warning, idx) =>
                  <div key={idx} className="p-2 bg-white dark:bg-gray-900 rounded border-l-2 border-orange-500">
                          <p className="text-sm text-orange-800 dark:text-orange-300">{warning}</p>
                        </div>
                  )}
                    </div>
                  </CardContent>
                </Card>
            }

              {/* Compliance Results */}
              {complianceResults &&
            <Card className={
            complianceResults.status === 'passed' ? 'border-green-300 bg-green-50 dark:bg-green-950' :
            complianceResults.status === 'critical' ? 'border-red-300 bg-red-50 dark:bg-red-950' :
            'border-yellow-300 bg-yellow-50 dark:bg-yellow-950'
            }>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Documentation Analysis</span>
                      {complianceResults?.status && (
                        <Badge className={
                      complianceResults.compliance_score >= 90 ? 'bg-green-600' :
                      complianceResults.compliance_score >= 70 ? 'bg-yellow-600' :
                      'bg-red-600'
                      }>
                           {complianceResults.status.toUpperCase()}
                         </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {complianceResults.compliant_elements?.length > 0 &&
                <div>
                        <h5 className="font-semibold text-green-800 dark:text-green-400 mb-2">✓ Compliant Elements</h5>
                        <ul className="space-y-1">
                          {complianceResults.compliant_elements.map((element, idx) =>
                    <li key={idx} className="text-sm text-green-700 dark:text-green-300">• {element}</li>
                    )}
                        </ul>
                      </div>
                }

                    {complianceResults.issues?.length > 0 &&
                    <div>
                        <h5 className="font-semibold text-red-800 dark:text-red-400 mb-2">⚠ Issues Found</h5>
                        <div className="space-y-3">
                          {complianceResults.issues.map((issue, idx) =>
                    <div key={idx} className="bg-white dark:bg-gray-900 p-3 rounded border border-red-200">
                              <div className="flex items-start gap-2 mb-1">
                                <Badge className={
                        issue.severity === 'critical' ? 'bg-red-600' :
                        issue.severity === 'high' ? 'bg-orange-500' :
                        'bg-yellow-500'
                        }>
                                  {issue.severity}
                                </Badge>
                                <p className="font-medium text-sm">{issue.element}</p>
                              </div>
                              <p className="text-sm text-red-700 dark:text-red-300 mb-2">{issue.problem}</p>
                              <div className="space-y-2">
                                <p className="text-sm text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900 p-2 rounded">
                                  <strong>How to fix:</strong> {issue.suggestion}
                                </p>
                                {issue.specific_fix &&
                          <p className="text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900 p-2 rounded">
                                    <strong>Example:</strong> {issue.specific_fix}
                                  </p>
                          }
                              </div>
                            </div>
                    )}
                        </div>
                      </div>
                    }
                  </CardContent>
                </Card>
            }

              {/* Suggested Tasks */}
              {suggestedTasks && suggestedTasks.length > 0 &&
            <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ListTodo className="w-5 h-5 text-blue-600" />
                      Suggested Follow-Up Tasks ({suggestedTasks.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {suggestedTasks.map((task, idx) =>
                <div key={idx} className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold text-slate-900 dark:text-slate-100">{task.title}</h4>
                              <Badge className={
                        task.priority === 'critical' ? 'bg-red-600' :
                        task.priority === 'high' ? 'bg-orange-500' :
                        task.priority === 'medium' ? 'bg-yellow-500' :
                        'bg-blue-500'
                        }>
                                {task.priority}
                              </Badge>
                              <Badge variant="outline">{task.type}</Badge>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{task.description}</p>
                            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-500">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {task.suggested_due_timeframe?.replace('_', ' ') || 'No deadline'}
                              </span>
                            </div>
                            {task.ai_reason &&
                      <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-800 rounded text-xs text-slate-600 dark:text-slate-400">
                                <strong>AI Analysis:</strong> {task.ai_reason}
                              </div>
                      }
                            {task.clinical_indicators && task.clinical_indicators.length > 0 &&
                      <div className="mt-2 flex gap-1 flex-wrap">
                                <span className="text-xs text-slate-500">Factors:</span>
                                {task.clinical_indicators.map((indicator, i) => (
                                  <Badge key={i} variant="outline" className="text-xs">{indicator}</Badge>
                                ))}
                              </div>
                      }
                          </div>
                          <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const dueDate = (() => {
                            const today = new Date();
                            switch (task.suggested_due_timeframe) {
                              case 'today':return today.toISOString().split('T')[0];
                              case '24_hours':
                                today.setDate(today.getDate() + 1);
                                return today.toISOString().split('T')[0];
                              case '48_hours':
                                today.setDate(today.getDate() + 2);
                                return today.toISOString().split('T')[0];
                              case 'this_week':
                                today.setDate(today.getDate() + 7);
                                return today.toISOString().split('T')[0];
                              default:return null;
                            }
                          })();

                          await base44.entities.Task.create({
                            title: task.title,
                            description: task.description,
                            priority: task.priority,
                            type: task.type,
                            due_date: dueDate,
                            due_timeframe: task.suggested_due_timeframe,
                            patient_id: selectedPatient !== 'no_patient' ? selectedPatient : null,
                            assigned_to: currentUser?.email,
                            source: 'ai_generated',
                            ai_reason: task.ai_reason,
                            status: 'pending'
                          });
                          toast.success('Task added to your list');
                          setSuggestedTasks((prev) => prev.filter((_, i) => i !== idx));
                        } catch (error) {
                          toast.error('Failed to add task');
                          console.error(error);
                        }
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white">

                            <Plus className="w-4 h-4 mr-1" />
                            Add Task
                          </Button>
                        </div>
                      </div>
                )}
                  </CardContent>
                </Card>
            }

              {/* AI Auto-Populate & Follow-Up Tasks */}
              {currentUser?.service_type !== 'home_health' && currentUser?.service_type !== 'hospice' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                <AutoPopulateDataFields
                narrative={enhancedNote || roughNotes}
                dataType="vital_signs"
                patientId={selectedPatient !== 'no_patient' ? selectedPatient : null}
                visitType={visitType}
                onDataExtracted={(data) => {
                  console.log('Extracted vital signs:', data);
                }} />

                <AIFollowUpTasksGenerator
                visitId={null}
                patientId={selectedPatient !== 'no_patient' ? selectedPatient : null}
                patientName={patientData ? `${patientData.first_name} ${patientData.last_name}` : 'Patient'}
                visitNotes={enhancedNote}
                vitalSigns={extractedData?.vitals} />

              </div>
              )}

              {/* Comprehensive Medical Coding Assistant - Only for Physicians & NPs after note enhancement */}
              <MedicalCodingAssistant
                enhancedNote={enhancedNote}
                diagnosis={selectedDiagnosis}
                visitType={visitType}
                providerType={currentUser?.credential_type}
                patientContext={patientData ? {
                  patient_name: `${patientData.first_name} ${patientData.last_name}`,
                  primary_diagnosis: patientData.primary_diagnosis,
                  secondary_diagnoses: patientData.secondary_diagnoses,
                  current_medications: patientData.current_medications
                } : null}
                currentUser={currentUser}
              />

              {/* Care Plan Suggestions */}
              {patientData && (currentUser?.credential_type === 'RN' || currentUser?.credential_type === 'MSW') &&
            <CarePlanSuggestionsPanel
              patientId={patientData.id}
              visitType={visitType}
              diagnosis={selectedDiagnosis}
              noteContent={enhancedNote} />

            }





              {/* Personalized AI Education Generator */}
              <PersonalizedEducationGenerator 
                diagnosis={selectedDiagnosis}
                visitType={visitType}
                clinicalNote={enhancedNote}
                patientId={selectedPatient !== 'no_patient' ? selectedPatient : null}
                patientContext={patientData ? {
                  patient_name: `${patientData.first_name} ${patientData.last_name}`,
                  age: patientData.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : null,
                  primary_diagnosis: patientData.primary_diagnosis,
                  allergies: patientData.allergies,
                  current_medications: patientData.current_medications
                } : null}
                onMaterialGenerated={(material, method) => {
                  setProvidedEducation(prev => [...prev, { material, method }]);
                  toast.success('Education documented - will be added to note');
                }}
              />

              {/* Patient Education Panel - Library Browser */}
              <PatientEducationPanel
                suggestedMaterials={suggestedEducation}
                patientId={selectedPatient !== 'no_patient' ? selectedPatient : null}
                patientEmail={patientData?.email}
                onEducationProvided={(material, method) => {
                  setProvidedEducation(prev => [...prev, { material, method }]);
                  toast.success('Education documented - will be added to note');
                }}
              />

              {/* Education Tracking History */}
              {selectedPatient !== 'no_patient' && (
                <EducationTrackingHistory patientId={selectedPatient} />
              )}

              {/* Start Over Button */}
              <Button
                onClick={() => {
                  setShowResults(false);
                  setEnhancedNote(null);
                  setEditedNote("");
                  setComplianceResults(null);
                  setMedicareViolations([]);
                  setRegulatoryWarnings([]);
                  setSuggestedTasks([]);
                  setRoughNotes("");
                  setVitalSigns({
                    temperature: "",
                    heart_rate: "",
                    respiratory_rate: "",
                    bp_systolic: "",
                    bp_diastolic: "",
                    oxygen_saturation: ""
                  });
                  setIsEditMode(false);
                }}
                variant="outline"
                className="w-full"
              >
                Create Another Note
              </Button>
            </div>
          </>
        }

        {/* Create Patient Dialog */}
        {(showCreatePatient || selectedPatient === "create_new") &&
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Create New Patient</CardTitle>
                  <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setShowCreatePatient(false);
                    setSelectedPatient("no_patient");
                  }}>

                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>First Name *</Label>
                  <Input
                  value={newPatientData.first_name}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    first_name: e.target.value
                  })
                  }
                  placeholder="John" />

                </div>
                <div>
                  <Label>Last Name *</Label>
                  <Input
                  value={newPatientData.last_name}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    last_name: e.target.value
                  })
                  }
                  placeholder="Doe" />

                </div>
                <div>
                  <Label>Date of Birth</Label>
                  <Input
                  type="date"
                  value={newPatientData.date_of_birth}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    date_of_birth: e.target.value
                  })
                  } />

                </div>
                <div>
                  <Label>Medical Record Number</Label>
                  <Input
                  value={newPatientData.medical_record_number}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    medical_record_number: e.target.value
                  })
                  }
                  placeholder="MRN-12345" />

                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowCreatePatient(false);
                    setSelectedPatient("no_patient");
                  }}>

                    Cancel
                  </Button>
                  <Button
                  className="flex-1"
                  onClick={createNewPatient}
                  disabled={creatingPatient}>

                    {creatingPatient ?
                  <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </> :

                  "Create Patient"
                  }
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        }
                    </div>
                    </div>);

}