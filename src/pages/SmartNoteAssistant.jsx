import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Sparkles,
  CheckCircle2,
  User,
  Activity,
  Stethoscope,
  ClipboardList,
  AlertTriangle,
  Mic,
  MicOff,
  ChevronRight,
  ChevronLeft,
  Brain,
  HelpCircle,
  ArrowRight,
  Copy,
  RotateCcw,
  Lightbulb,
  MessageCircle,
  Edit3,
  BookOpen,
  DollarSign,
  AlertCircle
} from "lucide-react";
import { trackRecommendation, categorizeRecommendation } from "../components/training/RecommendationTracker";
import ComplianceScoreIndicator from "../components/smartNote/ComplianceScoreIndicator";
import ClinicalDecisionSupport from "../components/smartNote/ClinicalDecisionSupport";
import TaskGenerator from "../components/smartNote/TaskGenerator";
import AICarePlanGenerator from "../components/carePlan/AICarePlanGenerator";
import AICarePlanOptimizer from "../components/carePlan/AICarePlanOptimizer";
import ComplianceSummaryReport from "../components/smartNote/ComplianceSummaryReport";
import FloatingActionBar from "../components/smartNote/FloatingActionBar";
import QuickPhraseButtons from "../components/smartNote/QuickPhraseButtons";
import EnhancedStepIndicator from "../components/smartNote/EnhancedStepIndicator";
import UnifiedAIPanel from "../components/smartNote/UnifiedAIPanel";
import QuickActionsBar from "../components/smartNote/QuickActionsBar";
import RichTextNoteEditor from "../components/smartNote/RichTextNoteEditor";
import SmartVitalsInput from "../components/smartNote/SmartVitalsInput";
import SmartAutoComplete from "../components/smartNote/SmartAutoComplete";
import SearchablePatientSelect from "../components/ui/SearchablePatientSelect";
import AIPatientHistorySummarizer from "../components/smartNote/AIPatientHistorySummarizer";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
import { todayEastern, formatEastern } from "../components/utils/timezone";
import ConsolidatedAIFeedback from "../components/smartNote/ConsolidatedAIFeedback";
import NextStepsPanel from "../components/smartNote/NextStepsPanel";
import UnifiedPatientOverview from "../components/smartNote/UnifiedPatientOverview";
import UnifiedAISuggestions from "../components/smartNote/UnifiedAISuggestions";
import DynamicAISidebar from "../components/smartNote/DynamicAISidebar";
import { retrieveRelevantGuidelines, formatGuidelinesForPrompt } from "../components/smartNote/GuidelineContextRetriever";
import FavoriteButton from "../components/navigation/FavoriteButton";
import MedicalTerminologyProcessor, { standardizeTerminology } from "../components/smartNote/MedicalTerminologyProcessor";
import ComprehensivePatientContext, { buildComprehensiveContext, formatContextForAI } from "../components/smartNote/ComprehensivePatientContext";
import AIProactiveSuggestions from "../components/smartNote/AIProactiveSuggestions";
import GuidelineReferencePanel from "../components/guidelines/GuidelineReferencePanel";
import GuidelineComplianceChecker from "../components/guidelines/GuidelineComplianceChecker";
import MedicareComplianceChecker from "../components/compliance/MedicareComplianceChecker";
import AutomaticDocumentReviewer from "../components/review/AutomaticDocumentReviewer";
import RealTimeClinicalAlertMonitor from "../components/smartNote/RealTimeClinicalAlertMonitor";
import AIMedicalKnowledgeBase from "../components/smartNote/AIMedicalKnowledgeBase";
import AIDocumentAnalyzer from "../components/smartNote/AIDocumentAnalyzer";
import PatientHistoryTimeline from "../components/patient/PatientHistoryTimeline";
import { buildComprehensivePatientHistory } from "../components/utils/patientHistoryAnalyzer";
import OASISAutomationPanel from "../components/oasis/OASISAutomationPanel";
import GuidedDocumentationWorkflow from "../components/smartNote/GuidedDocumentationWorkflow";
import PatientHistoryAutoPopulator from "../components/smartNote/PatientHistoryAutoPopulator";
import ConditionalAIAssistant from "../components/smartNote/ConditionalAIAssistant";
import VisitTypeComplianceChecker from "../components/compliance/VisitTypeComplianceChecker";
import RealTimeDocumentationAI from "../components/smartNote/RealTimeDocumentationAI";
import NuancedFeedbackPanel from "../components/smartNote/NuancedFeedbackPanel";
import ComplianceTargetSettings from "../components/smartNote/ComplianceTargetSettings";
import VisitTypeSpecificGuidance from "../components/smartNote/VisitTypeSpecificGuidance";
import PersonalizedEducationGenerator from "../components/education/PersonalizedEducationGenerator";
import AIComplianceAssistant from "../components/compliance/AIComplianceAssistant";
import ClinicalNoteReviewer from "../components/review/ClinicalNoteReviewer";
import AITemplateGenerator from "../components/smartNote/AITemplateGenerator";
import RealTimeComplianceAnalyzer from "../components/smartNote/RealTimeComplianceAnalyzer";
import PDGMOptimizationSuggester from "../components/smartNote/PDGMOptimizationSuggester";
import AIDraftGenerator from "../components/smartNote/AIDraftGenerator";
import BulletPointExpander from "../components/smartNote/BulletPointExpander";
import AISmartSuggester from "../components/smartNote/AISmartSuggester";
import ConsolidatedAISuggestions from "../components/smartNote/ConsolidatedAISuggestions";
import RealTimeDeteriorationPredictor from "../components/smartNote/RealTimeDeteriorationPredictor";
import AIEducationMaterialSuggester from "../components/smartNote/AIEducationMaterialSuggester";

// Common diagnoses list
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



