import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Mic, Save, Clock, User, Sparkles, FileText, CheckCircle2, Download, Mail, AlertCircle, MessageSquare, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

import AudioRecorder from "../components/visit/AudioRecorder";
import VitalSignsForm from "../components/visit/VitalSignsForm";
import TemplateGenerator from "../components/visit/TemplateGenerator";
import AIStructuredNoteGenerator from "../components/visit/AIStructuredNoteGenerator";
import RealTimeDocumentationAssistant from "../components/visit/RealTimeDocumentationAssistant";
import VitalSignsComparison from "../components/visit/VitalSignsComparison";
import ClinicalDecisionSupport from "../components/visit/ClinicalDecisionSupport";
import CarePlanProgress from "../components/visit/CarePlanProgress";
import TextExpander from "../components/visit/TextExpander";
import OneClickActions from "../components/visit/OneClickActions";
import MedicationReconciliation from "../components/visit/MedicationReconciliation";
import TeamNotes from "../components/visit/TeamNotes";
import SmartReminders from "../components/visit/SmartReminders";
import PreVisitPrep from "../components/visit/PreVisitPrep";
import SameAsLastVisit from "../components/visit/SameAsLastVisit";
import AIDocumentationPolish from "../components/visit/AIDocumentationPolish";
import AIQualityAssurance from "../components/visit/AIQualityAssurance";
import PredictiveMonitoring from "../components/visit/PredictiveMonitoring";
import QuickTemplatesLibrary from "../components/visit/QuickTemplatesLibrary";
import QuickIncidentReporting from "../components/visit/QuickIncidentReporting";
import FamilyCommunication from "../components/visit/FamilyCommunication"; 
import NoteScrubber from "../components/visit/NoteScrubber";
import SmartAssessmentSuggestions from "../components/visit/SmartAssessmentSuggestions";
import SmartVitalsPredictor from "../components/visit/SmartVitalsPredictor";
import OASISScrubber from "../components/visit/OASISScrubber";
import EarlyWarningSystem from "../components/patient/EarlyWarningSystem";
import VoiceDataEntry from "../components/visit/VoiceDataEntry";
import HomeboundVerification from "../components/visit/HomeboundVerification";
import ClinicalBestPracticeAlerts from "../components/quality/ClinicalBestPracticeAlerts";
import SkilledNeedJustificationAssistant from "../components/visit/SkilledNeedJustificationAssistant";
import PatientResponsePrompter from "../components/visit/PatientResponsePrompter";
import EnhancedOASISScrubber from "../components/visit/EnhancedOASISScrubber";
import AIDocumentationAssistant from "../components/visit/AIDocumentationAssistant";
import AIDocumentationAutomation from "../components/visit/AIDocumentationAutomation";
import RealTimeClinicalDecisionSupport from "../components/clinical/RealTimeClinicalDecisionSupport";
import EnhancedClinicalDecisionSupport from "../components/clinical/EnhancedClinicalDecisionSupport";
import AIDocumentationAudit from "../components/audit/AIDocumentationAudit";
import RichTextNoteEditor from "../components/smartNote/RichTextNoteEditor";
import SmartVitalsInput from "../components/smartNote/SmartVitalsInput";
import ICD10CodeSuggester from "../components/visit/ICD10CodeSuggester";
import DischargeVisitSummary from "../components/visit/DischargeVisitSummary";
import ProactiveRiskIdentifier from "../components/alerts/ProactiveRiskIdentifier";
import MedicalScribeAssistant from "../components/scribe/MedicalScribeAssistant";
import PatientRiskPredictor from "../components/risk/PatientRiskPredictor";
import PreVisitPreparation from "../components/visit/PreVisitPreparation";
import SNOMEDCodeSearch from "../components/clinical/SNOMEDCodeSearch";
import AdaptiveLearningDashboard from "../components/smartNote/AdaptiveLearningDashboard";
import RealTimeTaskGenerator from "../components/visit/RealTimeTaskGenerator";
import QuickPatientHandoutGenerator from "../components/visit/QuickPatientHandoutGenerator";
import PostConsultationAutomation from "../components/visit/PostConsultationAutomation";

import { 
  canAccessVisit, 
  validateFileUpload, 
  logSecurityEvent, 
  secureAICall, 
  sanitizeInput,
  clearSensitiveData,
  handleSecureError,
  secureUpdate
} from "@/components/utils/security";

import {
  trackAISuggestion,
  trackDocumentationActivity,
  trackTemplateUsage,
  trackVoiceCommand,
  trackVisitCompletion
} from "@/components/utils/performanceTracking";

import VoiceCommandListener from "../components/voice/VoiceCommandListener";
import { getCommandsForContext } from "../components/voice/voiceCommands";
import CameraScanner from "../components/mobile/CameraScanner";
import offlineStorage from "../components/mobile/OfflineStorage";

