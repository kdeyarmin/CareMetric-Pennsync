import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import ProviderNoteTypeSelector from "../components/smartNote/ProviderNoteTypeSelector";
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
  Settings,
  FileText
  } from "lucide-react";
import { 
  getVisitTypesForProvider, 
  getAccessibleCareSettings, 
  getCareSettingLabel,
  CARE_SETTINGS 
} from "@/components/utils/providerVisitTypeMapping";
import { toast } from "sonner";
import { getProviderCompliancePrompt } from "@/components/utils/providerSpecificConfig";
import { 
  getProviderPromptAdditions,
  getCareSettingPromptAdditions 
} from "@/components/utils/aiPrompts";
import { buildEnhancedPrompt, recordEditForLearning } from "@/components/utils/enhancedAIPrompts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CarePlanSuggestionsPanel from "@/components/smartNote/CarePlanSuggestionsPanel";
import SmartTemplateSuggester from "@/components/smartNote/SmartTemplateSuggester";
import CustomTemplateCreator from "@/components/smartNote/CustomTemplateCreator";
import EnhancedTemplateSelector from "@/components/templates/EnhancedTemplateSelector";
import TemplateEducationSuggestions from "@/components/education/TemplateEducationSuggestions";
import QuickPatientAccess from "@/components/smartNote/QuickPatientAccess";

import VitalSignsQuickButton from "@/components/smartNote/VitalSignsQuickButton";
import AutoSaveIndicator from "@/components/smartNote/AutoSaveIndicator";
import NoteDraftVersions from "@/components/smartNote/NoteDraftVersions";
import NoteConflictResolver from "@/components/smartNote/NoteConflictResolver";
import EnhancedOfflineNoteSync from "@/components/mobile/EnhancedOfflineNoteSync";
import AIPatientSummaryGenerator from "@/components/patient/AIPatientSummaryGenerator";

import AutoPopulateDataFields from "@/components/smartNote/AutoPopulateDataFields";
import AIFollowUpTasksGenerator from "@/components/smartNote/AIFollowUpTasksGenerator";
import EnhancedICD10Suggester from "@/components/clinical/EnhancedICD10Suggester";
import InteractiveQualitySuggestions from "@/components/smartNote/InteractiveQualitySuggestions";
import { Sparkles } from "lucide-react";
import VisitTypeGuidance from "@/components/smartNote/VisitTypeGuidance";
import CodeSearchInserter from "@/components/smartNote/CodeSearchInserter";
import AIPreferencesPanel from "@/components/smartNote/AIPreferencesPanel";

import MedicalCodingAssistant from "@/components/smartNote/MedicalCodingAssistant.jsx";
import AdvancedMedicalCodingAssistant from "@/components/coding/AdvancedMedicalCodingAssistant";

