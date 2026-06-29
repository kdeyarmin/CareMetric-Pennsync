import { useState, useEffect, lazy, Suspense } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { calculatePatientMatchScore } from "@/components/oasis/patientMatchScore";
import OASISAnalyticsDashboard from "@/components/oasis/OASISAnalyticsDashboard";
import { getScoreColor, getScoreBg, getSeverityBadge } from "@/components/oasis/oasisScoreColors";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  DollarSign,
  Target,
  Loader2,
  Info,
  TrendingUp,
  ClipboardCheck,
  Lightbulb,
  FileDown,
  FolderArchive,
  Workflow,
  Save,
  User,
  History,
  Sparkles,
  Zap,
  Shield
} from "lucide-react";
import { generateOASISReportPDF } from "@/functions/generateOASISReportPDF";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";


const BatchOASISAnalyzer = lazy(() => import("@/components/oasis/BatchOASISAnalyzer"));
const PDGMRevenueComparison = lazy(() => import("@/components/oasis/PDGMRevenueComparison"));
import FinancialGate from "@/components/ui/FinancialGate";
const EnhancedMultiReportComparison = lazy(() => import("@/components/oasis/EnhancedMultiReportComparison"));
import KeyTakeawaysSummary from "@/components/oasis/KeyTakeawaysSummary";
import AuditRiskPredictor from "@/components/oasis/AuditRiskPredictor";
import DocumentationQualitySuggestions from "@/components/oasis/DocumentationQualitySuggestions";
const OASISScenarioManager = lazy(() => import("@/components/oasis/OASISScenarioManager"));
import OASISActionWorkflow from "@/components/oasis/OASISActionWorkflow";
const AIDocumentationQualityAnalyzer = lazy(() => import("@/components/oasis/AIDocumentationQualityAnalyzer"));
import AIDocumentationAssistant from "@/components/oasis/AIDocumentationAssistant";
const AIAuditRiskPredictor = lazy(() => import("@/components/oasis/AIAuditRiskPredictor"));
import OASISDocumentationQualityScorer from "@/components/oasis/OASISDocumentationQualityScorer";
const AutomatedPDGMNavigator = lazy(() => import("@/components/oasis/AutomatedPDGMNavigator"));
import OASISTaskGenerator from "@/components/oasis/OASISTaskGenerator";
import SmartNoteDataImport from "@/components/oasis/SmartNoteDataImport";
import { useAutoFlagOASIS, THRESHOLDS } from "@/components/oasis/OASISAutoFlagger";
const OASISExportManager = lazy(() => import("@/components/oasis/OASISExportManager"));
import AIProactiveDocumentationAssistant from "@/components/oasis/AIProactiveDocumentationAssistant";
import AIDocumentationGenerator from "@/components/oasis/AIDocumentationGenerator";
import OASISValidationPanel from "@/components/oasis/OASISValidationPanel";
import ClinicalPathwayTrigger from "@/components/oasis/ClinicalPathwayTrigger";
import PDGMPredictiveForecaster from "@/components/oasis/PDGMPredictiveForecaster";
import PDGMImpactAnalyzer from "@/components/oasis/PDGMImpactAnalyzer";
const EnhancedPDGMCaseMixAnalyzer = lazy(() => import("@/components/oasis/EnhancedPDGMCaseMixAnalyzer"));
import PatientMatchSelector from "@/components/oasis/PatientMatchSelector";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import InlineDocumentationAssistant from "@/components/oasis/InlineDocumentationAssistant";
import AIPathwayRecommender from "@/components/oasis/AIPathwayRecommender";
import AutomaticDocumentReviewer from "@/components/review/AutomaticDocumentReviewer";
import AIDocumentReviewer from "@/components/oasis/AIDocumentReviewer";
import OASISDataEntryAssistant from "@/components/oasis/OASISDataEntryAssistant";
import { BarChart3 } from "lucide-react";
import OASISAutomationSettings from "@/components/oasis/OASISAutomationSettings";
import OASISExecutiveSummary from "@/components/oasis/OASISExecutiveSummary";
const PDGMTrendDashboard = lazy(() => import("@/components/oasis/PDGMTrendDashboard"));
const WorkflowExecutionEngine = lazy(() => import("@/components/oasis/WorkflowExecutionEngine"));
const WorkflowMonitoringDashboard = lazy(() => import("@/components/oasis/WorkflowMonitoringDashboard"));
import OASISToPatientChartPusher from "@/components/oasis/OASISToPatientChartPusher";
const PredictiveOutcomesAnalyzer = lazy(() => import("@/components/oasis/PredictiveOutcomesAnalyzer"));
import VisitTypeComplianceChecker from "@/components/compliance/VisitTypeComplianceChecker";
import AIDataValidationEngine from "@/components/oasis/AIDataValidationEngine";
import ClinicalNoteToOASISMapper from "@/components/oasis/ClinicalNoteToOASISMapper";
import OASISDraftGenerator from "@/components/oasis/OASISDraftGenerator";
import ProactiveRescoringEngine from "@/components/oasis/ProactiveRescoringEngine";
import AutomatedQualityAssurance from "@/components/oasis/AutomatedQualityAssurance";
import ProactiveDocumentationAssistant from "@/components/oasis/ProactiveDocumentationAssistant";
const ComprehensiveOASISReviewer = lazy(() => import("@/components/oasis/ComprehensiveOASISReviewer"));
import OASISPDFComparison from "@/components/oasis/OASISPDFComparison";
import { toast } from 'sonner';

