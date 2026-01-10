import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import PremiumFeatureGate from "../components/subscription/PremiumFeatureGate";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
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
  AlertCircle,
  Target,
  BookMarked
} from "lucide-react";
import { trackRecommendation, categorizeRecommendation } from "../components/training/RecommendationTracker";
import ComplianceScoreIndicator from "../components/smartNote/ComplianceScoreIndicator";
import { secureAICall } from "../components/utils/security";
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
import { getVisitTypesForProvider } from "../components/utils/providerVisitTypeMapping";
import NextStepsPanel from "../components/smartNote/NextStepsPanel";
import EnhancedPatientContext from "../components/patient/EnhancedPatientContext";
import DynamicAISidebar from "../components/smartNote/DynamicAISidebar";
import FavoriteButton from "../components/navigation/FavoriteButton";
import ConsolidatedAISuggestions from "../components/smartNote/ConsolidatedAISuggestions";
import CustomPhrasesManager from "../components/smartNote/CustomPhrasesManager";
import OneClickComplianceFixer from "../components/smartNote/OneClickComplianceFixer";

import UnifiedComplianceInsights from "../components/compliance/UnifiedComplianceInsights";
import AdverseEventPredictor from "../components/predictive/AdverseEventPredictor";
import PersonalizedEducationGenerator from "../components/education/PersonalizedEducationGenerator";
import ClinicalNoteReviewer from "../components/review/ClinicalNoteReviewer";
import DynamicContextAnalyzer from "../components/smartNote/DynamicContextAnalyzer";
import QuickPatientAddDialog from "../components/patient/QuickPatientAddDialog";
import InteractiveDocumentationGaps from "../components/smartNote/InteractiveDocumentationGaps";
import PreVisitAIBrief from "../components/smartNote/PreVisitAIBrief";
import ProactiveDocCoach from "../components/smartNote/ProactiveDocCoach";
import MedicationCrossChecker from "../components/smartNote/MedicationCrossChecker";
import NextBestActionsAI from "../components/smartNote/NextBestActionsAI";
import PersonalizedDocumentationGapSuggestions from "../components/smartNote/PersonalizedDocumentationGapSuggestions";
import ContextualPhraseTemplates from "../components/smartNote/ContextualPhraseTemplates";
import AITemplateGenerator from "../components/smartNote/AITemplateGenerator";
import ClinicalGuidelinesModal from "../components/guidelines/ClinicalGuidelinesModal";
import MedicalScribeRecorder from "../components/smartNote/MedicalScribeRecorder";
import DifferentialDiagnosisSuggester from "../components/smartNote/DifferentialDiagnosisSuggester";

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
          // Restart failed
        }
      } else {
        setListening(false);
        setInterimText('');
      }
    };
    
    recognition.onerror = (event) => {
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
  const navigate = useNavigate();
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
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccessfully, setSavedSuccessfully] = useState(false);
  const [detectedComplianceRisks, setDetectedComplianceRisks] = useState([]);
  const [noteStartTime, setNoteStartTime] = useState(null);
  const [complianceReviewComplete, setComplianceReviewComplete] = useState(false);
  const [appliedFixesText, setAppliedFixesText] = useState(new Set());
  const [isAnalyzingCompliance, setIsAnalyzingCompliance] = useState(false);
  const [interimVoiceText, setInterimVoiceText] = useState('');
  const [comprehensiveContext, setComprehensiveContext] = useState(null);
  const [complianceTarget, setComplianceTarget] = useState(90);
  const [documentationGaps, setDocumentationGaps] = useState([]);
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [unifiedInsights, setUnifiedInsights] = useState(null);
  const [isRunningUnifiedCheck, setIsRunningUnifiedCheck] = useState(false);
  const [showAddPatientDialog, setShowAddPatientDialog] = useState(false);
  const [showGuidelinesModal, setShowGuidelinesModal] = useState(false);

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

  const handlePatientCreated = (newPatient) => {
    queryClient.invalidateQueries({ queryKey: ['patients'] });
    setSelectedPatientId(newPatient.id);
  };

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



  const selectedPatient = selectedPatientId === 'anonymous' ? null : patients.find(p => p.id === selectedPatientId);
  const isAnonymous = selectedPatientId === 'anonymous';
  
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

  // Build patient context for compliance checking - memoized
  const patientContext = useMemo(() => {
    if (!selectedPatient) return null;
    return {
      name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
      primaryDiagnosis: selectedPatient.primary_diagnosis || finalDiagnosis,
      secondaryDiagnoses: selectedPatient.secondary_diagnoses || [],
      allergies: selectedPatient.allergies,
      recentConditions: recentVisits[0]?.nurse_notes ? 
        recentVisits[0].nurse_notes.substring(0, 200) + '...' : null,
      previousVisitSummary: recentVisits[0] ? 
        `Last visit ${recentVisits[0].visit_date}: ${recentVisits[0].visit_type}` : null,
      carePlanGoals: carePlans.filter(cp => cp.status === 'active').map(cp => cp.goal)
    };
  }, [selectedPatient, finalDiagnosis, recentVisits, carePlans]);

  const currentStep = useMemo(() => {
    if (!selectedPatientId || selectedPatientId === '') return 'patient';
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
    if (!roughNote.trim()) {
      alert('Please enter your notes before enhancing.');
      return;
    }
    if (roughNote.length < 20) {
      alert('Please enter at least 20 characters of notes.');
      return;
    }
    if (!finalDiagnosis) {
      alert('Please select a diagnosis before enhancing.');
      return;
    }
    setIsProcessing(true);
    const enhanceStartTime = Date.now();
    const actualDocTime = noteStartTime ? (enhanceStartTime - noteStartTime) : 0;

    try {
      // Use optimized backend function for enhancement with rate limiting
      const response = await secureAICall(
        () => base44.functions.invoke('enhanceNoteOptimized', {
          roughNote,
          patientId: selectedPatientId,
          visitType,
          visitDate,
          diagnosis: finalDiagnosis,
          vitalSigns,
          nurseType: currentUser?.credential_type || 'RN'
        }),
        currentUser?.email || 'anonymous'
      );

      // Unwrap the data from the function response
      const result = response.data || response;

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

      // Automatically run unified compliance check
      setIsRunningUnifiedCheck(true);
      try {
        const complianceResult = await secureAICall(
          () => base44.functions.invoke('comprehensiveComplianceCheck', {
            enhancedNote: result.enhanced_note,
            roughNote,
            visitType,
            diagnosis: finalDiagnosis,
            patientId: selectedPatientId,
            vitalSigns,
            nurseType: currentUser?.credential_type || 'RN'
          }),
          currentUser?.email || 'anonymous'
        );

        if (complianceResult.success) {
          setUnifiedInsights(complianceResult.insights);
        }
      } catch (complianceError) {
        // Error logged server-side
      }
      setIsRunningUnifiedCheck(false);

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
      console.error('Enhancement error:', error);
      if (error.message?.includes('Rate limit')) {
        alert('Too many requests. Please wait a moment before trying again.');
      } else {
        const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
        alert(`Failed to enhance note: ${errorMsg}\n\nPlease check that you've entered:\n- Patient (or select anonymous)\n- Diagnosis\n- Visit type\n- At least 20 characters of notes`);
      }
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
        if (result.analyses.proactive) {
          // Handle proactive suggestions
        }
      }
    } catch (error) {
      // Error logged server-side
    }
  };

  // Removed old fallback implementation - using optimized backend only
  const handleEnhanceNoteFallback_DEPRECATED = async () => {
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
      // Error logged server-side
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

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert clinical documentation specialist for home health nursing. Transform these rough notes into Medicare-compliant clinical narrative.

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

      ${visitType === 'recertification' ? `
      ⚠️ RECERTIFICATION VISIT - SPECIAL REQUIREMENTS:
      This is a recertification visit requiring detailed justification for continued skilled care.

      MANDATORY RECERTIFICATION ELEMENTS:
      1. COMPREHENSIVE PROGRESS REVIEW:
         - Compare patient's current status to admission baseline
         - Document ALL improvements (functional, clinical, safety, knowledge)
         - Document ongoing deficits requiring continued skilled intervention
         - Reference specific care plan goals: progress made vs. goals remaining
      
      2. CHANGES SINCE ADMISSION:
         ${selectedPatient?.admission_date ? `Admission Date: ${selectedPatient.admission_date}` : ''}
         ${selectedPatient?.baseline_vitals ? `Baseline Vitals: BP ${selectedPatient.baseline_vitals.blood_pressure_systolic}/${selectedPatient.baseline_vitals.blood_pressure_diastolic}, HR ${selectedPatient.baseline_vitals.heart_rate}, O2 Sat ${selectedPatient.baseline_vitals.oxygen_saturation}%` : ''}
         ${selectedPatient?.functional_status?.ambulation ? `Admission Ambulation: ${selectedPatient.functional_status.ambulation}` : ''}
         ${selectedPatient?.functional_status?.adl_independence ? `Admission ADL Level: ${selectedPatient.functional_status.adl_independence}` : ''}
         - Document vital sign trends and clinical stability improvements
         - Document functional ability changes (mobility, ADLs, IADLs)
         - Document medication management improvements
         - Document safety awareness and fall risk changes
         - Document patient/caregiver learning progress
      
      3. JUSTIFICATION FOR CONTINUED CARE:
         - Identify remaining skilled needs despite improvements
         - Explain why RN/LPN skilled services remain medically necessary
         - Document complexity requiring ongoing skilled intervention
         - Reference specific interventions preventing hospitalization/complications
         - Project timeline to discharge and remaining goals to achieve
      
      4. COMPREHENSIVE COMPARISON:
         Create a clear narrative showing:
         "On admission [date], patient presented with [baseline status]. Since then, patient has achieved [improvements]. However, patient continues to require skilled nursing for [ongoing needs] due to [clinical justification]. Goals for next certification period include [specific, measurable objectives]."
      
      Use ALL available patient history data, visit notes, vital trends, and care plan progress to build a compelling case for recertification.
      ` : ''}

      ${visitType === 'discharge' ? `
      🎉 DISCHARGE VISIT - SPECIAL REQUIREMENTS:
      This is a discharge visit requiring comprehensive summary of patient journey and outcomes.

      MANDATORY DISCHARGE ELEMENTS:
      1. ADMISSION TO DISCHARGE COMPARISON:
         ${selectedPatient?.admission_date ? `Admission Date: ${selectedPatient.admission_date}` : 'Document admission date'}
         Discharge Date: ${visitDate}
         
         ON ADMISSION STATUS:
         ${selectedPatient?.baseline_vitals ? `- Vitals: BP ${selectedPatient.baseline_vitals.blood_pressure_systolic}/${selectedPatient.baseline_vitals.blood_pressure_diastolic}, HR ${selectedPatient.baseline_vitals.heart_rate}, O2 Sat ${selectedPatient.baseline_vitals.oxygen_saturation}%` : '- Document admission vitals'}
         ${selectedPatient?.functional_status?.ambulation ? `- Ambulation: ${selectedPatient.functional_status.ambulation}` : '- Document admission mobility'}
         ${selectedPatient?.functional_status?.adl_independence ? `- ADL Independence: ${selectedPatient.functional_status.adl_independence}` : '- Document admission ADL status'}
         ${selectedPatient?.functional_status?.cognitive_status ? `- Cognitive Status: ${selectedPatient.functional_status.cognitive_status}` : ''}
         ${selectedPatient?.functional_status?.fall_risk ? `- Fall Risk: ${selectedPatient.functional_status.fall_risk}` : ''}
         - Chief Complaint on Admission: ${selectedPatient?.admission_source ? `Admitted from ${selectedPatient.admission_source}` : 'Document admission reason'}
         ${selectedPatient?.functional_status?.notes ? `- Admission Notes: ${selectedPatient.functional_status.notes}` : ''}
      
      2. CURRENT DISCHARGE STATUS:
         - Current Vitals: ${Object.entries(vitalSigns).filter(([k,v]) => v && k !== 'o2Source' && k !== 'o2Flow').map(([k,v]) => `${k}: ${v}`).join(', ')}
         - Current Ambulation/Mobility: [Document current status]
         - Current ADL Independence: [Document improvements]
         - Current Cognitive/Safety Awareness: [Document improvements]
         - Current Medication Management: [Document competency level]
      
      3. IMPROVEMENTS ACHIEVED:
         Document specific, measurable improvements in:
         - Clinical stability (vital sign trends, symptom management)
         - Functional abilities (mobility, transfers, ADLs, IADLs)
         - Safety (fall prevention knowledge, home safety modifications)
         - Disease self-management (medication compliance, symptom recognition)
         - Patient/caregiver education competency
         
         Reference care plan goals achieved:
         ${carePlans.filter(cp => cp.status === 'met').map(cp => `✓ ${cp.problem}: ${cp.goal} - ACHIEVED`).join('\n') || 'Document goals met during episode'}
      
      4. DISCHARGE PLAN & SUSTAINABILITY:
         - Reason for discharge (goals met, plateau, patient choice, etc.)
         - Patient/caregiver ability to sustain improvements independently
         - Home environment safety and support systems in place
         - Follow-up appointments scheduled (MD, therapies, etc.)
         - Emergency plan and red flag symptoms reviewed with patient/caregiver
         - DME/supplies provided and education completed
         - Community resources referred (if applicable)
      
      Create a comprehensive narrative that clearly demonstrates the VALUE of home health intervention by contrasting admission status with discharge status. Show measurable outcomes and patient transformation during the episode of care.
      ` : ''}

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
      }