// Voice Hub Component - Enhanced with Commands and Multi-language
function VoiceHub({ onTranscription, onInterimTranscription, onCommand }) {
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [commandMode, setCommandMode] = useState(false);
  const [lastCommand, setLastCommand] = useState(null);
  const recognitionRef = React.useRef(null);

  const voiceCommands = [
    { trigger: "enhance note", action: "enhance" },
    { trigger: "copy note", action: "copy" },
    { trigger: "save note", action: "save" },
    { trigger: "clear note", action: "clear" },
    { trigger: "next step", action: "next" },
    { trigger: "blood pressure", action: "bp", extract: true },
    { trigger: "heart rate", action: "hr", extract: true },
    { trigger: "temperature", action: "temp", extract: true },
    { trigger: "oxygen", action: "o2", extract: true },
    { trigger: "pain level", action: "pain", extract: true }
  ];

  const matchCommand = (text) => {
    const lower = text.toLowerCase();
    for (const cmd of voiceCommands) {
      if (lower.includes(cmd.trigger)) {
        if (cmd.extract) {
          const numbers = text.match(/\d+\.?\d*/g);
          return { ...cmd, value: numbers };
        }
        return cmd;
      }
    }
    return null;
  };

  const startListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition not supported in your browser');
      return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.maxAlternatives = 2;

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }
      
      if (finalTranscript) {
        const trimmedText = finalTranscript.trim();
        
        // Check for commands if in command mode or if text starts with command trigger
        const matchedCommand = matchCommand(trimmedText);
        if (matchedCommand && (commandMode || trimmedText.toLowerCase().startsWith(matchedCommand.trigger))) {
          setLastCommand(matchedCommand.action);
          onCommand?.(matchedCommand.action, trimmedText, matchedCommand.value);
          setTimeout(() => setLastCommand(null), 2000);
        } else {
          onTranscription?.(trimmedText);
        }
        
        setInterimText('');
      } else if (interimTranscript) {
        setInterimText(interimTranscript);
        onInterimTranscription?.(interimTranscript);
      }
    };
    
    recognition.onend = () => {
      if (listening) {
        try {
          recognition.start();
        } catch (e) {
          console.error('Restart error:', e);
        }
      } else {
        setListening(false);
        setInterimText('');
      }
    };
    
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech' || event.error === 'audio-capture') {
        if (listening) {
          setTimeout(() => {
            try {
              recognition.start();
            } catch (e) {}
          }, 100);
        }
      } else {
        setListening(false);
        setInterimText('');
      }
    };
    
    setListening(true);
    recognition.start();
  };

  const stopListening = () => {
    setListening(false);
    setInterimText('');
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  React.useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="default"
          variant={listening ? "destructive" : "outline"}
          onClick={listening ? stopListening : startListening}
          className="gap-2 min-h-[44px] px-4 flex-shrink-0"
        >
          {listening ? <MicOff className="w-4 h-4 md:w-5 md:h-5" /> : <Mic className="w-4 h-4 md:w-5 md:h-5" />}
          <span className="text-sm md:text-base">{listening ? 'Stop' : 'Voice'}</span>
        </Button>
        {!listening && (
          <select 
            value={language} 
            onChange={(e) => setLanguage(e.target.value)}
            className="text-xs border rounded px-2 py-1 h-[44px]"
          >
            <option value="en-US">🇺🇸 English</option>
            <option value="es-ES">🇪🇸 Spanish</option>
            <option value="fr-FR">🇫🇷 French</option>
            <option value="de-DE">🇩🇪 German</option>
            <option value="pt-BR">🇧🇷 Portuguese</option>
            <option value="zh-CN">🇨🇳 Chinese</option>
          </select>
        )}
        {!listening && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCommandMode(!commandMode)}
            className="text-xs"
          >
            {commandMode ? '🎤 Commands' : '✍️ Dictation'}
          </Button>
        )}
      </div>
      {listening && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 animate-pulse">
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <span className="text-xs text-gray-600">
              {commandMode ? 'Command Mode' : 'Dictating'}
            </span>
          </div>
          {lastCommand && (
            <Badge className="bg-green-600 text-white text-xs animate-pulse">
              ✓ {lastCommand}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

// Contextual AI Tools Sidebar - Enhanced with better guidance
function ContextualAITools({ currentStep, hasPatient, hasNotes, hasEnhancedNote, onAction, diagnosis, complianceScore }) {
  const getTools = () => {
    if (!hasPatient) return null;
    if (!hasNotes) return null;
    if (!hasEnhancedNote) return { 
      title: "✨ Ready to Enhance", 
      subtitle: "Step 3 of 4",
      items: [
        { label: "Transform to Medicare-Compliant", action: "enhance", type: "action", primary: true, icon: Sparkles },
      ],
      hint: diagnosis ? `AI will optimize for ${diagnosis.split(' ')[0]}` : "AI adds clinical language & compliance elements"
    };
    return { 
      title: "🎉 Note Complete!", 
      subtitle: complianceScore ? `${complianceScore}% Compliant` : "Ready to use",
      items: [
        { label: "Copy to Clipboard", action: "copy", type: "action", primary: true, icon: Copy },
        { label: "Generate Follow-up Tasks", action: "tasks", type: "action", icon: ClipboardList },
        { label: "Start New Note", action: "clear", type: "action", icon: RotateCcw }
      ],
      hint: "Review the note before pasting to EHR"
    };
  };
  const tools = getTools();

  if (!tools) return null;

  return (
    <Card className="border-2 border-indigo-200 bg-gradient-to-b from-indigo-50 to-white">
      <CardHeader className="py-3 pb-1">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="w-4 h-4 text-indigo-600" />
          {tools.title}
        </CardTitle>
        {tools.subtitle && (
          <p className="text-xs text-indigo-600 font-medium">{tools.subtitle}</p>
        )}
      </CardHeader>
      <CardContent className="py-2 space-y-2">
        {tools.items.map((item, idx) => (
          <div key={idx}>
            {item.type === 'action' ? (
              <Button
                size="sm"
                variant={item.primary ? "default" : "outline"}
                className={`w-full justify-between ${item.primary ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                onClick={() => onAction?.(item.action)}
              >
                <span className="flex items-center gap-2">
                  {item.icon && <item.icon className="w-3 h-3" />}
                  {item.label}
                </span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            ) : item.type === 'example' ? (
              <div className="bg-white/70 p-2 rounded border border-indigo-100">
                <p className="text-xs text-indigo-700 italic flex items-center gap-1">
                  <MessageCircle className="w-3 h-3" /> {item.label}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                {item.icon && <item.icon className="w-3 h-3 text-indigo-400" />}
                {item.label}
              </div>
            )}
          </div>
        ))}
        {tools.hint && (
          <div className="pt-2 border-t border-indigo-100">
            <p className="text-xs text-indigo-600 flex items-center gap-1">
              <Lightbulb className="w-3 h-3" /> {tools.hint}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Smart caching for AI responses to prevent redundant API calls
const aiResponseCache = new Map();

const useCachedAIResponse = (cacheKey, fetcher, ttl = 300000) => { // 5 min TTL
  const getCached = () => {
    const cached = aiResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data;
    }
    return null;
  };

  const setCached = (data) => {
    aiResponseCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  };

  return { getCached, setCached };
};

export default function SmartNoteAssistant() {
  const queryClient = useQueryClient();
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [visitType, setVisitType] = useState("routine_visit");
  const [visitDate, setVisitDate] = useState(todayEastern());
  const [diagnosis, setDiagnosis] = useState("");
  const [customDiagnosis, setCustomDiagnosis] = useState("");
  const [activeAITab, setActiveAITab] = useState("workflow");
  const [vitalSigns, setVitalSigns] = useState({ bp: "", hr: "", temp: "", o2: "", o2Source: "room_air", o2Flow: "", pain: "" });
  const [roughNote, setRoughNote] = useState("");
  const [enhancedNote, setEnhancedNote] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [auditResults, setAuditResults] = useState(null);
  const [activeAccordion, setActiveAccordion] = useState("");
  const [roughNoteCompliance, setRoughNoteCompliance] = useState(null);
  const [enhancedNoteCompliance, setEnhancedNoteCompliance] = useState(null);
  const [appliedFixes, setAppliedFixes] = useState([]);
  const [dismissedElementNames, setDismissedElementNames] = useState([]);
  const [complianceIssues, setComplianceIssues] = useState([]);
  const [oasisLinkedItems, setOasisLinkedItems] = useState([]);
  const [oasisDiscrepancies, setOasisDiscrepancies] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccessfully, setSavedSuccessfully] = useState(false);
  const [detectedComplianceRisks, setDetectedComplianceRisks] = useState([]);
  const [pdgmOptimizationWarnings, setPdgmOptimizationWarnings] = useState([]);
  const [noteStartTime, setNoteStartTime] = useState(null);
  const [complianceReviewComplete, setComplianceReviewComplete] = useState(false);
  const [appliedFixesText, setAppliedFixesText] = useState(new Set());
  const [isAnalyzingCompliance, setIsAnalyzingCompliance] = useState(false);
  const [interimVoiceText, setInterimVoiceText] = useState('');
  const [comprehensiveContext, setComprehensiveContext] = useState(null);
  const [oasisAutomationResults, setOasisAutomationResults] = useState(null);
  const [isRunningOASISAutomation, setIsRunningOASISAutomation] = useState(false);
  const [complianceTarget, setComplianceTarget] = useState(90);
  const [documentationGaps, setDocumentationGaps] = useState([]);
  const [pdgmOpportunities, setPdgmOpportunities] = useState(null);
  const [isAnalyzingPDGM, setIsAnalyzingPDGM] = useState(false);
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false);
  const [isVoiceListening, setIsVoiceListening] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Log page visit
  useEffect(() => {
    if (currentUser?.email) {
      logActivity(ActivityActions.PAGE_VISIT, {
        page: 'SmartNoteAssistant',
        page_title: 'Smart Note Assistant'
      });
    }
  }, [currentUser?.email]);

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: [],
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', selectedPatientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId,
  });

  const { data: recentVisits = [] } = useQuery({
    queryKey: ['patientRecentVisits', selectedPatientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatientId, status: 'completed' }, '-visit_date', 3),
    enabled: !!selectedPatientId,
  });

  const { data: patientOASIS = [] } = useQuery({
    queryKey: ['patientOASISForNotes', selectedPatientId],
    queryFn: () => base44.entities.OASISUpload.filter({ patient_id: selectedPatientId }, '-created_date', 1),
    enabled: !!selectedPatientId,
  });

  // Extract comprehensive OASIS context
  const oasisContext = React.useMemo(() => {
    if (!patientOASIS || patientOASIS.length === 0) return null;

    const latest = patientOASIS[0];
    const pdgm = latest.pdgm_data || {};
    const extracted = latest.extracted_data || {};

    return {
      assessmentDate: latest.created_date,
      admissionSource: pdgm.admission_source || extracted.admission_source,
      clinicalGroup: pdgm.clinical_grouping || extracted.clinical_group,
      functionalLevel: pdgm.functional_impairment_level || extracted.functional_level,
      comorbidities: Array.isArray(pdgm.comorbidity_level) ? pdgm.comorbidity_level : 
                    Array.isArray(extracted.comorbidities) ? extracted.comorbidities : [],
      primaryDiagnosis: extracted.primary_diagnosis || pdgm.primary_diagnosis,
      secondaryDiagnoses: extracted.secondary_diagnoses || [],
      medications: extracted.medications || [],
      admissionReason: extracted.admission_reason,
      priorHospitalization: extracted.prior_hospitalization,
      livingArrangement: extracted.living_arrangement,
      visionStatus: extracted.vision,
      hearingStatus: extracted.hearing,
      painLevel: extracted.pain_frequency,
      fallRisk: extracted.fall_risk,
      cognitiveStatus: extracted.cognitive_functioning,
      adlStatus: extracted.adl_limitations || {},
      iadlStatus: extracted.iadl_limitations || {}
    };
  }, [patientOASIS]);

  const selectedPatient = patients.find(p => p.id === selectedPatientId);
  
  // Auto-fill diagnosis when patient is selected
  React.useEffect(() => {
    if (selectedPatient?.primary_diagnosis && selectedPatientId) {
      const matchingDiagnosis = commonDiagnoses.find(dx => 
        selectedPatient.primary_diagnosis.toLowerCase().includes(dx.toLowerCase().split(' ')[0].toLowerCase()) ||
        dx.toLowerCase().includes(selectedPatient.primary_diagnosis.toLowerCase().split(' ')[0].toLowerCase())
      );
      if (matchingDiagnosis) {
        setDiagnosis(matchingDiagnosis);
      } else {
        setDiagnosis("Custom (type below)");
        setCustomDiagnosis(selectedPatient.primary_diagnosis);
      }
    }
  }, [selectedPatientId]);

  // Clear AI cache when patient changes
  React.useEffect(() => {
    if (selectedPatientId) {
      aiResponseCache.clear();
    }
  }, [selectedPatientId]);

  const finalDiagnosis = diagnosis === "Custom (type below)" ? customDiagnosis : diagnosis;

  // Build patient context for compliance checking
  const patientContext = selectedPatient ? {
    name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
    primaryDiagnosis: selectedPatient.primary_diagnosis || finalDiagnosis,
    secondaryDiagnoses: selectedPatient.secondary_diagnoses || [],
    allergies: selectedPatient.allergies,
    recentConditions: recentVisits[0]?.nurse_notes ? 
      recentVisits[0].nurse_notes.substring(0, 200) + '...' : null,
    previousVisitSummary: recentVisits[0] ? 
      `Last visit ${recentVisits[0].visit_date}: ${recentVisits[0].visit_type}` : null,
    carePlanGoals: carePlans.filter(cp => cp.status === 'active').map(cp => cp.goal)
  } : null;

  const currentStep = useMemo(() => {
    if (!selectedPatientId) return 'patient';
    if (!vitalSigns.bp && !vitalSigns.hr && !roughNote) return 'vitals';
    if (!roughNote || roughNote.length < 20) return 'notes';
    if (!enhancedNote) return 'enhance';
    return 'review';
  }, [selectedPatientId, vitalSigns, roughNote, enhancedNote]);

  // Step navigation helpers
  const stepOrder = ['patient', 'vitals', 'notes', 'enhance', 'review'];
  
  const handleStepClick = (stepId) => {
    const targetIndex = stepOrder.indexOf(stepId);
    const currentIndex = stepOrder.indexOf(currentStep);
    
    // Allow clicking on completed steps or current step
    if (targetIndex <= currentIndex || completedSteps.includes(stepId)) {
      // Scroll to the relevant section
      const sectionId = `step-${stepId}`;
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleGoBack = () => {
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex > 0) {
      const prevStep = stepOrder[currentIndex - 1];
      handleStepClick(prevStep);
    }
  };

  const completedSteps = useMemo(() => {
    const steps = [];
    if (selectedPatientId) steps.push('patient');
    if (vitalSigns.bp || vitalSigns.hr || vitalSigns.temp) steps.push('vitals');
    if (roughNote.length >= 20) steps.push('notes');
    if (enhancedNote) steps.push('enhance');
    return steps;
  }, [selectedPatientId, vitalSigns, roughNote, enhancedNote]);

  const handleEnhanceNote = async () => {
    if (!roughNote.trim()) return;
    setIsProcessing(true);
    const enhanceStartTime = Date.now();
    const actualDocTime = noteStartTime ? (enhanceStartTime - noteStartTime) : 0;

    try {
      // Use optimized backend function for enhancement
      const result = await base44.functions.invoke('enhanceNoteOptimized', {
        roughNote,
        patientId: selectedPatientId,
        visitType,
        visitDate,
        diagnosis: finalDiagnosis,
        vitalSigns,
        nurseType: currentUser?.credential_type || 'RN'
      });

      if (!result.success) {
        throw new Error(result.error || 'Enhancement failed');
      }

      setEnhancedNote(result.enhanced_note);
      setAuditResults({ 
        enhanced_note: result.enhanced_note,
        quality_score: result.quality_score 
      });
      setRoughNoteCompliance(result.rough_compliance);
      setEnhancedNoteCompliance(result.enhanced_compliance);
      setDocumentationGaps(result.documentation_gaps || []);
      setComplianceReviewComplete(false);

      // Log activity
      logActivity(ActivityActions.NOTE_ENHANCED, {
        patient_id: selectedPatientId,
        visit_type: visitType,
        diagnosis: finalDiagnosis,
        quality_score: result.quality_score,
        compliance_improvement: result.compliance_improvement,
        page: 'SmartNoteAssistant',
        ai_utilization: true
      });

      queryClient.invalidateQueries({ queryKey: ['patients'] });

    } catch (error) {
      console.error("Error enhancing note:", error);
      alert('Failed to enhance note. Please try again.');
    }
    setIsProcessing(false);
  };

  // Batch AI analysis for multiple operations
  const runBatchAnalysis = async (analysisTypes) => {
    try {
      const result = await base44.functions.invoke('batchAIAnalysis', {
        roughNote,
        enhancedNote,
        visitType,
        diagnosis: finalDiagnosis,
        vitalSigns,
        patientId: selectedPatientId,
        analysisTypes
      });

      if (result.success) {
        if (result.analyses.compliance) {
          setEnhancedNoteCompliance(result.analyses.compliance);
        }
        if (result.analyses.oasis) {
          setOasisAutomationResults(result.analyses.oasis);
        }
        if (result.analyses.pdgm) {
          setPdgmOpportunities(result.analyses.pdgm);
        }
        if (result.analyses.proactive) {
          // Handle proactive suggestions
          console.log('Proactive suggestions:', result.analyses.proactive);
        }
      }
    } catch (error) {
      console.error('Batch analysis error:', error);
    }
  };

  // Old implementation kept as fallback
  const handleEnhanceNoteFallback = async () => {
    if (!roughNote.trim()) return;
    setIsProcessing(true);
    const enhanceStartTime = Date.now();
    const actualDocTime = noteStartTime ? (enhanceStartTime - noteStartTime) : 0;

    // Calculate compliance of rough note BEFORE enhancement
    let roughCompliance = null;
    let identifiedGaps = [];
    try {
      const roughComplianceCheck = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this rough clinical note for Medicare compliance. Return a compliance score (0-100) based on presence of required elements.

  ROUGH NOTE:
  ${roughNote}

  VISIT TYPE: ${visitType}
  DIAGNOSIS: ${finalDiagnosis}

  Identify specific documentation gaps that must be addressed in enhancement.

  Return JSON with:
  {
    "compliance_score": 0-100,
    "missing_elements": ["element1", "element2"],
    "specific_gaps": [
      {
        "element": "Homebound Status",
        "reason": "No mention of mobility limitations or why leaving home is taxing",
        "priority": "critical"
      }
    ]
  }`,
        response_json_schema: {
          type: "object",
          properties: {
            compliance_score: { type: "number" },
            missing_elements: { type: "array", items: { type: "string" } },
            specific_gaps: { 
              type: "array", 
              items: { 
                type: "object",
                properties: {
                  element: { type: "string" },
                  reason: { type: "string" },
                  priority: { type: "string" }
                }
              }
            }
          }
        }
      });
      roughCompliance = roughComplianceCheck.compliance_score || 0;
      identifiedGaps = roughComplianceCheck.specific_gaps || [];
      setRoughNoteCompliance(roughComplianceCheck);
      setDocumentationGaps(identifiedGaps);
    } catch (error) {
      console.error('Error checking rough compliance:', error);
    }
    
    try {
      // Build comprehensive patient context
      const patientVisits = recentVisits || [];
      const patientCarePlans = carePlans || [];
      const patientIncidents = [];
      const patientAlerts = [];
      
      const fullContext = buildComprehensiveContext(
        selectedPatient, 
        patientVisits, 
        patientCarePlans, 
        patientIncidents,
        selectedPatient?.current_medications,
        patientAlerts
      );
      
      const contextualizedNote = formatContextForAI(fullContext);

      // Standardize medical terminology in rough note
      const standardizedNote = standardizeTerminology(roughNote);

      // Retrieve relevant Medicare guidelines for context
      const relevantGuidelines = await retrieveRelevantGuidelines({
        diagnosis: finalDiagnosis,
        visitType: visitType,
        noteContent: roughNote,
        maxGuidelines: 3
      });

      const guidelinesContext = formatGuidelinesForPrompt(relevantGuidelines);

      // Determine nurse type and adjust requirements accordingly
      const isLPN = currentUser?.credential_type === 'LPN';
      const nurseTitle = isLPN ? 'LPN' : 'RN';
      const nurseFullTitle = isLPN ? 'Licensed Practical Nurse' : 'Registered Nurse';

      const skilledNeedGuidance = isLPN ? 
        `Explicitly state why LPN skills are required - LPNs provide skilled services under RN supervision including:
         - Specific skilled tasks (wound care, medication administration, catheter care, tube feeding)
         - Implementation of established care plan interventions
         - Monitoring and reporting patient status changes
         - Patient/caregiver teaching on specific procedures (not comprehensive assessment/teaching)
         - DO NOT document comprehensive assessments, initial care planning, or complex clinical judgments (RN scope)
         ${oasisContext?.admissionSource === '2' || oasisContext?.admissionSource?.toLowerCase().includes('institutional') ? '- Document specific skilled interventions and monitoring per RN-established plan' : ''}
         ${oasisContext?.cognitiveStatus && oasisContext.cognitiveStatus !== 'intact' ? `- Document implementation of teaching strategies per RN plan, considering cognitive status (${oasisContext.cognitiveStatus})` : ''}` 
        : 
        `Explicitly state why RN skills are required (complex assessment, clinical judgment, patient education beyond basic instruction)
         ${oasisContext?.admissionSource === '2' || oasisContext?.admissionSource?.toLowerCase().includes('institutional') ? '- Document post-institutional monitoring and skilled assessment needs' : ''}
         ${oasisContext?.cognitiveStatus && oasisContext.cognitiveStatus !== 'intact' ? `- Address cognitive impairment (${oasisContext.cognitiveStatus}) requiring skilled nursing oversight` : ''}`;

      const patientResponseGuidance = isLPN ?
        `Document patient's response to specific interventions and teaching:
         - Patient's ability to demonstrate procedure/skill taught
         - Verbal feedback on specific interventions provided
         - Observed physical response to treatments
         ${oasisContext?.cognitiveStatus ? `- Note cognitive status (${oasisContext.cognitiveStatus}) affecting understanding of specific procedures` : ''}
         - Report any concerns/changes to RN supervisor`
        :
        `Include patient's verbal understanding, teach-back results, or demonstrated competency
         ${oasisContext?.cognitiveStatus ? `- Consider cognitive status (${oasisContext.cognitiveStatus}) when documenting teaching effectiveness` : ''}`;

      const functionalAssessmentGuidance = isLPN ?
        `LPNs observe and document functional status but do NOT perform comprehensive assessments:
         ${oasisContext?.adlStatus || oasisContext?.iadlStatus ? '- Note observed functional abilities compared to RN-documented baseline' : '- Document observed functional status during interventions'}
         ${oasisContext?.adlStatus && Object.keys(oasisContext.adlStatus).length > 0 ? `- Observed ADL performance: ${Object.entries(oasisContext.adlStatus).filter(([k,v]) => v).map(([k]) => k).join(', ')}` : ''}
         - Report any significant changes to RN`
        :
        `${oasisContext?.adlStatus || oasisContext?.iadlStatus ? 'Document changes in functional abilities compared to OASIS baseline:' : 'Document functional abilities:'}
         ${oasisContext?.adlStatus && Object.keys(oasisContext.adlStatus).length > 0 ? `- ADL assistance needs per OASIS: ${Object.entries(oasisContext.adlStatus).filter(([k,v]) => v).map(([k]) => k).join(', ')}` : ''}
         ${oasisContext?.iadlStatus && Object.keys(oasisContext.iadlStatus).length > 0 ? `- IADL assistance needs per OASIS: ${Object.entries(oasisContext.iadlStatus).filter(([k,v]) => v).map(([k]) => k).join(', ')}` : ''}`;

      const additionalRequirements = isLPN ? 
        `
      LPN-SPECIFIC DOCUMENTATION REQUIREMENTS:
      7. SUPERVISION ACKNOWLEDGMENT: LPN visits are under RN supervision per agency policy and state regulations
      8. CARE PLAN IMPLEMENTATION: Document specific interventions performed per RN-established care plan
      9. SCOPE LIMITATIONS: 
         - DO NOT document comprehensive patient assessments
         - DO NOT establish new care plan goals
         - DO NOT make independent clinical judgments requiring RN assessment
         - Focus on: skilled tasks performed, patient responses, observations, and reporting to RN
      10. REPORTING: Note what was reported to supervising RN (if applicable)
      11. PLAN OF CARE: Continue per RN-established plan, next LPN visit scheduled, when to contact RN/MD` 
      : 
      `
      RN-SPECIFIC DOCUMENTATION REQUIREMENTS:
      7. INTEGRATE CARE PLAN PROGRESS: Reference active care plan goals and document progress toward them
      8. COMPARE TO BASELINE: If previous visit data available, note changes from last visit
      9. FUNCTIONAL STATUS: Describe ADL limitations, mobility level, assistance needed
      10. PLAN OF CARE: State continuing plan, next visit schedule, when to contact nurse/MD`;

      // Build gap-specific enhancement instructions
      const gapInstructions = identifiedGaps.length > 0 ? `

      CRITICAL DOCUMENTATION GAPS IDENTIFIED - MUST ADDRESS:
      ${identifiedGaps.map((gap, idx) => `
      ${idx + 1}. ${gap.element} [${gap.priority.toUpperCase()}]
      Problem: ${gap.reason}
      Required Action: Add specific, measurable documentation for this element
      `).join('\n')}

      ` : '';

      const prompt = `You are an expert clinical documentation specialist for home health nursing. Transform these rough notes into Medicare-compliant clinical narrative.

      CRITICAL: This visit is documented by a ${nurseTitle} (${nurseFullTitle}).
      ${gapInstructions}

      ${contextualizedNote}

      VISIT DETAILS:
      - Visit Type: ${visitType.replace(/_/g, ' ')}
      - Visit Date: ${visitDate}
      - Documenting Nurse Type: ${nurseTitle}
      - Vitals: ${Object.entries(vitalSigns).filter(([k,v]) => v && k !== 'o2Source' && k !== 'o2Flow').map(([k,v]) => {
        if (k === 'o2') {
          const o2Text = `O2 Sat: ${v}`;
          if (vitalSigns.o2Source === 'on_oxygen' && vitalSigns.o2Flow) {
            return `${o2Text} on ${vitalSigns.o2Flow}L O2`;
          } else if (vitalSigns.o2Source === 'on_oxygen') {
            return `${o2Text} on supplemental O2`;
          }
          return `${o2Text} on room air`;
        }
        return `${k}: ${v}`;
      }).join(', ') || 'None provided'}

      PATIENT HISTORY:
      ${recentVisits.length > 0 ? `- Last Visit (${recentVisits[0].visit_date}): ${recentVisits[0].visit_type} - ${recentVisits[0].nurse_notes?.substring(0, 200)}...` : '- No previous visits on record'}

      ACTIVE CARE PLAN GOALS:
      ${carePlans.filter(cp => cp.status === 'active').map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') || '- No active care plans'}

      ${oasisContext ? `OASIS ASSESSMENT DATA (Synced):
      - Assessment Date: ${oasisContext.assessmentDate}
      - Admission Source: ${oasisContext.admissionSource === '1' || oasisContext.admissionSource?.toLowerCase().includes('community') ? 'Community (home)' : oasisContext.admissionSource === '2' || oasisContext.admissionSource?.toLowerCase().includes('institutional') ? 'Institutional (hospital/SNF discharge)' : oasisContext.admissionSource || 'Unknown'}
      - Clinical Group: ${oasisContext.clinicalGroup || 'Not specified'}
      - Functional Impairment Level: ${oasisContext.functionalLevel || 'Not specified'}
      - Documented Comorbidities: ${oasisContext.comorbidities.length > 0 ? oasisContext.comorbidities.join(', ') : 'None listed'}
      - OASIS Primary Diagnosis: ${oasisContext.primaryDiagnosis || 'Not specified'}
      - Secondary Diagnoses: ${oasisContext.secondaryDiagnoses.length > 0 ? oasisContext.secondaryDiagnoses.join(', ') : 'None'}
      - Current Medications: ${oasisContext.medications.length > 0 ? oasisContext.medications.slice(0, 5).join(', ') + (oasisContext.medications.length > 5 ? ` and ${oasisContext.medications.length - 5} more` : '') : 'Not documented'}
      - Admission Reason: ${oasisContext.admissionReason || 'Not specified'}
      - Living Arrangement: ${oasisContext.livingArrangement || 'Not specified'}
      - Cognitive Status: ${oasisContext.cognitiveStatus || 'Not assessed'}
      - Fall Risk: ${oasisContext.fallRisk || 'Not assessed'}
      - Pain Frequency: ${oasisContext.painLevel || 'Not assessed'}
      - Vision Status: ${oasisContext.visionStatus || 'Not assessed'}
      - Hearing Status: ${oasisContext.hearingStatus || 'Not assessed'}
      - ADL Limitations: ${Object.keys(oasisContext.adlStatus || {}).length > 0 ? Object.entries(oasisContext.adlStatus).filter(([k,v]) => v).map(([k]) => k).join(', ') : 'None documented'}
      - IADL Limitations: ${Object.keys(oasisContext.iadlStatus || {}).length > 0 ? Object.entries(oasisContext.iadlStatus).filter(([k,v]) => v).map(([k]) => k).join(', ') : 'None documented'}
      ` : ''}

      ROUGH NOTES (Standardized Medical Terminology):
      ${standardizedNote}

      CRITICAL ENHANCEMENT REQUIREMENTS:
      1. HOMEBOUND STATUS: ${oasisContext?.functionalLevel ? `Based on OASIS functional level (${oasisContext.functionalLevel}), document specific mobility limitations and why leaving home is taxing.` : 'If patient has mobility/activity limitations, clearly state why leaving home is taxing (specific symptoms, distances, assistance needed)'}
         ${oasisContext?.adlStatus && Object.keys(oasisContext.adlStatus).filter(k => oasisContext.adlStatus[k]).length > 0 ? `- OASIS shows ADL limitations in: ${Object.keys(oasisContext.adlStatus).filter(k => oasisContext.adlStatus[k]).join(', ')}` : ''}

      2. SKILLED NEED: ${skilledNeedGuidance}

      3. PATIENT RESPONSE: ${patientResponseGuidance}

      4. FUNCTIONAL ASSESSMENT: ${functionalAssessmentGuidance}

      5. SAFETY/RISK FACTORS: 
         ${oasisContext?.fallRisk ? `- Fall Risk: ${oasisContext.fallRisk} - document fall prevention measures` : ''}
         ${oasisContext?.visionStatus && oasisContext.visionStatus !== 'adequate' ? `- Vision impairment: ${oasisContext.visionStatus} - address safety implications` : ''}
         ${oasisContext?.hearingStatus && oasisContext.hearingStatus !== 'adequate' ? `- Hearing impairment: ${oasisContext.hearingStatus} - document communication adaptations` : ''}

      6. CONDITION-SPECIFIC DETAILS:
      ${finalDiagnosis?.toUpperCase().includes('CHF') || finalDiagnosis?.toUpperCase().includes('HEART FAILURE') || finalDiagnosis?.toUpperCase().includes('CONGESTIVE') ? '- CHF: Document daily weight, edema grading (0-4+), JVD assessment, bilateral lung sounds for crackles, S3 gallop, fluid status evaluation' : ''}
      ${finalDiagnosis?.toUpperCase().includes('COPD') || finalDiagnosis?.toUpperCase().includes('CHRONIC OBSTRUCTIVE') ? '- COPD: Document O2 sat on room air vs supplemental O2, respiratory rate, work of breathing, accessory muscle use, cyanosis, lung sounds (wheezes/rhonchi)' : ''}
      ${finalDiagnosis?.toUpperCase().includes('DIABETES') || finalDiagnosis?.toUpperCase().includes('DIABETIC') ? '- Diabetes: Document blood glucose reading, diabetic foot exam (pedal pulses, sensation, skin integrity between toes), peripheral neuropathy assessment' : ''}
      ${finalDiagnosis?.toUpperCase().includes('WOUND') || finalDiagnosis?.toUpperCase().includes('PRESSURE') || finalDiagnosis?.toUpperCase().includes('ULCER') ? '- Wound: Document dimensions (L x W x D in cm), wound bed appearance (% granulation/slough/eschar), exudate (type, amount, odor), periwound condition, undermining/tunneling' : ''}
      ${finalDiagnosis?.toUpperCase().includes('STROKE') || finalDiagnosis?.toUpperCase().includes('CVA') ? (isLPN ? '- Stroke: Document observed LOC, response to interventions, feeding/swallowing assistance provided per care plan' : '- Stroke: Document LOC, orientation, speech/aphasia, facial symmetry, motor strength bilateral (0-5 grading), sensation, swallowing safety') : ''}
      ${additionalRequirements}

      FORMATTING GUIDELINES:
      - Use complete sentences with proper medical terminology
      - Write in narrative paragraph format, not bullet points
      - Include measurable, objective data
      - Avoid vague terms like "doing well" or "stable" - be specific
      - Natural language flow suitable for EHR copy/paste

      CRITICAL - NO META-COMMENTARY:
      NEVER include sentences about documentation itself, such as:
      - "Thorough documentation of diagnoses could enhance reimbursement..."
      - "Recording vital signs will contribute to comprehensive assessments..."
      - "This documentation aligns with CMS compliance..."
      - "Further documentation would improve..."
      - ANY statement about the act of documenting or compliance standards
      
      Only write the actual clinical narrative as if it were going directly into the patient's chart. Write ONLY what a nurse would document about the patient visit - observations, assessments, interventions, patient responses. Do NOT write advice to the nurse about how to document.
${guidelinesContext}

      Return JSON:
      {
      "enhanced_note": "The complete clinical narrative",
      "quality_score": 0-100
      }`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            enhanced_note: { type: "string" },
            quality_score: { type: "number" }
          }
        }
      });
      setEnhancedNote(result.enhanced_note);
      setAuditResults(result);
      setComplianceReviewComplete(false); // Reset to show compliance review first

      // Calculate compliance of enhanced note AFTER enhancement
      let enhancedCompliance = null;
      try {
        const enhancedComplianceCheck = await base44.integrations.Core.InvokeLLM({
          prompt: `Analyze this enhanced clinical note for Medicare compliance. Return a compliance score (0-100) based on presence of required elements.

ENHANCED NOTE:
${result.enhanced_note}

VISIT TYPE: ${visitType}
DIAGNOSIS: ${finalDiagnosis}

Return JSON with:
{
  "compliance_score": 0-100,
  "compliant_elements": ["element1", "element2"]
}`,
          response_json_schema: {
            type: "object",
            properties: {
              compliance_score: { type: "number" },
              compliant_elements: { type: "array", items: { type: "string" } }
            }
          }
        });
        enhancedCompliance = enhancedComplianceCheck.compliance_score || 0;
        setEnhancedNoteCompliance(enhancedComplianceCheck);
      } catch (error) {
        console.error('Error checking enhanced compliance:', error);
      }

      // Save enhanced note to patient chart history immediately for future context
      try {
        const currentHistory = selectedPatient.enhanced_notes_history || [];
        const updatedHistory = [
          ...currentHistory,
          {
            date: new Date().toISOString(),
            visit_type: visitType,
            diagnosis: finalDiagnosis,
            enhanced_note: result.enhanced_note,
            rough_note: roughNote,
            quality_score: result.quality_score,
            nurse_email: currentUser?.email,
            vital_signs: vitalSigns
          }
        ];

        await base44.entities.Patient.update(selectedPatientId, {
          enhanced_notes_history: updatedHistory.slice(-10) // Keep last 10 notes for context
        });

        queryClient.invalidateQueries({ queryKey: ['patients'] });
      } catch (error) {
        console.error('Error saving note to patient history:', error);
      }

      // Log note enhancement activity - counts as AI utilization
      logActivity(ActivityActions.NOTE_ENHANCED, {
        patient_id: selectedPatientId,
        visit_type: visitType,
        visit_date: visitDate,
        diagnosis: finalDiagnosis,
        rough_note_length: roughNote.length,
        enhanced_note_length: result.enhanced_note?.length,
        quality_score: result.quality_score,
        page: 'SmartNoteAssistant',
        ai_utilization: true // Flag for analytics tracking
      });

      // Track note conversion with compliance improvement metrics
      try {
        const complianceImprovement = (roughCompliance !== null && enhancedCompliance !== null)
          ? enhancedCompliance - roughCompliance
          : null;

        await base44.entities.NoteConversion.create({
          nurse_email: currentUser?.email || 'unknown',
          patient_id: selectedPatientId || null,
          visit_type: visitType,
          diagnosis: finalDiagnosis || null,
          rough_note_length: roughNote.length,
          enhanced_note_length: result.enhanced_note?.length || 0,
          quality_score: result.quality_score || null,
          compliance_score: enhancedCompliance,
          rough_note_compliance: roughCompliance,
          enhanced_note_compliance: enhancedCompliance,
          compliance_improvement: complianceImprovement,
          conversion_time_ms: actualDocTime
        });
      } catch (trackError) {
        console.error("Error tracking note conversion:", trackError);
      }
      
      // Track any AI suggestions as recommendations for training
      if (currentUser?.email && result.missing_critical_elements) {
        result.missing_critical_elements.forEach(element => {
          trackRecommendation({
            nurseEmail: currentUser.email,
            type: categorizeRecommendation(element),
            text: element,
            source: "smart_note",
            severity: "medium",
            patientId: selectedPatientId
          });
        });
      }
    } catch (error) {
      console.error("Error enhancing note:", error);
    }
    setIsProcessing(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(enhancedNote);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    
    // Log copy action
    logActivity(ActivityActions.EXPORT, {
      type: 'clipboard_copy',
      patient_id: selectedPatientId,
      content_type: 'enhanced_note',
      note_length: enhancedNote.length,
      page: 'SmartNoteAssistant'
    });
  };

  const handleVoiceTranscription = (text) => {
    if (!noteStartTime) {
      setNoteStartTime(Date.now());
    }
    setRoughNote(prev => prev ? prev + ' ' + text : text);
    setInterimVoiceText('');
    
    // Log voice transcription usage
    logActivity(ActivityActions.AI_FEATURE_USED, {
      feature: 'voice_transcription',
      patient_id: selectedPatientId,
      page: 'SmartNoteAssistant'
    });
  };

  const handleInterimTranscription = (text) => {
    setInterimVoiceText(text);
  };

  const handleVoiceCommand = (action, spokenText, extractedValue) => {
    switch (action) {
      case 'enhance':
        handleEnhanceNote();
        break;
      case 'copy':
        handleCopy();
        break;
      case 'save':
        handleSaveNote();
        break;
      case 'clear':
        handleClearNote();
        break;
      case 'next':
        const currentIndex = stepOrder.indexOf(currentStep);
        if (currentIndex < stepOrder.length - 1) {
          handleStepClick(stepOrder[currentIndex + 1]);
        }
        break;
      case 'bp':
        if (extractedValue && extractedValue.length >= 2) {
          setVitalSigns(prev => ({ ...prev, bp: `${extractedValue[0]}/${extractedValue[1]}` }));
        }
        break;
      case 'hr':
        if (extractedValue && extractedValue[0]) {
          setVitalSigns(prev => ({ ...prev, hr: extractedValue[0] }));
        }
        break;
      case 'temp':
        if (extractedValue && extractedValue[0]) {
          setVitalSigns(prev => ({ ...prev, temp: extractedValue[0] }));
        }
        break;
      case 'o2':
        if (extractedValue && extractedValue[0]) {
          setVitalSigns(prev => ({ ...prev, o2: extractedValue[0] }));
        }
        break;
      case 'pain':
        if (extractedValue && extractedValue[0]) {
          setVitalSigns(prev => ({ ...prev, pain: extractedValue[0] }));
        }
        break;
      default:
        console.log('Unknown voice command:', action);
    }
    
    // Log voice command usage
    logActivity(ActivityActions.AI_FEATURE_USED, {
      feature: 'voice_command',
      command: action,
      patient_id: selectedPatientId,
      page: 'SmartNoteAssistant'
    });
  };



  const handleContextualAction = (action) => {
    if (action === 'enhance') handleEnhanceNote();
    if (action === 'copy') handleCopy();
    if (action === 'tasks') setActiveAccordion('tasks');
    if (action === 'clear') handleClearNote();
  };

  const handleClearNote = () => {
    setRoughNote("");
    setEnhancedNote("");
    setAuditResults(null);
    setAppliedFixes([]);
    setDismissedElementNames([]);
    setRoughNoteCompliance(null);
    setEnhancedNoteCompliance(null);
    setVisitDate(todayEastern());
    setNoteStartTime(null);
    setComplianceReviewComplete(false);
    setAppliedFixesText(new Set());
  };

  const handleInsertPhrase = (text) => {
    setRoughNote(prev => prev ? prev + ' ' + text : text);
  };

  const handleRunOASISAutomation = async () => {
    if (!enhancedNote || !selectedPatientId) return;

    setIsRunningOASISAutomation(true);
    try {
      // Use batch analysis for OASIS
      await runBatchAnalysis(['oasis']);
      setActiveAccordion('oasis');
      
      logActivity(ActivityActions.AI_FEATURE_USED, {
        feature: 'oasis_automation_batched',
        patient_id: selectedPatientId,
        page: 'SmartNoteAssistant'
      });
    } catch (error) {
      console.error('Error running OASIS automation:', error);
      alert('Failed to run OASIS automation. Please try again.');
    }
    setIsRunningOASISAutomation(false);
  };

  // Old OASIS implementation kept as fallback
  const handleRunOASISAutomationFallback = async () => {
    if (!enhancedNote || !selectedPatientId) return;

    setIsRunningOASISAutomation(true);
    try {
      // Enhanced OASIS mapping with detailed justifications
      const enhancedMapping = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an OASIS-E expert. Analyze this clinical note and map it to specific OASIS items with detailed justifications.

  ENHANCED CLINICAL NOTE:
  ${enhancedNote}

  PATIENT DATA:
  - Diagnosis: ${finalDiagnosis}
  - Visit Type: ${visitType}
  - Vitals: ${JSON.stringify(vitalSigns)}
  ${selectedPatient ? `- Age: ${selectedPatient.date_of_birth ? Math.floor((new Date() - new Date(selectedPatient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}` : ''}
  ${selectedPatient?.functional_status ? `- Functional Status: ${JSON.stringify(selectedPatient.functional_status)}` : ''}

  For EACH OASIS item you can confidently map, provide:
  1. OASIS Item Number (e.g., M1800, M1810, M1860)
  2. Suggested Value/Response
  3. Confidence Score (0-100)
  4. Specific Evidence from Note (quote exact phrases)
  5. Clinical Justification for scoring
  6. PDGM Impact (if applicable)

  Focus on functional items (M1800-M1890), wounds (M1306-M1342), medications, and comorbidities.

  Return JSON array of mappings with above fields.`,
        response_json_schema: {
          type: "object",
          properties: {
            mappings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  oasis_item: { type: "string" },
                  item_description: { type: "string" },
                  suggested_value: { type: "string" },
                  confidence: { type: "number" },
                  evidence_from_note: { type: "string" },
                  clinical_justification: { type: "string" },
                  pdgm_impact: { type: "string" },
                  requires_verification: { type: "boolean" }
                }
              }
            },
            high_confidence_items: { type: "number" },
            medium_confidence_items: { type: "number" },
            low_confidence_items: { type: "number" }
          }
        }
      });

      setOasisAutomationResults(enhancedMapping);
      setActiveAccordion('oasis');

      logActivity(ActivityActions.AI_FEATURE_USED, {
        feature: 'oasis_automation_enhanced',
        patient_id: selectedPatientId,
        items_mapped: enhancedMapping.mappings?.length || 0,
        high_confidence: enhancedMapping.high_confidence_items || 0,
        page: 'SmartNoteAssistant'
      });
    } catch (error) {
      console.error('Error running OASIS automation:', error);
      alert('Failed to run OASIS automation. Please try again.');
    }
    setIsRunningOASISAutomation(false);
  };

  const handleApplyOASISSuggestion = async (suggestion) => {
    try {
      // Update or create OASIS record with AI suggestion
      const oasisData = {
        patient_id: selectedPatientId,
        extracted_data: {
          [suggestion.item_number]: {
            value: suggestion.suggested_value,
            label: suggestion.suggested_value_label,
            confidence: suggestion.confidence_score,
            source: 'ai_automation',
            applied_by: currentUser?.email,
            applied_at: new Date().toISOString()
          }
        }
      };

      // If OASIS exists, update it; otherwise create new
      if (patientOASIS?.length > 0) {
        const existing = patientOASIS[0];
        const updatedData = {
          ...existing.extracted_data,
          ...oasisData.extracted_data
        };
        
        await base44.entities.OASISUpload.update(existing.id, {
          extracted_data: updatedData
        });
      } else {
        await base44.entities.OASISUpload.create(oasisData);
      }

      queryClient.invalidateQueries({ queryKey: ['patientOASISForNotes', selectedPatientId] });
    } catch (error) {
      console.error('Error applying OASIS suggestion:', error);
      alert('Failed to apply OASIS suggestion. Please try again.');
    }
  };

  const handleApplyAllOASIS = async (suggestions) => {
    try {
      const extractedData = {};
      
      suggestions.forEach(s => {
        extractedData[s.item_number] = {
          value: s.suggested_value,
          label: s.suggested_value_label,
          confidence: s.confidence_score,
          source: 'ai_automation_bulk',
          applied_by: currentUser?.email,
          applied_at: new Date().toISOString()
        };
      });

      const oasisData = {
        patient_id: selectedPatientId,
        extracted_data: extractedData
      };

      if (patientOASIS?.length > 0) {
        const existing = patientOASIS[0];
        const updatedData = {
          ...existing.extracted_data,
          ...extractedData
        };
        
        await base44.entities.OASISUpload.update(existing.id, {
          extracted_data: updatedData
        });
      } else {
        await base44.entities.OASISUpload.create(oasisData);
      }

      queryClient.invalidateQueries({ queryKey: ['patientOASISForNotes', selectedPatientId] });
    } catch (error) {
      console.error('Error applying all OASIS suggestions:', error);
      alert('Failed to apply OASIS suggestions. Please try again.');
    }
  };

  const analyzePDGMOpportunities = async () => {
    if (!enhancedNote || !selectedPatient) return;

    setIsAnalyzingPDGM(true);
    try {
      // Use batch analysis for PDGM
      await runBatchAnalysis(['pdgm']);

      logActivity(ActivityActions.AI_FEATURE_USED, {
        feature: 'pdgm_optimization_batched',
        patient_id: selectedPatientId,
        page: 'SmartNoteAssistant'
      });
    } catch (error) {
      console.error('Error analyzing PDGM opportunities:', error);
    }
    setIsAnalyzingPDGM(false);
  };

  // Old PDGM implementation kept as fallback
  const analyzePDGMOpportunitiesFallback = async () => {
    if (!enhancedNote || !selectedPatient) return;

    setIsAnalyzingPDGM(true);
    try {
      const pdgmAnalysis = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a PDGM optimization expert. Analyze this clinical note and patient profile for revenue optimization opportunities.

  ENHANCED NOTE:
  ${enhancedNote}

  PATIENT PROFILE:
  - Primary Diagnosis: ${finalDiagnosis}
  - Secondary Diagnoses: ${selectedPatient.secondary_diagnoses?.join(', ') || 'None documented'}
  - Current Medications: ${selectedPatient.current_medications?.map(m => m.name).join(', ') || 'None'}
  - Functional Status: ${JSON.stringify(selectedPatient.functional_status || {})}
  - Age: ${selectedPatient.date_of_birth ? Math.floor((new Date() - new Date(selectedPatient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}

  Identify PDGM optimization opportunities:

  1. COMORBIDITY CAPTURE:
   - Secondary diagnoses implied by medications but not documented
   - Clinical findings suggesting additional diagnoses
   - Comorbidity adjustments that would increase case-mix weight

  2. FUNCTIONAL IMPAIRMENT:
   - Current functional level vs documented level
   - ADL/IADL limitations that should be documented
   - GG items that could be scored more accurately

  3. CLINICAL GROUP ASSIGNMENT:
   - Current probable clinical group
   - Alternative groups with higher reimbursement
   - Documentation needed to support optimal grouping

  4. TIMING FACTORS:
   - Early vs Late timing considerations
   - Admission source impact on reimbursement

  Return specific, actionable opportunities with revenue impact estimates.`,
        response_json_schema: {
          type: "object",
          properties: {
            current_estimated_case_mix: { type: "number" },
            optimized_case_mix_potential: { type: "number" },
            revenue_impact: { type: "number" },
            opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  finding: { type: "string" },
                  suggested_documentation: { type: "string" },
                  evidence_in_note: { type: "string" },
                  revenue_impact: { type: "number" },
                  priority: { type: "string" },
                  actionable_now: { type: "boolean" }
                }
              }
            },
            summary: { type: "string" }
          }
        }
      });

      setPdgmOpportunities(pdgmAnalysis);

      logActivity(ActivityActions.AI_FEATURE_USED, {
        feature: 'pdgm_optimization_analysis',
        patient_id: selectedPatientId,
        opportunities_found: pdgmAnalysis.opportunities?.length || 0,
        potential_impact: pdgmAnalysis.revenue_impact || 0,
        page: 'SmartNoteAssistant'
      });
    } catch (error) {
      console.error('Error analyzing PDGM opportunities:', error);
    }
    setIsAnalyzingPDGM(false);
  };

  const handleSaveNote = async () => {
    if (!selectedPatientId || !enhancedNote) return;

    setIsSaving(true);
    try {
      // Save visit note
      const visit = await base44.entities.Visit.create({
        patient_id: selectedPatientId,
        visit_date: visitDate,
        visit_type: visitType,
        status: 'completed',
        nurse_notes: enhancedNote,
        vital_signs: {
          blood_pressure_systolic: vitalSigns.bp?.split('/')[0] || null,
          blood_pressure_diastolic: vitalSigns.bp?.split('/')[1] || null,
          heart_rate: vitalSigns.hr ? parseInt(vitalSigns.hr) : null,
          temperature: vitalSigns.temp ? parseFloat(vitalSigns.temp) : null,
          oxygen_saturation: vitalSigns.o2 ? parseInt(vitalSigns.o2) : null,
          pain_level: vitalSigns.pain ? parseInt(vitalSigns.pain) : null,
          weight: vitalSigns.weight ? parseFloat(vitalSigns.weight) : null
        }
      });

      setSavedSuccessfully(true);
      setTimeout(() => setSavedSuccessfully(false), 3000);

      // Log visit save
      logActivity(ActivityActions.VISIT_DOCUMENT, {
        patient_id: selectedPatientId,
        visit_id: visit.id,
        visit_date: visitDate,
        visit_type: visitType,
        note_length: enhancedNote.length,
        note_quality_score: auditResults?.quality_score,
        compliance_score: enhancedNoteCompliance?.overall_score,
        page: 'SmartNoteAssistant'
      });

      // Refresh patient and recent visits
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['patientRecentVisits', selectedPatientId] });

      // Trigger predictive risk analysis after visit completion
      try {
        await base44.functions.invoke('predictiveRiskAnalysis', {
          patient_id: selectedPatientId
        });
        queryClient.invalidateQueries({ queryKey: ['patientRiskAlerts', selectedPatientId] });
      } catch (riskError) {
        console.error('Risk analysis error:', riskError);
      }

      // Trigger predictive risk analysis after visit completion
      try {
        await base44.functions.invoke('predictiveRiskAnalysis', {
          patient_id: selectedPatientId
        });
        queryClient.invalidateQueries({ queryKey: ['patientRiskAlerts', selectedPatientId] });
      } catch (riskError) {
        console.error('Risk analysis error:', riskError);
      }

      logActivity(ActivityActions.VISIT_DOCUMENT, {
        patient_id: selectedPatientId,
        visit_date: visitDate,
        visit_type: visitType,
        note_length: enhancedNote.length,
        page: 'SmartNoteAssistant'
      });
    } catch (error) {
      console.error("Error saving note:", error);
    }
    setIsSaving(false);
  };

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-4 md:mb-6 flex items-center justify-between gap-2 md:gap-4">
        <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
          {currentStep !== 'patient' && (
            <Button 
              variant="outline" 
              size="default"
              onClick={handleGoBack}
              className="gap-1 text-gray-600 hover:text-gray-900 flex-shrink-0 min-h-[44px] px-3"
            >
              <ChevronLeft className="w-5 h-5" />
              <span className="hidden md:inline">Back</span>
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-gray-900 truncate">Smart Note Assistant</h1>
            <p className="text-sm md:text-base text-gray-600 hidden md:block">Transform rough notes into Medicare-compliant documentation</p>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <FavoriteButton type="page" id="SmartNoteAssistant" name="Smart Note Assistant" />
          <Button 
            variant="ghost" 
            size="default" 
            className="text-gray-500 gap-1 min-h-[44px]"
            onClick={async () => {
              try {
                const response = await base44.functions.invoke('generateSmartNoteGuide');
                const data = response.data || response;
                
                if (data.pdf) {
                  const binaryString = atob(data.pdf);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  const blob = new Blob([bytes], { type: 'application/pdf' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = data.filename || 'Smart_Note_Guide.pdf';
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  a.remove();
                }
              } catch (error) {
                console.error('Error downloading guide:', error);
                alert('Failed to download guide. Please try again.');
              }
            }}
          >
            <HelpCircle className="w-5 h-5" />
            <span className="hidden xl:inline">User Guide</span>
          </Button>
        </div>
      </div>

      {/* Enhanced Step Progress */}
      <EnhancedStepIndicator 
        currentStep={currentStep} 
        completedSteps={completedSteps}
        onStepClick={handleStepClick}
        patientName={selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : null}
        vitalStats={vitalSigns.bp || vitalSigns.hr ? `BP: ${vitalSigns.bp || '-'}, HR: ${vitalSigns.hr || '-'}` : null}
        noteLength={roughNote.length}
        complianceScore={enhancedNoteCompliance?.overall_score}
      />

      {/* Enhanced Patient Overview */}
      {selectedPatient && (
        <div className="mb-6 bg-blue-50 p-4 rounded-lg border-2 border-blue-300 shadow-lg">
          <UnifiedPatientOverview
            patient={selectedPatient}
            carePlans={carePlans}
            recentVisits={recentVisits}
            patientOASIS={patientOASIS}
            vitalSigns={vitalSigns}
            diagnosis={finalDiagnosis}
            onClear={() => setSelectedPatientId("")}
            onSyncData={(syncData) => {
              if (syncData.diagnosis) {
                setDiagnosis("Custom (type below)");
                setCustomDiagnosis(syncData.diagnosis);
              }
              const narrativeIntro = [];
              if (syncData.diagnosis) narrativeIntro.push(`Patient with ${syncData.diagnosis}`);
              if (syncData.comorbidities?.length > 0) {
                narrativeIntro.push(`and ${syncData.comorbidities.slice(0, 3).join(', ')}`);
              }
              if (syncData.admissionSource === 'institutional') {
                narrativeIntro.push('Recently discharged from facility.');
              }
              if (narrativeIntro.length > 0) {
                setRoughNote(prev => narrativeIntro.join(' ') + '. ' + prev);
              }
            }}
            onInsertTemplate={(template) => setRoughNote(prev => prev + '\n\n' + template)}
          />
          {/* Quick Patient Info Bar */}
          {selectedPatient.allergies && (
            <Alert className="mt-3 bg-red-50 border-red-300">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-sm font-medium text-red-800">
                <strong>ALLERGIES:</strong> {selectedPatient.allergies}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
        <div className="xl:col-span-3 space-y-4 md:space-y-6">

          {/* Step 1: Patient Selection - Enhanced */}
          <Card id="step-patient" className={`border-2 transition-all duration-300 ${currentStep === 'patient' ? 'border-blue-500 ring-4 ring-blue-200 shadow-xl' : 'border-gray-300'}`}>
            <CardHeader className="py-5 md:py-6 bg-gradient-to-r from-blue-100 to-indigo-100">
              <CardTitle className="text-lg md:text-xl flex items-center gap-3">
                <div className={`p-2 rounded-full ${currentStep === 'patient' ? 'bg-blue-500' : 'bg-gray-400'}`}>
                  <User className="w-5 h-5 text-white" />
                </div>
                <span>1. Select Patient & Visit Type</span>
                {selectedPatient && <CheckCircle2 className="w-6 h-6 text-green-600 ml-auto animate-pulse" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 md:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <div>
                  <Label className="text-sm md:text-base mb-2 block">Patient</Label>
                  <SearchablePatientSelect
                    patients={patients}
                    value={selectedPatientId}
                    onValueChange={(id) => {
                      setSelectedPatientId(id);
                      const patient = patients.find(p => p.id === id);
                      if (patient?.primary_diagnosis) {
                        const matchingDiagnosis = commonDiagnoses.find(dx => 
                          patient.primary_diagnosis.toLowerCase().includes(dx.toLowerCase().split(' ')[0].toLowerCase()) ||
                          dx.toLowerCase().includes(patient.primary_diagnosis.toLowerCase().split(' ')[0].toLowerCase())
                        );
                        if (matchingDiagnosis) {
                          setDiagnosis(matchingDiagnosis);
                        } else {
                          setDiagnosis("Custom (type below)");
                          setCustomDiagnosis(patient.primary_diagnosis);
                        }
                      }
                    }}
                    placeholder="Search patients..."
                  />
                </div>
                <div>
                  <Label className="text-sm md:text-base mb-2 block">Visit Date</Label>
                  <Input 
                    type="date" 
                    value={visitDate} 
                    onChange={(e) => setVisitDate(e.target.value)}
                    max={todayEastern()}
                    className="h-11 md:h-12 text-base"
                  />
                </div>
                <div>
                  <Label className="text-sm md:text-base mb-2 block">Visit Type</Label>
                  <Select value={visitType} onValueChange={setVisitType}>
                    <SelectTrigger className="h-11 md:h-12 text-base"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admission" className="text-base py-3">Admission</SelectItem>
                      <SelectItem value="routine_visit" className="text-base py-3">Routine Visit</SelectItem>
                      <SelectItem value="recertification" className="text-base py-3">Recertification</SelectItem>
                      <SelectItem value="discharge" className="text-base py-3">Discharge</SelectItem>
                      <SelectItem value="prn" className="text-base py-3">PRN Visit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm md:text-base mb-2 block">Diagnosis</Label>
                  <Select value={diagnosis} onValueChange={setDiagnosis}>
                    <SelectTrigger className="h-11 md:h-12 text-base"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {commonDiagnoses.map((dx) => (
                        <SelectItem key={dx} value={dx} className="text-base py-3">{dx}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {diagnosis === "Custom (type below)" && (
                <Input 
                  placeholder="Enter custom diagnosis" 
                  value={customDiagnosis} 
                  onChange={(e) => setCustomDiagnosis(e.target.value)}
                  className="h-11 md:h-12 text-base"
                />
              )}
            </CardContent>
          </Card>

          {/* Step 2: Vitals - Enhanced */}
          <Card id="step-vitals" className={`border-2 transition-all duration-300 ${currentStep === 'vitals' ? 'border-green-500 ring-4 ring-green-200 shadow-xl' : 'border-gray-300'}`}>
            <CardHeader className="py-5 md:py-6 bg-gradient-to-r from-green-100 to-emerald-100">
              <CardTitle className="text-lg md:text-xl flex items-center gap-3">
                <div className={`p-2 rounded-full ${currentStep === 'vitals' ? 'bg-green-500' : 'bg-gray-400'}`}>
                  <Activity className="w-5 h-5 text-white" />
                </div>
                <span>2. Vital Signs</span>
                {(vitalSigns.bp || vitalSigns.hr) && <CheckCircle2 className="w-6 h-6 text-green-600 ml-auto animate-pulse" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 md:p-6">
              <SmartVitalsInput 
                vitalSigns={vitalSigns} 
                onChange={setVitalSigns} 
              />
            </CardContent>
          </Card>

          {/* Consolidated AI Suggestions - All Categories */}
          {(roughNote.length >= 150 || enhancedNote) && selectedPatientId && (
            <ConsolidatedAISuggestions
              roughNote={roughNote}
              enhancedNote={enhancedNote}
              visitType={visitType}
              diagnosis={finalDiagnosis}
              patientData={selectedPatient}
              vitalSigns={vitalSigns}
              carePlans={carePlans}
              patientId={selectedPatientId}
              currentUserEmail={currentUser?.email}
              onApplyCompliance={(text) => {
                if (enhancedNote) {
                  setEnhancedNote(prev => prev + '\n\n' + text);
                } else {
                  setRoughNote(prev => prev + '\n\n' + text);
                }
              }}
              onApplyPDGM={(text) => {
                if (enhancedNote) {
                  setEnhancedNote(prev => prev + '\n\n' + text);
                } else {
                  setRoughNote(prev => prev + '\n\n' + text);
                }
              }}
              onCreateTask={async (taskData) => {
                await base44.entities.Task.create({
                  patient_id: selectedPatientId,
                  ...taskData,
                  assigned_to: currentUser?.email
                });
                queryClient.invalidateQueries({ queryKey: ['tasks'] });
              }}
              onCreateCarePlan={async (carePlanData) => {
                await base44.entities.CarePlan.create({
                  patient_id: selectedPatientId,
                  ...carePlanData
                });
                queryClient.invalidateQueries({ queryKey: ['patientCarePlans', selectedPatientId] });
              }}
              onApplyOASIS={async (oasisItems) => {
                try {
                  const extractedData = {};
                  oasisItems.forEach(item => {
                    extractedData[item.item_number] = {
                      value: item.suggested_value,
                      confidence: item.confidence,
                      evidence: item.evidence,
                      source: 'ai_note_analysis',
                      applied_by: currentUser?.email,
                      applied_at: new Date().toISOString()
                    };
                  });

                  if (patientOASIS?.length > 0) {
                    const existing = patientOASIS[0];
                    await base44.entities.OASISUpload.update(existing.id, {
                      extracted_data: { ...existing.extracted_data, ...extractedData }
                    });
                  } else {
                    await base44.entities.OASISUpload.create({
                      patient_id: selectedPatientId,
                      extracted_data: extractedData
                    });
                  }
                  queryClient.invalidateQueries({ queryKey: ['patientOASISForNotes', selectedPatientId] });
                } catch (error) {
                  console.error('Error applying OASIS:', error);
                }
              }}
              autoAnalyze={true}
            />
          )}



          {/* Comprehensive Patient Context Loader */}
          {selectedPatientId && (
            <ComprehensivePatientContext
              patientId={selectedPatientId}
              onContextReady={setComprehensiveContext}
            />
          )}

          {/* AI Draft Generator - Generate complete preliminary note */}
          {selectedPatientId && visitType && finalDiagnosis && roughNote.length < 50 && !enhancedNote && (
            <AIDraftGenerator
              visitType={visitType}
              diagnosis={finalDiagnosis}
              patientData={selectedPatient}
              vitalSigns={vitalSigns}
              recentVisits={recentVisits}
              carePlans={carePlans}
              onDraftGenerated={(draft) => {
                setRoughNote(draft);
                if (!noteStartTime) {
                  setNoteStartTime(Date.now());
                }
              }}
            />
          )}

          {/* Bullet Point Expander */}
          {selectedPatientId && visitType && finalDiagnosis && roughNote.length < 100 && !enhancedNote && (
            <BulletPointExpander
              visitType={visitType}
              diagnosis={finalDiagnosis}
              patientName={selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : ''}
              onExpanded={(text) => {
                setRoughNote(prev => prev ? prev + '\n\n' + text : text);
                if (!noteStartTime) {
                  setNoteStartTime(Date.now());
                }
              }}
            />
          )}

          {/* Patient History Auto-Populator */}
          {selectedPatientId && recentVisits.length > 0 && !enhancedNote && roughNote.length < 100 && (
            <PatientHistoryAutoPopulator
              patient={selectedPatient}
              recentVisits={recentVisits}
              carePlans={carePlans}
              diagnosis={finalDiagnosis}
              visitType={visitType}
              onPopulate={(text) => setRoughNote(prev => text + '\n\n' + prev)}
            />
          )}

          {/* Real-Time Clinical Decision Support */}
          {selectedPatientId && (diagnosis || vitalSigns.bp || vitalSigns.hr || roughNote.length > 30) && (
            <ClinicalDecisionSupport
              enhancedNote={enhancedNote}
              extractedData={null}
              diagnosis={finalDiagnosis}
              careType={selectedPatient?.care_type || "home_health"}
              vitalSigns={vitalSigns}
              roughNote={roughNote}
              onInsertRecommendation={(text) => {
                if (enhancedNote) {
                  setEnhancedNote(prev => prev + '\n\n' + text);
                } else {
                  setRoughNote(prev => prev + '\n\n' + text);
                }
              }}
            />
          )}

          {/* Real-Time Deterioration Predictor */}
          {selectedPatientId && (roughNote.length >= 100 || enhancedNote) && (
            <RealTimeDeteriorationPredictor
              noteContent={enhancedNote || roughNote}
              patientData={selectedPatient}
              vitalSigns={vitalSigns}
              recentVisits={recentVisits}
              diagnosis={finalDiagnosis}
              onCreateAlert={async (alertData) => {
                await base44.entities.PatientAlert.create(alertData);
                queryClient.invalidateQueries({ queryKey: ['patientActiveAlerts', selectedPatientId] });
              }}
              onAddToNote={(text) => {
                if (enhancedNote) {
                  setEnhancedNote(prev => prev + '\n\n' + text);
                } else {
                  setRoughNote(prev => prev + '\n\n' + text);
                }
              }}
              autoAnalyze={true}
            />
          )}

          {/* AI Education Material Suggester */}
          {selectedPatientId && (roughNote.length >= 100 || enhancedNote) && (
            <AIEducationMaterialSuggester
              noteContent={enhancedNote || roughNote}
              diagnosis={finalDiagnosis}
              patientData={selectedPatient}
              visitType={visitType}
              patientId={selectedPatientId}
              onAssignEducation={async (educationData) => {
                await base44.entities.PatientEducationAssignment.create({
                  ...educationData,
                  assigned_by: currentUser?.email
                });
                queryClient.invalidateQueries({ queryKey: ['patientEducation', selectedPatientId] });
              }}
              autoAnalyze={true}
            />
          )}

          {/* Real-Time Clinical Alert Monitor */}
          {selectedPatientId && (vitalSigns.bp || vitalSigns.hr || vitalSigns.temp || vitalSigns.o2 || roughNote.length > 50) && (
            <RealTimeClinicalAlertMonitor
              patientData={selectedPatient}
              vitalSigns={vitalSigns}
              noteContent={roughNote}
              diagnosis={finalDiagnosis}
              recentVisits={recentVisits}
              onAlertAction={async (alert, action) => {
                if (action === 'add_to_note') {
                  const alertText = `\n\n⚠️ CLINICAL ALERT: ${alert.title}\n${alert.description}\nActions taken: ${alert.recommended_actions.join('; ')}`;
                  setRoughNote(prev => prev + alertText);
                } else if (action === 'create_task') {
                  try {
                    await base44.entities.Task.create({
                      patient_id: selectedPatientId,
                      title: `URGENT: ${alert.title}`,
                      description: `${alert.description}\n\nRecommended actions:\n${alert.recommended_actions.join('\n')}`,
                      type: 'safety',
                      priority: alert.severity === 'CRITICAL' ? 'high' : 'medium',
                      due_timeframe: alert.time_sensitivity === 'Minutes' ? 'today' : '24_hours',
                      source: 'ai_generated',
                      ai_reason: alert.rationale,
                      assigned_to: currentUser?.email
                    });
                    queryClient.invalidateQueries({ queryKey: ['tasks'] });
                  } catch (error) {
                    console.error('Error creating alert task:', error);
                  }
                } else if (action === 'notify_md' || action === 'call_911') {
                  // Log the action
                  logActivity(ActivityActions.AI_FEATURE_USED, {
                    feature: 'clinical_alert_action',
                    action: action,
                    alert_severity: alert.severity,
                    patient_id: selectedPatientId,
                    page: 'SmartNoteAssistant'
                  });
                }
              }}
              onDismissAlert={(alert) => {
                logActivity(ActivityActions.AI_FEATURE_USED, {
                  feature: 'clinical_alert_dismissed',
                  alert_severity: alert.severity,
                  patient_id: selectedPatientId,
                  page: 'SmartNoteAssistant'
                });
              }}
            />
          )}

          {/* Step 3: Notes - Enhanced */}
          <Card id="step-notes" className={`border-2 transition-all duration-300 ${currentStep === 'notes' ? 'border-purple-500 ring-4 ring-purple-200 shadow-xl' : 'border-gray-300'}`}>
          <CardHeader className="py-5 md:py-6 bg-gradient-to-r from-purple-100 to-pink-100">
          <CardTitle className="text-lg md:text-xl flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className={`p-2 rounded-full ${currentStep === 'notes' ? 'bg-purple-500' : 'bg-gray-400'}`}>
                <Edit3 className="w-5 h-5 text-white flex-shrink-0" />
              </div>
              <span className="truncate">3. Your Notes</span>
              {roughNote.length >= 20 && <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 animate-pulse" />}
            </div>
            <VoiceHub 
              onTranscription={handleVoiceTranscription}
              onInterimTranscription={handleInterimTranscription}
              onCommand={handleVoiceCommand}
            />
          </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 space-y-4">
          {/* Medical Terminology Processor */}
          {roughNote.length > 50 && (
            <MedicalTerminologyProcessor 
              text={roughNote} 
              onSuggestion={(suggestion) => console.log('Terminology suggestion:', suggestion)}
            />
          )}
              {/* Smart auto-complete textarea with phrase categories */}
              <div className="relative">
                <SmartAutoComplete
                  value={roughNote}
                  onChange={(value) => {
                    if (!noteStartTime && value.length > 0) {
                      setNoteStartTime(Date.now());
                    }
                    setRoughNote(value);
                  }}
                  placeholder="Type or dictate your notes... Start typing trigger words like 'lungs', 'heart', 'wound' for quick phrases"
                  diagnosis={finalDiagnosis}
                  className="min-h-[150px]"
                />
                {/* Interim voice transcription overlay */}
                {interimVoiceText && (
                  <div className="absolute bottom-2 left-2 right-2 bg-blue-100/90 border border-blue-300 rounded px-3 py-2 text-sm text-blue-900 italic pointer-events-none">
                    <Mic className="w-3 h-3 inline mr-1" />
                    {interimVoiceText}...
                  </div>
                )}
              </div>

              {/* Character count */}
              <div className="flex items-center gap-2">
                <p className={`text-sm ${roughNote.length >= 20 ? 'text-green-600 font-medium' : 'text-gray-400'}`}>
                  {roughNote.length} characters
                </p>
                {roughNote.length < 20 && roughNote.length > 0 && (
                  <p className="text-sm text-orange-500">(min 20 required)</p>
                )}
              </div>
              </CardContent>
              </Card>

            {/* Conditional AI Assistant - Visit & Diagnosis Specific */}
            {!enhancedNote && roughNote.length >= 100 && (
              <ConditionalAIAssistant
                visitType={visitType}
                diagnosis={finalDiagnosis}
                roughNote={roughNote}
                patientData={selectedPatient}
                vitalSigns={vitalSigns}
                onSuggestion={(text) => setRoughNote(prev => prev + '\n\n' + text)}
              />
            )}

            {/* Unified AI Suggestions - Compliance + Quality */}
            {!enhancedNote && roughNote.length >= 100 && (
              <UnifiedAISuggestions
                roughNote={roughNote}
                diagnosis={finalDiagnosis}
                vitalSigns={vitalSigns}
                patientData={selectedPatient}
                patientContext={patientContext}
                careType="home_health"
                visitType={visitType}
                appliedFixes={appliedFixes}
                onApplyFix={(textOrUpdatedNote, category, isReplacement) => {
                  if (isReplacement) {
                    // Replace entire note with updated version (for quality fixes)
                    setRoughNote(textOrUpdatedNote);
                  } else {
                    // Add text to note (for compliance additions)
                    const normalizedText = textOrUpdatedNote.trim().toLowerCase();
                    const normalizedNote = roughNote.trim().toLowerCase();
                    
                    if (!normalizedNote.includes(normalizedText.substring(0, 100))) {
                      setRoughNote(prev => prev + '\n\n' + textOrUpdatedNote);
                    }
                  }
                  
                  if (category && !appliedFixes.includes(category)) {
                    setAppliedFixes(prev => [...prev, category]);
                  }
                }}
                onApplyAll={(replacements, additions) => {
                  // Apply quality replacements first
                  let updatedNote = roughNote;
                  replacements.forEach(({ from, to }) => {
                    updatedNote = updatedNote.replace(from, to);
                  });
                  
                  // Then add compliance additions
                  if (additions.length > 0) {
                    updatedNote = updatedNote + '\n\n' + additions.join('\n\n');
                  }
                  
                  setRoughNote(updatedNote);
                  setAppliedFixes(prev => [...prev, ...additions.map(a => a.split(':')[0].trim())]);
                }}
              />
            )}



            {/* Enhance Button - Prominent CTA */}
            {!enhancedNote && roughNote.length >= 20 && (
              <Card className="border-4 border-purple-400 bg-gradient-to-r from-purple-100 to-pink-100 shadow-2xl animate-pulse">
                <CardContent className="p-6">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <div className="p-4 bg-purple-500 rounded-full">
                      <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-purple-900 mb-1">Ready to Transform!</h3>
                      <p className="text-sm text-purple-700">Click below to create your Medicare-compliant note</p>
                    </div>
                    <Button
                      onClick={handleEnhanceNote}
                      disabled={isProcessing}
                      size="lg"
                      className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 w-full sm:w-auto text-lg font-bold shadow-lg"
                    >
                      {isProcessing ? (
                        <><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mr-2" /> Enhancing...</>
                      ) : (
                        <><Sparkles className="w-6 h-6 mr-2" /> Enhance with AI</>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}



          {/* Step 4: Enhanced Note - Celebration */}
          {enhancedNote && (
            <>
              <Card id="step-enhance" className="border-4 border-green-400 bg-gradient-to-r from-green-50 to-emerald-50 shadow-2xl">
                <CardHeader className="py-6 md:py-7 bg-gradient-to-r from-green-100 to-emerald-100">
                  <CardTitle className="text-lg md:text-2xl flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-green-500 rounded-full">
                        <CheckCircle2 className="w-6 h-6 text-white" />
                      </div>
                      <span>✨ Note Enhanced - Ready for EHR!</span>
                    </div>
                    <span className="text-xs md:text-sm text-gray-600 font-normal sm:ml-auto bg-yellow-100 px-3 py-1 rounded-full">💡 Yellow highlights = areas needing completion</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 md:p-6">
                  <RichTextNoteEditor
                    value={enhancedNote}
                    onChange={setEnhancedNote}
                    onCopy={() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    copied={copied}
                    qualityScore={auditResults?.quality_score}
                  />
                </CardContent>
              </Card>

              {/* Next Steps Panel - Clear action-oriented summary */}
              <NextStepsPanel
                copied={copied}
                isSaving={isSaving}
                savedSuccessfully={savedSuccessfully}
                onCopy={handleCopy}
                onSave={handleSaveNote}
                onGenerateTasks={() => setActiveAccordion('tasks')}
                onGenerateCarePlans={() => setActiveAccordion('careplans')}
                onStartNew={handleClearNote}
                complianceScore={enhancedNoteCompliance?.overall_score}
              />

              {/* OASIS Automation Trigger */}
              {patientOASIS?.length > 0 && (
                <Card className="border-2 border-purple-300 bg-gradient-to-r from-purple-50 to-pink-50">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-600" />
                        <div>
                          <p className="text-sm font-medium">AI OASIS Automation Available</p>
                          <p className="text-xs text-gray-600">Map note to OASIS with detailed justifications</p>
                        </div>
                      </div>
                      <Button
                        onClick={handleRunOASISAutomation}
                        disabled={isRunningOASISAutomation}
                        className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 w-full sm:w-auto"
                      >
                        {isRunningOASISAutomation ? (
                          <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" /> Analyzing...</>
                        ) : (
                          <><Sparkles className="w-4 h-4 mr-2" /> Run OASIS Automation</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}


            </>
          )}

          {/* Additional Tools */}
          {enhancedNote && selectedPatientId && (
            <Accordion type="single" collapsible value={activeAccordion} onValueChange={setActiveAccordion}>
              <AccordionItem value="oasis">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> AI OASIS Automation with Justifications
                    {oasisAutomationResults && (
                      <Badge className="ml-2 bg-purple-100 text-purple-800">
                        {oasisAutomationResults.mappings?.length || 0} items
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  {oasisAutomationResults?.mappings ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="bg-green-50 p-2 rounded border border-green-200 text-center">
                          <p className="text-xs text-green-600">High Confidence</p>
                          <p className="text-lg font-bold text-green-900">
                            {oasisAutomationResults.high_confidence_items || 0}
                          </p>
                        </div>
                        <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-center">
                          <p className="text-xs text-yellow-600">Medium Confidence</p>
                          <p className="text-lg font-bold text-yellow-900">
                            {oasisAutomationResults.medium_confidence_items || 0}
                          </p>
                        </div>
                        <div className="bg-red-50 p-2 rounded border border-red-200 text-center">
                          <p className="text-xs text-red-600">Low Confidence</p>
                          <p className="text-lg font-bold text-red-900">
                            {oasisAutomationResults.low_confidence_items || 0}
                          </p>
                        </div>
                      </div>
                      {oasisAutomationResults.mappings.map((mapping, idx) => (
                        <Card key={idx} className={`border-l-4 ${
                          mapping.confidence >= 80 ? 'border-l-green-500' :
                          mapping.confidence >= 60 ? 'border-l-yellow-500' : 'border-l-red-500'
                        }`}>
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="font-semibold text-sm">{mapping.oasis_item}</p>
                                <p className="text-xs text-gray-600">{mapping.item_description}</p>
                              </div>
                              <Badge className={`${
                                mapping.confidence >= 80 ? 'bg-green-600' :
                                mapping.confidence >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                              }`}>
                                {mapping.confidence}% confidence
                              </Badge>
                            </div>
                            <div className="space-y-2 text-sm">
                              <div className="bg-blue-50 p-2 rounded">
                                <p className="text-xs font-semibold text-blue-900">Suggested Value:</p>
                                <p className="text-xs text-blue-800">{mapping.suggested_value}</p>
                              </div>
                              <div className="bg-gray-50 p-2 rounded">
                                <p className="text-xs font-semibold text-gray-900">Evidence from Note:</p>
                                <p className="text-xs text-gray-700 italic">"{mapping.evidence_from_note}"</p>
                              </div>
                              <div className="bg-purple-50 p-2 rounded">
                                <p className="text-xs font-semibold text-purple-900">Clinical Justification:</p>
                                <p className="text-xs text-purple-800">{mapping.clinical_justification}</p>
                              </div>
                              {mapping.pdgm_impact && (
                                <div className="bg-green-50 p-2 rounded">
                                  <p className="text-xs font-semibold text-green-900">PDGM Impact:</p>
                                  <p className="text-xs text-green-800">{mapping.pdgm_impact}</p>
                                </div>
                              )}
                              {mapping.requires_verification && (
                                <Alert className="bg-amber-50 border-amber-200 p-2">
                                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                                  <AlertDescription className="text-xs text-amber-800">
                                    Requires clinical verification before submission
                                  </AlertDescription>
                                </Alert>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600 text-center py-4">
                      Run OASIS automation to see detailed mappings
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="tasks">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4" /> AI Task Generator
                    <Badge className="bg-orange-100 text-orange-800 text-xs">Smart</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <Alert className="bg-blue-50 border-blue-200 mb-3">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-xs text-blue-800">
                      AI analyzes your note to generate specific, actionable follow-up tasks based on interventions documented, patient status, and care plan goals.
                    </AlertDescription>
                  </Alert>
                  <TaskGenerator
                    enhancedNote={enhancedNote}
                    narrativeText={roughNote}
                    patientId={selectedPatientId}
                    patientName={selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : null}
                    diagnosis={finalDiagnosis}
                    complianceGaps={enhancedNoteCompliance?.flagged_issues || roughNoteCompliance?.elements?.filter(e => e.status !== 'present') || []}
                    nurseEmail={currentUser?.email}
                    autoGenerate={true}
                  />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="careplans">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <Stethoscope className="w-4 h-4" /> AI Care Plan Optimizer
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <AICarePlanOptimizer
                    enhancedNote={enhancedNote}
                    patientData={selectedPatient}
                    existingCarePlans={carePlans}
                    recentVisits={recentVisits}
                    diagnosis={finalDiagnosis}
                    onCreateCarePlan={async (carePlanData) => {
                      try {
                        await base44.entities.CarePlan.create({
                          patient_id: selectedPatientId,
                          ...carePlanData
                        });
                        queryClient.invalidateQueries({ queryKey: ['patientCarePlans', selectedPatientId] });
                      } catch (error) {
                        console.error('Error creating care plan:', error);
                      }
                    }}
                    onModifyCarePlan={async (modification) => {
                      console.log('Care plan modification suggested:', modification);
                      // Could implement update logic here
                    }}
                    autoAnalyze={false}
                  />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="incident">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Report Incident
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-gray-600">Incident reporting form will appear here.</p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="education">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4" /> Generate Patient Education
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <PersonalizedEducationGenerator
                    patient={selectedPatient}
                    carePlans={carePlans}
                    recentVisits={recentVisits}
                  />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="review">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> Clinical Note Review (Completeness & Billing)
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ClinicalNoteReviewer
                    noteContent={enhancedNote}
                    visitType={visitType}
                    diagnosis={finalDiagnosis}
                    patientData={selectedPatient}
                    autoReview={false}
                    onApplySuggestion={(text) => setEnhancedNote(prev => prev + '\n\n' + text)}
                  />
                </AccordionContent>
              </AccordionItem>
              </Accordion>
              )}
        </div>

        {/* Enhanced AI Sidebar with Tabs */}
        <div className="space-y-4 md:space-y-6">
          {/* Primary AI Assistant Card - Always Visible */}
          <DynamicAISidebar
            currentStep={currentStep}
            hasPatient={!!selectedPatientId}
            hasNotes={roughNote.length >= 20}
            hasEnhancedNote={!!enhancedNote}
            diagnosis={finalDiagnosis}
            complianceScore={enhancedNoteCompliance?.overall_score}
            patientData={selectedPatient}
            vitalSigns={vitalSigns}
            hasOASIS={patientOASIS?.length > 0}
            oasisLinkedItems={oasisLinkedItems}
            onAction={handleContextualAction}
            onInsertGuideline={(text) => setRoughNote(prev => prev + '\n\n' + text)}
            onAddOASISLink={(link) => setOasisLinkedItems(prev => [...prev, link])}
            onRemoveOASISLink={(idx) => setOasisLinkedItems(prev => prev.filter((_, i) => i !== idx))}
          />

          {/* Tabbed AI Tools - Only show when patient selected */}
          {selectedPatientId && (
            <Card className="border-2 border-blue-200 shadow-lg">
              <CardHeader className="pb-3 bg-gradient-to-r from-blue-50 to-indigo-50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="w-4 h-4 text-blue-600" />
                  AI Tools & Resources
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Tabs value={activeAITab} onValueChange={setActiveAITab} className="w-full">
                  <TabsList className="w-full grid grid-cols-3 rounded-none border-b">
                    <TabsTrigger value="workflow" className="text-xs">
                      Workflow
                    </TabsTrigger>
                    <TabsTrigger value="compliance" className="text-xs">
                      Compliance
                    </TabsTrigger>
                    <TabsTrigger value="knowledge" className="text-xs">
                      Knowledge
                    </TabsTrigger>
                  </TabsList>

                  {/* Workflow Tab - Lazy Loaded */}
                  <TabsContent value="workflow" className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
                    {activeAITab === "workflow" && (
                      <>
                    {visitType && (
                      <GuidedDocumentationWorkflow
                        visitType={visitType}
                        diagnosis={finalDiagnosis}
                        careType={selectedPatient?.care_type || "home_health"}
                      />
                    )}
                    {visitType && (
                      <VisitTypeSpecificGuidance
                        visitType={visitType}
                        diagnosis={finalDiagnosis}
                        patientData={selectedPatient}
                        onGenerateTemplate={(template) => setRoughNote(prev => template + '\n\n' + prev)}
                      />
                    )}
                    <AIDocumentAnalyzer
                      patientId={selectedPatientId}
                      patientData={selectedPatient}
                      onApplyToPatient={async (field, value) => {
                        try {
                          const updateData = {};
                          if (field === 'primary_diagnosis') {
                            updateData.primary_diagnosis = value;
                          } else if (field === 'medications') {
                            updateData.current_medications = value;
                          }
                          await base44.entities.Patient.update(selectedPatientId, updateData);
                          queryClient.invalidateQueries({ queryKey: ['patients'] });
                        } catch (error) {
                          console.error('Error updating patient:', error);
                        }
                      }}
                      onInsertToNote={(text) => {
                        if (enhancedNote) {
                          setEnhancedNote(prev => prev + '\n\n' + text);
                        } else {
                          setRoughNote(prev => prev + '\n\n' + text);
                        }
                      }}
                      compact={true}
                    />
                      </>
                    )}
                  </TabsContent>

                  {/* Compliance Tab - Lazy Loaded */}
                  <TabsContent value="compliance" className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
                    {activeAITab === "compliance" && (
                      <>
                    <ComplianceTargetSettings
                      currentTarget={complianceTarget}
                      onTargetChange={setComplianceTarget}
                      visitType={visitType}
                    />
                    {(roughNote.length >= 100 || enhancedNote) && (
                      <NuancedFeedbackPanel
                        noteContent={enhancedNote || roughNote}
                        visitType={visitType}
                        diagnosis={finalDiagnosis}
                        complianceTarget={complianceTarget}
                        onApplyFix={(textOrUpdatedNote, category, isReplacement) => {
                          if (isReplacement) {
                            if (enhancedNote) {
                              setEnhancedNote(textOrUpdatedNote);
                            } else {
                              setRoughNote(textOrUpdatedNote);
                            }
                          } else {
                            if (enhancedNote) {
                              setEnhancedNote(prev => prev + '\n\n' + textOrUpdatedNote);
                            } else {
                              setRoughNote(prev => prev + '\n\n' + textOrUpdatedNote);
                            }
                          }
                        }}
                      />
                    )}
                    {enhancedNote && (
                      <VisitTypeComplianceChecker
                        visitType={visitType}
                        noteContent={enhancedNote}
                        oasisData={patientOASIS?.[0]}
                        patientData={selectedPatient}
                        vitalSigns={vitalSigns}
                        careType={selectedPatient?.care_type || "home_health"}
                        autoCheck={true}
                        onIssuesDetected={(issues) => {
                          setComplianceIssues(prev => [...prev, ...issues]);
                        }}
                      />
                    )}
                    {enhancedNote && (
                      <>
                        <MedicareComplianceChecker
                          noteContent={enhancedNote}
                          visitType={visitType}
                          patientData={selectedPatient}
                          diagnosis={finalDiagnosis}
                          vitalSigns={vitalSigns}
                          nurseType={currentUser?.credential_type || 'RN'}
                          onApplyFix={(text) => setEnhancedNote(prev => prev + '\n\n' + text)}
                          autoCheck={true}
                        />
                        <GuidelineComplianceChecker
                          noteContent={enhancedNote}
                          diagnosis={finalDiagnosis}
                          visitType={visitType}
                          patientData={selectedPatient}
                          careType={selectedPatient?.care_type || "home_health"}
                          onIssueFound={(gaps) => {
                            setComplianceIssues(prev => [...prev, ...gaps]);
                          }}
                        />
                      </>
                    )}
                      </>
                    )}
                  </TabsContent>

                  {/* Knowledge Tab - Lazy Loaded */}
                  <TabsContent value="knowledge" className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
                    {activeAITab === "knowledge" && (
                      <>
                    <AIComplianceAssistant 
                      compact={true}
                      context={enhancedNote ? `Current note context: ${enhancedNote.substring(0, 500)}...` : null}
                    />
                    <AIMedicalKnowledgeBase
                      patientData={selectedPatient}
                      diagnosis={finalDiagnosis}
                      currentMedications={selectedPatient?.current_medications || []}
                      onInsertToNote={(text) => {
                        if (enhancedNote) {
                          setEnhancedNote(prev => prev + '\n\n' + text);
                        } else {
                          setRoughNote(prev => prev + '\n\n' + text);
                        }
                      }}
                      compact={true}
                    />
                    {(roughNote.length >= 50 || enhancedNote) && (
                      <GuidelineReferencePanel
                        diagnosis={finalDiagnosis}
                        visitType={visitType}
                        noteContent={roughNote || enhancedNote}
                        onInsertGuideline={(text) => {
                          if (enhancedNote) {
                            setEnhancedNote(prev => prev + '\n\n' + text);
                          } else {
                            setRoughNote(prev => prev + '\n\n' + text);
                          }
                        }}
                        compact={true}
                      />
                    )}
                      </>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
          </div>
        </div>

        {/* AI Patient History Summarizer - Moved to bottom */}
        {selectedPatient && (
        <AIPatientHistorySummarizer
          patientId={selectedPatientId}
          patientName={`${selectedPatient.first_name} ${selectedPatient.last_name}`}
          diagnosis={finalDiagnosis || selectedPatient.primary_diagnosis}
          previousVisits={recentVisits}
          carePlans={carePlans}
          onInsertSummary={(text) => setRoughNote(prev => text + '\n\n' + prev)}
          compact={false}
        />
        )}



      {/* Quick Actions Bar */}
      <QuickActionsBar
        currentStep={currentStep}
        isProcessing={isProcessing}
        isSaving={isSaving}
        saved={savedSuccessfully}
        copied={copied}
        isListening={isVoiceListening}
        complianceScore={enhancedNoteCompliance?.overall_score}
        onEnhance={handleEnhanceNote}
        onCopy={handleCopy}
        onSave={handleSaveNote}
        onClear={handleClearNote}
        onGenerateTasks={() => setActiveAccordion('tasks')}
        onToggleVoice={() => setIsVoiceListening(!isVoiceListening)}
      />
    </div>
  );
}