export default function OASISAnalyzer() {
  const [activeTab, setActiveTab] = useState("single");
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [pdgmData, setPdgmData] = useState(null);
  const [error, setError] = useState(null);
  const [savedBatchResults, setSavedBatchResults] = useState([]);
  const [analysisId, setAnalysisId] = useState(null);
  const [originalPayment, setOriginalPayment] = useState(null);
  const [patientName, setPatientName] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedToPatient, setSavedToPatient] = useState(false);
  const [revenueData, setRevenueData] = useState(null);
  const [navigationData, setNavigationData] = useState(null);
  const [qualityScore, setQualityScore] = useState(null);
  const [triggeredPathways, setTriggeredPathways] = useState([]);
  const [matchResults, setMatchResults] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [useDataEntryAssistant, setUseDataEntryAssistant] = useState(false);
  const [predictions, setPredictions] = useState(null);
  const [patientHistoricalData, setPatientHistoricalData] = useState(null);
  const [extractedData, setExtractedData] = useState(null);

  const queryClient = useQueryClient();

  // Fetch patients for linking
  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
  });

  // Update selected patient when selectedPatientId changes
  useEffect(() => {
    if (selectedPatientId && patients.length > 0) {
      const patient = patients.find(p => p.id === selectedPatientId);
      setSelectedPatient(patient || null);
      
      // Load historical data for AI validation
      if (patient) {
        loadPatientHistoricalData(patient.id);
      }
    } else {
      setSelectedPatient(null);
      setPatientHistoricalData(null);
    }
  }, [selectedPatientId, patients]);

  // Load patient historical data for AI validation
  const loadPatientHistoricalData = async (patientId) => {
    try {
      const [visits, previousOASISRes] = await Promise.all([
        base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 5),
        // Routed through listOASISUploads so financial fields are stripped server-side for non-financial users.
        base44.functions.invoke('listOASISUploads', { patientId, sort: '-created_date', limit: 3 })
      ]);
      const previousOASIS = previousOASISRes?.data?.uploads || [];

      setPatientHistoricalData({
        previousScores: previousOASIS.map(o => ({
          date: o.assessment_date,
          overall: o.scores?.overall,
          functional: o.pdgm_data?.functional_impairment_level
        })),
        hospitalizations: visits.filter(v => v.visit_type === 'admission'),
        functionalDecline: previousOASIS.length >= 2 && 
          previousOASIS[0].pdgm_data?.functional_impairment_level > previousOASIS[1].pdgm_data?.functional_impairment_level
      });
    } catch (error) {
      console.error('Error loading historical data:', error);
    }
  };

  // Fetch saved OASIS uploads
  const { data: savedOASISUploads = [] } = useQuery({
    queryKey: ['oasisUploads'],
    // Routed through listOASISUploads so financial fields (estimated_payment,
    // revenue_*) are stripped server-side for non-financial users.
    queryFn: async () => (await base44.functions.invoke('listOASISUploads', { sort: '-created_date', limit: 50 }))?.data?.uploads || [],
  });

  // Save OASIS mutation
  const saveOASISMutation = useMutation({
    mutationFn: (data) => base44.entities.OASISUpload.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisUploads'] });
      setSavedToPatient(true);
    },
  });

  // Auto-flag mutation for audit workflow
  const autoFlagMutation = useAutoFlagOASIS();

  // Generate unique analysis ID when new analysis starts
  useEffect(() => {
    if (analysisResults && !analysisId) {
        const newAnalysisId = `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        setAnalysisId(newAnalysisId);
        const extractedName = analysisResults.pdgm_data?.patient_info?.name || 
                               pdgmData?.patient_info?.name || 
                               "Unknown Patient";
        setPatientName(extractedName);
      setSavedToPatient(false);
      
      // Advanced fuzzy matching algorithm with multiple strategies
      if (extractedName && extractedName !== "Unknown Patient" && extractedName !== "Unknown Patient - Verify Document" && patients.length > 0) {
        const extractedDOB = analysisResults.pdgm_data?.patient_info?.dob;
        const extractedPhone = pdgmData?.patient_info?.phone || analysisResults?.pdgm_data?.patient_info?.phone;
        const extractedAddress = pdgmData?.patient_info?.address || analysisResults?.pdgm_data?.patient_info?.address;

        const matchedPatients = patients.map(patient => {
          const score = calculatePatientMatchScore(extractedName, patient, extractedDOB, extractedPhone, extractedAddress);
          return { patient, ...score };
        })
        .filter(m => m.confidence >= 40) // Only show matches with at least 40% confidence
        .sort((a, b) => b.confidence - a.confidence);
        
        const results = {
          extractedName,
          extractedDOB,
          matches: matchedPatients
        };
        
        setMatchResults(results);
        
        // Pre-select the strongest match so the nurse can review and confirm —
        // but NEVER auto-save. The match score can reach this threshold on name
        // signals alone (the name/DOB are themselves AI-extracted from the PDF),
        // so silently persisting an AI-extracted OASIS assessment (and its PDGM
        // payment estimate) to a chart with no human in the loop risks attaching
        // a whole assessment to the wrong patient. Saving requires an explicit
        // click on "Save to Patient Record".
        const bestMatch = matchedPatients[0];
        if (bestMatch && bestMatch.confidence >= 85) {
          setSelectedPatientId(bestMatch.patient.id);
          // Avoid logging patient name (PHI) to the browser console.
        } else if (bestMatch) {
          // Avoid logging patient name (PHI) to the browser console.
        }
      }
    }
  }, [analysisResults, patients, uploadedFileUrl, analysisId, pdgmData?.patient_info?.address, pdgmData?.patient_info?.name, pdgmData?.patient_info?.phone]);

  // Reset match results when starting new analysis
  useEffect(() => {
    if (!analysisResults) {
      setMatchResults(null);
    }
  }, [analysisResults, patients]);

  // Handle viewing batch result in single analysis view
  const handleViewBatchResult = (result) => {
    setAnalysisResults(result);
    if (result?.pdgm_data) {
      setPdgmData(result.pdgm_data);
    }
    setActiveTab("single");
  };

  // Handle batch results for comparison
  const handleBatchComplete = (results) => {
    const successfulResults = results.filter(r => r.status === 'success' && r.pdgm_data);
    setSavedBatchResults(prev => [...prev, ...successfulResults]);
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
      setError(null);
      setAnalysisResults(null);
      setAnalysisId(null);
      setSavedToPatient(false);
      setUploadedFileUrl(null);
    } else {
      setError("Please select a valid PDF file.");
      setFile(null);
    }
  };

  // Save OASIS to patient record
  const handleSaveToPatient = async (autoPatientId = null) => {
    const patientIdToUse = autoPatientId || selectedPatientId;
    if (!analysisResults || !uploadedFileUrl) return;
    
    setIsSaving(true);
    try {
      const selectedPatient = patients.find(p => p.id === patientIdToUse);
      const patientFullName = selectedPatient 
        ? `${selectedPatient.first_name} ${selectedPatient.last_name}`
        : patientName;
      
      // Map assessment type abbreviations to full names
      // Map to the OASISUpload.assessment_type enum
      // (SOC/ROC/Recertification/Follow-up/Transfer/Discharge/Other). The prior
      // 'Start of Care'/'Resumption of Care' strings belong to a DIFFERENT entity
      // (OASISAssessment.visit_type) and were silently dropped by Base44, losing the
      // type on the two highest-volume assessments.
      const mapAssessmentType = (type) => {
        if (!type) return 'Other';
        const typeUpper = type.toUpperCase().trim();
        if (typeUpper === 'SOC' || typeUpper.includes('START OF CARE')) return 'SOC';
        if (typeUpper === 'ROC' || typeUpper.includes('RESUMPTION')) return 'ROC';
        if (typeUpper === 'RECERT' || typeUpper.includes('RECERTIFICATION')) return 'Recertification';
        if (typeUpper.includes('FOLLOW')) return 'Follow-up';
        if (typeUpper.includes('TRANSFER')) return 'Transfer';
        if (typeUpper === 'DISCHARGE' || typeUpper.includes('DISCHARGE')) return 'Discharge';
        return 'Other'; // Coerce any unrecognized value to the enum-safe default
      };
      
      // Deep sanitize to remove circular references and non-serializable objects
      const sanitizeData = (obj) => {
        if (!obj) return null;

        const seen = new WeakSet();

        const sanitize = (value) => {
          // Handle null and undefined
          if (value === null || value === undefined) return value;

          // Handle primitives
          const type = typeof value;
          if (type === 'string' || type === 'number' || type === 'boolean') {
            return value;
          }

          // Skip functions
          if (type === 'function') return undefined;

          // Handle objects
          if (type === 'object') {
            // Detect circular references
            if (seen.has(value)) return undefined;
            seen.add(value);

            // Skip DOM elements, React elements, and HTML elements
            if (value instanceof Element || value instanceof Node || 
                value.$$typeof || value._owner || value.nodeType ||
                (value.constructor && (
                  value.constructor.name?.includes('HTML') ||
                  value.constructor.name?.includes('Element') ||
                  value.constructor.name === 'FiberNode'
                ))) {
              return undefined;
            }

            // Handle arrays
            if (Array.isArray(value)) {
              return value.map(item => sanitize(item)).filter(item => item !== undefined);
            }

            // Handle plain objects
            const result = {};
            for (const key in value) {
              // Skip React internal properties
              if (key.startsWith('__') || key.startsWith('_') || 
                  key.includes('react') || key.includes('fiber') || key.includes('Fiber') ||
                  key === 'nativeEvent' || key === 'target' || key === 'currentTarget') {
                continue;
              }

              try {
                const sanitized = sanitize(value[key]);
                if (sanitized !== undefined) {
                  result[key] = sanitized;
                }
              } catch {
                // Skip problematic properties
                continue;
              }
            }
            return result;
          }

          return undefined;
        };

        return sanitize(obj);
      };
      
      // Sanitize all data before saving
      const cleanPdgmData = sanitizeData(pdgmData);
      const cleanAnalysisResults = sanitizeData(analysisResults);

      const savedOASIS = await saveOASISMutation.mutateAsync({
        patient_id: patientIdToUse || null,
        patient_name: patientFullName,
        file_url: uploadedFileUrl,
        file_name: file?.name || 'OASIS Document',
        assessment_date: analysisResults.pdgm_data?.patient_info?.assessment_date || new Date().toISOString().split('T')[0],
        assessment_type: mapAssessmentType(analysisResults.pdgm_data?.patient_info?.assessment_type),
        analysis_id: analysisId,
        pdgm_data: cleanPdgmData,
        analysis_results: cleanAnalysisResults,
        scores: {
          overall: analysisResults.overall_score || 0,
          accuracy: analysisResults.accuracy_score || 0,
          compliance: analysisResults.compliance_score || 0,
          revenue_optimization: analysisResults.revenue_optimization_score || 0
        },
        estimated_payment: originalPayment || 0,
        status: 'analyzed'
      });

      // Log save activity
      logActivity(ActivityActions.OASIS_SAVE, {
        patient_id: patientIdToUse,
        patient_name: patientFullName,
        overall_score: analysisResults.overall_score,
        estimated_payment: originalPayment,
        entity_type: 'OASISUpload',
        entity_id: savedOASIS.id,
        page: 'OASISAnalyzer'
      });

      // Auto-flag for audit if below thresholds
      if (savedOASIS) {
        autoFlagMutation.mutate({
          oasisUpload: { 
            ...savedOASIS, 
            patient_name: patientFullName,
            patient_id: patientIdToUse 
          },
          analysisResults: analysisResults
        });
      }
    } catch (err) {
      console.error("Error saving OASIS:", err);
      setError(`Failed to save OASIS to patient record: ${err.message || 'Unknown error'}`);
    }
    setIsSaving(false);
  };

  // Load saved OASIS for viewing
  // Load saved OASIS for viewing
  const handleLoadSavedOASIS = (oasisUpload) => {
    setAnalysisResults(oasisUpload.analysis_results);
    setPdgmData(oasisUpload.pdgm_data);
    setAnalysisId(oasisUpload.analysis_id);
    setPatientName(oasisUpload.patient_name);
    setSelectedPatientId(oasisUpload.patient_id || '');
    setOriginalPayment(oasisUpload.estimated_payment);
    setUploadedFileUrl(oasisUpload.file_url);
    setSavedToPatient(true);
    setActiveTab("single");
    
    logActivity(ActivityActions.VIEW, {
      entity_type: 'OASISUpload',
      entity_id: oasisUpload.id,
      patient_id: oasisUpload.patient_id,
      patient_name: oasisUpload.patient_name,
      page: 'OASISAnalyzer'
    });
  };

  const handleUploadAndAnalyze = async () => {
    if (!file) return;

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setError("File size exceeds 10MB. Please upload a smaller file.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(20);
    setError(null);

    try {
      // Upload the file with timeout handling
      let file_url;
      try {
        const uploadResult = await Promise.race([
          base44.integrations.Core.UploadFile({ file }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Upload timeout - file may be too large')), 60000)
          )
        ]);
        file_url = uploadResult.file_url;
      } catch (uploadErr) {
        throw new Error(`File upload failed: ${uploadErr.message}. Please check your connection and try again.`);
      }
      
      setUploadedFileUrl(file_url);
      setUploadProgress(40);
      setExtractedData(null); // Reset extracted data for new upload

      // Log upload activity
      logActivity(ActivityActions.OASIS_UPLOAD, {
        file_name: file.name,
        file_size: file.size,
        page: 'OASISAnalyzer'
      });

      // Enhanced extraction schema - simplified for better reliability
      let extractedData;
      let extractionMethod = 'structured';
      
      try {
        extractedData = await Promise.race([
          base44.integrations.Core.ExtractDataFromUploadedFile({
            file_url: file_url,
            json_schema: {
              type: "object",
              properties: {
            // Patient demographics - LOOK AT THE TOP OF THE DOCUMENT
            patient_name_raw: { type: "string", description: "PATIENT FULL NAME - ABSOLUTELY CRITICAL FOR RECORD MATCHING! Search the ENTIRE FIRST PAGE top to bottom. Look for: 1) Header/title area (very top), 2) Fields labeled: 'Patient Name:', 'Patient:', 'Name:', 'Pt Name:', 'Client:', 3) Near 'M0080' (Patient ID) or 'M0065' (Medicaid Number), 4) Demographics box/section, 5) Before ICD-10 codes/diagnoses. FORMATS to recognize: 'Smith, John', 'John Smith', 'SMITH JOHN', 'Smith John A', 'John A Smith'. Extract EXACTLY as it appears - do NOT skip middle initials. If MULTIPLE names appear, choose the one that is NOT labeled as 'Physician' or 'Agency'. ALWAYS extract something even if uncertain - extraction is better than nothing." },
            patient_first_name: { type: "string", description: "Patient's FIRST NAME only - separate field for matching. Look for 'First Name:', 'Given Name:' or extract from full name." },
            patient_last_name: { type: "string", description: "Patient's LAST NAME only - separate field for matching. Look for 'Last Name:', 'Surname:' or extract from full name." },
            patient_dob: { type: "string", description: "Date of birth - look for 'DOB:', 'Date of Birth:', birth date field. Format MM/DD/YYYY or any date format found." },
            patient_gender: { type: "string", description: "Gender - M, F, Male, Female. Look for 'Gender:', 'Sex:' checkbox or field." },
            patient_address: { type: "string", description: "Patient home address - look for 'Address:', 'Street:', 'Home Address:' on patient demographics section." },

            // Assessment info
            assessment_date: { type: "string", description: "M0090 date of assessment" },
            assessment_type: { type: "string", description: "SOC, ROC, Recert, Follow-up, Transfer, Discharge" },
            assessment_reason: { type: "string", description: "M0100 reason for assessment" },

            // Episode timing - critical for PDGM
            m0110_episode_timing: { type: "string", description: "M0110 Episode Timing: 1=Early (within 30 days of SOC/ROC), 2=Late (31+ days), or NA" },
            soc_date: { type: "string", description: "M0030 Start of Care date" },
            referral_date: { type: "string", description: "M0104 Referral date" },
            days_since_soc: { type: "string", description: "Number of days since start of care if mentioned" },

            // DIAGNOSES - SEARCH THE ENTIRE DOCUMENT FOR THESE
            m1021_primary_diagnosis_code: { 
              type: "string", 
              description: "PRIMARY DIAGNOSIS ICD-10 CODE - CRITICAL! Search for: 'M1021', 'M-1021', 'M 1021', '(M1021)', 'Primary Diagnosis', 'Principal Diagnosis'. Extract ICD-10 code (format: letter + numbers + optional decimal, examples: I50.9, J44.1, E11.65, Z99.11). May be listed as (a), (b), etc - get the FIRST one. If you find ANY ICD-10 code pattern, extract it here even if not labeled M1021." 
            },
            m1021_primary_diagnosis_description: { 
              type: "string", 
              description: "PRIMARY DIAGNOSIS NAME - the condition name/description next to the primary ICD-10 code. Examples: 'Congestive heart failure', 'COPD', 'Diabetes with complications'. Extract the full text description." 
            },
            m1023_other_diagnoses: { 
              type: "string", 
              description: "OTHER/SECONDARY DIAGNOSES - Search for: 'M1023', 'M-1023', 'M 1023', 'Other Diagnoses', 'Secondary Diagnoses', 'Additional Diagnoses'. Extract ALL ICD-10 codes found with their descriptions. Format: 'I10 Hypertension, E11.9 Diabetes, J44.9 COPD' - include ALL you find, separated by commas." 
            },
            all_icd10_codes_found: {
              type: "string",
              description: "EXTRACT ALL ICD-10 CODES FOUND ANYWHERE IN DOCUMENT - Look for any text matching pattern: Letter followed by 2-3 digits, optional decimal and more digits (I50.9, J44.1, E11.65, etc). List ALL codes found, comma separated, even if not in M1021/M1023 sections."
            },
            diagnosis_section_text: {
              type: "string",
              description: "RAW TEXT FROM DIAGNOSIS SECTION - Copy the entire text from any section labeled with 'Diagnosis', 'ICD-10', 'M1021', 'M1023' verbatim. This ensures we capture everything even if codes are unclear."
            },

            // Episode timing
            episode_timing: { type: "string", description: "Early (0-29 days) or Late (30+ days)" },

            // Functional status - ADLs
            m1800_grooming: { type: "string", description: "M1800 score 0-3" },
            m1810_dress_upper: { type: "string", description: "M1810 score 0-3" },
            m1820_dress_lower: { type: "string", description: "M1820 score 0-3" },
            m1830_bathing: { type: "string", description: "M1830 score 0-6" },
            m1840_toilet_transfer: { type: "string", description: "M1840 score 0-4" },
            m1850_transferring: { type: "string", description: "M1850 score 0-5" },
            m1860_ambulation: { type: "string", description: "M1860 score 0-6" },

            // GG items if present
            gg0130_self_care: { type: "string", description: "GG0130 self-care score" },
            gg0170_mobility: { type: "string", description: "GG0170 mobility score" },

            // Clinical status
            m1400_dyspnea: { type: "string", description: "M1400 score 0-4" },
            m1242_pain_freq: { type: "string", description: "M1242 pain frequency" },
            m1306_pressure_ulcer: { type: "string", description: "M1306 pressure ulcer present 0-1" },
            m1307_pressure_ulcer_stage: { type: "string", description: "M1307 oldest stage" },
            m1311_pressure_ulcer_count: { type: "string", description: "M1311 number of ulcers" },
            m1322_stasis_ulcer: { type: "string", description: "M1322 stasis ulcer present" },
            m1324_stasis_ulcer_status: { type: "string", description: "M1324 status" },
            m1330_surgical_wound: { type: "string", description: "M1330 surgical wound present" },
            m1340_surgical_wound_status: { type: "string", description: "M1340 status" },

            // Cognitive and behavioral
            m1700_cognitive: { type: "string", description: "M1700 cognitive functioning" },
            m1710_confusion: { type: "string", description: "M1710 when confused" },
            m1720_anxiety: { type: "string", description: "M1720 anxiety level" },
            m1730_depression: { type: "string", description: "M1730 PHQ-2 score" },

            // Therapy needs
            therapy_pt_needed: { type: "string", description: "Physical therapy ordered yes/no" },
            therapy_ot_needed: { type: "string", description: "Occupational therapy ordered yes/no" },
            therapy_slp_needed: { type: "string", description: "Speech therapy ordered yes/no" },

            // Risk factors
            fall_risk_assessment: { type: "string", description: "Fall risk score or level" },
            hospitalization_risk: { type: "string", description: "Hospitalization risk indicators" },

            // Medications
            high_risk_medications: { type: "string", description: "High risk drugs mentioned" },
            medication_count: { type: "string", description: "Number of medications if stated" },

            // Full text for AI analysis
            clinical_narrative: { type: "string", description: "Any narrative clinical notes or comments" }
              }
            }
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Data extraction timeout - PDF may be too complex')), 90000)
          )
        ]);
      } catch (extractErr) {
        console.warn("Structured extraction failed, trying text fallback:", extractErr);
        extractionMethod = 'text_fallback';
        
        // Store extraction data for mapper
        setExtractedData(extractedData);
        
        // Fallback: Extract as plain text with AI-assisted parsing
        try {
          const textExtract = await base44.integrations.Core.ExtractDataFromUploadedFile({
            file_url: file_url,
            json_schema: {
              type: "object",
              properties: {
                full_text: { 
                  type: "string", 
                  description: "Extract ALL text from the PDF document exactly as it appears, preserving line breaks and spacing" 
                }
              }
            }
          });
          
          if (textExtract.status === "success" && textExtract.output?.full_text) {
            
            // Use AI to parse the raw text for critical fields
            const parsedData = await invokeLLM({
              model: "claude_opus_4_8",
              prompt: `Parse this OASIS document text and extract key data fields. Focus on accuracy.

DOCUMENT TEXT:
${textExtract.output.full_text.substring(0, 8000)}

Extract ONLY what you can clearly identify. Return "NOT FOUND" for fields you cannot locate.

CRITICAL FIELDS TO FIND:
1. Patient name - look at the very top of the document
2. M1021 Primary Diagnosis - ICD-10 code AND description
3. M1023 Other Diagnoses - ALL codes and descriptions listed
4. Date of birth
5. Assessment date (M0090)
6. Functional scores (M1800-M1860)

Return JSON:
{
  "patient_name": "exact name from document or NOT FOUND",
  "patient_dob": "DOB or NOT FOUND",
  "m1021_code": "ICD-10 code or NOT FOUND",
  "m1021_description": "diagnosis description or NOT FOUND",
  "m1023_list": "all other diagnoses with codes, comma separated, or NOT FOUND",
  "assessment_date": "date or NOT FOUND",
  "functional_scores": {"m1800": "0-3 or ?", "m1810": "0-3 or ?", "m1820": "0-3 or ?", "m1830": "0-6 or ?", "m1840": "0-4 or ?", "m1850": "0-5 or ?", "m1860": "0-6 or ?"}
}`,
              response_json_schema: {
                type: "object",
                properties: {
                  patient_name: { type: "string" },
                  patient_dob: { type: "string" },
                  m1021_code: { type: "string" },
                  m1021_description: { type: "string" },
                  m1023_list: { type: "string" },
                  assessment_date: { type: "string" },
                  functional_scores: { type: "object" }
                }
              }
            }, { timeoutMs: 90000, retries: 1 });
            
            // Map parsed data to extraction output format
            extractedData = {
              status: "success",
              output: {
                full_text: textExtract.output.full_text,
                patient_name_raw: parsedData.patient_name,
                patient_name: parsedData.patient_name,
                patient_dob: parsedData.patient_dob,
                m1021_primary_diagnosis_code: parsedData.m1021_code,
                m1021_primary_diagnosis_description: parsedData.m1021_description,
                m1023_other_diagnoses: parsedData.m1023_list,
                assessment_date: parsedData.assessment_date,
                m1800_grooming: parsedData.functional_scores?.m1800,
                m1810_dress_upper: parsedData.functional_scores?.m1810,
                m1820_dress_lower: parsedData.functional_scores?.m1820,
                m1830_bathing: parsedData.functional_scores?.m1830,
                m1840_toilet_transfer: parsedData.functional_scores?.m1840,
                m1850_transferring: parsedData.functional_scores?.m1850,
                m1860_ambulation: parsedData.functional_scores?.m1860
              }
            };
          } else {
            throw new Error("Text extraction also failed");
          }
        } catch {
          throw new Error(`Unable to read PDF: ${extractErr.message}. Please ensure the PDF is not password-protected, corrupted, or scanned without OCR. Try re-saving the PDF or using a different file.`);
        }
      }

      setUploadProgress(50);

      if (extractedData.status === "error") {
        throw new Error(extractedData.details || "Failed to extract data from PDF. The file may be password-protected, corrupted, or require OCR. Please try a different file or re-save the PDF.");
      }

      // Build comprehensive OASIS content from extraction
      const output = extractedData.output;
      let oasisTextContent = "";
      let extractedPatientName = "Unknown Patient";

      // Handle text fallback extraction
      if (extractionMethod === 'text_fallback' && output?.full_text) {
        oasisTextContent = output.full_text;
        
        // Try to extract patient name from raw text
        const namePatterns = [
          /Patient Name:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
          /Patient:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
          /Name:\s*([A-Z][a-z]+,?\s+[A-Z][a-z]+)/i,
          /([A-Z][a-z]+,\s*[A-Z][a-z]+(?:\s+[A-Z]\.?)?)/,
        ];
        
        for (const pattern of namePatterns) {
          const match = output.full_text.match(pattern);
          if (match && match[1]) {
            extractedPatientName = match[1].trim();
            // Do not log the extracted patient name (PHI) to the console.
            break;
          }
        }
        
        // Create minimal structured output for downstream processing
        output.patient_name_raw = extractedPatientName;
        output.patient_name = extractedPatientName;
      } else if (output) {
        // Build detailed diagnosis section
        const primaryDxCode = output.m1021_primary_diagnosis_code || output.primary_diagnosis_code || 'NOT FOUND';
        const primaryDxDesc = output.m1021_primary_diagnosis_description || output.primary_diagnosis_description || 'NOT FOUND';
        const otherDx = output.m1023_other_diagnoses || output.secondary_diagnoses || 'NOT FOUND';
        const comorbidities = output.comorbidities_text || 'NOT FOUND';
        
        // Enhanced patient name extraction with fallbacks
        let extractedPatientName = output.patient_name_raw || output.patient_name || '';
        
        // Try to construct from first/last if full name not found
        if (!extractedPatientName && (output.patient_first_name || output.patient_last_name)) {
          const firstName = output.patient_first_name || '';
          const lastName = output.patient_last_name || '';
          extractedPatientName = `${firstName} ${lastName}`.trim();
        }
        
        // Clean up the name
        extractedPatientName = extractedPatientName
          .replace(/patient:?/gi, '')
          .replace(/name:?/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        extractedPatientName = extractedPatientName || 'NOT FOUND - CHECK DOCUMENT HEADER';

        oasisTextContent = `PATIENT DEMOGRAPHICS:
      Name: ${extractedPatientName}
      DOB: ${output.patient_dob || '?'}
      Gender: ${output.patient_gender || '?'}

      ASSESSMENT INFORMATION:
      Date (M0090): ${output.assessment_date || '?'}
      Type: ${output.assessment_type || '?'}
      Reason (M0100): ${output.assessment_reason || '?'}

      ===== DIAGNOSES (CRITICAL FOR PDGM) =====

      M1021 PRIMARY DIAGNOSIS:
      Code: ${primaryDxCode}
      Description: ${primaryDxDesc}

      M1023 OTHER DIAGNOSES:
      ${otherDx}

      ADDITIONAL SECONDARY DIAGNOSES:
      ${output.secondary_diagnoses !== otherDx ? output.secondary_diagnoses || 'None' : 'See M1023 above'}

      ALL COMORBIDITIES & CONDITIONS MENTIONED:
      ${comorbidities}

      ==========================================

      ADMISSION/EPISODE:
      M0110 Episode Timing: ${output.m0110_episode_timing || '?'}
      SOC Date (M0030): ${output.soc_date || '?'}
      Referral Date (M0104): ${output.referral_date || '?'}
      Days Since SOC: ${output.days_since_soc || '?'}
      Episode Timing Determination: ${output.episode_timing || 'Not determined'}

      FUNCTIONAL STATUS (ADLs):
      M1800 Grooming: ${output.m1800_grooming || '?'}
      M1810 Upper Body Dressing: ${output.m1810_dress_upper || '?'}
      M1820 Lower Body Dressing: ${output.m1820_dress_lower || '?'}
      M1830 Bathing: ${output.m1830_bathing || '?'}
      M1840 Toilet Transferring: ${output.m1840_toilet_transfer || '?'}
      M1850 Transferring: ${output.m1850_transferring || '?'}
      M1860 Ambulation: ${output.m1860_ambulation || '?'}

      GG FUNCTIONAL ITEMS:
      GG0130 Self-Care: ${output.gg0130_self_care || 'N/A'}
      GG0170 Mobility: ${output.gg0170_mobility || 'N/A'}

      CLINICAL STATUS:
      M1400 Dyspnea: ${output.m1400_dyspnea || '?'}
      M1242 Pain Frequency: ${output.m1242_pain_freq || '?'}

      WOUNDS/SKIN:
      M1306 Pressure Ulcer Present: ${output.m1306_pressure_ulcer || '?'}
      M1307 Pressure Ulcer Stage: ${output.m1307_pressure_ulcer_stage || 'N/A'}
      M1311 Pressure Ulcer Count: ${output.m1311_pressure_ulcer_count || 'N/A'}
      M1322 Stasis Ulcer: ${output.m1322_stasis_ulcer || '?'}
      M1324 Stasis Ulcer Status: ${output.m1324_stasis_ulcer_status || 'N/A'}
      M1330 Surgical Wound: ${output.m1330_surgical_wound || '?'}
      M1340 Surgical Wound Status: ${output.m1340_surgical_wound_status || 'N/A'}

      COGNITIVE/BEHAVIORAL:
      M1700 Cognitive Functioning: ${output.m1700_cognitive || '?'}
      M1710 When Confused: ${output.m1710_confusion || '?'}
      M1720 Anxiety Level: ${output.m1720_anxiety || '?'}
      M1730 Depression (PHQ-2): ${output.m1730_depression || '?'}

      THERAPY SERVICES:
      PT Ordered: ${output.therapy_pt_needed || '?'}
      OT Ordered: ${output.therapy_ot_needed || '?'}
      SLP Ordered: ${output.therapy_slp_needed || '?'}

      RISK FACTORS:
      Fall Risk: ${output.fall_risk_assessment || '?'}
      Hospitalization Risk: ${output.hospitalization_risk || '?'}
      High-Risk Medications: ${output.high_risk_medications || 'None noted'}
      Medication Count: ${output.medication_count || '?'}

      CLINICAL NARRATIVE:
      ${output.clinical_narrative || 'No narrative extracted'}`;
      }
      
      // Final fallback for text extraction method
      if ((!oasisTextContent || oasisTextContent.trim().length < 20) && extractionMethod === 'text_fallback') {
        oasisTextContent = output?.full_text || '';
      }
      
      if (!oasisTextContent || oasisTextContent.trim().length < 20) {
        throw new Error("PDF appears to be empty or unreadable. Please ensure it's a valid OASIS document with actual content.");
      }

      
      // Parse scores helper
      const parseScore = (val) => {
        if (!val) return 0;
        const num = parseInt(String(val).replace(/[^0-9]/g, ''));
        return isNaN(num) ? 0 : num;
      };

      // Default admission source
      let admissionSource = 'community';

      // Determine episode timing from M0110 or calculated from dates
      let episodeTiming = 'early';
      const m0110 = String(output?.m0110_episode_timing || '').toLowerCase();
      if (m0110.includes('2') || m0110.includes('late') || m0110.includes('31')) {
        episodeTiming = 'late';
      } else if (m0110.includes('1') || m0110.includes('early') || m0110.includes('30') || m0110.includes('within')) {
        episodeTiming = 'early';
      } else if (output?.days_since_soc) {
        const days = parseInt(output.days_since_soc);
        if (!isNaN(days) && days > 30) {
          episodeTiming = 'late';
        }
      } else if (output?.soc_date && output?.assessment_date) {
        // Try to calculate from dates
        try {
          const soc = new Date(output.soc_date);
          const assessment = new Date(output.assessment_date);
          const diffDays = Math.floor((assessment - soc) / (1000 * 60 * 60 * 24));
          if (diffDays > 30) {
            episodeTiming = 'late';
          }
        } catch {
          // Keep default early
        }
      }

      // Parse comorbidities from extracted text
      const parseComorbidities = (text) => {
        if (!text) return [];
        const items = text.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 2);
        return items.slice(0, 15); // Limit to 15 comorbidities
      };

      // Extract primary diagnosis with M1021 priority - use ANY code found as fallback
      let primaryDxCode = output?.m1021_primary_diagnosis_code || output?.primary_diagnosis_code || '';
      let primaryDxDescription = output?.m1021_primary_diagnosis_description || output?.primary_diagnosis_description || '';

      // Fallback: try to extract from all_icd10_codes_found or diagnosis_section_text
      if (!primaryDxCode && output?.all_icd10_codes_found) {
        const firstCode = output.all_icd10_codes_found.split(',')[0]?.trim();
        if (firstCode) {
          primaryDxCode = firstCode.split(' ')[0]; // Get just the code
          primaryDxDescription = firstCode.substring(primaryDxCode.length).trim(); // Get description
        }
      }

      // Another fallback: parse diagnosis_section_text for ICD-10 pattern
      if (!primaryDxCode && output?.diagnosis_section_text) {
        const icd10Match = output.diagnosis_section_text.match(/([A-Z]\d{2}\.?\d*)\s+([^,\n]+)/);
        if (icd10Match) {
          primaryDxCode = icd10Match[1];
          primaryDxDescription = icd10Match[2].trim();
        }
      }

      const primaryDiagnosis = primaryDxDescription || primaryDxCode;

      // Combine M1023 and secondary diagnoses for comorbidities
      const allSecondaryDx = [
        output?.m1023_other_diagnoses,
        output?.all_icd10_codes_found,
        output?.secondary_diagnoses,
        output?.comorbidities_text
      ].filter(Boolean).join(', ');

      // Parse out additional codes from all_icd10_codes_found
      const additionalCodes = [];
      if (output?.all_icd10_codes_found) {
        const codes = output.all_icd10_codes_found.split(',').map(c => c.trim()).filter(c => c);
        codes.forEach(code => {
          if (code !== primaryDxCode && !additionalCodes.includes(code)) {
            additionalCodes.push(code);
          }
        });
      }

      // Determine therapy needs
      const checkTherapy = (val) => {
        if (!val) return false;
        const v = val.toLowerCase();
        return v.includes('yes') || v.includes('ordered') || v.includes('true') || v === '1';
      };

      // Build structured PDGM data with enhanced extraction
      const structuredPdgmData = {
        primary_diagnosis: primaryDiagnosis,
        primary_diagnosis_code: primaryDxCode,
        primary_diagnosis_description: primaryDxDescription,
        comorbidities: [...parseComorbidities(allSecondaryDx), ...additionalCodes].filter((v, i, a) => a.indexOf(v) === i), // Deduplicate
        raw_diagnosis_data: {
          m1021_found: !!output?.m1021_primary_diagnosis_code,
          m1023_found: !!output?.m1023_other_diagnoses,
          all_codes_found: output?.all_icd10_codes_found || null,
          diagnosis_section: output?.diagnosis_section_text || null
        },
        admission_source: admissionSource,
        episode_timing: episodeTiming,
        m0110_episode_timing: output?.m0110_episode_timing || null,
        soc_date: output?.soc_date || null,
        functional_scores: {
          m1800_grooming: parseScore(output?.m1800_grooming),
          m1810_dress_upper: parseScore(output?.m1810_dress_upper),
          m1820_dress_lower: parseScore(output?.m1820_dress_lower),
          m1830_bathing: parseScore(output?.m1830_bathing),
          m1840_toilet_transfer: parseScore(output?.m1840_toilet_transfer),
          m1850_transferring: parseScore(output?.m1850_transferring),
          m1860_ambulation: parseScore(output?.m1860_ambulation)
        },
        gg_scores: { 
          self_care: output?.gg0130_self_care || null, 
          mobility: output?.gg0170_mobility || null 
        },
        clinical_items: {
          dyspnea: parseScore(output?.m1400_dyspnea),
          pain_frequency: parseScore(output?.m1242_pain_freq),
          pressure_ulcer_present: output?.m1306_pressure_ulcer === '1' || String(output?.m1306_pressure_ulcer).toLowerCase().includes('yes'),
          pressure_ulcer_stage: output?.m1307_pressure_ulcer_stage || null,
          pressure_ulcer_count: parseScore(output?.m1311_pressure_ulcer_count),
          stasis_ulcer: output?.m1322_stasis_ulcer === '1' || String(output?.m1322_stasis_ulcer).toLowerCase().includes('yes'),
          surgical_wound: output?.m1330_surgical_wound === '1' || String(output?.m1330_surgical_wound).toLowerCase().includes('yes'),
          surgical_wound_status: output?.m1340_surgical_wound_status || null
        },
        cognitive_status: {
          cognitive_functioning: output?.m1700_cognitive || null,
          confusion: output?.m1710_confusion || null,
          anxiety: output?.m1720_anxiety || null,
          depression_phq2: output?.m1730_depression || null
        },
        therapy_services: { 
          pt: checkTherapy(output?.therapy_pt_needed), 
          ot: checkTherapy(output?.therapy_ot_needed), 
          slp: checkTherapy(output?.therapy_slp_needed) 
        },
        risk_factors: {
          fall_risk: output?.fall_risk_assessment || null,
          hospitalization_risk: output?.hospitalization_risk || null,
          high_risk_medications: output?.high_risk_medications || null,
          medication_count: parseScore(output?.medication_count)
        },
        homebound_reason: output?.homebound_reason || null,
        patient_info: { 
          name: extractedPatientName || "Unknown Patient - Verify Document",
          first_name: output?.patient_first_name || null,
          last_name: output?.patient_last_name || null,
          dob: output?.patient_dob || "Not found",
          gender: output?.patient_gender || "Not specified",
          address: output?.patient_address || null,
          assessment_date: output?.assessment_date || new Date().toISOString().split('T')[0], 
          assessment_type: output?.assessment_type || "Unknown",
          assessment_reason: output?.assessment_reason || "Not specified"
        }
      };

      // Increase content limit for better analysis
      const maxContentLength = 15000;
      const _truncatedContent = oasisTextContent.length > maxContentLength 
        ? oasisTextContent.substring(0, maxContentLength) + "\n[content truncated for processing]"
        : oasisTextContent;

      setIsUploading(false);
      setIsAnalyzing(true);

      // Simplified analysis - focus on core findings
      let analysisResult;
      try {
        analysisResult = await Promise.race([
          invokeLLM({
            model: "claude_opus_4_8",
            prompt: `Analyze OASIS document. Extract: diagnosis, functional scores, compliance issues, revenue opportunities.

DATA:
Primary Dx: ${structuredPdgmData.primary_diagnosis_code} ${structuredPdgmData.primary_diagnosis_description}
Comorbidities: ${structuredPdgmData.comorbidities?.slice(0, 5).join(', ') || 'None'}
Functional: Bathing=${structuredPdgmData.functional_scores?.m1830_bathing}, Transfer=${structuredPdgmData.functional_scores?.m1850_transferring}, Ambulation=${structuredPdgmData.functional_scores?.m1860_ambulation}

Return scores (0-100) and top 3-5 issues in each category.`,
            response_json_schema: {
              type: "object",
              properties: {
                overall_score: { type: "number" },
                accuracy_score: { type: "number" },
                compliance_score: { type: "number" },
                revenue_optimization_score: { type: "number" },
                summary: { type: "string" },
                pdgm_data: { type: "object" },
                extracted_items: { type: "object" },
                accuracy_issues: { type: "array", items: { type: "object" } },
                compliance_concerns: { type: "array", items: { type: "object" } },
                revenue_tips: { type: "array", items: { type: "object" } },
                documentation_improvements: { type: "array", items: { type: "object" } },
                audit_risk_areas: { type: "array", items: { type: "object" } },
                specific_rescore_opportunities: { type: "array", items: { type: "object" } },
                missing_high_value_documentation: { type: "array", items: { type: "object" } },
                strengths: { type: "array", items: { type: "string" } },
                key_recommendations: { type: "array", items: { type: "string" } },
                quick_wins: { type: "array", items: { type: "object" } },
                clinician_questions: { type: "array", items: { type: "string" } }
              }
            }
          }, { timeoutMs: 90000, retries: 0 }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Analysis timeout - please try again')), 90000)
          )
        ]);
      } catch (analysisErr) {
        throw new Error(`AI analysis failed: ${analysisErr.message}. Please try uploading again.`);
      }

      setUploadProgress(85);

      // Skip narrative analysis to speed up
      let narrativeMatchAnalysis = null;

      setUploadProgress(90);

      // Deterministic data-quality validation is not run in this fast path, so
      // do NOT fabricate a quality score or PDGM readiness. Omit the summary —
      // the UI guards on validation_summary and shows nothing, rather than a
      // fake "Quality: 80% / ready for grouping".
      analysisResult.validation_summary = null;

      // Attach narrative analysis to results
      if (narrativeMatchAnalysis) {
        analysisResult.narrative_match_analysis = narrativeMatchAnalysis;
      }

      setUploadProgress(100);
      setAnalysisResults(analysisResult);

      // Log analysis activity
      logActivity(ActivityActions.OASIS_ANALYZE, {
        file_name: file.name,
        overall_score: analysisResult.overall_score,
        accuracy_score: analysisResult.accuracy_score,
        compliance_score: analysisResult.compliance_score,
        estimated_payment: originalPayment,
        page: 'OASISAnalyzer'
      });

      // Auto-flag for audit if scores below threshold
      const shouldFlag = 
        (analysisResult.accuracy_score < THRESHOLDS.accuracy) ||
        (analysisResult.compliance_score < THRESHOLDS.compliance) ||
        (analysisResult.overall_score < THRESHOLDS.overall);

      if (shouldFlag && uploadedFileUrl) {
        // Will be flagged when saved to patient
      }
      
      // Use pre-extracted structured data merged with AI analysis for PDGM calculation
      const finalPdgmData = {
        ...structuredPdgmData,
        ...(analysisResult.pdgm_data || {}),
        // Prefer AI-analyzed values if they seem more complete
        primary_diagnosis: analysisResult.pdgm_data?.primary_diagnosis || structuredPdgmData.primary_diagnosis,
        comorbidities: (analysisResult.pdgm_data?.comorbidities?.length > structuredPdgmData.comorbidities?.length) 
          ? analysisResult.pdgm_data.comorbidities 
          : structuredPdgmData.comorbidities,
        functional_scores: {
          ...structuredPdgmData.functional_scores,
          ...(analysisResult.pdgm_data?.functional_scores || {})
        }
      };
      
      // Update the analysis result with merged data
      analysisResult.pdgm_data = finalPdgmData;
      setPdgmData(finalPdgmData);
      
      // Store extracted data for clinical note mapper
      if (!extractedData) {
        setExtractedData({ status: 'success', output });
      }
    } catch (err) {
    console.error("Error analyzing OASIS:", err);

    // Log error activity
    logActivity(ActivityActions.ERROR, {
      error_message: err.message,
      file_name: file?.name,
      component: 'OASISAnalyzer',
      page: 'OASISAnalyzer'
    });

    // Provide more specific error messages
    let errorMessage = "Failed to analyze the OASIS document. ";
      
      if (err.message?.includes('timeout')) {
        errorMessage += "The request timed out. The file may be too large or complex. Try a smaller file or try again.";
      } else if (err.message?.includes('network') || err.message?.includes('fetch')) {
        errorMessage += "Network error. Please check your internet connection and try again.";
      } else if (err.message?.includes('upload')) {
        errorMessage += "File upload failed. Please try again with a different file.";
      } else if (err.message?.includes('extract')) {
        errorMessage += "Could not read the PDF. Ensure it's a valid OASIS document.";
      } else {
        errorMessage += err.message || "Please try again.";
      }
      
      setError(errorMessage);
    }

    setIsUploading(false);
    setIsAnalyzing(false);
  };

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadReport = async () => {
    if (!analysisResults) return;

    setIsDownloading(true);
    try {
      const response = await generateOASISReportPDF({ analysisResults });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `OASIS_Analysis_Report_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error("Error generating PDF:", err);
      setError("Failed to generate PDF report. Please try again.");
    }
    setIsDownloading(false);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4 sm:mb-6">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex md:grid md:w-full md:max-w-3xl md:grid-cols-5 gap-1 min-w-max h-auto">
            <TabsTrigger value="single" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Single Document</span>
              <span className="sm:hidden">Single</span>
            </TabsTrigger>
            <TabsTrigger value="batch" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <FolderArchive className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Batch Analysis</span>
              <span className="sm:hidden">Batch</span>
            </TabsTrigger>
            <TabsTrigger value="saved" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <History className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden md:inline">Saved ({savedOASISUploads.length})</span>
              <span className="md:hidden">Saved</span>
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <BarChart3 className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Analytics</span>
              <span className="sm:hidden">Stats</span>
            </TabsTrigger>
            <TabsTrigger value="automation" className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
              <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Automation</span>
              <span className="sm:hidden">Auto</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* One Suspense boundary covers every tab's lazily-loaded feature
            components (below), so a lazy child can never suspend without an
            ancestor boundary. TabsList stays outside it so the tabs remain
            visible while a tab's chunk loads. */}
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}>
        {/* Saved OASIS Tab */}
        <TabsContent value="saved" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" />
                Saved OASIS Analyses
              </CardTitle>
            </CardHeader>
            <CardContent>
              {savedOASISUploads.length === 0 ? (
                <p className="text-center text-slate-500 py-8">
                  No saved OASIS analyses yet. Upload and analyze a document, then save it to a patient.
                </p>
              ) : (
                <div className="space-y-3">
                  {savedOASISUploads.map((oasis) => (
                    <div 
                      key={oasis.id} 
                      className="p-4 border rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => handleLoadSavedOASIS(oasis)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <FileText className="w-8 h-8 text-blue-500" />
                          <div>
                            <p className="font-medium">{oasis.patient_name || 'Unknown Patient'}</p>
                            <p className="text-sm text-slate-500">
                              {oasis.assessment_type} - {oasis.assessment_date || 'No date'}
                            </p>
                            <p className="text-xs text-slate-400">{oasis.file_name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="flex gap-2">
                            <Badge className={oasis.scores?.overall >= 80 ? 'bg-green-100 text-green-800' : oasis.scores?.overall >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}>
                              Score: {oasis.scores?.overall || 'N/A'}%
                            </Badge>
                            <FinancialGate>
                              {oasis.estimated_payment && (
                                <Badge variant="outline">
                                  ${oasis.estimated_payment?.toLocaleString()}
                                </Badge>
                              )}
                            </FinancialGate>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(oasis.created_date).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab — payment trends & revenue stats; financial, admins only */}
        <TabsContent value="analytics" className="mt-4">
          <FinancialGate fallback={<p className="text-sm text-slate-500">Analytics are available to administrators.</p>}>
            <div className="space-y-6">
              <PDGMTrendDashboard />
              <OASISAnalyticsDashboard savedOASISUploads={savedOASISUploads} />
            </div>
          </FinancialGate>
        </TabsContent>

        {/* Automation Tab */}
        <TabsContent value="automation" className="mt-4">
          <div className="space-y-6">
            {/* Workflow Monitoring Dashboard */}
            <WorkflowMonitoringDashboard />

            {/* Automation Settings */}
            <OASISAutomationSettings />
            
            <Alert className="bg-blue-50 border-blue-200">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <AlertDescription>
                <p className="text-sm text-blue-900 mb-2">
                  <strong>How Automation Works:</strong>
                </p>
                <ul className="text-sm text-blue-800 space-y-1 ml-4 list-disc">
                  <li>Configure rules that trigger when specific OASIS issues are detected</li>
                  <li>AI analyzes each assessment and matches findings to your automation rules</li>
                  <li>Automatically creates tasks, alerts, and notifications based on configured actions</li>
                  <li>Monitor workflow execution history and performance in the dashboard above</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        </TabsContent>

        <TabsContent value="batch" className="mt-4">
          {/* Batch results/exports include estimated payment & revenue columns — admins only */}
          <FinancialGate fallback={<p className="text-sm text-slate-500">Batch analysis includes payment/revenue data and is available to administrators.</p>}>
            <BatchOASISAnalyzer onSingleAnalysis={handleViewBatchResult} onBatchComplete={handleBatchComplete} />
          </FinancialGate>
        </TabsContent>

        <TabsContent value="single" className="mt-4">
          {/* AI Data Entry Assistant */}
          {useDataEntryAssistant ? (
            <OASISDataEntryAssistant
              onDataConfirmed={(data) => {
                // Use the confirmed data to pre-populate analysis
                setFile(data.file);
                setUploadedFileUrl(data.fileUrl);
                setPatientName(data.extractedData.patient_name || "Unknown");

                // Auto-trigger analysis with pre-filled data
                setUseDataEntryAssistant(false);

                // Show success message
                toast.error("Data confirmed! Now analyzing with AI-extracted information...");
              }}
            />
          ) : null}

          {/* Upload Section */}
          <Card className="mb-4 sm:mb-6">
            <CardHeader className="p-3 sm:p-4 md:p-6">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 flex-shrink-0" />
                <span className="truncate">Upload OASIS Document</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 md:p-6">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
                <Button
                  variant={useDataEntryAssistant ? "outline" : "default"}
                  onClick={() => setUseDataEntryAssistant(false)}
                  className={`min-h-[44px] w-full sm:w-auto ${!useDataEntryAssistant ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Quick Upload
                </Button>
                <Button
                  variant={useDataEntryAssistant ? "default" : "outline"}
                  onClick={() => setUseDataEntryAssistant(true)}
                  className={`min-h-[44px] w-full sm:w-auto ${useDataEntryAssistant ? "bg-navy-600 hover:bg-navy-700" : ""}`}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">AI Data Entry Assistant</span>
                  <span className="sm:hidden">AI Assistant</span>
                </Button>
                </div>

                {!useDataEntryAssistant && (
                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleFileChange}
                      className="hidden"
                      id="oasis-upload"
                    />
                    <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-sm text-slate-600 mb-2">
                      {file ? file.name : "No file selected"}
                    </p>
                    <p className="text-xs text-slate-400 mb-4">Upload your OASIS PDF for accuracy review</p>
                    <Button 
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={() => document.getElementById('oasis-upload').click()}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Choose PDF File
                    </Button>
                  </div>
                )}
              </div>

              {file && (
                <div className="mt-4 flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-medium">{file.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </Badge>
                  </div>
                  <Button
                    onClick={handleUploadAndAnalyze}
                    disabled={isUploading || isAnalyzing}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isUploading || isAnalyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {isUploading ? "Uploading..." : "Analyzing..."}
                      </>
                    ) : (
                      <>
                        <ClipboardCheck className="w-4 h-4 mr-2" />
                        Analyze OASIS
                      </>
                    )}
                  </Button>
                </div>
              )}

              {(isUploading || isAnalyzing) && (
                <div className="mt-4">
                  <Progress value={uploadProgress} className="h-2" />
                  <p className="text-xs text-slate-500 mt-2 text-center">
                    {isUploading ? "Uploading document..." : "AI is analyzing your OASIS document..."}
                  </p>
                </div>
              )}

              {error && (
                <Alert className="mt-4 bg-red-50 border-red-200">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <AlertDescription className="text-red-800">{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

      {/* Clinical Note to OASIS Mapper */}
      {pdgmData && (
        <ClinicalNoteToOASISMapper
          onMappingComplete={() => {
          }}
          existingOASISData={pdgmData}
          extractedNarrative={extractedData?.output?.clinical_narrative}
        />
      )}

      {/* OASIS Draft Generator */}
      {selectedPatient && (
        <OASISDraftGenerator
          patientData={selectedPatient}
          clinicalContext={analysisResults?.summary}
          visitType={pdgmData?.patient_info?.assessment_type || 'admission'}
          onDraftGenerated={() => {
          }}
        />
      )}

      {/* Proactive Rescoring Engine */}
      {analysisResults && pdgmData && (
        <ProactiveRescoringEngine
          oasisData={pdgmData}
          patientData={selectedPatient}
          clinicalContext={analysisResults?.summary}
          autoAnalyze={true}
          onOpportunitiesFound={() => {
          }}
        />
      )}

      {/* Comprehensive OASIS Review - Full Document Analysis */}
      {analysisResults && pdgmData && (
        <ComprehensiveOASISReviewer
          oasisData={pdgmData}
          analysisResults={analysisResults}
          patientData={selectedPatient}
          autoReview={true}
        />
      )}

      {/* Proactive Documentation Assistant - AI Gap Detection */}
      {analysisResults && pdgmData && (
        <ProactiveDocumentationAssistant
          oasisData={pdgmData}
          clinicalNotes={analysisResults?.summary}
          patientData={selectedPatient}
          autoAnalyze={true}
          onApplySuggestion={() => {
            // Could integrate with OASIS editor if available
          }}
        />
      )}

      {/* Automated Quality Assurance */}
      {analysisResults && pdgmData && (
        <AutomatedQualityAssurance
          oasisData={pdgmData}
          patientData={selectedPatient}
          clinicalNotes={analysisResults?.summary}
          autoRun={true}
          onQAComplete={() => {
          }}
        />
      )}

      {/* AI Data Validation Engine - Proactive OASIS Corrections */}
      {analysisResults && pdgmData && (
        <AIDataValidationEngine
          oasisData={{ extracted_data: pdgmData, pdgm_data: pdgmData }}
          patientData={selectedPatient}
          clinicalNotes={analysisResults?.summary}
          patientHistory={patientHistoricalData}
          autoValidate={true}
          onCorrection={(correction) => {
            setPdgmData(prev => ({
              ...prev,
              [correction.m_item_code]: correction.suggested_value
            }));
          }}
        />
      )}

      {/* Visit-Type Compliance Review */}
      {selectedPatientId && analysisResults && (
        <VisitTypeComplianceChecker
          visitType={pdgmData?.patient_info?.assessment_type || 'admission'}
          noteContent={analysisResults?.summary}
          oasisData={{ extracted_data: pdgmData, pdgm_data: pdgmData }}
          patientData={selectedPatient}
          careType={selectedPatient?.care_type || "home_health"}
          autoCheck={false}
        />
      )}

      {/* Predictive Outcomes Analyzer */}
      <PredictiveOutcomesAnalyzer
        analysisResults={analysisResults}
        pdgmData={pdgmData}
        patientId={selectedPatientId}
        onPredictionsComplete={(preds) => setPredictions(preds)}
      />

      {/* Push Recommendations to Patient Chart */}
      {selectedPatientId && (
        <OASISToPatientChartPusher
          analysisResults={analysisResults}
          pdgmData={pdgmData}
          patientId={selectedPatientId}
          oasisUploadId={analysisId}
          predictions={predictions}
        />
      )}

      {/* Workflow Execution Engine */}
      <WorkflowExecutionEngine
        analysisResults={analysisResults}
        pdgmData={pdgmData}
        patientId={selectedPatientId}
        patientName={patientName}
        oasisUploadId={analysisId}
        autoExecute={true}
      />

      {/* Analysis Results */}
      {analysisResults && (
        <div className="space-y-6">
          {/* Side-by-Side PDF Comparison */}
          <OASISPDFComparison
            uploadedFileUrl={uploadedFileUrl}
            extractedData={extractedData}
            pdgmData={pdgmData}
            oasisUploadId={analysisId}
            onDataCorrected={(correctedData) => {
              // Update pdgmData with corrected values
              setPdgmData(prev => ({
                ...prev,
                patient_info: {
                  ...prev?.patient_info,
                  name: correctedData.patient_name || prev?.patient_info?.name,
                  dob: correctedData.patient_dob || prev?.patient_info?.dob,
                  gender: correctedData.patient_gender || prev?.patient_info?.gender,
                  address: correctedData.patient_address || prev?.patient_info?.address,
                  assessment_date: correctedData.assessment_date || prev?.patient_info?.assessment_date,
                  assessment_type: correctedData.assessment_type || prev?.patient_info?.assessment_type,
                },
                primary_diagnosis_code: correctedData.primary_diagnosis_code || prev?.primary_diagnosis_code,
                primary_diagnosis_description: correctedData.primary_diagnosis_description || prev?.primary_diagnosis_description,
                functional_scores: {
                  ...prev?.functional_scores,
                  m1800_grooming: correctedData.m1800_grooming ?? prev?.functional_scores?.m1800_grooming,
                  m1810_dress_upper: correctedData.m1810_dress_upper ?? prev?.functional_scores?.m1810_dress_upper,
                  m1820_dress_lower: correctedData.m1820_dress_lower ?? prev?.functional_scores?.m1820_dress_lower,
                  m1830_bathing: correctedData.m1830_bathing ?? prev?.functional_scores?.m1830_bathing,
                  m1840_toilet_transfer: correctedData.m1840_toilet_transfer ?? prev?.functional_scores?.m1840_toilet_transfer,
                  m1850_transferring: correctedData.m1850_transferring ?? prev?.functional_scores?.m1850_transferring,
                  m1860_ambulation: correctedData.m1860_ambulation ?? prev?.functional_scores?.m1860_ambulation,
                },
                episode_timing: correctedData.episode_timing || prev?.episode_timing,
                m0110_episode_timing: correctedData.m0110_episode_timing || prev?.m0110_episode_timing,
                clinical_items: {
                  ...prev?.clinical_items,
                  dyspnea: correctedData.m1400_dyspnea ?? prev?.clinical_items?.dyspnea,
                  pain_frequency: correctedData.m1242_pain_freq ?? prev?.clinical_items?.pain_frequency,
                }
              }));
            }}
          />

          {/* Patient Match Selector - Enhanced with Confidence Scoring */}
          <PatientMatchSelector
            extractedName={patientName}
            extractedDOB={pdgmData?.patient_info?.dob}
            matchResults={matchResults}
            selectedPatientId={selectedPatientId}
            onSelectPatient={(patientId) => setSelectedPatientId(patientId)}
            allPatients={patients}
            oasisUploadId={analysisId}
          />

          {/* Save to Patient Action */}
          <Card className="border-2 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">Save OASIS Analysis</p>
                    <p className="text-xs text-slate-500">
                      {selectedPatientId && patients.find(p => p.id === selectedPatientId)
                        ? `Link to ${patients.find(p => p.id === selectedPatientId)?.first_name} ${patients.find(p => p.id === selectedPatientId)?.last_name}`
                        : 'Save as standalone record'}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleSaveToPatient}
                  disabled={isSaving || savedToPatient || !uploadedFileUrl}
                  className={savedToPatient ? "bg-green-600" : "bg-blue-600 hover:bg-blue-700"}
                >
                  {isSaving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : savedToPatient ? (
                    <><CheckCircle2 className="w-4 h-4 mr-2" /> Saved</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> Save OASIS</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Navigation to Detailed Review Pages */}
          <Card className="border-2 border-indigo-300 bg-gradient-to-r from-indigo-50 to-navy-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Workflow className="w-5 h-5 text-indigo-600" />
                Detailed Analysis Sections
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FinancialGate>
                <Link to="/OASISCenter?tab=revenue" state={{ analysisResults, pdgmData, patientName, uploadId: analysisId }}>
                  <Button className="w-full bg-green-600 hover:bg-green-700 h-auto py-4 flex flex-col items-center gap-2">
                    <DollarSign className="w-8 h-8" />
                    <div className="text-center">
                      <div className="font-bold">Revenue Analysis</div>
                      <div className="text-xs opacity-90">PDGM, Case Mix, Payment</div>
                    </div>
                  </Button>
                </Link>
                </FinancialGate>
                <Link to="/OASISCenter?tab=quality" state={{ analysisResults, pdgmData, patientName, patientId: selectedPatientId }}>
                  <Button className="w-full bg-red-600 hover:bg-red-700 h-auto py-4 flex flex-col items-center gap-2">
                    <Shield className="w-8 h-8" />
                    <div className="text-center">
                      <div className="font-bold">Compliance Review</div>
                      <div className="text-xs opacity-90">Audit Risk, Validation</div>
                    </div>
                  </Button>
                </Link>
                <Link to="/OASISCenter?tab=quality" state={{ analysisResults, pdgmData, patientName, navigationData }}>
                  <Button className="w-full bg-navy-600 hover:bg-navy-700 h-auto py-4 flex flex-col items-center gap-2">
                    <FileText className="w-8 h-8" />
                    <div className="text-center">
                      <div className="font-bold">Documentation</div>
                      <div className="text-xs opacity-90">Quality, AI Suggestions</div>
                    </div>
                  </Button>
                </Link>
              </div>
              <p className="text-xs text-slate-600 mt-3 text-center">Click any section above to view detailed analysis and AI-powered recommendations</p>
            </CardContent>
          </Card>

          {/* Executive Summary - AI-Generated Quick Overview (includes revenue
              optimization figures) — financial, admins only */}
          <FinancialGate>
            <OASISExecutiveSummary
              analysisResults={analysisResults}
              pdgmData={pdgmData}
            />
          </FinancialGate>

          {/* Auto-Generated Tasks Based on Analysis */}
          <OASISTaskGenerator
            analysisResults={analysisResults}
            pdgmData={pdgmData}
            patientId={selectedPatientId}
            patientName={patientName}
            onTasksCreated={() => {}}
          />

          {/* Export Manager — exports include revenue optimization fields; admins only */}
          <FinancialGate>
            <OASISExportManager
              analysisResults={analysisResults}
              pdgmData={pdgmData}
              revenueData={revenueData}
              navigationData={navigationData}
              qualityScore={qualityScore}
              patientName={patientName}
            />
          </FinancialGate>

          {/* Key Takeaways Summary (includes potential-revenue figures) — financial, admins only */}
          <FinancialGate>
            <KeyTakeawaysSummary analysisResults={analysisResults} revenueData={null} />
          </FinancialGate>

          {/* AI-Powered Automatic Document Review */}
          <AIDocumentReviewer
            oasisData={pdgmData}
            autoReview={true}
          />

          {/* Narrative-Question Match Analysis */}
          {analysisResults.narrative_match_analysis && (
           <Card className="border-2 border-navy-300">
             <CardHeader>
               <CardTitle className="text-lg flex items-center gap-2">
                 <ClipboardCheck className="w-5 h-5 text-navy-600" />
                 Narrative-Question Consistency Analysis
               </CardTitle>
             </CardHeader>
             <CardContent>
               <div className="grid grid-cols-3 gap-4 mb-4">
                 <div className="text-center p-3 bg-navy-50 rounded-lg border">
                   <p className="text-sm text-navy-600">Consistency Score</p>
                   <p className={`text-3xl font-bold ${analysisResults.narrative_match_analysis.consistency_analysis?.overall_consistency_score >= 80 ? 'text-green-600' : analysisResults.narrative_match_analysis.consistency_analysis?.overall_consistency_score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                     {analysisResults.narrative_match_analysis.consistency_analysis?.overall_consistency_score || 0}%
                   </p>
                 </div>
                 <div className="text-center p-3 bg-red-50 rounded-lg border">
                   <p className="text-sm text-red-600">Total Mismatches</p>
                   <p className="text-3xl font-bold text-red-700">
                     {analysisResults.narrative_match_analysis.consistency_analysis?.total_mismatches_found || 0}
                   </p>
                 </div>
                 <div className="text-center p-3 bg-orange-50 rounded-lg border">
                   <p className="text-sm text-orange-600">Critical Issues</p>
                   <p className="text-3xl font-bold text-orange-700">
                     {analysisResults.narrative_match_analysis.consistency_analysis?.critical_mismatches || 0}
                   </p>
                 </div>
               </div>

               {analysisResults.narrative_match_analysis.consistency_analysis?.mismatches?.length > 0 && (
                 <Accordion type="single" collapsible className="mt-4">
                   <AccordionItem value="mismatches">
                     <AccordionTrigger className="text-red-700">
                       <div className="flex items-center gap-2">
                         <AlertTriangle className="w-4 h-4" />
                         Narrative-Code Mismatches ({analysisResults.narrative_match_analysis.consistency_analysis.mismatches.length})
                       </div>
                     </AccordionTrigger>
                     <AccordionContent>
                       <div className="space-y-3">
                         {analysisResults.narrative_match_analysis.consistency_analysis.mismatches.map((mismatch, idx) => (
                           <div key={idx} className={`p-3 rounded-lg border ${
                             mismatch.severity === 'critical' ? 'bg-red-50 border-red-300' :
                             mismatch.severity === 'high' ? 'bg-orange-50 border-orange-300' :
                             'bg-yellow-50 border-yellow-300'
                           }`}>
                             <div className="flex items-center justify-between mb-2">
                               <Badge className="font-mono">{mismatch.m_item_code}</Badge>
                               <Badge className={getSeverityBadge(mismatch.severity)}>
                                 {mismatch.severity}
                               </Badge>
                             </div>
                             <p className="text-sm font-medium text-slate-800 mb-1">{mismatch.m_item_question}</p>

                             <div className="grid grid-cols-2 gap-2 my-2">
                               <div className="bg-white p-2 rounded border">
                                 <p className="text-xs text-slate-500">Coded Response:</p>
                                 <p className="text-sm font-medium text-red-700">{mismatch.coded_response}</p>
                               </div>
                               <div className="bg-white p-2 rounded border">
                                 <p className="text-xs text-slate-500">Should Be:</p>
                                 <p className="text-sm font-medium text-green-700">{mismatch.correct_response_should_be}</p>
                               </div>
                             </div>

                             <div className="bg-white p-2 rounded border my-2">
                               <p className="text-xs text-slate-500 mb-1">Narrative Quote:</p>
                               <p className="text-sm text-slate-700 italic">"{mismatch.narrative_quote}"</p>
                             </div>

                             <p className="text-sm text-slate-800 mb-2">{mismatch.explanation}</p>

                             <FinancialGate>
                               {mismatch.revenue_impact && (
                                 <div className="bg-emerald-50 p-2 rounded text-xs text-emerald-800 mb-1 flex items-start gap-1.5">
                                   <DollarSign className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                   <span>Revenue Impact: {mismatch.revenue_impact}</span>
                                 </div>
                               )}
                             </FinancialGate>

                             {mismatch.compliance_risk && (
                               <div className="bg-red-50 p-2 rounded text-xs text-red-800 mb-2 flex items-start gap-1.5">
                                 <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                 <span>Compliance Risk: {mismatch.compliance_risk}</span>
                               </div>
                             )}

                             <div className="bg-blue-50 p-2 rounded border border-blue-200">
                               <p className="text-xs text-blue-600 font-medium mb-1">Recommended Fix:</p>
                               <p className="text-sm text-blue-900">{mismatch.recommended_fix}</p>
                             </div>

                             {mismatch.exact_narrative_needed && (
                               <div className="bg-navy-50 p-2 rounded border border-navy-200 mt-2">
                                 <p className="text-xs text-navy-600 font-medium mb-1">Add This Narrative:</p>
                                 <p className="text-sm text-navy-900 italic">"{mismatch.exact_narrative_needed}"</p>
                               </div>
                             )}
                           </div>
                         ))}
                       </div>
                     </AccordionContent>
                   </AccordionItem>
                 </Accordion>
               )}

               {analysisResults.narrative_match_analysis.consistency_analysis?.missing_narratives?.length > 0 && (
                 <Alert className="mt-4 bg-yellow-50 border-yellow-300">
                   <AlertTriangle className="w-4 h-4 text-yellow-600" />
                   <AlertDescription className="text-yellow-800">
                     <p className="font-semibold mb-2">Missing Required Narratives ({analysisResults.narrative_match_analysis.consistency_analysis.missing_narratives.length})</p>
                     <ul className="space-y-1 text-sm">
                       {analysisResults.narrative_match_analysis.consistency_analysis.missing_narratives.slice(0, 5).map((missing, idx) => (
                         <li key={idx}>
                           <strong>{missing.m_item_code}</strong>: {missing.why_narrative_required}
                         </li>
                       ))}
                     </ul>
                   </AlertDescription>
                 </Alert>
               )}
             </CardContent>
           </Card>
          )}

          {/* Automated Document Reviewer - Compliance & Best Practices Scanner */}
          <AutomaticDocumentReviewer
            documentType="oasis_assessment"
            documentContent={JSON.stringify(pdgmData, null, 2) + '\n\n' + JSON.stringify(analysisResults, null, 2)}
            patientData={patients.find(p => p.id === selectedPatientId)}
            diagnosis={pdgmData?.primary_diagnosis}
            visitType={pdgmData?.patient_info?.assessment_type}
            autoReview={true}
            onReviewComplete={(reviewResults) => {
              logActivity(ActivityActions.NOTE_COMPLIANCE_CHECK, {
                document_type: 'oasis',
                overall_score: reviewResults.overall_score,
                compliance_score: reviewResults.compliance_score,
                critical_issues: reviewResults.critical_issues?.length || 0,
                patient_id: selectedPatientId,
                page: 'OASISAnalyzer'
              });
            }}
            compact={false}
          />

          {/* Score Overview */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Analysis Results</CardTitle>
              <Button variant="outline" size="sm" onClick={handleDownloadReport} disabled={isDownloading}>
                {isDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating PDF...
                  </>
                ) : (
                  <>
                    <FileDown className="w-4 h-4 mr-2" />
                    Download PDF Report
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <Alert className="bg-amber-50 border-amber-300 mb-4">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-800 text-sm">
                  <span className="font-semibold">AI-generated estimates.</span> These scores are produced by an AI model from the assessment text — they are not an official OASIS/PDGM determination and do not guarantee coverage or reimbursement. A clinician must verify every M-item before submission.
                </AlertDescription>
              </Alert>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`p-4 rounded-lg border-2 ${getScoreBg(analysisResults.overall_score)}`}>
                  <p className="text-xs text-slate-600 mb-1">Overall Score (est.)</p>
                  <p className={`text-3xl font-bold ${getScoreColor(analysisResults.overall_score)}`}>
                    {analysisResults.overall_score}%
                  </p>
                </div>
                <div className={`p-4 rounded-lg border-2 ${getScoreBg(analysisResults.accuracy_score)}`}>
                  <p className="text-xs text-slate-600 mb-1">Accuracy (est.)</p>
                  <p className={`text-3xl font-bold ${getScoreColor(analysisResults.accuracy_score)}`}>
                    {analysisResults.accuracy_score}%
                  </p>
                </div>
                <div className={`p-4 rounded-lg border-2 ${getScoreBg(analysisResults.compliance_score)}`}>
                  <p className="text-xs text-slate-600 mb-1">Compliance (est.)</p>
                  <p className={`text-3xl font-bold ${getScoreColor(analysisResults.compliance_score)}`}>
                    {analysisResults.compliance_score}%
                  </p>
                </div>
                <FinancialGate>
                  <div className={`p-4 rounded-lg border-2 ${getScoreBg(analysisResults.revenue_optimization_score)}`}>
                    <p className="text-xs text-slate-600 mb-1">Revenue Optimization (est.)</p>
                    <p className={`text-3xl font-bold ${getScoreColor(analysisResults.revenue_optimization_score)}`}>
                      {analysisResults.revenue_optimization_score}%
                    </p>
                  </div>
                </FinancialGate>
              </div>

              {/* Summary */}
              <Alert className="bg-blue-50 border-blue-200 mb-4">
                <Info className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  {analysisResults.summary}
                </AlertDescription>
              </Alert>

              {/* Validation Summary */}
              {analysisResults.validation_summary && (
                <div className={`p-4 rounded-lg border-2 mb-4 ${
                  analysisResults.validation_summary.critical_issues_found > 0 
                    ? 'bg-red-50 border-red-300' 
                    : analysisResults.validation_summary.warnings_found > 0
                      ? 'bg-yellow-50 border-yellow-300'
                      : 'bg-green-50 border-green-300'
                }`}>
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    {analysisResults.validation_summary.critical_issues_found > 0 ? (
                      <><AlertTriangle className="w-4 h-4 text-red-600" /> Data Validation Issues Found</>
                    ) : analysisResults.validation_summary.warnings_found > 0 ? (
                      <><AlertTriangle className="w-4 h-4 text-yellow-600" /> Validation Warnings</>
                    ) : (
                      <><CheckCircle2 className="w-4 h-4 text-green-600" /> Validation Passed</>
                    )}
                    <Badge variant="outline" className="ml-auto">
                      Quality: {analysisResults.validation_summary.data_quality_score}%
                    </Badge>
                  </h3>
                  {analysisResults.validation_summary.recommendation && (
                    <p className="text-sm text-slate-700 mb-2">{analysisResults.validation_summary.recommendation}</p>
                  )}
                  {/* PDGM Readiness Summary */}
                  {analysisResults.validation_summary.pdgm_readiness && (
                    <div className={`mt-3 p-2 rounded border ${
                      analysisResults.validation_summary.pdgm_readiness.ready_for_grouping 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-orange-50 border-orange-200'
                    }`}>
                      <p className="text-xs font-semibold mb-1">
                        {analysisResults.validation_summary.pdgm_readiness.ready_for_grouping 
                          ? '✓ Ready for PDGM Grouping' 
                          : '⚠ PDGM Data Issues Detected'}
                      </p>
                      {analysisResults.validation_summary.pdgm_readiness.missing_critical_elements?.length > 0 && (
                        <div className="text-xs text-orange-800">
                          <span className="font-medium">Missing: </span>
                          {analysisResults.validation_summary.pdgm_readiness.missing_critical_elements.join(', ')}
                        </div>
                      )}
                      {analysisResults.validation_summary.pdgm_readiness.optimization_opportunities?.length > 0 && (
                        <div className="text-xs text-blue-700 mt-1">
                          <span className="font-medium">Optimize: </span>
                          {analysisResults.validation_summary.pdgm_readiness.optimization_opportunities.slice(0, 2).join('; ')}
                        </div>
                      )}
                    </div>
                  )}

                  {analysisResults.validation_summary.issues?.length > 0 && (
                    <div className="space-y-2 mt-3">
                      {analysisResults.validation_summary.issues.slice(0, 5).map((issue, idx) => (
                        <div key={idx} className="bg-white p-2 rounded border text-sm">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge className={issue.severity === 'critical' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}>
                              {issue.severity}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {issue.type?.replace('_', ' ')}
                            </Badge>
                            {issue.item && <span className="font-mono text-xs bg-slate-100 px-1 rounded">{issue.item}</span>}
                          </div>
                          <p className="text-slate-700">{issue.description}</p>
                          {issue.pdgm_impact && (
                            <p className="text-navy-700 text-xs mt-1">
                              <span className="font-medium">PDGM Impact:</span> {issue.pdgm_impact}
                            </p>
                          )}
                          {issue.suggested_correction && (
                            <p className="text-green-700 text-xs mt-1 bg-green-50 p-1 rounded">
                              <span className="font-medium">Fix:</span> {issue.suggested_correction}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Key Recommendations */}
              {analysisResults.key_recommendations?.length > 0 && (
                <div className="bg-gradient-to-r from-indigo-50 to-navy-50 p-4 rounded-lg border border-indigo-200 mb-4">
                  <h3 className="font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Key Recommendations
                  </h3>
                  <ol className="space-y-2">
                    {analysisResults.key_recommendations.map((rec, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-indigo-800">
                        <span className="bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">
                          {idx + 1}
                        </span>
                        {rec}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Strengths */}
              {analysisResults.strengths?.length > 0 && (
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <h3 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Strengths
                  </h3>
                  <ul className="space-y-1">
                    {analysisResults.strengths.map((strength, idx) => (
                      <li key={idx} className="text-sm text-green-800 flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3" />
                        {strength}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PDGM payment tools (navigator, case-mix $, impact, revenue) — financial, admins only */}
          <FinancialGate>
          {/* Automated PDGM Navigator */}
          <AutomatedPDGMNavigator
            analysisResults={analysisResults} 
            pdgmData={pdgmData}
            revenueData={null}
            onNavigationComplete={(navData) => setNavigationData(navData)}
          />

          {/* Enhanced Case-Mix Component Analyzer */}
          {navigationData && (
            <EnhancedPDGMCaseMixAnalyzer
              pdgmData={pdgmData}
              navigationData={navigationData}
            />
          )}

          {/* PDGM Impact Analyzer */}
          {analysisResults?.specific_rescore_opportunities?.length > 0 && (
            <PDGMImpactAnalyzer
              currentPdgmData={pdgmData}
              suggestedChanges={{
                functional_improvements: analysisResults.specific_rescore_opportunities
                  ?.filter(opp => opp.category === 'functional')
                  ?.reduce((acc, opp) => {
                    if (opp.m_item && opp.suggested_score !== undefined) {
                      acc[opp.m_item] = opp.suggested_score;
                    }
                    return acc;
                  }, {}),
                comorbidity_additions: analysisResults.specific_rescore_opportunities
                  ?.filter(opp => opp.category === 'comorbidity')
                  ?.map(opp => opp.comorbidity),
                clinical_items: {}
              }}
              onAnalysisComplete={() => {
              }}
            />
          )}

          {/* PDGM Revenue Analysis */}
          <PDGMRevenueComparison 
            analysisResults={analysisResults} 
            pdgmData={pdgmData}
            onPaymentCalculated={(payment) => setOriginalPayment(payment)}
            onRevenueCalculated={(revData) => setRevenueData(revData)}
          />

          </FinancialGate>

          {/* Scenario Planning & Action Workflow — payment scenarios; financial, admins only */}
          <FinancialGate>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <OASISScenarioManager
              analysisId={analysisId}
              originalPdgmData={pdgmData}
              originalPayment={originalPayment || 0}
              patientName={patientName}
              onCreateActions={() => {
                // Trigger action creation from scenarios
              }}
            />
            <OASISActionWorkflow
              analysisId={analysisId}
              analysisResults={analysisResults}
              pdgmData={pdgmData}
              originalPayment={originalPayment || 0}
              patientName={patientName}
            />
          </div>
          </FinancialGate>

          {/* Smart Note Data Import - Bi-directional sync */}
          <SmartNoteDataImport
            patientId={selectedPatientId}
            patientName={patientName}
            onImportData={(importData) => {
              // Apply imported functional observations to PDGM data for comparison
              if (importData.functionalObservations && pdgmData) {
                const obs = importData.functionalObservations;
                const updatedScores = { ...pdgmData.functional_scores };
                if (obs.ambulation?.score !== undefined) {
                  updatedScores.m1860_ambulation = obs.ambulation.score;
                }
                if (obs.transfer?.score !== undefined) {
                  updatedScores.m1850_transferring = obs.transfer.score;
                }
                if (obs.bathing?.score !== undefined) {
                  updatedScores.m1830_bathing = obs.bathing.score;
                }
                setPdgmData(prev => ({
                  ...prev,
                  functional_scores: updatedScores,
                  _importedFromVisit: importData.visitDate
                }));
              }
            }}
          />

          {/* Multi-Report Comparison — revenue summaries/chart/column; financial, admins only */}
          <FinancialGate>
            <EnhancedMultiReportComparison
              savedReports={savedBatchResults}
              currentReport={analysisResults}
              currentPdgmData={pdgmData}
            />
          </FinancialGate>

          {/* AI Documentation Generator - Generate Draft Clinical Text */}
          <AIDocumentationGenerator
            analysisResults={analysisResults}
            pdgmData={pdgmData}
            navigationData={navigationData}
          />

          {/* AI Proactive Documentation Assistant - Most Important for Real-Time Help */}
          <AIProactiveDocumentationAssistant
            analysisResults={analysisResults}
            pdgmData={pdgmData}
            navigationData={navigationData}
            qualityScore={qualityScore}
          />

          {/* AI Documentation Quality Scorer - Full Width */}
          <OASISDocumentationQualityScorer 
            analysisResults={analysisResults} 
            pdgmData={pdgmData}
            onQualityScoreComplete={(score) => setQualityScore(score)}
          />

          {/* AI Documentation Quality Analyzer - Full Width */}
          <AIDocumentationQualityAnalyzer analysisResults={analysisResults} pdgmData={pdgmData} />

          {/* AI Documentation Assistant & Audit Risk Predictor */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AIDocumentationAssistant 
              analysisResults={analysisResults} 
              pdgmData={pdgmData}
              onInsertText={() => {}}
            />
            <AIAuditRiskPredictor 
              analysisResults={analysisResults} 
              patientId={selectedPatientId}
            />
          </div>

          {/* AI Pathway Recommender - Proactive pathway suggestions */}
          <AIPathwayRecommender
            pdgmData={pdgmData}
            analysisResults={analysisResults}
            navigationData={navigationData}
            patientId={selectedPatientId}
            onPathwaysActivated={(pathways) => {
              setTriggeredPathways(pathways);
            }}
          />

          {/* Clinical Pathway Trigger - Existing pathway matching */}
          <ClinicalPathwayTrigger
            pdgmData={pdgmData}
            analysisResults={analysisResults}
            patientId={selectedPatientId}
            onTasksCreated={() => {}}
            onPathwaysTriggered={(pathways) => setTriggeredPathways(pathways)}
          />

          {/* PDGM Predictive Forecaster — revenue forecast; financial, admins only */}
          <FinancialGate>
          <PDGMPredictiveForecaster
            pdgmData={pdgmData}
            analysisResults={analysisResults}
            currentPayment={originalPayment}
            triggeredPathways={triggeredPathways}
          />
          </FinancialGate>

          {/* OASIS Validation Panel - Full Width for Prominence */}
          <OASISValidationPanel 
            pdgmData={pdgmData} 
            analysisResults={analysisResults}
          />

          {/* AI-Enhanced Insights Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Audit Risk Predictor */}
            <AuditRiskPredictor analysisResults={analysisResults} />
            
            {/* Documentation Quality Suggestions */}
            <DocumentationQualitySuggestions analysisResults={analysisResults} />
          </div>

          {/* Detailed Analysis Accordion */}
          <Accordion type="multiple" className="space-y-2">
            {/* Accuracy Issues */}
            {analysisResults.accuracy_issues?.length > 0 && (
              <AccordionItem value="accuracy" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-600" />
                    <span>Accuracy Issues ({analysisResults.accuracy_issues.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                    {analysisResults.accuracy_issues.map((issue, idx) => (
                     <div key={idx} className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                       <div className="flex items-center justify-between mb-2">
                         <Badge variant="outline" className="font-mono">{issue.item}</Badge>
                         <Badge className={getSeverityBadge(issue.severity)}>{issue.severity}</Badge>
                       </div>
                       <p className="text-sm text-slate-800 mb-2">{issue.issue}</p>
                       <div className="bg-white p-2 rounded border">
                         <p className="text-xs text-slate-500 mb-1">Recommendation:</p>
                         <p className="text-sm text-green-700">{issue.recommendation}</p>
                       </div>
                       <InlineDocumentationAssistant 
                         issue={issue} 
                         issueType="accuracy"
                         pdgmData={pdgmData}
                       />
                     </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Compliance Concerns */}
            {analysisResults.compliance_concerns?.length > 0 && (
              <AccordionItem value="compliance" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-600" />
                    <span>Compliance Concerns ({analysisResults.compliance_concerns.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                    {analysisResults.compliance_concerns.map((concern, idx) => (
                     <div key={idx} className="p-3 bg-red-50 rounded-lg border border-red-200">
                       <div className="flex items-center justify-between mb-2">
                         <span className="font-semibold text-red-900">{concern.area}</span>
                         <Badge className={getSeverityBadge(concern.severity)}>{concern.severity}</Badge>
                       </div>
                       <p className="text-sm text-slate-800 mb-2">{concern.issue}</p>
                       {concern.cms_reference && (
                         <p className="text-xs text-slate-500 mb-2">CMS Reference: {concern.cms_reference}</p>
                       )}
                       <div className="bg-white p-2 rounded border">
                         <p className="text-xs text-slate-500 mb-1">Recommendation:</p>
                         <p className="text-sm text-green-700">{concern.recommendation}</p>
                       </div>
                       <InlineDocumentationAssistant 
                         issue={concern} 
                         issueType="compliance"
                         pdgmData={pdgmData}
                       />
                     </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Revenue Tips — revenue optimization; financial, admins only */}
            <FinancialGate>
            {analysisResults.revenue_tips?.length > 0 && (
              <AccordionItem value="revenue" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    <span>Revenue Optimization Tips ({analysisResults.revenue_tips.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                    {analysisResults.revenue_tips.map((tip, idx) => (
                     <div key={idx} className="p-3 bg-green-50 rounded-lg border border-green-200">
                       <div className="flex items-center justify-between mb-2">
                         <Badge variant="outline" className="bg-white">{tip.category}</Badge>
                         <Badge className={`${tip.potential_impact === 'high' ? 'bg-green-600' : tip.potential_impact === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'} text-white`}>
                           <TrendingUp className="w-3 h-3 mr-1" />
                           {tip.potential_impact} impact
                         </Badge>
                       </div>
                       <div className="space-y-2 text-sm">
                         <div>
                           <p className="text-xs text-slate-500">Current Documentation:</p>
                           <p className="text-slate-700">{tip.current_documentation}</p>
                         </div>
                         <div>
                           <p className="text-xs text-slate-500">Opportunity:</p>
                           <p className="text-green-700">{tip.opportunity}</p>
                         </div>
                         <div className="bg-white p-2 rounded border">
                           <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                             <Lightbulb className="w-3 h-3 text-yellow-500" />
                             Specific Action:
                           </p>
                           <p className="text-green-800 font-medium">{tip.specific_action}</p>
                         </div>
                       </div>
                       <InlineDocumentationAssistant 
                         issue={tip} 
                         issueType="revenue"
                         pdgmData={pdgmData}
                       />
                     </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
            </FinancialGate>

            {/* Audit Risk Areas */}
            {analysisResults.audit_risk_areas?.length > 0 && (
              <AccordionItem value="audit" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600" />
                    <span>Audit Risk Areas ({analysisResults.audit_risk_areas.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                    {analysisResults.audit_risk_areas.map((risk, idx) => (
                      <div key={idx} className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-orange-900">{risk.area}</span>
                          <Badge className={getSeverityBadge(risk.risk_level)}>{risk.risk_level} risk</Badge>
                        </div>
                        <p className="text-sm text-slate-800 mb-2">{risk.explanation}</p>
                        <div className="bg-white p-2 rounded border">
                          <p className="text-xs text-slate-500 mb-1">Mitigation:</p>
                          <p className="text-sm text-green-700">{risk.mitigation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Documentation Improvements */}
            {analysisResults.documentation_improvements?.length > 0 && (
              <AccordionItem value="improvements" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-blue-600" />
                    <span>Documentation Improvements ({analysisResults.documentation_improvements.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                    {analysisResults.documentation_improvements.map((imp, idx) => (
                     <div key={idx} className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                       <div className="flex items-center justify-between mb-2">
                         <p className="font-semibold text-blue-900">{imp.item}</p>
                         {imp.m_item_impact && (
                           <Badge className="bg-navy-100 text-navy-800 text-xs">
                             Affects: {imp.m_item_impact}
                           </Badge>
                         )}
                       </div>
                       <div className="grid md:grid-cols-2 gap-3">
                         <div className="bg-red-50 p-2 rounded border border-red-200">
                           <p className="text-xs text-red-600 mb-1">Current:</p>
                           <p className="text-sm text-red-800">{imp.current_state}</p>
                         </div>
                         <div className="bg-green-50 p-2 rounded border border-green-200">
                           <p className="text-xs text-green-600 mb-1">Improved:</p>
                           <p className="text-sm text-green-800">{imp.improved_state}</p>
                         </div>
                       </div>
                       {imp.exact_text_to_add && (
                         <div className="mt-2 p-2 bg-white rounded border border-blue-300">
                           <p className="text-xs text-blue-600 mb-1 font-medium flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Exact Text to Add:</p>
                           <p className="text-sm text-blue-900 italic">"{imp.exact_text_to_add}"</p>
                         </div>
                       )}
                       <p className="text-xs text-slate-600 mt-2 italic">{imp.rationale}</p>
                       <InlineDocumentationAssistant 
                         issue={imp} 
                         issueType="documentation_improvement"
                         pdgmData={pdgmData}
                       />
                     </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Specific Rescore Opportunities */}
            {analysisResults.specific_rescore_opportunities?.length > 0 && (
              <AccordionItem value="rescore" className="border rounded-lg border-green-300">
                <AccordionTrigger className="px-4 hover:no-underline bg-green-50 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                    <span className="text-green-800">Rescore Opportunities ({analysisResults.specific_rescore_opportunities.length})</span>
                    <FinancialGate><Badge className="bg-emerald-600 text-white ml-2"><DollarSign className="w-3 h-3 mr-1" />Revenue Impact</Badge></FinancialGate>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                    {analysisResults.specific_rescore_opportunities.map((opp, idx) => (
                     <div key={idx} className="p-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-300">
                       <div className="flex items-center justify-between mb-2">
                         <Badge className="bg-green-700 text-white font-mono">{opp.m_item}</Badge>
                         <FinancialGate>
                         {opp.revenue_impact && (
                           <Badge className="bg-emerald-600 text-white">{opp.revenue_impact}</Badge>
                         )}
                         </FinancialGate>
                       </div>
                       <div className="grid grid-cols-2 gap-2 mb-2">
                         <div className="bg-red-100 p-2 rounded text-center">
                           <p className="text-xs text-red-600">Current Score</p>
                           <p className="text-xl font-bold text-red-800">{opp.current_score}</p>
                         </div>
                         <div className="bg-green-100 p-2 rounded text-center">
                           <p className="text-xs text-green-600">Recommended Score</p>
                           <p className="text-xl font-bold text-green-800">{opp.recommended_score}</p>
                         </div>
                       </div>
                       <div className="bg-white p-2 rounded border mb-2">
                         <p className="text-xs text-slate-500 mb-1">Clinical Evidence:</p>
                         <p className="text-sm text-slate-800">{opp.clinical_evidence}</p>
                       </div>
                       <div className="bg-blue-50 p-2 rounded border border-blue-200">
                         <p className="text-xs text-blue-600 mb-1 font-medium flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Action Required:</p>
                         <p className="text-sm text-blue-900">{opp.action_required}</p>
                       </div>
                       <InlineDocumentationAssistant 
                         issue={opp} 
                         issueType="rescore"
                         pdgmData={pdgmData}
                       />
                     </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Missing High-Value Documentation */}
            {analysisResults.missing_high_value_documentation?.length > 0 && (
              <AccordionItem value="missing-docs" className="border rounded-lg border-amber-300">
                <AccordionTrigger className="px-4 hover:no-underline bg-amber-50 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span className="text-amber-800">Missing High-Value Documentation ({analysisResults.missing_high_value_documentation.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                    {analysisResults.missing_high_value_documentation.map((doc, idx) => (
                     <div key={idx} className="p-3 bg-amber-50 rounded-lg border border-amber-300">
                       <div className="flex items-center justify-between mb-2">
                         <p className="font-semibold text-amber-900">{doc.area}</p>
                         {doc.potential_value && (
                           <Badge className="bg-amber-600 text-white">{doc.potential_value}</Badge>
                         )}
                       </div>
                       <p className="text-sm text-slate-700 mb-2">{doc.why_it_matters}</p>
                       {doc.suggested_text && (
                         <div className="bg-white p-2 rounded border border-amber-200">
                           <p className="text-xs text-amber-600 mb-1 font-medium flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Suggested Documentation:</p>
                           <p className="text-sm text-slate-800 italic">"{doc.suggested_text}"</p>
                         </div>
                       )}
                       <InlineDocumentationAssistant 
                         issue={doc} 
                         issueType="missing_documentation"
                         pdgmData={pdgmData}
                       />
                     </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Quick Wins */}
            {analysisResults.quick_wins?.length > 0 && (
              <AccordionItem value="quick-wins" className="border rounded-lg border-navy-300">
                <AccordionTrigger className="px-4 hover:no-underline bg-navy-50 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-navy-600" />
                    <span className="text-navy-800">Quick Wins ({analysisResults.quick_wins.length})</span>
                    <Badge className="bg-navy-600 text-white ml-2">Easy Improvements</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                    {analysisResults.quick_wins.map((win, idx) => (
                      <div key={idx} className="p-3 bg-navy-50 rounded-lg border border-navy-200">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-semibold text-navy-900">{win.action}</p>
                          <div className="flex gap-2">
                            <Badge className={win.effort === 'low' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
                              {win.effort} effort
                            </Badge>
                          </div>
                        </div>
                        {/* Financial/revenue impact — hidden from non-admins (clinicians still see the action + how-to). */}
                        <FinancialGate>
                          <p className="text-sm text-emerald-700 mb-2 flex items-center gap-1.5"><DollarSign className="w-4 h-4" /> Impact: {win.impact}</p>
                        </FinancialGate>
                        {win.how_to && (
                          <div className="bg-white p-2 rounded border">
                            <p className="text-xs text-navy-600 mb-1 font-medium">How to do it:</p>
                            <p className="text-sm text-slate-800">{win.how_to}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Clinician Questions */}
            {analysisResults.clinician_questions?.length > 0 && (
              <AccordionItem value="questions" className="border rounded-lg border-indigo-300">
                <AccordionTrigger className="px-4 hover:no-underline bg-indigo-50 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-indigo-600" />
                    <span className="text-indigo-800">Questions for Clinician ({analysisResults.clinician_questions.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                    <p className="text-xs text-indigo-700 mb-3">Ask the assessing clinician these questions to clarify scoring:</p>
                    <ol className="space-y-2">
                      {analysisResults.clinician_questions.map((question, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-indigo-900">
                          <span className="bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">
                            {idx + 1}
                          </span>
                          {question}
                        </li>
                      ))}
                    </ol>
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
            </Accordion>
        </div>
      )}
        </TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}