import RegulatoryComplianceMonitor from "@/components/smartNote/RegulatoryComplianceMonitor";
import EducationLibraryBrowser from "@/components/education/EducationLibraryBrowser";
import PatientEducationPanel from "@/components/education/PatientEducationPanel";
import VoiceNoteRecorder from "@/components/smartNote/VoiceNoteRecorder";
import VoiceDictationInput from "@/components/smartNote/VoiceDictationInput";
import ClinicalInsightsPanel from "@/components/smartNote/ClinicalInsightsPanel";
import OASISFieldSuggester from "@/components/smartNote/OASISFieldSuggester";
import CarePlanDraftGenerator from "@/components/smartNote/CarePlanDraftGenerator";
import DocumentationGapDetector from "@/components/smartNote/DocumentationGapDetector";
import OfflineSyncNotification from "@/components/mobile/OfflineSyncNotification";
import { useOfflineNotes } from "@/components/mobile/OfflineNoteCache";
import ProactiveClinicalOrders from "@/components/clinical/ProactiveClinicalOrders";
import PriorAuthGenerator from "@/components/clinical/PriorAuthGenerator";
import DocumentationQualityScore from "@/components/smartNote/DocumentationQualityScore";
import PersonalizedEducationGenerator from "@/components/education/PersonalizedEducationGenerator";
import EducationTrackingHistory from "@/components/education/EducationTrackingHistory";
import OfflineNoteCapture from "@/components/mobile/OfflineNoteCapture";
import { ResolveComplianceIssue, ResolveDocumentationGap, ResolveQualitySuggestion, ResolveAllIssues } from "@/components/smartNote/OneClickResolvers";
import NoteEmailDialog from "@/components/notes/NoteEmailDialog";
import ComplianceBasedTrainingRecommender from "@/components/training/ComplianceBasedTrainingRecommender";
import AIOutputRating from "@/components/feedback/AIOutputRating";
import InlineAIFeedback from "@/components/feedback/InlineAIFeedback";
import RealTimeComplianceMonitor from '../components/compliance/RealTimeComplianceMonitor';
import PatientContextSidebar from '../components/smartNote/PatientContextSidebar';
import TimeSavingsSummary from '../components/smartNote/TimeSavingsSummary';
import AIFollowUpQuestions from '../components/smartNote/AIFollowUpQuestions';
import ProactiveGapAnalyzer from '../components/smartNote/ProactiveGapAnalyzer';
import VisitRelevantHistorySummary from '../components/smartNote/VisitRelevantHistorySummary';
import AICareCoordinationPanel from '../components/coordination/AICareCoordinationPanel';
import UnifiedComplianceAudit from '../components/smartNote/UnifiedComplianceAudit';
import UnifiedSuggestionsPanel from '../components/smartNote/UnifiedSuggestionsPanel';
import NoteCompletenessTracker from '../components/smartNote/NoteCompletenessTracker';
import QuickTemplateInserter from '../components/smartNote/QuickTemplateInserter';
import AIPhraseSuggestionWidget from '../components/smartNote/AIPhraseSuggestionWidget';
import ICD10CodeSuggester from '../components/smartNote/ICD10CodeSuggester';
import FollowUpTaskGenerator from '../components/smartNote/FollowUpTaskGenerator';
import RealtimeComplianceChecker from '../components/smartNote/RealtimeComplianceChecker';
import PatientEducationGenerator from '../components/education/PatientEducationGenerator';
import EnhancedMedicalCodingAssistant from '../components/smartNote/EnhancedMedicalCodingAssistant';
import PremiumFeatureGate from '../components/subscription/PremiumFeatureGate';
import UnifiedAIDocumentationAssistant from '../components/smartNote/UnifiedAIDocumentationAssistant';
import ClinicalDecisionSupportPanel from '../components/smartNote/ClinicalDecisionSupportPanel';
import PostEnhancementInsights from '../components/smartNote/PostEnhancementInsights';
import AIClinicalAssistantPanel from '../components/clinical/AIClinicalAssistantPanel';
import UnifiedSuggestionsApplier from '../components/smartNote/UnifiedSuggestionsApplier';

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
  const [noteRating, setNoteRating] = useState(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [timeSavedMinutes, setTimeSavedMinutes] = useState(0);
  const [conflictData, setConflictData] = useState(null);
  const [showTemplateCreator, setShowTemplateCreator] = useState(false);
  const [templateCreatorInitData, setTemplateCreatorInitData] = useState(null);
  const location = useLocation();
  const { isOnline, saveOfflineNote } = useOfflineNotes();

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

  // Auto-set care setting and provider type from user profile
  const careSetting = currentUser?.service_type || "";
  const providerType = currentUser?.credential_type || "RN";

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

     if (!careSetting) {
     toast.error("Please select a care setting");
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
     console.log('🔵 Getting compliance prompt for:', providerType, visitType, careSetting);
     const compliancePrompt = getProviderCompliancePrompt(providerType, visitType);
     const providerAdditions = getProviderPromptAdditions(providerType);
     const locationAdditions = getCareSettingPromptAdditions(careSetting);
     let fullCompliancePrompt = `${compliancePrompt}\n${providerAdditions}\n${locationAdditions}`;

     // Enhance prompt with learned patterns and knowledge base
     fullCompliancePrompt = await buildEnhancedPrompt({
       basePrompt: fullCompliancePrompt,
       visitType,
       diagnosis: selectedDiagnosis,
       careSetting,
       category: 'clinical_documentation'
     });
     console.log('✅ Enhanced compliance prompt with learned patterns');

     // Filter custom rules applicable to this provider, visit type, and care setting
     const applicableRules = customComplianceRules.filter(rule => {
       // Check visit type
       const visitTypeMatch = !rule.applies_to_visit_types || rule.applies_to_visit_types.length === 0 || 
                              rule.applies_to_visit_types.includes(visitType);

       // Check care type (home_health, hospice, both)
       const careTypeMatch = !rule.applies_to_care_type || rule.applies_to_care_type === 'both' ||
                             rule.applies_to_care_type === careSetting;

       return visitTypeMatch && careTypeMatch;
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
          provider_type: providerType,
          care_setting: careSetting,
          compliance_prompt: fullCompliancePrompt,
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
            provider_type: providerType,
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

       // Calculate time saved (estimate: 15 min manual charting saved with AI enhancement)
       const noteLength = finalNote?.length || 0;
       const baselineMinutes = Math.max(10, Math.min(30, noteLength / 50)); // 10-30 min based on length
       const actualMinutes = 2; // Typical time with AI
       const savedMinutes = baselineMinutes - actualMinutes;
       setTimeSavedMinutes(savedMinutes);

       // Record time savings
       try {
         await base44.entities.TimeSavings.create({
           user_email: currentUser?.email,
           feature_used: 'note_enhancement',
           time_saved_minutes: savedMinutes,
           patient_id: selectedPatient !== 'no_patient' ? selectedPatient : null,
           visit_date: new Date().toISOString().split('T')[0],
           baseline_time_minutes: baselineMinutes,
           actual_time_minutes: actualMinutes,
           note_length_chars: noteLength,
           specialty: providerType
         });
       } catch (saveError) {
         console.error('Failed to save time tracking:', saveError);
       }

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

  // Get available visit types based on provider and care setting from profile
  const availableVisitTypes = (providerType && careSetting) ?
    getVisitTypesForProvider(providerType, careSetting) :
    [];

  // Home Health & Hospice focused diagnoses
  const HOME_HEALTH_HOSPICE_DIAGNOSES = [
    "Congestive Heart Failure (CHF) - I50.9",
    "COPD - J44.1",
    "Diabetes Mellitus Type 2 - E11.9",
    "Hypertension - I10",
    "Wound Care - Pressure Ulcer - L89",
    "Wound Care - Diabetic Ulcer - E11.621",
    "Wound Care - Venous Stasis Ulcer - I87.2",
    "Wound Care - Surgical Site - T81.4",
    "Post-Surgical Care",
    "Chronic Kidney Disease - N18.9",
    "Dementia/Alzheimer's - F03.90",
    "Stroke/CVA Recovery - I63.9",
    "UTI - N39.0",
    "Pneumonia - J18.9",
    "Cellulitis - L03.90",
    "DVT/PE - I82.40",
    "Atrial Fibrillation - I48.91",
    "Coronary Artery Disease - I25.10",
    "Peripheral Vascular Disease - I73.9",
    "Parkinson's Disease - G20",
    "Multiple Sclerosis - G35",
    "Cancer Care / Oncology - C80.1",
    "Palliative Care - Z51.5",
    "End-of-Life / Hospice Care - Z51.5",
    "Chronic Pain Management - G89.29",
    "Depression - F32.9",
    "Anxiety - F41.9",
    "Fall Risk / History of Falls - R29.6",
    "Osteoarthritis - M19.90",
    "Osteoporosis - M81.0",
    "Fracture - Hip - S72.009A",
    "ESRD on Dialysis - N18.6",
    "Anemia - D64.9",
    "Seizure Disorder - G40.909",
    "Dysphagia - R13.10",
    "Obesity - E66.9",
    "Sepsis - A41.9",
    "COVID-19 - U07.1",
    "Heart Failure - Systolic - I50.20",
    "Heart Failure - Diastolic - I50.30",
    "Liver Cirrhosis - K74.60",
    "ALS - G12.21",
    "Bipolar Disorder - F31.9",
    "Schizophrenia - F20.9",
    "Opioid Dependence - F11.20",
    "Caregiver Support / Training",
  ];

  const [customDiagnosisSearch, setCustomDiagnosisSearch] = useState("");
  const [showCustomSearch, setShowCustomSearch] = useState(false);

  const commonDiagnoses = HOME_HEALTH_HOSPICE_DIAGNOSES;

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
    
    // Build education text for the note
    let educationText = '';
    if (providedEducation.length > 0) {
      educationText = '\n\nPatient Education Provided:\n' + 
        providedEducation.map(ed => `- ${ed.material.title} (via ${ed.method})`).join('\n');
    }
    
    const noteData = {
      patientId: patientData.id,
      visitType,
      diagnosis: selectedDiagnosis,
      enhancedNote: (isEditMode ? editedNote : enhancedNote) + educationText,
      roughNotes,
      vitalSigns,
      qualityScore: complianceResults?.quality_analysis?.overall_quality_score,
      complianceScore: complianceResults?.compliance_score
    };

    // If offline, save to cache
    if (!isOnline) {
      const draftId = saveOfflineNote(noteData);
      if (draftId) {
        toast.success("Note saved offline - will sync when online");
        setSavingToPatient(false);
        return;
      }
    }

    // If online, save directly
    try {
      const currentHistory = patientData.enhanced_notes_history || [];
      
      const newEntry = {
        date: new Date().toISOString(),
        visit_type: visitType,
        diagnosis: selectedDiagnosis,
        enhanced_note: noteData.enhancedNote,
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
      
      // If save fails, cache offline
      const draftId = saveOfflineNote(noteData);
      if (draftId) {
        toast.warning("Saved offline - will sync when connection restored");
      } else {
        toast.error("Failed to save note");
      }
    } finally {
      setSavingToPatient(false);
    }
  };

  const recheckCompliance = async () => {
   const loadingToast = toast.loading("Re-checking compliance and quality...");
   try {
     const compliancePrompt = getProviderCompliancePrompt(providerType, visitType);
     const providerAdditions = getProviderPromptAdditions(providerType);
     const locationAdditions = getCareSettingPromptAdditions(careSetting);
     const fullCompliancePrompt = `${compliancePrompt}\n${providerAdditions}\n${locationAdditions}`;
      
      const applicableRules = customComplianceRules.filter(rule => {
        const visitTypeMatch = !rule.applies_to_visit_types || rule.applies_to_visit_types.length === 0 || 
                              rule.applies_to_visit_types.includes(visitType);
        const careTypeMatch = !rule.applies_to_care_type || rule.applies_to_care_type === 'both' ||
                             rule.applies_to_care_type === careSetting;
        return visitTypeMatch && careTypeMatch;
      });

      const response = await base44.functions.invoke('enhanceNoteWithQuality', {
        rough_notes: editedNote,
        visit_type: visitType,
        diagnosis: selectedDiagnosis,
        provider_type: providerType,
        care_setting: careSetting,
        compliance_prompt: fullCompliancePrompt,
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

      // Enhanced learning from user edits
      if (enhancedNote !== editedNote) {
        try {
          // Old learning system
          await base44.functions.invoke('learnFromUserEdits', {
            original_enhanced_note: enhancedNote,
            edited_note: editedNote,
            visit_type: visitType,
            provider_type: providerType,
            compliance_issues_before: medicareViolations,
            compliance_issues_after: newComplianceResults
          });

          // New enhanced learning system with explicit rating
          await recordEditForLearning({
            originalText: enhancedNote,
            editedText: editedNote,
            context: {
              visit_type: visitType,
              diagnosis: selectedDiagnosis,
              care_setting: careSetting,
              section: 'full_note',
              compliance_score: result.compliance_check?.compliance_score || 0,
              quality_score: result.quality_analysis?.overall_quality_score || 0,
              explicit_rating: noteRating?.rating || null,
              explicit_feedback: noteRating?.feedback || null
            }
          });
          console.log('✅ Enhanced learning from user edits complete');
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
        provider_type: providerType,
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
    <PremiumFeatureGate featureName="Smart Note Assistant" featureDescription="AI-powered clinical documentation with real-time compliance monitoring and quality scoring." allowTrial={true}>
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 p-4 sm:p-6 pb-20 sm:pb-6">
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
        
        {/* Professional Header */}
        <div className="bg-white rounded-xl shadow-sm border border-blue-100 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg">
              <Wand2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Smart Note Assistant</h1>
              <p className="text-sm text-slate-600 mt-0.5">AI-powered clinical documentation with compliance monitoring</p>
            </div>
          </div>
        </div>
        {/* Enhanced Offline Sync Status */}
        {currentUser?.email && (
          <EnhancedOfflineNoteSync 
            userEmail={currentUser.email} 
            isOnline={isOnline}
          />
        )}

        {/* Conflict Resolution */}
        {conflictData && (
          <NoteConflictResolver
            onlineVersion={conflictData.online}
            offlineVersion={conflictData.offline}
            patientName={patientData?.first_name}
            onResolve={(content) => {
              setRoughNotes(content);
              setConflictData(null);
              toast.success("Conflict resolved");
            }}
          />
        )}
        {/* Hide provider note type selector to streamline - visit type is below */}

        {/* Streamlined - removed checklist for efficiency */}

        {/* Offline Sync Status */}
        {!isOnline && <OfflineSyncNotification currentUser={currentUser} />}

        {!showResults ?
        <>
            {/* Clinical Documentation Form - Streamlined */}
            <Card className="border-blue-200 shadow-md">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 p-4 sm:p-6">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <FileText className="w-5 h-5 text-blue-600" />
                  Clinical Documentation
                </CardTitle>
              </CardHeader>
              <CardContent className="bg-white p-4 sm:p-6 space-y-4">
                 {/* Quick Patient Access - Hide if using standard section */}

                 {/* Core Documentation Fields */}
                 <div className="grid gap-5">
                 {/* Patient Selection Dropdown */}
                 <div className="w-full">
                   <Label className="text-sm font-semibold text-slate-700 mb-2 block">Patient *</Label>
                  <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                    <SelectTrigger className="w-full h-11">
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

                {/* Visit Type Selection */}
                <div className="w-full">
                  <Label className="text-sm font-semibold text-slate-700 mb-2 block">Visit Type *</Label>
                  <Select value={visitType} onValueChange={setVisitType}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select visit type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableVisitTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Diagnosis Selection */}
                <div className="w-full">
                  <Label className="text-sm font-semibold text-slate-700 mb-2 block">Primary Diagnosis *</Label>
                  {!showCustomSearch ? (
                    <div className="space-y-2">
                      <Input
                        placeholder="Search common diagnoses..."
                        value={diagnosisSearch}
                        onChange={(e) => setDiagnosisSearch(e.target.value)}
                        className="h-11"
                      />
                      <Select value={selectedDiagnosis} onValueChange={(value) => {
                        if (value === "__other__") {
                          setShowCustomSearch(true);
                          setDiagnosisSearch("");
                        } else {
                          setSelectedDiagnosis(value);
                          setDiagnosisSearch("");
                        }
                      }}>
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="Select diagnosis..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          {filteredDiagnoses.map((diagnosis) => (
                            <SelectItem key={diagnosis} value={diagnosis}>
                              {diagnosis}
                            </SelectItem>
                          ))}
                          <SelectItem value="__other__">
                            <span className="text-blue-600 font-medium">Other — Search by name or ICD-10...</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Type diagnosis name or ICD-10 code..."
                          value={customDiagnosisSearch}
                          onChange={(e) => setCustomDiagnosisSearch(e.target.value)}
                          className="h-11 flex-1"
                          autoFocus
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 px-3 text-xs"
                          onClick={() => { setShowCustomSearch(false); setCustomDiagnosisSearch(""); }}
                        >
                          Back
                        </Button>
                      </div>
                      {customDiagnosisSearch.trim().length >= 2 && (
                        <Button
                          variant="outline"
                          className="w-full h-11 justify-start text-left text-sm"
                          onClick={() => {
                            setSelectedDiagnosis(customDiagnosisSearch.trim());
                            setShowCustomSearch(false);
                            setCustomDiagnosisSearch("");
                          }}
                        >
                          Use: <span className="font-semibold ml-1">{customDiagnosisSearch.trim()}</span>
                        </Button>
                      )}
                      <p className="text-[10px] text-slate-500">Type at least 2 characters, then click to select</p>
                    </div>
                  )}
                  {selectedDiagnosis && (
                    <div className="mt-1 flex items-center gap-2">
                      <Badge className="bg-blue-100 text-blue-800 text-xs">{selectedDiagnosis}</Badge>
                      <button onClick={() => { setSelectedDiagnosis(""); setShowCustomSearch(false); }} className="text-xs text-slate-400 hover:text-red-500">clear</button>
                    </div>
                  )}
                </div>

                {/* Smart Template Suggester with AI matching */}
                {visitType && providerType && (
                  <SmartTemplateSuggester
                    visitType={visitType}
                    providerType={providerType}
                    diagnosis={selectedDiagnosis}
                    patientData={patientData}
                    onSelectTemplate={(formattedNote, template) => {
                      setRoughNotes(formattedNote);
                      setSelectedTemplate(template);
                    }}
                    onOpenCreator={(initialData) => {
                      setTemplateCreatorInitData(initialData || null);
                      setShowTemplateCreator(true);
                    }}
                  />
                )}

                {/* Template Education Suggestions */}
                {visitType && providerType && selectedTemplate && (
                  <TemplateEducationSuggestions
                    templateId={selectedTemplate.id}
                    patientDiagnosis={selectedDiagnosis}
                  />
                )}

                {/* Visit Type Guidance */}
                {visitType && <VisitTypeGuidance visitType={visitType} diagnosis={selectedDiagnosis} />}

                {/* OASIS Field Suggestions - Only for RN on Admission visits */}
                {providerType === 'RN' && visitType === 'admission' && selectedDiagnosis && (
                  <OASISFieldSuggester
                    visitType={visitType}
                    diagnosis={selectedDiagnosis}
                    noteContent={roughNotes}
                    patientContext={patientData ? {
                      age: patientData.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : null,
                      diagnoses: [patientData.primary_diagnosis, ...(patientData.secondary_diagnoses || [])],
                      medications: patientData.current_medications
                    } : null}
                    onFieldsGenerated={(fields) => {
                      console.log('OASIS fields suggested:', fields);
                    }}
                  />
                )}

                {/* Real-Time HIPAA Compliance Checker - Physicians & NPs only */}
                {(providerType === 'MD' || providerType === 'NP') && visitType && roughNotes && roughNotes.length > 100 && (
                  <RealtimeComplianceChecker
                    noteContent={roughNotes}
                    providerType={providerType}
                    visitType={visitType}
                    onComplianceUpdate={(result) => {
                      if (result.score < 85) {
                        console.log('Compliance issues detected:', result.issues);
                      }
                    }}
                  />
                )}

                {/* Real-Time Compliance Monitor */}
                {visitType && selectedDiagnosis && roughNotes && roughNotes.length > 100 && (
                  <RealTimeComplianceMonitor
                    content={roughNotes}
                    documentType={visitType}
                    patientId={selectedPatient !== 'no_patient' ? selectedPatient : null}
                    onScoreChange={(score) => {
                      if (score < 70) {
                        console.log('Low compliance score detected:', score);
                      }
                    }}
                  />
                )}

                {/* Unified AI Documentation Assistant */}
                {visitType && selectedDiagnosis && (
                  <UnifiedAIDocumentationAssistant
                    patientId={selectedPatient}
                    patientData={patientData}
                    visitType={visitType}
                    diagnosis={selectedDiagnosis}
                    clinicalNotes={roughNotes}
                    extractedData={extractedData}
                    onFieldsPopulated={(result) => {
                      if (result.fields) {
                        const populated = `\nAssessment: ${result.fields.assessment}\n\nPlan: ${result.fields.plan}`;
                        setRoughNotes(roughNotes + populated);
                        toast.success('Fields populated');
                      }
                    }}
                    onCodesGenerated={(result) => {
                      console.log('ICD-10 codes generated:', result.codes);
                    }}
                    onEducationGenerated={(result) => {
                      setSuggestedEducation([result.material]);
                      toast.success('Education material generated');
                    }}
                    onComplianceChecked={(result) => {
                      console.log('Compliance check completed:', result);
                    }}
                  />
                )}

                {/* Clinical Decision Support Panel */}
                {visitType && selectedDiagnosis && (
                  <ClinicalDecisionSupportPanel
                    symptoms={roughNotes}
                    findings={roughNotes}
                    diagnosis={selectedDiagnosis}
                    patientAge={patientData?.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : null}
                    patientConditions={patientData?.secondary_diagnoses || []}
                    currentMedications={patientData?.current_medications || []}
                    patientId={selectedPatient}
                  />
                )}

                {/* AI Clinical Assistant Panel */}
                {visitType && selectedDiagnosis && (
                  <AIClinicalAssistantPanel
                    patientId={selectedPatient !== "no_patient" ? selectedPatient : null}
                    patientName={patientData ? `${patientData.first_name} ${patientData.last_name}` : null}
                    noteContent={roughNotes}
                    visitType={visitType}
                    diagnosis={selectedDiagnosis}
                    providerType={providerType}
                    careSetting={careSetting}
                    vitalSigns={vitalSigns}
                    onInsertDraft={(draft) => {
                      setRoughNotes(draft);
                      toast.success("Draft note inserted");
                    }}
                    onApplyFix={(text) => {
                      setRoughNotes(roughNotes + '\n\n' + text);
                      toast.success("Fix applied");
                    }}
                  />
                )}

                {/* Proactive AI Gap Analyzer */}
                {visitType && selectedDiagnosis && (
                  <ProactiveGapAnalyzer
                    patient={patientData}
                    visitType={visitType}
                    diagnosis={selectedDiagnosis}
                    roughNotes={roughNotes}
                    vitalSigns={vitalSigns}
                    providerType={providerType}
                    careSetting={careSetting}
                    onResolveGap={(text) => setRoughNotes(roughNotes + '\n\n' + text)}
                  />
                )}

                {/* Documentation Gap Detection */}
                {visitType && selectedDiagnosis && roughNotes && (
                  <DocumentationGapDetector
                    visitType={visitType}
                    diagnosis={selectedDiagnosis}
                    noteContent={roughNotes}
                    vitalSigns={vitalSigns}
                    patientContext={patientData}
                    onGapIdentified={(gaps) => {
                      if (gaps.some(g => g.severity === 'critical')) {
                        toast.warning('Critical documentation gaps detected');
                      }
                    }}
                    onGapResolved={(enhancedNote) => {
                      setRoughNotes(enhancedNote);
                    }}
                  />
                )}

                {/* Code Search & Inserter - Only for Physicians & NPs */}
                {(providerType === 'MD' || providerType === 'NP') && (
                  <CodeSearchInserter
                    onInsertCode={(code) => {
                      setRoughNotes(roughNotes + '\n\n' + code);
                      toast.success('Code inserted into notes');
                    }}
                    noteType="rough"
                  />
                )}

                </div>

                {/* Vital Signs Section */}
                <div className="w-full bg-slate-50 p-4 rounded-lg border border-slate-200">
                 <Label className="text-sm font-semibold text-slate-700 mb-3 block">Vital Signs</Label>
                 {selectedPatient !== 'no_patient' && (
                   <VitalSignsQuickButton
                     patientId={selectedPatient}
                     onApply={(vitals) => {
                       setVitalSigns({
                         temperature: vitals.temperature || vitalSigns.temperature,
                         heart_rate: vitals.heart_rate || vitalSigns.heart_rate,
                         respiratory_rate: vitals.respiratory_rate || vitalSigns.respiratory_rate,
                         bp_systolic: vitals.blood_pressure?.split('/')[ 0] || vitalSigns.bp_systolic,
                         bp_diastolic: vitals.blood_pressure?.split('/')[1] || vitalSigns.bp_diastolic,
                         oxygen_saturation: vitals.oxygen_saturation || vitalSigns.oxygen_saturation
                       });
                     }}
                   />
                 )}
                 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1 sm:mt-2">
                   <div>
                    <label className="text-[9px] sm:text-[10px] md:text-xs text-slate-600 dark:text-slate-400 block mb-1">Temp (°F)</label>
                     <Input
                       type="number"
                       step="0.1"
                       placeholder="98.6"
                       value={vitalSigns.temperature}
                       onChange={(e) => setVitalSigns({...vitalSigns, temperature: e.target.value})}
                       className="h-9 text-sm"
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



                {/* Patient Context Quick Insert */}
                {selectedPatient !== 'no_patient' && patientData && (
                  <PatientContextSidebar
                    patientId={selectedPatient}
                    onInsertContext={(text) => {
                      setRoughNotes(roughNotes + '\n\n' + text);
                    }}
                  />
                )}

                {/* Visit-Relevant History Summary */}
                {selectedPatient !== 'no_patient' && patientData && visitType && selectedDiagnosis && (
                  <VisitRelevantHistorySummary
                    patient={patientData}
                    visitType={visitType}
                    diagnosis={selectedDiagnosis}
                    onInsertText={(text) => setRoughNotes(roughNotes + text)}
                  />
                )}

                {/* AI Follow-Up Questions & Assessments */}
                {selectedPatient !== 'no_patient' && patientData && visitType && selectedDiagnosis && (
                  <AIFollowUpQuestions
                    patient={patientData}
                    visitType={visitType}
                    diagnosis={selectedDiagnosis}
                    roughNotes={roughNotes}
                    onInsertQuestion={(text) => setRoughNotes(roughNotes + '\n\n' + text)}
                  />
                )}

                {/* Clinical Notes Section */}
                <div className="w-full">
                  <div className="mb-3">
                    <Label className="text-sm font-semibold text-slate-700 mb-1 block">Clinical Notes *</Label>
                    <p className="text-xs text-slate-600">Type or dictate your clinical observations and findings</p>
                  </div>

                  {/* Auto-Save Indicator */}
                  {selectedPatient !== "no_patient" && (
                    <AutoSaveIndicator
                      noteContent={roughNotes}
                      onSave={async () => {
                        if (selectedPatient !== "no_patient" && roughNotes.trim()) {
                          saveOfflineNote({
                            patientId: selectedPatient,
                            visitType,
                            diagnosis: selectedDiagnosis,
                            enhancedNote: roughNotes,
                            roughNotes,
                            vitalSigns
                          });
                        }
                      }}
                      enabled={true}
                    />
                  )}

                  {/* Draft Versions */}
                  {selectedPatient !== "no_patient" && (
                    <NoteDraftVersions
                      patientId={selectedPatient}
                      visitType={visitType}
                      diagnosis={selectedDiagnosis}
                      onVersionSelect={(version) => {
                        setRoughNotes(version.content);
                        toast.info("Version loaded");
                      }}
                    />
                  )}

                  <VoiceDictationInput
                    value={roughNotes}
                    onChange={(e) => setRoughNotes(e.target.value)}
                    placeholder="Enter your rough clinical notes here or use voice dictation...

Example: Patient reports feeling better, pain level 2/10. Medications reviewed, compliant. Wound healing well, no signs of infection. Patient ambulating with walker..."



                  />
                </div>

                {/* Generate Enhanced Note Button */}
                <div className="pt-2 border-t border-slate-200">
                <Button
                onClick={enhanceNote}
                disabled={enhancing || !visitType || !selectedDiagnosis || !roughNotes.trim()}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all"
                size="lg">

                  {enhancing ?
                  <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Generating Enhanced Note...
                    </> :

                  <>
                      <Sparkles className="w-5 h-5 mr-2" />
                      Generate Enhanced Note
                    </>
                  }
                  </Button>
                  </div>
              </CardContent>
            </Card>
          </> :

        <>
            {/* Results Page */}
            <div className="space-y-3 sm:space-y-4 w-full max-w-full overflow-x-hidden min-w-0">


              {/* Time Savings Summary */}
              {timeSavedMinutes > 0 && (
                <TimeSavingsSummary 
                  timeSavedMinutes={timeSavedMinutes} 
                  feature="note_enhancement" 
                />
              )}

              {/* Note Completeness Tracker */}
              <NoteCompletenessTracker
                noteContent={isEditMode ? editedNote : enhancedNote}
                complianceResults={complianceResults}
                visitType={visitType}
                providerType={providerType}
              />

              {/* Enhanced Note Display */}
              <Card className="border-green-200 shadow-md">
                <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100 p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="p-1.5 bg-green-600 rounded-lg">
                        <CheckCircle2 className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <span className="font-semibold text-lg text-slate-900 block">Enhanced Clinical Note</span>
                        <span className="text-xs text-slate-600">AI-optimized and compliance-checked</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      {complianceResults?.compliance_score && (
                        <Badge className={`${complianceResults.compliance_score >= 85 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'} text-xs font-semibold px-3 py-1`}>
                          {complianceResults.compliance_score}% Compliant
                        </Badge>
                      )}
                      <Button onClick={() => { navigator.clipboard.writeText(enhancedNote); toast.success("Copied!"); }} variant="outline" size="sm">Copy</Button>
                      {!isEditMode && <Button onClick={() => { setIsEditMode(true); setEditedNote(enhancedNote); }} variant="outline" size="sm">Edit</Button>}
                      {patientData && !isEditMode && (
                        <Button onClick={saveToPatientRecord} disabled={savingToPatient} className="bg-green-600 hover:bg-green-700" size="sm">
                          {savingToPatient ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save to Record'}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 sm:p-6">
                  {isEditMode ? (
                    <div className="space-y-3">
                      <textarea value={editedNote} onChange={(e) => setEditedNote(e.target.value)} className="w-full h-64 p-4 border-2 border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono" />
                      <div className="flex gap-2">
                        <Button onClick={() => { setEnhancedNote(editedNote); setIsEditMode(false); recheckCompliance(); }} className="bg-green-600 hover:bg-green-700">Save & Recheck</Button>
                        <Button onClick={() => { setEditedNote(enhancedNote); setIsEditMode(false); }} variant="outline">Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-5 rounded-lg text-sm whitespace-pre-wrap max-h-96 overflow-y-auto border border-slate-200 leading-relaxed">
                      {enhancedNote}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Post-Enhancement AI Insights: ICD-10, Tasks, Compliance */}
              <PostEnhancementInsights
                enhancedNote={isEditMode ? editedNote : enhancedNote}
                diagnosis={selectedDiagnosis}
                visitType={visitType}
                providerType={providerType}
                careSetting={careSetting}
                patientId={selectedPatient}
                patientData={patientData}
                currentUserEmail={currentUser?.email}
                onCodesSelected={(codes) => {
                  console.log('ICD-10 codes selected:', codes);
                  toast.success(`${codes.length} code(s) added`);
                }}
              />

              {/* AI Feedback */}
              <InlineAIFeedback
                suggestionType="note_enhancement"
                suggestionContent={enhancedNote?.substring(0, 500)}
                userEmail={currentUser?.email}
                contextData={{ visit_type: visitType, diagnosis: selectedDiagnosis, care_setting: careSetting }}
              />

              {/* Unified Suggestions & Quick Actions */}
              <UnifiedSuggestionsApplier
                complianceIssues={complianceResults?.issues || []}
                qualitySuggestions={complianceResults?.quality_analysis?.suggestions || []}
                educationMaterials={suggestedEducation}
                medicareViolations={medicareViolations}
                noteContent={isEditMode ? editedNote : enhancedNote}
                loading={enhancing}
                onApplyAll={async () => {
                  // Apply all quality improvements
                  let improvedNote = isEditMode ? editedNote : enhancedNote;
                  
                  // Apply quality suggestions
                  if (complianceResults?.quality_analysis?.suggestions) {
                    for (const suggestion of complianceResults.quality_analysis.suggestions) {
                      if (suggestion.excerpt && suggestion.improved_text && improvedNote.includes(suggestion.excerpt)) {
                        improvedNote = improvedNote.replace(suggestion.excerpt, suggestion.improved_text);
                      }
                    }
                  }
                  
                  setEditedNote(improvedNote);
                  setEnhancedNote(improvedNote);
                  setIsEditMode(false);
                  toast.success("All suggestions applied successfully!");
                  await recheckCompliance();
                }}
              />

              {/* New Note Button */}
              <Button onClick={() => { setShowResults(false); setEnhancedNote(null); setRoughNotes(""); setIsEditMode(false); }} variant="outline" className="w-full touch-target">
                Create New Note
              </Button>

              {/* Detailed Audit - Collapsed by Default */}
              {(medicareViolations.length > 0 || complianceResults?.quality_analysis?.suggestions?.length > 0) && (
              <details className="group w-full">
                <summary className="cursor-pointer list-none">
                  <Card className="hover:shadow-md transition-all border-slate-200">
                    <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100 p-4 sm:p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4 text-slate-600" />
                          <span className="text-xs font-semibold text-slate-700">Detailed Audit Report</span>
                        </div>
                        <span className="text-xs text-slate-500 group-open:hidden">▼</span>
                        <span className="text-xs text-slate-500 hidden group-open:inline">▲</span>
                      </div>
                    </CardHeader>
                  </Card>
                </summary>
                <div className="mt-2 space-y-3 w-full">
                  <UnifiedComplianceAudit complianceResults={complianceResults} medicareViolations={medicareViolations} regulatoryWarnings={regulatoryWarnings} qualityAnalysis={complianceResults?.quality_analysis} />
                </div>
              </details>
              )}

              {/* Clinical Tools & Education - Collapsed by Default */}
              <details className="group w-full">
              <summary className="cursor-pointer list-none">
                <Card className="hover:shadow-md transition-all border-slate-200">
                  <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100 p-4 sm:p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-slate-600" />
                        <span className="text-xs font-semibold text-slate-700">Clinical Tools & Education</span>
                      </div>
                      <span className="text-xs text-slate-500 group-open:hidden">▼</span>
                      <span className="text-xs text-slate-500 hidden group-open:inline">▲</span>
                    </div>
                  </CardHeader>
                </Card>
              </summary>
              <div className="mt-2 space-y-3 w-full">
                  {(providerType === 'MD' || providerType === 'NP') && (
                    <>
                      <ICD10CodeSuggester
                        noteContent={isEditMode ? editedNote : enhancedNote}
                        diagnosis={selectedDiagnosis}
                        visitType={visitType}
                        onCodesSelected={(codes) => {
                          console.log('ICD-10 codes selected:', codes);
                          toast.success(`${codes.length} code(s) selected`);
                        }}
                      />

                      <FollowUpTaskGenerator
                        noteContent={isEditMode ? editedNote : enhancedNote}
                        diagnosis={selectedDiagnosis}
                        patientId={selectedPatient !== 'no_patient' ? selectedPatient : null}
                        currentUserEmail={currentUser?.email}
                        onTasksCreated={(tasks) => {
                          console.log('Follow-up tasks created:', tasks);
                        }}
                      />

                      <EnhancedMedicalCodingAssistant
                        noteContent={isEditMode ? editedNote : enhancedNote}
                        diagnosis={selectedDiagnosis}
                        procedures={extractedData?.procedures || ''}
                        patientAge={patientData?.age}
                        visitType={visitType}
                        patientId={selectedPatient !== 'no_patient' ? selectedPatient : null}
                        onCodesSelected={(codes) => {
                          console.log('Codes selected:', codes);
                        }}
                      />

                      <AdvancedMedicalCodingAssistant
                        enhancedNote={isEditMode ? editedNote : enhancedNote}
                        extractedData={extractedData}
                        diagnosis={selectedDiagnosis}
                        visitType={visitType}
                        onCodesGenerated={(codes) => {
                          console.log('Medical codes generated:', codes);
                        }}
                      />
                      </>
                      )}
                  <MedicalCodingAssistant enhancedNote={enhancedNote} diagnosis={selectedDiagnosis} visitType={visitType} providerType={providerType} patientContext={patientData ? { patient_name: `${patientData.first_name} ${patientData.last_name}`, primary_diagnosis: patientData.primary_diagnosis, secondary_diagnoses: patientData.secondary_diagnoses, current_medications: patientData.current_medications } : null} currentUser={currentUser} />
                  {patientData && (providerType === 'RN' || providerType === 'MSW' || providerType === 'NP' || providerType === 'PT' || providerType === 'OT' || providerType === 'ST') && (
                    <CarePlanSuggestionsPanel patientId={patientData.id} visitType={visitType} diagnosis={selectedDiagnosis} noteContent={enhancedNote} providerType={providerType} />
                  )}
                  {patientData && (
                    <>
                      <PatientEducationGenerator
                        patientAge={patientData?.age}
                        onMaterialGenerated={(material) => {
                          console.log('Patient education material generated:', material);
                          toast.success('Educational material generated!');
                        }}
                      />
                      <PatientEducationPanel suggestedMaterials={suggestedEducation} patientId={selectedPatient} patientEmail={patientData?.email} onEducationProvided={(material, method) => { setProvidedEducation(prev => [...prev, { material, method }]); toast.success('Education documented'); }} />
                    </>
                  )}
                </div>
              </details>
            </div>
          </>
        }

        {/* Create Patient Dialog */}
        {(showCreatePatient || selectedPatient === "create_new") &&
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <Card className="w-full max-w-md">
              <CardHeader className="p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base sm:text-lg">Create New Patient</CardTitle>
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
              <CardContent className="space-y-4 p-4 sm:p-6 pt-0">
                <div>
                  <Label className="text-xs sm:text-sm">First Name *</Label>
                  <Input
                  value={newPatientData.first_name}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    first_name: e.target.value
                  })
                  }
                  placeholder="John"
                  className="h-11" />

                </div>
                <div>
                  <Label className="text-xs sm:text-sm">Last Name *</Label>
                  <Input
                  value={newPatientData.last_name}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    last_name: e.target.value
                  })
                  }
                  placeholder="Doe"
                  className="h-11" />

                </div>
                <div>
                  <Label className="text-xs sm:text-sm">Date of Birth</Label>
                  <Input
                  type="date"
                  value={newPatientData.date_of_birth}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    date_of_birth: e.target.value
                  })
                  }
                  className="h-11" />

                </div>
                <div>
                  <Label className="text-xs sm:text-sm">Medical Record Number</Label>
                  <Input
                  value={newPatientData.medical_record_number}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    medical_record_number: e.target.value
                  })
                  }
                  placeholder="MRN-12345"
                  className="h-11" />

                </div>
                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <Button
                  variant="outline"
                  className="flex-1 w-full touch-target"
                  onClick={() => {
                    setShowCreatePatient(false);
                    setSelectedPatient("no_patient");
                  }}>

                    Cancel
                  </Button>
                  <Button
                  className="flex-1 w-full touch-target"
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
        {/* Custom Template Creator Dialog */}
        {showTemplateCreator && (
          <CustomTemplateCreator
            onClose={() => { setShowTemplateCreator(false); setTemplateCreatorInitData(null); }}
            onSaved={() => { setShowTemplateCreator(false); setTemplateCreatorInitData(null); }}
            initialData={templateCreatorInitData}
            visitType={visitType}
            providerType={providerType}
            diagnosis={selectedDiagnosis}
          />
        )}
                    </div>
                    </div>
    </PremiumFeatureGate>);

}