${guidelinesContext}`,
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
        // Error logged server-side
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
        // Error logged server-side
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
        // Error logged server-side
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

  const handleCopy = React.useCallback(() => {
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
  }, [enhancedNote, selectedPatientId]);

  const handleVoiceTranscription = React.useCallback((text) => {
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
  }, [noteStartTime, selectedPatientId]);

  const handleInterimTranscription = React.useCallback((text) => {
    setInterimVoiceText(text);
  }, []);

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
        // Unknown command
    }
    
    // Log voice command usage
    logActivity(ActivityActions.AI_FEATURE_USED, {
      feature: 'voice_command',
      command: action,
      patient_id: selectedPatientId,
      page: 'SmartNoteAssistant'
    });
  };

  const handleClearNote = React.useCallback(() => {
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
    setUnifiedInsights(null);
    setDocumentationGaps([]);
  }, []);

  const handleContextualAction = React.useCallback((action) => {
    if (action === 'enhance') handleEnhanceNote();
    if (action === 'copy') handleCopy();
    if (action === 'tasks') setActiveAccordion('tasks');
    if (action === 'clear') handleClearNote();
  }, [handleEnhanceNote, handleCopy, handleClearNote]);



  const handleInsertPhrase = React.useCallback((text) => {
    setRoughNote(prev => prev ? prev + ' ' + text : text);
  }, []);





  const handleSaveNote = async () => {
    if (!selectedPatientId || !enhancedNote || isAnonymous) {
      if (isAnonymous) {
        alert('Anonymous notes cannot be saved. Copy the note to use it.');
      }
      return;
    }

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

      // Trigger AI-powered adverse event prediction after visit completion
      try {
        await base44.functions.invoke('predictAdverseEvents', {
          patient_id: selectedPatientId,
          trigger_source: 'note_completion'
        });
        queryClient.invalidateQueries({ queryKey: ['patientRiskAlerts', selectedPatientId] });
        queryClient.invalidateQueries({ queryKey: ['allPatientRiskAlerts'] });
      } catch (riskError) {
        // Error logged server-side
      }

    } catch (error) {
      alert('Failed to save note. Please try again.');
    }
    setIsSaving(false);
  };

  return (
    <PremiumFeatureGate
      featureName="AI Smart Note Assistant"
      featureDescription="Transform your rough notes into Medicare-compliant documentation with AI. This premium feature includes voice dictation, real-time compliance checking, and intelligent clinical suggestions."
      allowTrial={true}
    >
    <>
    <QuickPatientAddDialog
      open={showAddPatientDialog}
      onOpenChange={setShowAddPatientDialog}
      onPatientCreated={handlePatientCreated}
    />
    <ClinicalGuidelinesModal
      isOpen={showGuidelinesModal}
      onClose={() => setShowGuidelinesModal(false)}
      roughNote={roughNote}
      diagnosis={finalDiagnosis}
      specialty={currentUser?.provider_type || ""}
      userEmail={currentUser?.email}
    />
    <div className="w-full max-w-full overflow-hidden min-w-0">
    <div className="p-2.5 sm:p-3 md:p-4 lg:p-6 max-w-7xl mx-auto pb-24 sm:pb-8 lg:pb-6 w-full overflow-hidden min-w-0">
      <div className="mb-3 sm:mb-4 flex items-center justify-between w-full min-w-0 gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Smart Note Assistant</h1>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <Button 
            variant="ghost" 
            size="icon"
            className="text-gray-500 hover:text-gray-700 h-10 w-10"
            onClick={() => setShowGuidelinesModal(true)}
            title="Clinical Guidelines"
          >
            <BookMarked className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            className="text-gray-500 hover:text-gray-700 h-10 w-10"
            title="Download Quick Guide"
            onClick={async () => {
              try {
                const response = await base44.functions.invoke('generateSmartNoteGuide');
                const data = response.data || response;
                if (data.pdf) {
                  const binaryString = atob(data.pdf);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
                  const blob = new Blob([bytes], { type: 'application/pdf' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = data.filename || 'Guide.pdf';
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  a.remove();
                }
              } catch (error) {
                alert('Failed to download guide.');
              }
            }}
          >
            <HelpCircle className="w-4 h-4" />
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
        criticalGaps={documentationGaps.filter(g => g.priority === 'critical')}
        vitalAlerts={[]}
        roughNote={roughNote}
      />

      {/* Enhanced Patient Context */}
      {selectedPatient && !isAnonymous && currentStep !== 'patient' && (
        <EnhancedPatientContext
          patient={selectedPatient}
          visits={recentVisits}
          carePlans={carePlans}
        />
      )}

      {/* Pre-Visit AI Brief */}
      {selectedPatient && !isAnonymous && currentStep !== 'patient' && (
        <PreVisitAIBrief
          patient={selectedPatient}
          recentVisits={recentVisits}
          carePlans={carePlans}
          userEmail={currentUser?.email}
        />
      )}
      
      {/* Anonymous Mode Notice */}
      {isAnonymous && (
        <Alert className="bg-purple-50 border-purple-200">
          <AlertCircle className="w-4 h-4 text-purple-600" />
          <AlertDescription className="text-sm text-purple-800">
            🔒 Anonymous Mode: Note will be enhanced but no patient data will be saved or stored
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-2.5 sm:gap-3 lg:gap-4 w-full">
        <div className="xl:col-span-3 space-y-2.5 sm:space-y-3 lg:space-y-4 w-full min-w-0">

          {/* Step 1: Patient Selection - Enhanced */}
           <Card id="step-patient" className={`border-2 transition-all duration-300 w-full overflow-hidden ${currentStep === 'patient' ? 'border-blue-500 ring-4 ring-blue-200 shadow-xl' : 'border-gray-300'}`}>
             <CardHeader className="py-2 sm:py-3 bg-gradient-to-r from-blue-100 to-indigo-100">
               <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <div className={`p-1.5 rounded-full flex-shrink-0 ${currentStep === 'patient' ? 'bg-blue-500' : 'bg-gray-400'}`}>
                  <User className="w-4 h-4 text-white" />
                </div>
                <span className="flex-1 min-w-0 truncate">1. Select Patient & Visit</span>
                {selectedPatient && <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2.5 sm:p-3 space-y-2.5 overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 w-full">
                <div className="w-full overflow-hidden">
                  <Label className="text-xs sm:text-sm mb-1.5 block">Patient</Label>
                  <Select value={selectedPatientId} onValueChange={(id) => {
                    if (id === '__add_new__') {
                      setShowAddPatientDialog(true);
                      return;
                    }
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
                  }}>
                    <SelectTrigger className="h-11 w-full">
                      <SelectValue placeholder="Select patient or anonymous..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__add_new__" className="text-sm font-bold text-blue-600 border-b mb-1">
                        ➕ Add New Patient
                      </SelectItem>
                      <SelectItem value="anonymous" className="text-sm font-medium text-purple-600">
                        🔒 Anonymous (No patient data saved)
                      </SelectItem>
                      {patients.map(p => (
                        <SelectItem key={p.id} value={p.id} className="text-sm">
                          {p.first_name} {p.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full overflow-hidden">
                  <Label className="text-xs sm:text-sm mb-1.5 block">Visit Date</Label>
                  <Input 
                    type="date" 
                    value={visitDate} 
                    onChange={(e) => setVisitDate(e.target.value)}
                    max={todayEastern()}
                    className="h-11 text-sm w-full"
                  />
                </div>
                <div className="w-full overflow-hidden">
                  <Label className="text-xs sm:text-sm mb-1.5 block">Visit Type</Label>
                  <Select value={visitType} onValueChange={setVisitType}>
                    <SelectTrigger className="h-11 text-sm w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {getVisitTypesForProvider(currentUser?.credential_type || 'RN').map(vt => (
                        <SelectItem key={vt.id} value={vt.id} className="text-sm" title={vt.description}>
                          {vt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full overflow-hidden">
                  <Label className="text-xs sm:text-sm mb-1.5 block">Diagnosis</Label>
                  <Select value={diagnosis} onValueChange={setDiagnosis}>
                    <SelectTrigger className="h-11 text-sm w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {commonDiagnoses.map((dx) => (
                        <SelectItem key={dx} value={dx} className="text-sm">{dx}</SelectItem>
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
                  className="h-11 text-sm w-full"
                />
              )}
            </CardContent>
          </Card>

          {/* Step 2: Vitals - Enhanced */}
          <Card id="step-vitals" className={`border-2 transition-all duration-300 w-full overflow-hidden ${currentStep === 'vitals' ? 'border-green-500 shadow-lg' : 'border-gray-300'}`}>
            <CardHeader className="py-2 sm:py-3 bg-gradient-to-r from-green-100 to-emerald-100">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <div className={`p-1.5 rounded-full flex-shrink-0 ${currentStep === 'vitals' ? 'bg-green-500' : 'bg-gray-400'}`}>
                  <Activity className="w-4 h-4 text-white" />
                </div>
                <span className="flex-1 min-w-0 truncate">2. Vital Signs</span>
                {(vitalSigns.bp || vitalSigns.hr) && <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2.5 sm:p-3 overflow-hidden">
              <SmartVitalsInput 
                vitalSigns={vitalSigns} 
                onChange={setVitalSigns} 
              />
            </CardContent>
          </Card>

          {/* Medical Scribe - Record visit and generate note */}
          {selectedPatientId && !enhancedNote && (
            <div className="space-y-2.5">
              <Card className="border-blue-200 bg-blue-50">
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <Mic className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm text-blue-900 mb-1">Medical Scribe Assistant</h3>
                      <p className="text-xs text-blue-800 mb-2">
                        Record your visit audio or upload a file. Our AI will transcribe it and generate a clinical note automatically.
                      </p>
                      <ul className="text-xs text-blue-700 space-y-0.5 list-disc list-inside">
                        <li>Record directly from your device microphone</li>
                        <li>Upload pre-recorded audio files</li>
                        <li>AI auto-generates clinical documentation</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <MedicalScribeRecorder
                diagnosis={finalDiagnosis}
                visitType={visitType}
                patientId={selectedPatientId}
                onNoteGenerated={(note) => {
                  setRoughNote(note);
                  setNoteStartTime(Date.now());
                }}
              />
            </div>
          )}

          {/* Advanced AI Tools - Hidden by default for cleaner workflow */}
          {selectedPatientId && roughNote.length >= 50 && !enhancedNote && (
            <Accordion type="single" collapsible className="border rounded-lg">
              <AccordionItem value="ai-tools">
                <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:bg-gray-50">
                  <Sparkles className="w-4 h-4 mr-2 text-blue-600" />
                  AI Analysis Tools
                </AccordionTrigger>
                <AccordionContent className="p-3 space-y-3 border-t">
                  <DifferentialDiagnosisSuggester
                    roughNote={roughNote}
                    vitalSigns={vitalSigns}
                    patientData={selectedPatient}
                    diagnosis={finalDiagnosis}
                    userEmail={currentUser?.email}
                  />
                  <PersonalizedDocumentationGapSuggestions
                    roughNote={roughNote}
                    patientData={selectedPatient}
                    visitType={visitType}
                    diagnosis={finalDiagnosis}
                    carePlans={carePlans}
                    vitalSigns={vitalSigns}
                    onApplySuggestion={(text) => setRoughNote(prev => prev + '\n\n' + text)}
                    userEmail={currentUser?.email}
                  />
                  <DynamicContextAnalyzer
                    roughNote={roughNote}
                    visitType={visitType}
                    diagnosis={finalDiagnosis}
                    patientData={selectedPatient}
                    vitalSigns={vitalSigns}
                    carePlans={carePlans}
                    onApplySuggestion={(textOrUpdatedNote, isReplacement) => {
                      if (isReplacement) {
                        setRoughNote(textOrUpdatedNote);
                      } else {
                        setRoughNote(prev => prev + '\n\n' + textOrUpdatedNote);
                      }
                    }}
                    userEmail={currentUser?.email}
                  />
                  <AdverseEventPredictor
                    patientId={selectedPatientId}
                    patientData={selectedPatient}
                    roughNote={roughNote}
                    vitalSigns={vitalSigns}
                    diagnosis={finalDiagnosis}
                    userEmail={currentUser?.email}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {/* Clinical Decision Support - Only show for abnormal vitals */}
          {selectedPatientId && !enhancedNote && (
            (vitalSigns.bp && (parseInt(vitalSigns.bp.split('/')[0]) > 140 || parseInt(vitalSigns.bp.split('/')[0]) < 90)) ||
            (vitalSigns.o2 && parseInt(vitalSigns.o2) < 92) ||
            (vitalSigns.temp && (parseFloat(vitalSigns.temp) > 99.5 || parseFloat(vitalSigns.temp) < 96))
          ) && (
            <ClinicalDecisionSupport
              enhancedNote={enhancedNote}
              extractedData={null}
              diagnosis={finalDiagnosis}
              careType={selectedPatient?.care_type || "home_health"}
              vitalSigns={vitalSigns}
              roughNote={roughNote}
              onInsertRecommendation={(text) => setRoughNote(prev => prev + '\n\n' + text)}
            />
          )}

          {/* Step 3: Notes - Enhanced */}
          <Card id="step-notes" className={`border-2 transition-all duration-300 w-full overflow-hidden ${currentStep === 'notes' ? 'border-purple-500 shadow-lg' : 'border-gray-300'}`}>
          <CardHeader className="py-2 sm:py-3 bg-gradient-to-r from-purple-100 to-pink-100">
          <CardTitle className="text-sm sm:text-base flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 w-full min-w-0">
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
              <div className={`p-1.5 rounded-full flex-shrink-0 ${currentStep === 'notes' ? 'bg-purple-500' : 'bg-gray-400'}`}>
                <Edit3 className="w-4 h-4 text-white" />
              </div>
              <span className="truncate text-sm sm:text-base">3. Your Notes</span>
              {roughNote.length >= 20 && <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-600 flex-shrink-0" />}
            </div>
            <div className="w-full sm:w-auto">
              <VoiceHub 
                onTranscription={handleVoiceTranscription}
                onInterimTranscription={handleInterimTranscription}
                onCommand={handleVoiceCommand}
              />
            </div>
          </CardTitle>
          </CardHeader>
          <CardContent className="p-2.5 sm:p-3 space-y-2.5 sm:space-y-3 overflow-hidden">
              {/* Smart auto-complete textarea with phrase categories */}
              <div className="relative w-full min-w-0">
                <SmartAutoComplete
                  value={roughNote}
                  onChange={(value) => {
                    if (!noteStartTime && value.length > 0) {
                      setNoteStartTime(Date.now());
                    }
                    setRoughNote(value);
                  }}
                  placeholder="Type or dictate notes... Start typing 'lungs', 'heart', 'wound' for quick phrases"
                  diagnosis={finalDiagnosis}
                  className="min-h-[120px] sm:min-h-[150px] w-full text-sm"
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
              <p className={`text-sm ${roughNote.length >= 20 ? 'text-green-600 font-medium' : 'text-gray-400'}`}>
                {roughNote.length} characters
                {roughNote.length < 20 && roughNote.length > 0 && (
                  <span className="text-orange-500 ml-2">(min 20 required)</span>
                )}
              </p>
              </CardContent>
              </Card>

            {/* Enhance Button - Prominent CTA */}
            {!enhancedNote && roughNote.length >= 20 && (
              <Card className="border-4 border-purple-400 bg-gradient-to-r from-purple-100 to-pink-100 shadow-xl w-full overflow-hidden">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex flex-col items-center gap-2.5 sm:gap-3 text-center">
                    <div className="p-2.5 bg-purple-500 rounded-full">
                      <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-purple-900 mb-1">Ready to Transform!</h3>
                      <p className="text-xs text-purple-700">Create your Medicare-compliant note</p>
                    </div>
                    <Button
                      onClick={handleEnhanceNote}
                      disabled={isProcessing}
                      className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 w-full min-h-11 font-bold shadow-lg"
                    >
                      {isProcessing ? (
                        <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" /> Enhancing...</>
                      ) : (
                        <><Sparkles className="w-4 h-4 mr-2" /> Enhance with AI</>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}



          {/* Post-Enhancement Refinement Tools */}
          {enhancedNote && (
            <Accordion type="single" collapsible className="border rounded-lg">
              <AccordionItem value="refinements">
                <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:bg-gray-50">
                  <Brain className="w-4 h-4 mr-2 text-green-600" />
                  Refinement Tools
                </AccordionTrigger>
                <AccordionContent className="p-3 space-y-3 border-t">
                  {documentationGaps.length > 0 && (
                    <InteractiveDocumentationGaps
                      gaps={documentationGaps}
                      patientData={selectedPatient}
                      visitType={visitType}
                      diagnosis={finalDiagnosis}
                      vitalSigns={vitalSigns}
                      roughNote={roughNote}
                      onApplySuggestion={(text) => setEnhancedNote(prev => prev + '\n\n' + text)}
                      userEmail={currentUser?.email}
                    />
                  )}
                  <OneClickComplianceFixer
                    noteContent={enhancedNote}
                    visitType={visitType}
                    diagnosis={finalDiagnosis}
                    patientData={selectedPatient}
                    vitalSigns={vitalSigns}
                    onApplyFix={(text) => setEnhancedNote(prev => prev + '\n\n' + text)}
                    autoAnalyze={true}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {/* Step 4: Enhanced Note - Celebration */}
          {enhancedNote && (
          <>
            <Card id="step-enhance" className="border-4 border-green-400 bg-gradient-to-r from-green-50 to-emerald-50 shadow-xl w-full overflow-hidden">
              <CardHeader className="py-2 sm:py-3 bg-gradient-to-r from-green-100 to-emerald-100">
                <CardTitle className="text-sm sm:text-base flex flex-col gap-2 w-full">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-2 bg-green-500 rounded-full flex-shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    </div>
                    <span className="truncate">✨ Note Enhanced!</span>
                  </div>
                  <span className="text-[10px] sm:text-xs text-gray-600 font-normal bg-yellow-100 px-2 py-1 rounded-full self-start">💡 Yellow = needs completion</span>
                </CardTitle>
              </CardHeader>
                <CardContent className="p-2.5 sm:p-3 overflow-hidden">
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

              {/* Smart Clinical Review - Consolidated insights */}
              <Accordion type="single" collapsible className="border rounded-lg">
                <AccordionItem value="review">
                  <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:bg-gray-50">
                    <CheckCircle2 className="w-4 h-4 mr-2 text-orange-600" />
                    Final Review & Actions
                  </AccordionTrigger>
                  <AccordionContent className="p-3 space-y-3 border-t">
                    <MedicationCrossChecker
                      enhancedNote={enhancedNote}
                      patientData={selectedPatient}
                      onAddDocumentation={(text) => setEnhancedNote(prev => prev + '\n\n' + text)}
                      userEmail={currentUser?.email}
                    />
                    <NextBestActionsAI
                      enhancedNote={enhancedNote}
                      patientData={selectedPatient}
                      vitalSigns={vitalSigns}
                      diagnosis={finalDiagnosis}
                      onCreateTask={async (action, rationale, priority) => {
                        try {
                          await base44.entities.Task.create({
                            patient_id: selectedPatientId,
                            title: action,
                            description: rationale,
                            type: 'followup',
                            priority: priority === 'critical' ? 'critical' : priority === 'high' ? 'high' : 'medium',
                            due_timeframe: priority === 'critical' ? 'today' : '24_hours',
                            source: 'ai_generated',
                            assigned_to: currentUser?.email
                          });
                          queryClient.invalidateQueries({ queryKey: ['tasks'] });
                        } catch (error) {
                          alert('Failed to create task.');
                        }
                      }}
                      userEmail={currentUser?.email}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Unified Compliance Insights - All AI Feedback in One Place */}
              <UnifiedComplianceInsights
                insights={unifiedInsights}
                isLoading={isRunningUnifiedCheck}
                onApplyFix={(text) => setEnhancedNote(prev => prev + '\n\n' + text)}
                onApplyAllFixes={(fixes) => {
                  const combinedFixes = fixes.join('\n\n');
                  setEnhancedNote(prev => prev + '\n\n' + combinedFixes);
                }}
                onCreateTask={async (taskDescription) => {
                  try {
                    await base44.entities.Task.create({
                      patient_id: selectedPatientId,
                      title: `Follow-up: ${taskDescription.substring(0, 100)}`,
                      description: taskDescription,
                      type: 'followup',
                      priority: 'high',
                      due_timeframe: '24_hours',
                      source: 'ai_generated',
                      assigned_to: currentUser?.email
                    });
                    queryClient.invalidateQueries({ queryKey: ['tasks'] });
                    queryClient.invalidateQueries({ queryKey: ['nurseTrainingRecommendations', currentUser?.email] });
                  } catch (error) {
                    alert('Failed to create task.');
                  }
                }}
              />



              {/* Next Steps Panel - Clear action-oriented summary */}
              <NextStepsPanel
                copied={copied}
                isSaving={isSaving}
                savedSuccessfully={savedSuccessfully}
                onCopy={handleCopy}
                onSave={isAnonymous ? undefined : handleSaveNote}
                onGenerateTasks={isAnonymous ? undefined : () => setActiveAccordion('tasks')}
                onGenerateCarePlans={isAnonymous ? undefined : () => setActiveAccordion('careplans')}
                onStartNew={handleClearNote}
                complianceScore={unifiedInsights?.overall_compliance_score || enhancedNoteCompliance?.overall_score}
              />




            </>
          )}

          {/* Additional Tools - Collapsible for focused workflow */}
          {enhancedNote && selectedPatientId && (
            <Accordion type="single" collapsible value={activeAccordion} onValueChange={setActiveAccordion}>
              <AccordionItem value="tasks">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4" /> Tasks
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-gray-600">Task generation available after enhancement</p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="careplans">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4" /> Care Plans
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-gray-600">Care plan generation available after enhancement</p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="education">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4" /> Patient Education
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <PersonalizedEducationGenerator
                    patient={selectedPatient}
                    carePlans={carePlans}
                    recentVisits={recentVisits}
                    diagnosis={finalDiagnosis}
                    vitalSigns={vitalSigns}
                    roughNote={roughNote}
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

              {/* Simplified Sidebar */}
              <div className="space-y-2.5 sm:space-y-3 lg:space-y-4 w-full min-w-0 xl:sticky xl:top-4">
                <DynamicAISidebar
                  currentStep={currentStep}
                  hasPatient={!!selectedPatientId}
                  hasNotes={roughNote.length >= 20}
                  hasEnhancedNote={!!enhancedNote}
                  diagnosis={finalDiagnosis}
                  complianceScore={enhancedNoteCompliance?.overall_score}
                  patientData={selectedPatient}
                  vitalSigns={vitalSigns}
                  onAction={handleContextualAction}
                  onInsertGuideline={(text) => setRoughNote(prev => prev + '\n\n' + text)}
                  roughNote={roughNote}
                  criticalGaps={documentationGaps.filter(g => g.priority === 'critical')}
                />
              {selectedPatientId && (
                <>
                <AITemplateGenerator
                  visitType={visitType}
                  diagnosis={finalDiagnosis}
                  patientData={selectedPatient}
                  currentUser={currentUser}
                  onApplyTemplate={(template) => setRoughNote(template)}
                />
                <ContextualPhraseTemplates
                  visitType={visitType}
                  diagnosis={finalDiagnosis}
                  onInsertPhrase={(text) => setRoughNote(prev => prev ? prev + ' ' + text : text)}
                  compact={true}
                />
                </>
              )}
              </div>
              </div>
              </div>
              </div>
              </>
              </PremiumFeatureGate>
              );
              }