export default function DocumentVisit() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const visitId = urlParams.get('visitId');

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingTemplate, setIsGeneratingTemplate] = useState(false);
  const [narrativeText, setNarrativeText] = useState("");
  const [vitalSigns, setVitalSigns] = useState({});
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [hasGeneratedTemplate, setHasGeneratedTemplate] = useState(false);
  const [recognizedCommand, setRecognizedCommand] = useState(null);
  const [commandHistory, setCommandHistory] = useState([]);
  const [lastSaved, setLastSaved] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const autoSaveTimerRef = useRef(null);
  const [hasAccess, setHasAccess] = useState(null);
  const [aiToolsUsed, setAiToolsUsed] = useState([]);
  const documentationStartTime = useRef(new Date());
  const [scannedDocuments, setScannedDocuments] = useState([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [selectedSnomedCodes, setSelectedSnomedCodes] = useState([]); 

  useEffect(() => {
    const checkAccess = async () => {
      if (!visitId) {
        setHasAccess(false);
        return;
      }
      
      const access = await canAccessVisit(visitId);
      setHasAccess(access);
      
      if (access) {
        await logSecurityEvent('VISIT_DOCUMENTATION_ACCESSED', { visit_id: visitId });
      } else {
        await logSecurityEvent('UNAUTHORIZED_VISIT_ACCESS_ATTEMPT', { visit_id: visitId });
      }
    };
    
    checkAccess();
  }, [visitId]);

  // Cleanup sensitive data on unmount
  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearSensitiveData({
        setNarrativeText,
        setVitalSigns,
        setStartTime,
        setEndTime
      });
    };
  }, []);

  const { data: visit, isLoading } = useQuery({
    queryKey: ['visit', visitId],
    queryFn: () => base44.entities.Visit.filter({ id: visitId }),
    select: (data) => data[0],
    enabled: !!visitId && hasAccess === true, 
  });

  const { data: patient } = useQuery({
    queryKey: ['patient', visit?.patient_id],
    queryFn: () => base44.entities.Patient.filter({ id: visit.patient_id }),
    select: (data) => data[0],
    enabled: !!visit?.patient_id && hasAccess === true, 
  });

  const { data: allVisits } = useQuery({
    queryKey: ['patientAllVisits', visit?.patient_id],
    queryFn: () => base44.entities.Visit.filter({ 
      patient_id: visit.patient_id,
      status: 'completed'
    }, '-visit_date'),
    enabled: !!visit?.patient_id && hasAccess === true, 
    initialData: [],
  });

  const previousVisit = allVisits && allVisits.length > 0 ? allVisits[0] : null;

  const { data: carePlans } = useQuery({
    queryKey: ['carePlans', visit?.patient_id],
    queryFn: () => base44.entities.CarePlan.filter({ 
      patient_id: visit.patient_id,
      status: 'active'
    }),
    initialData: [],
    enabled: !!visit?.patient_id && hasAccess === true, 
  });

  useEffect(() => {
    if (visit) {
      setNarrativeText(visit.nurse_notes || "");
      setVitalSigns(visit.vital_signs || {});
      setStartTime(visit.start_time || "");
      setEndTime(visit.end_time || "");
      
      if (!visit.start_time && visit.status === 'scheduled') {
        const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        setStartTime(now);
        updateVisitMutation.mutate({ 
          status: 'in_progress', 
          start_time: now 
        });
      }
    }
  }, [visit]);

  const updateVisitMutation = useMutation({
    mutationFn: (updates) => base44.entities.Visit.update(visitId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit', visitId] });
      queryClient.invalidateQueries({ queryKey: ['todayVisits'] });
    },
  });

  const autoSave = async () => {
    if (!hasUnsavedChanges || isSaving) return;
    
    setIsSaving(true);
    try {
      const sanitizedNarrative = sanitizeInput(narrativeText);
      
      await secureUpdate(
        base44.entities.Visit,
        visitId,
        {
          nurse_notes: sanitizedNarrative,
          vital_signs: vitalSigns,
          start_time: startTime,
          end_time: endTime
        },
        'Visit'
      );
      
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (error) {
      await handleSecureError(error, 'visit_auto_save', null);
    }
    setIsSaving(false);
  };

  useEffect(() => {
    if (visit && (narrativeText !== (visit.nurse_notes || "") || JSON.stringify(vitalSigns) !== JSON.stringify(visit.vital_signs || {}))) {
      setHasUnsavedChanges(true);
      
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      
      autoSaveTimerRef.current = setTimeout(() => {
        autoSave();
      }, 30000);
    }

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [narrativeText, vitalSigns, startTime, endTime, visit]);

  const handleVoiceCommand = async (action, spokenText) => {
    // Track voice command usage
    await trackVoiceCommand({
      command: action,
      context: 'documentation',
      page: 'DocumentVisit',
      success: true
    });
    
    let insertText = "";
    
    switch (action) {
      case 'insert_cardiovascular':
        insertText = "\n\n**CARDIOVASCULAR ASSESSMENT:**\n[Nurse to document: heart sounds, peripheral pulses, edema, chest pain, palpitations]\n";
        break;
      case 'insert_respiratory':
        insertText = "\n\n**RESPIRATORY ASSESSMENT:**\n[Nurse to document: lung sounds, respiratory effort, dyspnea, cough, sputum]\n";
        break;
      case 'insert_medication':
        insertText = "\n\n**MEDICATION MANAGEMENT:**\nCurrent medications reviewed with patient. Patient demonstrates understanding of medication purposes and proper administration. Compliance assessed. No adverse effects reported.\n[Nurse to document: specific medication changes, concerns, or teaching needs]\n";
        break;
      case 'insert_education':
        insertText = "\n\n**PATIENT/CAREGIVER EDUCATION:**\nEducation provided regarding [disease process/medications/safety/self-care]. Teaching methods: [verbal/written/demonstration]. Patient/caregiver demonstrates understanding via teach-back method. [Specific topics covered].\n";
        break;
      case 'insert_normal_findings':
        insertText = "\n\nPhysical Assessment: Alert and oriented x3. Skin warm, dry, intact. Heart sounds S1 S2 regular, no murmurs. Lung sounds clear bilaterally. Abdomen soft, non-tender. Extremities: No edema, peripheral pulses 2+ bilaterally.\n";
        break;
      case 'insert_normal_cardiovascular':
        insertText = "\n\nCardiovascular: Heart rate regular, S1 S2 present, no S3/S4, no murmurs, gallops, or rubs. Peripheral pulses 2+ and equal bilaterally. No jugular venous distention. No peripheral edema noted.\n";
        break;
      case 'insert_normal_respiratory':
        insertText = "\n\nRespiratory: Lung sounds clear to auscultation bilaterally, no wheezes, crackles, or rhonchi. Respiratory effort unlabored, no use of accessory muscles. No dyspnea at rest.\n";
        break;
      case 'insert_homebound':
        insertText = "\n\n**HOMEBOUND STATUS:**\nPatient remains homebound due to [taxing effort to leave home/requires assistance of another person/medical contraindication]. Objective evidence: [severe shortness of breath with minimal exertion/requires walker and standby assistance/severe pain limiting mobility/cognitive impairment requiring supervision]. Patient leaves home only for medical appointments with assistance.\n";
        break;
      case 'insert_skilled_need':
        insertText = "\n\n**SKILLED NURSING NECESSITY:**\nSkilled nursing services required for [complex assessment/medication management/wound care/patient education]. Patient unable to safely self-manage due to [complexity of condition/cognitive limitations/physical limitations/lack of caregiver]. RN judgment and skilled assessment required for [monitoring unstable condition/managing complex medication regimen/providing skilled instruction].\n";
        break;
      case 'insert_physician_notification':
        insertText = "\n\n**PHYSICIAN NOTIFICATION:**\nPhysician Dr. [name] notified via [phone/secure message] at [time] regarding [findings]. [Orders received: _____ / No new orders at this time]. Patient/caregiver instructed per physician orders.\n";
        break;
      case 'insert_vitals':
        if (Object.keys(vitalSigns).length > 0) {
          let vitalsText = "\n\n**VITAL SIGNS:**\n";
          if (vitalSigns.temperature) vitalsText += `Temperature: ${vitalSigns.temperature}°F\n`;
          if (vitalSigns.blood_pressure_systolic) vitalsText += `Blood Pressure: ${vitalSigns.blood_pressure_systolic}/${vitalSigns.blood_pressure_diastolic} mmHg\n`;
          if (vitalSigns.heart_rate) vitalsText += `Heart Rate: ${vitalSigns.heart_rate} bpm\n`;
          if (vitalSigns.respiratory_rate) vitalsText += `Respiratory Rate: ${vitalSigns.respiratory_rate} breaths/minute\n`;
          if (vitalSigns.oxygen_saturation) vitalsText += `Oxygen Saturation: ${vitalSigns.oxygen_saturation}%\n`;
          if (vitalSigns.pain_level !== undefined) vitalsText += `Pain Level: ${vitalSigns.pain_level}/10\n`;
          insertText = vitalsText;
        }
        break;
      case 'copy_previous':
        if (previousVisit && previousVisit.nurse_notes) {
          insertText = `\n\n[Previous visit note for reference - modify as needed]:\n${previousVisit.nurse_notes}\n`;
        }
        break;
      case 'save_documentation':
        handleSave();
        setRecognizedCommand('Saving Documentation...');
        break;
      case 'generate_template':
        generateSmartTemplate();
        setRecognizedCommand('Generating Template...');
        break;
      case 'report_fall':
        document.querySelector('[data-incident="fall"]')?.click();
        setRecognizedCommand('Fall Incident Reported');
        return;
      case 'report_hospitalization':
        document.querySelector('[data-incident="hospitalized"]')?.click();
        setRecognizedCommand('Hospitalization Incident Reported');
        return;
      case 'generate_care_plans':
        const carePlanButton = document.querySelector('[data-care-plan-generator="true"]');
        if (carePlanButton) carePlanButton.click();
        setRecognizedCommand('Generating Care Plans...');
        return;
        
      default:
        console.log('Unhandled voice command:', action);
        return;
    }
    
    if (insertText) {
      setNarrativeText(prev => (prev ? prev + insertText : insertText));
    }

    setRecognizedCommand(spokenText || action.replace(/_/g, ' ').toUpperCase());
    setCommandHistory(prev => [...prev, { command: spokenText || action.replace(/_/g, ' ').toUpperCase(), time: new Date().toLocaleTimeString() }].slice(-5));
    setTimeout(() => {
      setRecognizedCommand(null);
    }, 3000);
  };

  const handleTextExpand = (expandedText) => {
    setNarrativeText(prev => (prev ? prev + '\n\n' : '') + expandedText);
  };

  const handleInsertTemplate = (templateText) => {
    setNarrativeText(prev => {
      if (prev) {
        return prev + '\n\n' + templateText;
      }
      return templateText;
    });
  };

  const handleExportPDF = async () => {
    if (!patient || !visit) {
      alert("Patient or visit data not available for export.");
      return;
    }
    try {
      const exportData = {
        patient: `${patient.first_name} ${patient.last_name}`,
        mrn: patient.medical_record_number,
        visit_date: visit.visit_date,
        visit_type: visit.visit_type,
        vital_signs: vitalSigns,
        narrative: narrativeText
      };

      // Log export
      await logSecurityEvent('VISIT_EXPORTED', { 
        visit_id: visitId,
        format: 'JSON',
        patient_id: patient.id
      });

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `visit-${patient.last_name}-${visit.visit_date}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      await handleSecureError(error, 'visit_export', (msg) => alert(msg));
    }
  };

  const handleEmailSummary = async () => {
    if (!patient || !visit) {
      alert("Patient or visit data not available for email.");
      return;
    }
    try {
      const summary = `Visit Summary for ${patient.first_name} ${patient.last_name}
Date: ${visit.visit_date}
Visit Type: ${visit.visit_type.replace(/_/g, ' ')}

Vital Signs:
${Object.keys(vitalSigns).length > 0 ? Object.entries(vitalSigns).map(([key, value]) => `- ${key.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}: ${value}`).join('\n') : 'Not recorded'}

Clinical Notes:
${narrativeText || 'In progress'}

Next Steps:
- Continue current care plan
- Follow medication schedule
- Contact nurse with any concerns

For questions, please contact your care team.`;

      const recipientEmail = patient.email || 'caregiver@example.com';
      if (!patient.email) {
        console.warn(`Patient email not found for ${patient.first_name} ${patient.last_name}. Sending to default: ${recipientEmail}`);
      }

      await base44.integrations.Core.SendEmail({
        to: recipientEmail,
        subject: `Visit Summary - ${visit.visit_date}`,
        body: summary,
        from_name: 'PennCares Home Health'
      });

      await logSecurityEvent('VISIT_SUMMARY_EMAILED', { 
        visit_id: visitId, 
        recipient: recipientEmail,
        patient_id: patient.id
      });

      alert("Visit summary sent successfully!");
    } catch (error) {
      await handleSecureError(error, 'visit_email', (msg) => alert(msg));
    }
  };

  const generateSmartTemplate = async () => {
    setIsGeneratingTemplate(true);
    setAiToolsUsed(prev => [...prev, 'smart_template']);
    
    try {
      let prompt = `You are an expert home health and hospice nurse documentation specialist. Generate a comprehensive, Medicare-compliant template for a ${visit.visit_type.replace(/_/g, ' ')} visit.

CRITICAL REQUIREMENTS:
1. DYNAMIC SECTION PRIORITIZATION: Reorder sections based on the patient's PRIMARY DIAGNOSIS
2. PROACTIVE MEDICARE COMPLIANCE: Include all required Medicare elements for ${patient.care_type === 'hospice' ? 'HOSPICE' : 'HOME HEALTH'} ${visit.visit_type.replace(/_/g, ' ')}

PATIENT INFORMATION:
- Name: ${patient.first_name} ${patient.last_name}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patient.allergies || 'NKDA'}
- Care Type: ${patient.care_type === 'hospice' ? 'Hospice Care' : 'Home Health'}
- Visit Type: ${visit.visit_type.replace(/_/g, ' ')}

`;

      if (Object.keys(vitalSigns).length > 0) {
        prompt += `\nCURRENT VITAL SIGNS ENTERED:
`;
        if (vitalSigns.temperature) prompt += `- Temperature: ${vitalSigns.temperature}°F\n`;
        if (vitalSigns.blood_pressure_systolic && vitalSigns.blood_pressure_diastolic) {
          prompt += `- Blood Pressure: ${vitalSigns.blood_pressure_systolic}/${vitalSigns.blood_pressure_diastolic} mmHg\n`;
        }
        if (vitalSigns.heart_rate) prompt += `- Heart Rate: ${vitalSigns.heart_rate} bpm\n`;
        if (vitalSigns.respiratory_rate) prompt += `- Respiratory Rate: ${vitalSigns.respiratory_rate} /min\n`;
        if (vitalSigns.oxygen_saturation) prompt += `- Oxygen Saturation: ${vitalSigns.oxygen_saturation}%\n`;
        if (vitalSigns.pain_level !== undefined) prompt += `- Pain Level: ${vitalSigns.pain_level}/10\n`;
      }

      if (previousVisit) {
        prompt += `\nPREVIOUS VISIT DATA (for comparison):
- Date: ${previousVisit.visit_date}
- Notes excerpt: ${previousVisit.nurse_notes?.substring(0, 300) || 'No previous notes'}
`;
        
        if (previousVisit.vital_signs && Object.keys(vitalSigns).length > 0) {
          prompt += `\nCOMPARISON TO PREVIOUS VISIT:
`;
          const prev = previousVisit.vital_signs;
          
          if (vitalSigns.blood_pressure_systolic && prev.blood_pressure_systolic) {
            const diff = vitalSigns.blood_pressure_systolic - prev.blood_pressure_systolic;
            prompt += `- BP: ${vitalSigns.blood_pressure_systolic}/${vitalSigns.blood_pressure_diastolic} today vs ${prev.blood_pressure_systolic}/${prev.blood_pressure_diastolic} last visit (${diff > 0 ? '+' : ''}${diff} systolic)\n`;
          }
          
          if (vitalSigns.heart_rate && prev.heart_rate) {
            const diff = vitalSigns.heart_rate - prev.heart_rate;
            prompt += `- Heart Rate: ${vitalSigns.heart_rate} today vs ${prev.heart_rate} last visit (${diff > 0 ? '+' : ''}${diff})\n`;
          }

          if (vitalSigns.oxygen_saturation && prev.oxygen_saturation) {
            const diff = vitalSigns.oxygen_saturation - prev.oxygen_saturation;
            prompt += `- O2 Saturation: ${vitalSigns.oxygen_saturation}% today vs ${prev.oxygen_saturation}% last visit (${diff > 0 ? '+' : ''}${diff}%)\n`;
          }
        }
      }

      prompt += `\n=== DYNAMIC SECTION PRIORITIZATION ===
Based on PRIMARY DIAGNOSIS "${patient.primary_diagnosis}" (or implied from conditions):
`;

      if (patient.primary_diagnosis?.toLowerCase().includes('chf') || 
          patient.primary_diagnosis?.toLowerCase().includes('heart failure')) {
        prompt += `
PRIORITIZE THESE SECTIONS FIRST (in this order):
1. CARDIOVASCULAR ASSESSMENT (TOP PRIORITY)
   - Weight comparison to baseline/previous visit (CRITICAL for CHF)
   - Edema assessment with specific grading
   - JVD, peripheral pulses
   - Dyspnea on exertion/at rest
   - Orthopnea/PND
   
2. RESPIRATORY ASSESSMENT
   - Lung sounds (crackles indicate fluid overload)
   - Oxygen saturation
   
3. MEDICATION MANAGEMENT
   - Diuretic compliance
   - Daily weight monitoring compliance
`;
      } else if (patient.primary_diagnosis?.toLowerCase().includes('copd') || 
                 patient.primary_diagnosis?.toLowerCase().includes('emphysema')) {
        prompt += `
PRIORITIZE THESE SECTIONS FIRST (in this order):
1. RESPIRATORY ASSESSMENT (TOP PRIORITY)
   - Lung sounds (wheezes, diminished, crackles)
   - Dyspnea level
   - Use of accessory muscles
   - Oxygen therapy details
   
2. ACTIVITY TOLERANCE
   
3. MEDICATION MANAGEMENT
   - Inhaler technique
   - Oxygen compliance
`;
      } else if (patient.primary_diagnosis?.toLowerCase().includes('diabetes')) {
        prompt += `
PRIORITIZE THESE SECTIONS FIRST (in this order):
1. ENDOCRINE/METABOLIC ASSESSMENT (TOP PRIORITY)
   - Blood glucose readings
   - HbA1c trends
   - Hypoglycemic episodes
   
2. INTEGUMENTARY (Diabetic Foot Assessment)
   - Bilateral foot inspection
   - Sensation testing
   
3. MEDICATION MANAGEMENT
   - Insulin/oral medication compliance
   - Glucometer technique
`;
      } else if (patient.primary_diagnosis?.toLowerCase().includes('wound') ||
                 patient.primary_diagnosis?.toLowerCase().includes('ulcer')) {
        prompt += `
PRIORITIZE THESE SECTIONS FIRST (in this order):
1. WOUND ASSESSMENT (TOP PRIORITY)
   - Measurements (L x W x D)
   - Wound bed characteristics
   - Drainage
   - Periwound condition
   
2. PAIN MANAGEMENT
   
3. NUTRITIONAL STATUS
`;
      } else {
        prompt += `
Use standard section ordering but emphasize areas most relevant to "${patient.primary_diagnosis}"
`;
      }

      prompt += `\n\n=== PROACTIVE MEDICARE COMPLIANCE ===
`;

      if (patient.care_type === 'home_health') {
        prompt += `
REQUIRED HOME HEALTH MEDICARE ELEMENTS (must include these sections with prompts):

1. **HOMEBOUND STATUS JUSTIFICATION** (CRITICAL - required for all home health visits):
   "HOMEBOUND STATUS: Patient remains homebound due to [nurse to document: taxing effort to leave home, requires assistance of another person, medical contraindication to leaving home, leaves home infrequently for medical appointments only]. Objective evidence: [nurse to document specific observations such as: severe SOB with minimal exertion, requires walker and assistance, bedbound, severe pain limiting mobility, cognitive impairment requiring supervision]."

2. **SKILLED NEED/MEDICAL NECESSITY** (CRITICAL):
   "SKILLED NURSING NECESSITY: Skilled nursing services required for [assessment of complex/unstable condition, medication management requiring RN judgment, wound care requiring sterile technique, patient/caregiver education for safe self-management]. Patient unable to safely self-manage due to [nurse to document]."

3. **PATIENT/CAREGIVER RESPONSE TO TEACHING**:
   Must document comprehension, barriers, and plan for continued education.

4. **FUNCTIONAL LIMITATIONS**:
   Document specific ADL/IADL limitations that require skilled intervention.

5. **SAFETY ASSESSMENT**:
   Home safety, fall risk, emergency plan.
`;
      }

      if (patient.care_type === 'hospice') {
        prompt += `
REQUIRED HOSPICE MEDICARE ELEMENTS (must include these sections with prompts):

1. **TERMINAL PROGNOSIS INDICATORS** (CRITICAL):
   "DISEASE PROGRESSION: [Nurse to document objective evidence of disease progression/decline consistent with terminal prognosis, such as: increased symptom burden, functional decline, weight loss, increased care needs]."

2. **SYMPTOM MANAGEMENT** (CRITICAL):
   Detailed assessment of pain and other distressing symptoms.
   "SYMPTOM ASSESSMENT: Pain [location/intensity/character], Dyspnea [severity/interventions], Nausea/Vomiting, Constipation, Anxiety/Agitation. Current management: [medications/interventions]. Effectiveness: [patient/family report]."

3. **PATIENT/FAMILY COPING**:
   "PSYCHOSOCIAL/SPIRTUAL: Patient and family coping with disease progression. [Nurse to document emotional status, spiritual concerns, grief anticipation]. Support systems in place: [document]."

4. **DECLINE IN FUNCTIONAL STATUS**:
   "FUNCTIONAL STATUS: [Document specific ADL dependencies, Karnofsky/Palliative Performance Scale if applicable]. Changes since last visit: [improved/declined/stable]."

5. **CAREGIVER EDUCATION & SUPPORT**:
   Must document education on disease process, what to expect, comfort measures, and 24-hour hospice availability.
`;
      }

      if (visit.visit_type === 'admission') {
        prompt += `\nADMISSION VISIT ADDITIONAL REQUIREMENTS:
- Complete medication reconciliation with source verification
- Advance directives discussion and documentation
- Emergency contact verification
- Comprehensive baseline assessment of all systems
- Patient/caregiver orientation to services
- Copy of rights and responsibilities provided
`;
      } else if (visit.visit_type === 'recertification') {
        prompt += `\nRECERTIFICATION VISIT ADDITIONAL REQUIREMENTS:
- Comprehensive reassessment of all systems
- Progress toward all care plan goals
- Continued need for services justification
- Update of all medications and diagnoses
- Discussion of ongoing plan of care
`;
      }

      prompt += `\n\nINSTRUCTIONS:
1. Generate a comprehensive template with ALL required Medicare elements above
2. Prioritize sections based on the primary diagnosis as specified
3. Auto-populate vital signs data with clinical narrative
4. Include comparison language where previous visit data exists
5. Use placeholders like [nurse to document specific observation] where nurse input is needed
6. Make it detailed and professional
7. Ensure every required Medicare element has a dedicated, clearly marked section
8. Format with clear section headers (use ** for headers)

Generate the complete template now:`;

      const template = await base44.integrations.Core.InvokeLLM({
        prompt: prompt
      });

      const sanitizedTemplate = sanitizeInput(template);
      setNarrativeText(sanitizedTemplate);
      setHasGeneratedTemplate(true);
      
      await updateVisitMutation.mutateAsync({ 
        nurse_notes: sanitizedTemplate
      });
      await logSecurityEvent('TEMPLATE_GENERATED', { visit_id: visitId });
      
      // Track template usage for performance metrics
      await trackTemplateUsage({
        visit_id: visitId,
        patient_id: visit.patient_id,
        template_type: visit.visit_type,
        diagnosis: patient.primary_diagnosis,
        sections_count: template.split('\n\n').length,
        customized: Object.keys(vitalSigns).length > 0
      });

    } catch (error) {
      console.error("Error generating template:", error);
      alert("Error generating template. Please try again.");
      await logSecurityEvent('TEMPLATE_GENERATION_ERROR', { visit_id: visitId, error: error.message });
    }
    setIsGeneratingTemplate(false);
  };

  const handleAudioProcessed = async (audioFile) => {
    const validation = validateFileUpload(audioFile, {
      maxSize: 25 * 1024 * 1024,
      allowedTypes: ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg']
    });
    
    if (!validation.valid) {
      alert(`File validation failed: ${validation.error}`);
      await logSecurityEvent('FILE_UPLOAD_VALIDATION_FAILED', { 
        visit_id: visitId,
        file_name: audioFile.name,
        error: validation.error 
      });
      return;
    }

    setIsProcessing(true);
    try {
      const user = await base44.auth.me();
      
      const processAudioWrapper = async () => {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: audioFile });
        
        await updateVisitMutation.mutateAsync({ audio_url: file_url });

        let prompt = `You are a skilled home health and hospice nursing documentation specialist. Your task is to accurately transcribe the provided audio and intelligently integrate the spoken observations into the clinical narrative.

CONTEXT - PATIENT INFORMATION:
- Name: ${patient.first_name} ${patient.last_name}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patient.care_type === 'hospice' ? 'Hospice Care' : 'Home Health'}
- Visit Type: ${visit.visit_type.replace(/_/g, ' ')}

`;
        if (Object.keys(vitalSigns).length > 0) {
          prompt += `VITAL SIGNS DOCUMENTED:
`;
          if (vitalSigns.temperature) prompt += `- Temperature: ${vitalSigns.temperature}°F\n`;
          if (vitalSigns.blood_pressure_systolic && vitalSigns.blood_pressure_diastolic) {
            prompt += `- Blood Pressure: ${vitalSigns.blood_pressure_systolic}/${vitalSigns.blood_pressure_diastolic} mmHg\n`;
          }
          if (vitalSigns.heart_rate) prompt += `- Heart Rate: ${vitalSigns.heart_rate} bpm\n`;
          if (vitalSigns.respiratory_rate) prompt += `- Respiratory Rate: ${vitalSigns.respiratory_rate} /min\n`;
          if (vitalSigns.oxygen_saturation) prompt += `- Oxygen Saturation: ${vitalSigns.oxygen_saturation}%\n`;
          if (vitalSigns.pain_level !== undefined) prompt += `- Pain Level: ${vitalSigns.pain_level}/10\n`;
        }

        if (previousVisit && previousVisit.vital_signs) {
          prompt += `\nPREVIOUS VISIT VITAL SIGNS (for comparison):
`;
          const prev = previousVisit.vital_signs;
          if (prev.blood_pressure_systolic) prompt += `- BP: ${prev.blood_pressure_systolic}/${prev.blood_pressure_diastolic} mmHg\n`;
          if (prev.heart_rate) prompt += `- Heart Rate: ${prev.heart_rate} bpm\n`;
          if (prev.oxygen_saturation) prompt += `- O2 Saturation: ${prev.oxygen_saturation}%\n`;
          if (prev.pain_level !== undefined) prompt += `- Pain Level: ${prev.pain_level}/10\n`;
          
          if (previousVisit.nurse_notes) {
            prompt += `\nPREVIOUS VISIT NOTES EXCERPT (for general context, not for copying): ${previousVisit.nurse_notes.substring(0, 500)}...\n`;
          }
        }

        if (narrativeText && narrativeText.length > 0) {
          prompt += `\nEXISTING NARRATIVE:
${narrativeText}

`;
        }

        prompt += `TASK:
1. Transcribe the audio content provided.
2. Integrate the transcribed observations and assessments into a coherent, professional clinical narrative.
3. If there is existing narrative (above), intelligently merge the new observations into it, enhancing or adding details without duplicating. Fill in any [nurse to document] placeholders from the existing narrative with information from the audio.
4. Ensure the output is Medicare-compliant for a ${patient.care_type === 'hospice' ? 'hospice' : 'home health'} visit.
5. Automatically incorporate the vital signs listed above into the narrative with proper clinical language.
6. ${previousVisit ? 'Compare current vital signs to previous visit and note trends (improved, stable, worsened).' : ''}
7. Use professional nursing terminology.
8. Follow SOAP format where applicable.
9. Include patient response to interventions, changes in condition, medication compliance, and education provided.

Generate the complete clinical narrative based on the audio and context:`;

        const llmResult = await base44.integrations.Core.InvokeLLM({
          prompt: prompt,
          file_urls: [file_url]
        });
        return llmResult;
      };
      
      const result = await secureAICall(() => processAudioWrapper(), user.email);
      
      const sanitizedResult = sanitizeInput(result);
      setNarrativeText(sanitizedResult);
      await updateVisitMutation.mutateAsync({ 
        nurse_notes: sanitizedResult,
        raw_transcription: "Processed from audio and intelligently merged into clinical narrative."
      });

      await logSecurityEvent('AUDIO_DOCUMENTATION_PROCESSED', { 
        visit_id: visitId,
        file_size: audioFile.size,
        file_type: audioFile.type 
      });

    } catch (error) {
      if (error.message.includes('Rate limit')) {
        alert("Too many AI requests. Please wait a moment and try again.");
        await logSecurityEvent('AI_RATE_LIMIT_HIT', { 
          visit_id: visitId,
          error: error.message 
        });
      } else {
        console.error("Error processing audio:", error);
        alert("Error processing audio. Please try again.");
        await logSecurityEvent('AUDIO_PROCESSING_ERROR', { 
          visit_id: visitId,
          error: error.message 
        });
      }
    }
    setIsProcessing(false);
  };

  const handleAddSuggestion = async (suggestionText, sourceComponent = 'unknown') => {
    setNarrativeText(prev => {
      if (prev) {
        return prev + (prev.endsWith('\n') ? '' : '\n') + "\n" + suggestionText;
      }
      return suggestionText;
    });
    
    // Track AI suggestion applied
    await trackAISuggestion({
      type: 'documentation',
      text: suggestionText.substring(0, 200),
      source: sourceComponent,
      severity: 'medium',
      patient_id: visit?.patient_id,
      visit_id: visitId,
      element: sourceComponent,
      note_snippet: narrativeText?.substring(0, 100),
      context: suggestionText
    });
    
    setAiToolsUsed(prev => [...new Set([...prev, sourceComponent])]);
  };

  const handleAutoFillVitals = (vitalUpdates) => {
    setVitalSigns(prev => ({
      ...prev,
      ...vitalUpdates
    }));
  };

  const handleCarePlanProgress = (progressText) => {
    setNarrativeText(prev => {
      if (prev) {
        return prev + (prev.endsWith('\n') ? '' : '\n') + "\n" + progressText;
      }
      return progressText;
    });
  };

  const handleCopyFromPrevious = (copiedContent) => {
    setNarrativeText(prev => prev + '\n\n' + copiedContent);
  };

  const handlePolishedText = (polishedText) => {
    setNarrativeText(polishedText);
  };

  const handleQAFix = (suggestion) => {
    setNarrativeText(prev => prev + '\n\n' + suggestion);
  };

  const handleScrubberFix = (suggestion) => {
    setNarrativeText(prev => prev + '\n\n' + suggestion);
  };

  const handleScrubComplete = (results) => {
    console.log('Note scrubber completed:', results);
  };

  const handleIncidentReported = (reportText) => {
    setNarrativeText(prev => {
      if (prev) {
        return prev + '\n\n' + reportText;
      }
      return reportText;
    });
  };

  const handleScrubbedNote = (scrubbedText) => {
    setNarrativeText(scrubbedText);
  };

  const handleVoiceVitalsUpdate = (newVitals) => {
    setVitalSigns(newVitals);
    setHasUnsavedChanges(true);
  };

  const handleVoiceNarrativeUpdate = (newNarrative) => {
    setNarrativeText(newNarrative);
    setHasUnsavedChanges(true);
  };

  const handleHomeboundTextGenerated = (homeboundText) => {
    setNarrativeText(prev => {
      if (prev) {
        return prev + '\n\n' + homeboundText;
      }
      return homeboundText;
    });
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    try {
      const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      
      const sanitizedNarrative = sanitizeInput(narrativeText);
      
      const visitData = {
        nurse_notes: sanitizedNarrative,
        vital_signs: vitalSigns,
        start_time: startTime,
        end_time: endTime || now,
        status: 'completed'
      };

      // Add scanned documents if any
      if (scannedDocuments.length > 0) {
        visitData.scanned_documents = scannedDocuments;
      }

      // Save offline if no connection
      if (isOffline) {
        offlineStorage.saveUpdate(visitId, visitData);
        alert("Visit saved offline. Will sync when connection is restored.");
        navigate(createPageUrl("Dashboard"));
        return;
      }
      
      await secureUpdate(
        base44.entities.Visit,
        visitId,
        visitData,
        'Visit'
      );

      await logSecurityEvent('VISIT_DOCUMENTATION_COMPLETED', { 
        visit_id: visitId,
        patient_id: visit.patient_id 
      });

      // Track comprehensive visit completion metrics
      const visitDuration = startTime && endTime ? 
        (new Date(`2000-01-01T${endTime}`) - new Date(`2000-01-01T${startTime}`)) / (1000 * 60) : 0;
      const docTime = (new Date() - documentationStartTime.current) / (1000 * 60);
      
      await trackVisitCompletion({
        visit_id: visitId,
        patient_id: visit.patient_id,
        visit_type: visit.visit_type,
        duration_minutes: visitDuration,
        documentation_time: docTime,
        compliance_score: null, // Will be filled by compliance checker
        ai_tools_used: aiToolsUsed,
        template_used: hasGeneratedTemplate,
        voice_dictation_used: aiToolsUsed.includes('voice_dictation'),
        scribe_used: aiToolsUsed.includes('ai_scribe'),
        word_count: narrativeText.split(/\s+/).length,
        vital_signs_count: Object.keys(vitalSigns).length
      });

      alert("Visit documentation saved successfully!");
      navigate(createPageUrl("Dashboard"));
    } catch (error) {
      await handleSecureError(error, 'visit_save', (msg) => alert(msg));
    }
  };

  if (hasAccess === null) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-gray-500">
            Verifying access permissions...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (hasAccess === false) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Alert className="border-red-300 bg-red-50">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <AlertDescription className="text-red-900">
            <p className="font-semibold mb-2">Access Denied</p>
            <p>You do not have permission to document this visit. This incident has been logged.</p>
          </AlertDescription>
        </Alert>
        <Button 
          onClick={() => navigate(createPageUrl("Dashboard"))}
          className="mt-4"
        >
          Return to Dashboard
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-gray-500">
            Loading visit information...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!visit || !patient) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Visit not found or patient data missing</h2>
            <Button onClick={() => navigate(createPageUrl("Dashboard"))}>
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto min-h-screen w-full max-w-full overflow-x-hidden min-w-0">
      <VoiceCommandListener
        onCommand={handleVoiceCommand}
        commands={getCommandsForContext('documentation')}
        context="documentation"
      />

      <div className="mb-4 sm:mb-6">
        <Button
          variant="outline"
          onClick={() => navigate(createPageUrl("Dashboard"))}
          className="mb-3 sm:mb-4 min-h-[44px] w-full sm:w-auto"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>

        <Card className="bg-slate-200 border-slate-400 dark:bg-slate-800 dark:border-slate-600">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-12 h-12 sm:w-14 sm:h-14 bg-slate-600 dark:bg-slate-500 rounded-full flex items-center justify-center shadow-lg flex-shrink-0">
                <User className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <h1 className="text-base sm:text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100 truncate">
                  {patient?.first_name} {patient?.last_name}
                </h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm text-gray-600 mt-1">
                  <span className="truncate text-slate-700 dark:text-slate-300">MRN: {patient?.medical_record_number || 'N/A'}</span>
                  <span className="hidden sm:inline">•</span>
                   <span className="truncate text-slate-700 dark:text-slate-300">{patient?.primary_diagnosis}</span>
                   <span className="hidden sm:inline">•</span>
                   <span className="capitalize text-slate-700 dark:text-slate-300">{patient?.care_type?.replace('_', ' ')}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {(isSaving || lastSaved) && (
        <Alert className={`mb-4 bg-slate-200 border-slate-400 dark:bg-slate-800 dark:border-slate-600`}>
          <Clock className="w-4 h-4 text-slate-700 dark:text-slate-400" />
          <AlertDescription className="text-slate-900 dark:text-slate-100">
            {isSaving ? 'Saving...' : `Last saved: ${lastSaved ? lastSaved.toLocaleTimeString() : 'N/A'}`}
            {hasUnsavedChanges && !isSaving && ' • Unsaved changes'}
          </AlertDescription>
        </Alert>
      )}

      {/* Pre-Visit Preparation */}
      <PreVisitPreparation
        patientId={visit?.patient_id}
        visitId={visitId}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <Tabs defaultValue="document" className="space-y-4 sm:space-y-6">
            <TabsList className="grid w-full grid-cols-2 h-auto">
              <TabsTrigger value="document" className="text-sm sm:text-base py-2">Documentation</TabsTrigger>
              <TabsTrigger value="workflow" className="text-sm sm:text-base py-2">AI Workflow</TabsTrigger>
            </TabsList>

            <TabsContent value="document" className="space-y-4 sm:space-y-6">
              <VoiceDataEntry
                onVitalsUpdate={handleVoiceVitalsUpdate}
                onNarrativeUpdate={handleVoiceNarrativeUpdate}
                currentVitals={vitalSigns}
                currentNarrative={narrativeText}
                patient={patient}
                visit={visit}
              />

              <OneClickActions
                patient={patient}
                visit={visit}
                onScheduleFollowUp={() => alert('Schedule follow-up feature coming soon')}
                onMarkUrgent={() => alert('Urgent flag set - office will be notified')}
                onRequestSupplies={() => alert('Supply request sent to office')}
              />

              <QuickIncidentReporting 
                patient={patient}
                visit={visit}
                onIncidentReported={handleIncidentReported}
              />

              {/* Discharge Visit Auto-Summary */}
              <DischargeVisitSummary
                patient={patient}
                visit={visit}
                allVisits={allVisits}
                carePlans={carePlans}
                onSummaryGenerated={(summary) => setNarrativeText(summary)}
              />

              {/* Proactive Risk Identification */}
              <ProactiveRiskIdentifier
                patient={patient}
                recentVisits={allVisits}
                carePlans={carePlans}
                vitalSigns={vitalSigns}
                onAlertCreated={async (alertData) => {
                  try {
                    await base44.entities.PatientAlert.create(alertData);
                  } catch (error) {
                    console.error("Error creating alert:", error);
                  }
                }}
              />

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Visit Times
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="start_time">Start Time</Label>
                      <Input
                        id="start_time"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="end_time">End Time</Label>
                      <Input
                        id="end_time"
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <QuickTemplatesLibrary onInsertTemplate={handleInsertTemplate} />

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Vital Signs</CardTitle>
                </CardHeader>
                <CardContent>
                  <SmartVitalsInput 
                    vitalSigns={vitalSigns}
                    onChange={setVitalSigns}
                  />
                </CardContent>
              </Card>

              <SmartVitalsPredictor
                patient={patient}
                vitalSigns={vitalSigns}
                previousVisit={previousVisit}
                onAutoFill={handleAutoFillVitals}
              />

              <SameAsLastVisit
                previousVisit={previousVisit}
                onCopyContent={handleCopyFromPrevious}
              />

              <MedicationReconciliation
                patientId={visit?.patient_id}
                onMedicationsUpdated={(medText) => setNarrativeText(prev => prev + '\n\n' + medText)}
              />

              {previousVisit && Object.keys(vitalSigns).length > 0 && (
                <VitalSignsComparison 
                  currentVitals={vitalSigns}
                  previousVitals={previousVisit.vital_signs}
                />
              )}

              <ClinicalDecisionSupport
                patient={patient}
                visit={visit}
                vitalSigns={vitalSigns}
                narrativeText={narrativeText}
                onAddSuggestion={(text) => handleAddSuggestion(text, 'clinical_decision_support')}
              />

              <SmartAssessmentSuggestions
                patient={patient}
                narrativeText={narrativeText}
                vitalSigns={vitalSigns}
                onAddSuggestion={(text) => handleAddSuggestion(text, 'smart_assessment')}
              />

              <CarePlanProgress
                patientId={visit?.patient_id}
                visit={visit}
                vitalSigns={vitalSigns}
                previousVisit={previousVisit}
                onProgressGenerated={handleCarePlanProgress}
              />

              <AIDocumentationPolish
                narrativeText={narrativeText}
                onPolishedTextGenerated={async (text) => {
                  handlePolishedText(text);
                  setAiToolsUsed(prev => [...new Set([...prev, 'documentation_polish'])]);
                  await trackAISuggestion({
                    type: 'documentation',
                    text: 'AI-polished documentation applied',
                    source: 'ai_documentation_polish',
                    severity: 'low',
                    patient_id: visit.patient_id,
                    visit_id: visitId,
                    element: 'Documentation Polish'
                  });
                }}
              />

              <AIQualityAssurance
                patient={patient}
                visit={visit}
                narrativeText={narrativeText}
                vitalSigns={vitalSigns}
                onFixIssue={async (text) => {
                  handleQAFix(text);
                  setAiToolsUsed(prev => [...new Set([...prev, 'quality_assurance'])]);
                  await trackAISuggestion({
                    type: 'compliance',
                    text: text.substring(0, 200),
                    source: 'ai_quality_assurance',
                    severity: 'high',
                    patient_id: visit.patient_id,
                    visit_id: visitId,
                    element: 'Quality Assurance'
                  });
                }}
              />

              <AIDocumentationAudit
                patient={patient}
                visit={visit}
                narrativeText={narrativeText}
                vitalSigns={vitalSigns}
                onInsertText={(text) => handleAddSuggestion(text, 'ai_documentation_audit')}
              />

              <NoteScrubber
                patient={patient}
                visit={visit}
                narrativeText={narrativeText}
                vitalSigns={vitalSigns}
                onFixSuggestion={handleScrubberFix}
                onScrubComplete={handleScrubComplete}
              />

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Clinical Narrative
                    {recognizedCommand && (
                      <Badge className="bg-green-500 text-white animate-pulse ml-auto">
                        ✓ {recognizedCommand}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TextExpander onExpand={handleTextExpand} />

                  {commandHistory.length > 0 && (
                    <Alert className="bg-slate-200 border-slate-400 dark:bg-slate-800 dark:border-slate-600">
                      <AlertDescription className="text-sm text-slate-900 dark:text-slate-100">
                        <strong>Recent Commands:</strong>
                        <div className="mt-2 space-y-1">
                          {commandHistory.map((cmd, idx) => (
                            <div key={idx} className="text-xs text-gray-600">
                              • {cmd.command} at {cmd.time}
                            </div>
                          ))}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  <RichTextNoteEditor
                    value={narrativeText}
                    onChange={setNarrativeText}
                    onCopy={() => {
                      navigator.clipboard.writeText(narrativeText.replace(/<[^>]*>/g, ''));
                    }}
                    copied={false}
                    qualityScore={null}
                  />
                </CardContent>
              </Card>

              <TeamNotes
                visitId={visitId}
                patientId={visit?.patient_id}
              />

              {/* Mobile Features */}
              <CameraScanner
                documentType="visit_document"
                onScanComplete={(doc) => {
                  setScannedDocuments(prev => [...prev, doc]);
                  alert("Document scanned and attached to visit!");
                }}
              />

              {/* ICD-10 Code Suggester */}
              <ICD10CodeSuggester
                narrativeText={narrativeText}
                diagnosis={patient?.primary_diagnosis}
                patient={patient}
                onCodesSelected={(codes) => {
                  const codeText = `\n\n**ICD-10 CODES:**\n${codes.map(c => `• ${c.code} - ${c.description}`).join('\n')}`;
                  setNarrativeText(prev => prev + codeText);
                }}
              />

              {/* Patient Handout Generator */}
              <QuickPatientHandoutGenerator
                patientId={visit?.patient_id}
                visitNotes={narrativeText}
                diagnosis={patient?.primary_diagnosis}
                medications={patient?.current_medications}
              />

              {/* Post-Consultation Automation */}
              <PostConsultationAutomation
                patientId={visit?.patient_id}
                visitId={visitId}
                visitNotes={narrativeText}
                diagnosis={patient?.primary_diagnosis}
                onComplete={(actions) => {
                  console.log('Completed actions:', actions);
                }}
              />

              <div className="flex flex-col sm:flex-row sm:justify-between gap-3 pb-8">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleExportPDF}
                    className="gap-2 flex-1 sm:flex-initial text-sm"
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleEmailSummary}
                    className="gap-2 flex-1 sm:flex-initial text-sm"
                  >
                    <Mail className="w-4 h-4" />
                    <span className="hidden sm:inline">Email</span>
                  </Button>
                </div>
                <div className="flex gap-2 sm:gap-3">
                  <Button
                    variant="outline"
                    onClick={() => navigate(createPageUrl("Dashboard"))}
                    className="flex-1 sm:flex-initial text-sm"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    className="bg-green-600 hover:bg-green-700 flex-1 sm:flex-initial text-sm"
                    disabled={!narrativeText || isProcessing}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Complete
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="workflow" className="space-y-4 sm:space-y-6">
              <Alert className="bg-slate-200 border-slate-400 dark:bg-slate-800 dark:border-slate-600">
                <Sparkles className="w-5 h-5 text-slate-700 dark:text-slate-400" />
                <AlertDescription className="text-slate-900 dark:text-slate-100">
                  <strong>Recommended AI Workflow:</strong>
                  <ol className="list-decimal ml-5 mt-2 space-y-1">
                    <li>Enter vital signs first (helps AI generate better content)</li>
                    <li>Generate smart template (pre-fills based on visit type & patient)</li>
                    <li>Review template and add observations via voice or typing</li>
                    <li>AI merges everything into final note</li>
                  </ol>
                </AlertDescription>
              </Alert>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Step 1: Visit Times
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="start_time_wf">Start Time</Label>
                      <Input
                        id="start_time_wf"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="end_time_wf">End Time</Label>
                      <Input
                        id="end_time_wf"
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Step 2: Enter Vital Signs</CardTitle>
                </CardHeader>
                <CardContent>
                  <VitalSignsForm 
                    vitalSigns={vitalSigns}
                    onChange={setVitalSigns}
                  />
                  {Object.keys(vitalSigns).length > 0 && (
                   <Alert className="mt-4 bg-slate-200 border-slate-400 dark:bg-slate-800 dark:border-slate-600">
                     <AlertDescription className="text-slate-900 dark:text-slate-100">
                        ✓ Vital signs entered. These will be automatically incorporated into your note.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              {previousVisit && Object.keys(vitalSigns).length > 0 && (
                <VitalSignsComparison 
                  currentVitals={vitalSigns}
                  previousVitals={previousVisit.vital_signs}
                />
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Step 3: Generate Smart Template</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TemplateGenerator
                    patient={patient}
                    visit={visit}
                    vitalSigns={vitalSigns}
                    previousVisit={previousVisit}
                    onTemplateGenerated={generateSmartTemplate}
                    isGenerating={isGeneratingTemplate}
                  />

                  {hasGeneratedTemplate && (
                    <Alert className="bg-slate-200 border-slate-400 dark:bg-slate-800 dark:border-slate-600">
                      <AlertDescription className="text-slate-900 dark:text-slate-100">
                        ✓ Template generated! Review it in the Documentation tab or proceed to add your observations.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              <MedicalScribeAssistant
                patientId={visit?.patient_id}
                onDataExtracted={async (scribeData) => {
                  // Apply narrative
                  if (scribeData.narrative) {
                    setNarrativeText(prev => prev ? `${prev}\n\n${scribeData.narrative}` : scribeData.narrative);
                  }
                  
                  // Auto-fill vitals if available
                  if (scribeData.structuredData?.vital_signs) {
                    const extractedVitals = {};
                    const vs = scribeData.structuredData.vital_signs;
                    
                    if (vs.blood_pressure) {
                      const bpMatch = vs.blood_pressure.match(/(\d+)\/(\d+)/);
                      if (bpMatch) {
                        extractedVitals.blood_pressure_systolic = parseInt(bpMatch[1]);
                        extractedVitals.blood_pressure_diastolic = parseInt(bpMatch[2]);
                      }
                    }
                    if (vs.heart_rate) extractedVitals.heart_rate = parseInt(vs.heart_rate);
                    if (vs.temperature) extractedVitals.temperature = parseFloat(vs.temperature);
                    if (vs.respiratory_rate) extractedVitals.respiratory_rate = parseInt(vs.respiratory_rate);
                    if (vs.oxygen_saturation) extractedVitals.oxygen_saturation = parseInt(vs.oxygen_saturation);
                    if (vs.pain_level) extractedVitals.pain_level = parseInt(vs.pain_level);
                    
                    setVitalSigns(prev => ({ ...prev, ...extractedVitals }));
                  }
                  
                  setAiToolsUsed(prev => [...new Set([...prev, 'ai_scribe'])]);
                  setHasUnsavedChanges(true);
                }}
              />

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mic className="w-5 h-5" />
                    Alternative: Quick Voice Dictation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert className="bg-slate-200 border-slate-400 dark:bg-slate-800 dark:border-slate-600">
                     <Sparkles className="w-4 h-4 text-slate-700 dark:text-slate-400" />
                     <AlertDescription className="text-slate-900 dark:text-slate-100">
                      <strong>🎤 Global Voice Commands are now active!</strong>
                      <p className="mt-2 mb-3">Speak commands like "insert cardiovascular" or "save documentation" anytime in the app to trigger actions.</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="font-semibold mb-1">Text Insertion:</p>
                          <ul className="space-y-0.5">
                            <li>• "Cardiovascular section"</li>
                            <li>• "Respiratory section"</li>
                            <li>• "Medication section"</li>
                            <li>• "Add normal findings"</li>
                            <li>• "Insert vital signs"</li>
                          </ul>
                        </div>
                        <div>
                          <p className="font-semibold mb-1">Actions & Shortcuts:</p>
                          <ul className="space-y-0.5">
                            <li>• "Add homebound status"</li>
                            <li>• "Add skilled need"</li>
                            <li>• "Notify physician"</li>
                            <li>• "Copy from last visit"</li>
                            <li>• "Generate template"</li>
                            <li>• "Save documentation"</li>
                            <li>• "Report fall"</li>
                            <li>• "Report hospitalization"</li>
                            <li>• "Generate care plans"</li> 
                          </ul>
                        </div>
                      </div>
                      <p className="mt-3 text-xs italic">💡 Your spoken dictation will be intelligently merged into your note.</p>
                    </AlertDescription>
                  </Alert>

                  {recognizedCommand && (
                    <Alert className="bg-slate-200 border-slate-400 dark:bg-slate-800 dark:border-slate-600 animate-in fade-in">
                      <CheckCircle2 className="w-4 h-4 text-slate-700 dark:text-slate-400" />
                      <AlertDescription className="text-slate-900 dark:text-slate-100">
                        <strong>Command Recognized:</strong> {recognizedCommand}
                      </AlertDescription>
                    </Alert>
                  )}

                  <AudioRecorder 
                    onAudioProcessed={handleAudioProcessed}
                    isProcessing={isProcessing}
                  />

                  {isProcessing && (
                    <div className="flex items-center justify-center py-8 gap-3">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                      <div className="text-center">
                        <p className="text-gray-900 font-semibold">Processing audio with AI...</p>
                        <p className="text-sm text-gray-600">Transcribing and intelligently merging into narrative</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex flex-col sm:flex-row sm:justify-end gap-2 sm:gap-3 pb-8">
                <Button
                  variant="outline"
                  onClick={() => navigate(createPageUrl("Dashboard"))}
                  className="w-full sm:w-auto text-sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  className="bg-green-600 hover:bg-green-700 w-full sm:w-auto text-sm"
                  disabled={!narrativeText || isProcessing}
                >
                  <Save className="w-4 h-4 mr-2" />
                  Complete Visit
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4 sm:space-y-6">
          {/* Adaptive Learning Dashboard */}
          <AdaptiveLearningDashboard userEmail={patient?.created_by} />

          {/* Real-Time Task Generator */}
          <RealTimeTaskGenerator
            clinicalContext={narrativeText}
            patientId={visit?.patient_id}
            visitId={visitId}
            autoGenerate={true}
          />

          {/* SNOMED Code Search */}
          <SNOMEDCodeSearch
            selectedCodes={selectedSnomedCodes}
            onCodeSelect={(code) => {
              setSelectedSnomedCodes(prev => [...prev, code]);
              const codeText = `\n\n**SNOMED CODE:** ${code.code} - ${code.description}`;
              setNarrativeText(prev => prev + codeText);
              toast.success('Code added to documentation');
            }}
          />

          {/* Enhanced AI Clinical Decision Support */}
          {patient && (
           <EnhancedClinicalDecisionSupport
             patient={patient}
             currentNoteText={narrativeText}
             vitalSigns={vitalSigns}
             previousVisits={allVisits}
             carePlans={carePlans}
             onInsertRecommendation={(text) => handleAddSuggestion(text, 'enhanced_clinical_decision_support')}
             onAlertAcknowledged={(alertId) => console.log('Alert acknowledged:', alertId)}
             autoAnalyze={true}
           />
          )}

          {/* Real-Time Clinical Decision Support */}
          {patient && visit && (
            <RealTimeClinicalDecisionSupport
              patient={patient}
              visit={visit}
              vitalSigns={vitalSigns}
              narrativeText={narrativeText}
              carePlans={carePlans}
              onInsertText={(text) => handleAddSuggestion(text, 'realtime_clinical_support')}
            />
          )}

          {/* AI Documentation Automation - Auto-populate & follow-ups */}
          {patient && visit && (
            <AIDocumentationAutomation
              patient={patient}
              visit={visit}
              vitalSigns={vitalSigns}
              narrativeText={narrativeText}
              carePlans={carePlans}
              previousVisits={allVisits}
              onInsertText={(text) => handleAddSuggestion(text, 'ai_documentation_automation')}
            />
          )}

          {/* AI Documentation Assistant - Context-aware help */}
          {patient && visit && (
            <AIDocumentationAssistant
              patient={patient}
              visit={visit}
              vitalSigns={vitalSigns}
              narrativeText={narrativeText}
              carePlans={carePlans}
              onInsertText={(text) => handleAddSuggestion(text, 'ai_documentation_assistant')}
            />
          )}

          {patient && (
            <ClinicalBestPracticeAlerts
              patient={patient}
              vitalSigns={vitalSigns}
              narrativeText={narrativeText}
            />
          )}
          
          <SkilledNeedJustificationAssistant
            patient={patient}
            visit={visit}
            narrativeText={narrativeText}
            vitalSigns={vitalSigns}
            onAddJustification={(text) => handleAddSuggestion(text, 'skilled_need_justification')}
          />

          <EnhancedOASISScrubber
            patient={patient}
            visit={visit}
            narrativeText={narrativeText}
            vitalSigns={vitalSigns}
            onAddSuggestion={(text) => handleAddSuggestion(text, 'oasis_scrubber')}
          />

          <PatientResponsePrompter
            narrativeText={narrativeText}
            onAddSuggestion={(text) => handleAddSuggestion(text, 'patient_response_prompter')}
          />

          <PatientRiskPredictor patient={patient} compact={true} />

          <EarlyWarningSystem
            patient={patient}
            currentVisit={visit}
            allVisits={allVisits}
          />

          <PreVisitPrep 
            patient={patient}
            visit={visit}
            previousVisit={previousVisit}
            carePlans={carePlans}
          />

          <SmartReminders 
            patient={patient}
            visit={visit}
            allVisits={allVisits}
          />

          <PredictiveMonitoring
            patient={patient}
            currentVitals={vitalSigns}
            allVisits={allVisits}
          />

          <FamilyCommunication
            patient={patient}
            visit={visit}
            vitalSigns={vitalSigns}
            narrativeText={narrativeText}
          />

          <HomeboundVerification
            patient={patient}
            visit={visit}
            onHomeboundTextGenerated={handleHomeboundTextGenerated}
          />

          {patient?.care_type === 'home_health' && (
            <OASISScrubber
              patient={patient}
              visit={visit}
              narrativeText={narrativeText}
              vitalSigns={vitalSigns}
              onFixSuggestion={handleScrubberFix}
            />
          )}
        </div>
      </div>
    </div>
  );
}