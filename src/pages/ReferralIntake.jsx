import { useState, useEffect, lazy, Suspense } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Eye,
  User,
  RefreshCw,
  Sparkles,
  ClipboardCheck,
  ClipboardList,
  Target,
  Trash2,
  UserCheck,
  Loader2
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import LoadingState from "@/components/ui/LoadingState";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { todayEastern } from "@/components/utils/timezone";
import { Link, useSearchParams } from "react-router-dom";
import ReferralPDFSummarizer from "../components/referral/ReferralPDFSummarizer";
import { validateReferralFile, getDocumentType } from "../components/referral/referralUploadUtils";
import { runReferralQuickScan } from "../components/referral/referralExtraction";
import PatientMatchReview from "../components/referral/PatientMatchReview";
import AIReferralCarePlanGenerator from "../components/referral/AIReferralCarePlanGenerator";
import PatientVerificationStep from "../components/referral/PatientVerificationStep";
import MultiReferralDetector from "../components/referral/MultiReferralDetector";

const ReferralProcessor = lazy(() => import("@/components/hub-tabs/ReferralProcessor"));
const ReferralAdmissionNote = lazy(() => import("@/components/hub-tabs/ReferralAdmissionNote"));

// Tab keys for the referral intake workflow hub. Kept in sync with the
// TabsTrigger values below and used to validate the ?tab= deep-link so the
// retired standalone pages (Referral Processor, Referral Admission Note)
// redirect straight to the right tab.
const TAB_KEYS = ["intake", "process", "admission"];

export default function ReferralIntake() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "intake";
  // Reflect the active tab in the URL so workflow tabs are shareable/bookmarkable
  // and redirects from the retired pages deep-link correctly. "intake" is the
  // default, so it stays a clean /ReferralIntake with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "intake" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= so the
  // default tab is plain /ReferralIntake. Only fires when the param resolved to
  // the default tab, leaving a valid deep-link like ?tab=process untouched.
  useEffect(() => {
    if (requestedTab !== null && activeTab === "intake") {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, setSearchParams]);

  const queryClient = useQueryClient();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [processingReferralId, setProcessingReferralId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [matchReviewReferral, setMatchReviewReferral] = useState(null);
  const [verificationReferral, setVerificationReferral] = useState(null);

  // New referral form state
  const [newReferral, setNewReferral] = useState({
    patient_name: "",
    referral_source: "",
    referral_date: todayEastern(),
    document_type: "pdf",
    priority: "normal",
    estimated_start_date: ""
  });
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [extractedFormData, setExtractedFormData] = useState(null);
  const [multiReferralDetection, setMultiReferralDetection] = useState(null);
  const [_processingMultipleReferrals, setProcessingMultipleReferrals] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  // Reset to the first page whenever the filters change, otherwise a high currentPage
  // can slice past the now-shorter filtered list and show an empty table with the
  // pager hidden (no way to recover).
  useEffect(() => { setCurrentPage(1); }, [statusFilter, priorityFilter]);
  const REFERRALS_PER_PAGE = 15;
  const [referralToDelete, setReferralToDelete] = useState(null);
  const [referralToReject, setReferralToReject] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: referrals = [], isLoading } = useQuery({
    queryKey: ['referrals'],
    queryFn: () => base44.entities.Referral.list('-created_date', 200),
    initialData: [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const { valid, error } = validateReferralFile(file);
    if (!valid) {
      toast.error(error);
      return;
    }

    setIsUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadedFile(file_url);
      // Auto-classify the document type (pdf vs scanned image) from the file.
      // Use the resolved type so PDFs from sources that leave file.type empty
      // (some scanners/fax servers) still take the multi-referral path.
      const docType = getDocumentType(file);
      setNewReferral(prev => ({ ...prev, document_type: docType }));

      // If it's a PDF, check for multiple referrals
      if (docType === 'pdf') {
        setMultiReferralDetection({ fileUrl: file_url, fileName: file.name });
        setIsUploading(false);
        return;
      }
      
      // Immediately extract data for instant form pre-population + urgency triage.
      // Uses the shared quick-scan definition (single source of truth) wrapped in
      // the standard retry/timeout policy.
      const extracted = await runReferralQuickScan(invokeLLM, { fileUrl: file_url });

      setExtractedFormData(extracted);
      
      // Auto-populate form with comprehensive extracted data
      if (extracted.patient_name) {
        setNewReferral(prev => ({
          ...prev,
          patient_name: extracted.patient_name || prev.patient_name,
          referral_source: extracted.referral_source || prev.referral_source,
          referral_date: extracted.referral_date || prev.referral_date,
          priority: extracted.urgency_level || prev.priority,
          diagnosis: extracted.primary_diagnosis,
          category: extracted.category,
          urgency_factors: extracted.urgency_factors,
          suggested_tasks: extracted.suggested_initial_tasks,
          suggested_care_plans: extracted.suggested_care_plans
        }));
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload file. Please try again.');
    }
    setIsUploading(false);
  };

  const handleMultiReferralDetectionComplete = async (analysis, selectedIndices) => {
    setProcessingMultipleReferrals(true);
    try {
      // Create referrals for each selected document.
      const selected = (analysis.referrals || []).filter(r => selectedIndices?.includes(r.index));
      // Single-referral PDF (or nothing individually selected): create ONE referral
      // from the whole document so a single-referral PDF is never stuck in the dialog.
      const isSingle = selected.length === 0;
      const docs = isSingle
        ? [{
            patient_name: analysis.referrals?.[0]?.patient_name || newReferral.patient_name || '',
            referral_source: analysis.referrals?.[0]?.referral_source || newReferral.referral_source || '',
            referral_date: analysis.referrals?.[0]?.referral_date || todayEastern(),
            estimated_start_page: analysis.referrals?.[0]?.estimated_start_page,
            estimated_end_page: analysis.referrals?.[0]?.estimated_end_page,
            confidence: analysis.referrals?.[0]?.confidence,
          }]
        : selected;

      // Independent inserts — create concurrently rather than one-by-one.
      await Promise.all(docs.map((referral) => {
        const hasPages = referral.estimated_start_page != null && referral.estimated_end_page != null;
        const payload = {
          patient_name: referral.patient_name || '',
          referral_source: referral.referral_source || '',
          referral_date: referral.referral_date || todayEastern(),
          document_type: 'pdf',
          priority: 'normal',
          document_url: multiReferralDetection.fileUrl,
          status: 'new',
        };
        // page_range / detection_confidence are only meaningful for a multi-document
        // split; omit them (rather than writing "null-null") for a single referral.
        if (hasPages) payload.page_range = `${referral.estimated_start_page}-${referral.estimated_end_page}`;
        if (referral.confidence != null) payload.detection_confidence = referral.confidence;
        if (!isSingle) {
          // Record the split provenance in the schema's structured follow_up_notes
          // array (`notes` is not a Referral field and would be silently dropped).
          payload.follow_up_notes = [{
            date: new Date().toISOString(),
            note: `Extracted from multi-document PDF: ${multiReferralDetection.fileName}.${hasPages ? ` Pages ${referral.estimated_start_page}-${referral.estimated_end_page}` : ''}`,
            created_by: currentUser?.email || 'system',
          }];
        }
        return base44.entities.Referral.create(payload);
      }));

      // Reset form
      setMultiReferralDetection(null);
      setUploadedFile(null);
      setNewReferral({
        patient_name: "",
        referral_source: "",
        referral_date: todayEastern(),
        document_type: "pdf",
        priority: "normal",
        estimated_start_date: ""
      });
      setUploadDialogOpen(false);

      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      toast.success(isSingle
        ? 'Referral created from PDF. It is ready for processing.'
        : `Successfully created ${docs.length} referral${docs.length !== 1 ? 's' : ''} from multi-document PDF. They are ready for processing.`);
    } catch (error) {
      console.error('Error processing referrals:', error);
      toast.error('Failed to create referrals. Please try again.');
    } finally {
      setProcessingMultipleReferrals(false);
    }
  };

  const handleCreateReferral = async () => {
    if (!uploadedFile) {
      toast.error('Please upload a referral document first');
      return;
    }

    setIsUploading(true);
    try {
      // Create referral with AI-enhanced categorization and suggestions
      const referral = await base44.entities.Referral.create({
        ...newReferral,
        document_url: uploadedFile,
        status: 'new',
        ai_generated_tasks: extractedFormData?.suggested_initial_tasks || [],
        extracted_data: extractedFormData ? {
          demographics: {
            full_name: extractedFormData.patient_name,
            date_of_birth: extractedFormData.patient_dob,
            phone: extractedFormData.patient_phone,
            address: extractedFormData.patient_address
          },
          diagnoses: {
            primary_diagnosis: extractedFormData.primary_diagnosis,
            secondary_diagnoses: extractedFormData.secondary_diagnoses || [],
            icd10_codes: extractedFormData.icd10_codes || []
          },
          clinical_category: extractedFormData.category,
          urgency_assessment: {
            urgency_level: extractedFormData.urgency_level,
            urgency_factors: extractedFormData.urgency_factors || [],
            clinical_urgency_score: extractedFormData.clinical_urgency_score || 0,
            administrative_urgency_score: extractedFormData.administrative_urgency_score || 0
          },
          care_needs: {
            skilled_nursing: extractedFormData.skilled_nursing_needs || [],
            therapy_requirements: extractedFormData.therapy_requirements || [],
            dme_needs: extractedFormData.dme_needs || [],
            medication_management: extractedFormData.medication_management || false,
            wound_care: extractedFormData.wound_care_needed || false,
            iv_therapy: extractedFormData.iv_therapy_needed || false
          },
          suggested_care_plans: extractedFormData.suggested_care_plans || []
        } : null
      });

      // Automatically start processing
      setProcessingReferralId(referral.id);
      setUploadDialogOpen(false);
      
      // Reset form
      setNewReferral({
        patient_name: "",
        referral_source: "",
        referral_date: todayEastern(),
        document_type: "pdf",
        priority: "normal",
        estimated_start_date: ""
      });
      setUploadedFile(null);
      setExtractedFormData(null);

      queryClient.invalidateQueries({ queryKey: ['referrals'] });
    } catch (error) {
      console.error('Error creating referral:', error);
      toast.error('Failed to create referral. Please try again.');
    }
    setIsUploading(false);
  };

  const _handleStatusChange = async (referralId, newStatus) => {
    try {
      await base44.entities.Referral.update(referralId, { status: newStatus });
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
    }
  };

  const handleNurseAssignment = async (referralId, nurseEmail) => {
    if (nurseEmail === 'unassigned') {
      try {
        await base44.entities.Referral.update(referralId, { assigned_to: null });
        queryClient.invalidateQueries({ queryKey: ['referrals'] });
      } catch (error) {
        console.error('Error unassigning nurse:', error);
      }
      return;
    }

    try {
      const referral = referrals.find(r => r.id === referralId);
      if (!referral) return;
      const nurse = users.find(u => u.email === nurseEmail);

      await base44.entities.Referral.update(referralId, { assigned_to: nurseEmail });

      // Send secure message to assigned nurse with PROCESSED PDF document (not original upload)
      const attachmentUrl = referral.processed_document_url || referral.document_url;
      const messageData = {
        patient_id: referral.patient_id,
        thread_id: `referral-${referralId}`,
        subject: `New Referral Assignment: ${referral.patient_name || 'Unknown Patient'}`,
        message_text: `You have been assigned a new referral.

Patient: ${referral.patient_name || 'Unknown'}
Referral Source: ${referral.referral_source || 'N/A'}
Priority: ${referral.priority}
Referral Date: ${referral.referral_date ? format(new Date(referral.referral_date), 'MM/dd/yyyy') : 'N/A'}

${referral.extracted_data ? 'Referral has been processed with AI analysis and formatted into an admission packet.' : 'Please process this referral to extract patient information.'}

Actions available:
• View analyzed referral data
• Create admission note in Smart Note (prepopulated with referral info)
• Review patient information

📎 ${referral.processed_document_url ? 'AI-processed admission packet PDF is attached.' : 'Referral document is attached.'}`,
        sender_name: 'System',
        sender_email: currentUser?.email,
        recipients: [nurseEmail],
        priority: referral.priority === 'urgent' ? 'urgent' : 'high',
        attachments: attachmentUrl ? [attachmentUrl] : [],
        related_event_id: referralId,
        related_event_type: 'referral'
      };

      await base44.entities.Message.create(messageData);
      
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      
      toast.success(`Referral assigned to ${nurse?.full_name || nurseEmail}. Secure message sent.`);
    } catch (error) {
      console.error('Error assigning nurse:', error);
      toast.error('Failed to assign nurse');
    }
  };

  const handleProcessingComplete = async (referralId, extractedData, analysisResults, generatedPdfUrl = null) => {
    try {
      // Comprehensive AI-powered referral analysis
      const [priorityResponse, intakeAnalysisResponse] = await Promise.all([
        base44.functions.invoke('analyzeReferralPriority', {
          extractedData,
          analysisResults
        }),
        base44.functions.invoke('analyzeReferralIntake', {
          extractedData,
          analysisResults
        })
      ]);

      const priorityAnalysis = priorityResponse.data?.priorityAnalysis || {};
      const intakeAnalysis = intakeAnalysisResponse.data?.analysis || {};

      // Extract and update referral fields from AI-processed data
      const updates = {
        status: 'ready_for_admission',
        extracted_data: extractedData,
        analysis_results: {
          ...analysisResults,
          priority_analysis: priorityAnalysis,
          intake_analysis: intakeAnalysis
        },
        patient_name: extractedData.demographics?.full_name || null,
        patient_dob: extractedData.demographics?.date_of_birth || null,
        referral_source: extractedData.admission_details?.admission_source || 
                         extractedData.demographics?.referring_physician || 
                         null,
        referral_date: extractedData.admission_details?.referral_date || 
                       extractedData.admission_details?.admission_date || 
                       null,
        diagnosis: extractedData.diagnoses?.primary_diagnosis || null,
        priority: priorityAnalysis.priority || 'normal'
      };

      // Check for missing critical information using AI analysis
      const allMissingInfo = [
        ...(intakeAnalysis.missing_critical_info?.high_priority || []),
        ...(intakeAnalysis.missing_critical_info?.medium_priority || []),
        ...(intakeAnalysis.missing_critical_info?.low_priority || [])
      ];

      if (intakeAnalysis.missing_critical_info?.high_priority?.length > 0) {
        updates.status = 'awaiting_info';
        updates.missing_information = allMissingInfo;
      }

      // Enhanced patient matching logic
      const fullName = extractedData.demographics?.full_name || '';
      const dob = extractedData.demographics?.date_of_birth;
      const phone = extractedData.demographics?.phone;
      const address = extractedData.demographics?.address;
      
      let existingPatient = null;
      const allPatients = await base44.entities.Patient.list('-created_date', 500);
      
      if (fullName || dob || phone) {
        const nameParts = fullName.split(' ').filter(p => p.length > 0);
        const firstName = nameParts[0] || '';
        const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
        
        // Helper: normalize string for comparison
        const normalize = (str) => str?.toLowerCase().trim().replace(/[^a-z0-9]/g, '') || '';
        
        // Helper: true Levenshtein edit distance. A positional char-by-char compare
        // (the prior approach) collapses on a single insertion/deletion — "jon" vs
        // "john" scored 0.5 instead of 0.75 — which distorts the auto-match threshold.
        const levenshtein = (a, b) => {
          const m = a.length, n = b.length;
          if (!m) return n;
          if (!n) return m;
          let prev = Array.from({ length: n + 1 }, (_, i) => i);
          for (let i = 1; i <= m; i++) {
            const cur = [i];
            for (let j = 1; j <= n; j++) {
              cur[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]
                : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
            }
            prev = cur;
          }
          return prev[n];
        };

        // Helper: calculate string similarity from edit distance (0..1)
        const similarity = (s1, s2) => {
          if (!s1 || !s2) return 0;
          const longerLen = Math.max(s1.length, s2.length);
          if (longerLen === 0) return 1.0;
          return (longerLen - levenshtein(s1, s2)) / longerLen;
        };
        
        // Score each patient for match likelihood
        const scoredPatients = allPatients.map(p => {
          let score = 0;
          const reasons = [];
          
          // Name matching (40 points max)
          if (firstName && p.first_name) {
            const firstNameSim = similarity(normalize(firstName), normalize(p.first_name));
            if (firstNameSim >= 0.8) {
              score += firstNameSim * 20;
              reasons.push(`First name: ${(firstNameSim * 100).toFixed(0)}%`);
            }
          }
          
          if (lastName && p.last_name) {
            const lastNameSim = similarity(normalize(lastName), normalize(p.last_name));
            if (lastNameSim >= 0.8) {
              score += lastNameSim * 20;
              reasons.push(`Last name: ${(lastNameSim * 100).toFixed(0)}%`);
            }
          }
          
          // Middle name/initial bonus (5 points)
          if (middleName && p.middle_name) {
            const m1 = normalize(middleName);
            const m2 = normalize(p.middle_name);
            if (m1 === m2 || m1[0] === m2[0]) {
              score += 5;
              reasons.push('Middle name match');
            }
          }
          
          // DOB matching (30 points)
          if (dob && p.date_of_birth) {
            if (dob === p.date_of_birth) {
              score += 30;
              reasons.push('Exact DOB match');
            } else {
              // Partial DOB match (year and month)
              const [y1, m1] = dob.split('-');
              const [y2, m2] = p.date_of_birth.split('-');
              if (y1 === y2 && m1 === m2) {
                score += 15;
                reasons.push('Partial DOB match');
              }
            }
          }
          
          // Phone matching (15 points)
          if (phone && p.phone) {
            const p1 = normalize(phone);
            const p2 = normalize(p.phone);
            if (p1 === p2 || p1.includes(p2.slice(-7)) || p2.includes(p1.slice(-7))) {
              score += 15;
              reasons.push('Phone match');
            }
          }
          
          // Address matching (10 points)
          if (address && p.address) {
            const a1 = normalize(address);
            const a2 = normalize(p.address);
            if (similarity(a1, a2) >= 0.7) {
              score += 10;
              reasons.push('Address match');
            }
          }
          
          return { patient: p, score, reasons };
        });
        
        // Sort by score and get best match
        const bestMatch = scoredPatients.sort((a, b) => b.score - a.score)[0];
        
        // Match threshold: 60+ points = high confidence match
        if (bestMatch && bestMatch.score >= 60) {
          existingPatient = bestMatch.patient;
        }
      }

      // Enhanced AI-powered patient matching with detailed analysis
      if (extractedData.demographics && allPatients.length > 0) {
        // Always run AI matching for comprehensive analysis
        const aiMatchResponse = await base44.functions.invoke('matchPatientWithAI', {
          extractedData,
          existingPatients: allPatients.slice(0, 100) // Analyze top 100 patients
        });

        const matchAnalysis = aiMatchResponse.data?.matchAnalysis;
        
        if (matchAnalysis) {
          // Store full match analysis
          updates.match_analysis = matchAnalysis;
          updates.match_confidence = matchAnalysis.confidence_score;
          updates.match_factors = matchAnalysis.match_factors;
          updates.discrepancies = matchAnalysis.discrepancies;
          
          if (((matchAnalysis.confidence_level === 'definitive') || (matchAnalysis.confidence_level === 'high' && matchAnalysis.confidence_score >= 90)) && matchAnalysis.best_match_id) {
            // Definitive (e.g. exact MRN) or high confidence (90%+) - auto-match.
            // 'definitive' previously fell through every branch and silently created
            // a DUPLICATE patient despite an exact-identifier match.
            if (!existingPatient) {
              existingPatient = allPatients.find(p => p.id === matchAnalysis.best_match_id);
            }
          } else if (matchAnalysis.confidence_level === 'high' && matchAnalysis.best_match_id) {
            // Medium-high confidence (70-89%) - flag for quick review
            updates.requires_manual_review = true;
            updates.match_suggestions = [
              { 
                patient_id: matchAnalysis.best_match_id, 
                confidence_score: matchAnalysis.confidence_score,
                reasons: matchAnalysis.match_factors 
              },
              ...(matchAnalysis.alternative_matches || [])
            ];
          } else if (matchAnalysis.confidence_level === 'medium' && matchAnalysis.alternative_matches?.length > 0) {
            // Medium confidence (50-69%) - show multiple options
            updates.requires_manual_review = true;
            updates.match_suggestions = matchAnalysis.alternative_matches;
          } else if (matchAnalysis.confidence_level === 'low' || matchAnalysis.recommendation === 'create_new') {
            // Low confidence - likely new patient
          }
        }
      }

      if (!existingPatient && extractedData.demographics) {
        // Create new patient from referral data
        const nameParts = (extractedData.demographics.full_name || '').split(' ');
        const firstName = nameParts[0] || '';
        const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

        const newPatient = await base44.entities.Patient.create({
          first_name: firstName,
          middle_name: middleName,
          last_name: lastName,
          medical_record_number: extractedData.demographics.medical_record_number || extractedData.demographics.mrn || null,
          date_of_birth: extractedData.demographics.date_of_birth,
          address: extractedData.demographics.address,
          phone: extractedData.demographics.phone,
          email: extractedData.demographics.email || null,
          payor: extractedData.demographics.insurance_primary || 'Unknown',
          emergency_contact_name: extractedData.demographics.emergency_contact,
          emergency_contact_phone: extractedData.demographics.emergency_phone,
          emergency_contact_relationship: extractedData.demographics.emergency_relationship,
          physician_name: extractedData.demographics.referring_physician || extractedData.demographics.primary_care_physician,
          physician_phone: extractedData.demographics.referring_physician_contact || extractedData.demographics.pcp_contact,
          physician_email: extractedData.demographics.referring_physician_email || extractedData.demographics.pcp_email,
          caregiver_name: extractedData.demographics.caregiver_name,
          caregiver_phone: extractedData.demographics.caregiver_phone,
          caregiver_email: extractedData.demographics.caregiver_email,
          primary_diagnosis: extractedData.diagnoses?.primary_diagnosis,
          secondary_diagnoses: extractedData.diagnoses?.secondary_diagnoses || [],
          allergies: extractedData.diagnoses?.allergies,
          current_medications: extractedData.medications?.map(med => ({
            name: med.name,
            dosage: med.dosage,
            frequency: med.frequency,
            prescriber: med.prescriber,
            start_date: med.start_date
          })) || [],
          past_medical_history: extractedData.diagnoses?.past_medical_history || [],
          past_hospitalizations: extractedData.diagnoses?.past_hospitalizations || [],
          baseline_vitals: extractedData.vital_signs || {},
          functional_status: extractedData.functional_status || {},
          social_history: extractedData.social_history || {},
          advance_directives: extractedData.advance_directives || {},
          insurance_primary: extractedData.demographics.insurance_details?.primary || {},
          insurance_secondary: extractedData.demographics.insurance_details?.secondary || {},
          admission_date: extractedData.admission_details?.admission_date,
          admission_source: extractedData.admission_details?.admission_source,
          status: 'active',
          care_type: extractedData.admission_details?.care_type || 'home_health',
          clinical_notes: `Referral received from ${extractedData.demographics.referring_physician || 'physician'} on ${extractedData.admission_details?.referral_date || 'unknown date'}.\n\nReason: ${extractedData.admission_details?.referral_reason || 'Not specified'}`,
          goals_of_care: extractedData.skilled_needs?.goals_of_care ? [extractedData.skilled_needs.goals_of_care] : []
        });

        updates.patient_id = newPatient.id;
        existingPatient = newPatient;
      } else if (existingPatient) {
        // Pull MRN from existing patient and update with referral data
        const updateData = {
          medical_record_number: existingPatient.medical_record_number || extractedData.demographics?.medical_record_number || extractedData.demographics?.mrn,
        };
        
        // Update fields only if they're missing or empty in existing record
        if (!existingPatient.physician_name && (extractedData.demographics?.referring_physician || extractedData.demographics?.primary_care_physician)) {
          updateData.physician_name = extractedData.demographics.referring_physician || extractedData.demographics.primary_care_physician;
        }
        if (!existingPatient.physician_phone && (extractedData.demographics?.referring_physician_contact || extractedData.demographics?.pcp_contact)) {
          updateData.physician_phone = extractedData.demographics.referring_physician_contact || extractedData.demographics.pcp_contact;
        }
        if (!existingPatient.emergency_contact_name && extractedData.demographics?.emergency_contact) {
          updateData.emergency_contact_name = extractedData.demographics.emergency_contact;
        }
        if (!existingPatient.emergency_contact_phone && extractedData.demographics?.emergency_phone) {
          updateData.emergency_contact_phone = extractedData.demographics.emergency_phone;
        }
        if (extractedData.diagnoses?.secondary_diagnoses?.length > 0) {
          const existingDiagnoses = existingPatient.secondary_diagnoses || [];
          const newDiagnoses = extractedData.diagnoses.secondary_diagnoses.filter(d => !existingDiagnoses.includes(d));
          if (newDiagnoses.length > 0) {
            updateData.secondary_diagnoses = [...existingDiagnoses, ...newDiagnoses];
          }
        }
        
        // Update patient with new information
        await base44.entities.Patient.update(existingPatient.id, updateData);
        updates.patient_id = existingPatient.id;
      }

      // Store the generated PDF URL in referral
      if (generatedPdfUrl) {
        updates.processed_document_url = generatedPdfUrl;
      }

      await base44.entities.Referral.update(referralId, updates);

      // Create comprehensive AI-generated tasks from multiple sources
      const allSuggestedTasks = [];
      
      // Tasks from intake analysis
      if (intakeAnalysis.suggested_next_steps?.length > 0) {
        const analysisTasksToCreate = intakeAnalysis.suggested_next_steps
          .filter(step => step.priority === 'immediate' || step.priority === 'urgent' || step.priority === 'high')
          .map(step => ({
            patient_id: updates.patient_id || null,
            title: step.action,
            description: `AI-suggested action based on referral analysis. Timeframe: ${step.timeframe}`,
            type: 'followup',
            priority: step.priority === 'immediate' || step.priority === 'urgent' ? 'high' : 'medium',
            status: 'pending',
            source: 'ai_generated',
            ai_reason: `Referral intake analysis identified this as ${step.priority} priority action`,
            related_visit_id: referralId
          }));
        allSuggestedTasks.push(...analysisTasksToCreate);
      }
      
      // Tasks from the full referral extraction. The extraction schema exposes
      // skilled_needs (services_ordered / specific_interventions / dme_supplies)
      // and functional_status.wounds — NOT a `care_needs` object with
      // wound_care/iv_therapy/therapy_requirements/dme_needs flags. The previous
      // reads of extractedData.care_needs.* were always undefined, so these
      // wound/IV/therapy/DME coordination tasks were never created.
      const skilledNeeds = extractedData.skilled_needs || {};
      const orderedServices = [
        ...(skilledNeeds.services_ordered || []),
        ...(skilledNeeds.specific_interventions || []),
      ];
      const servicesText = orderedServices.join(' ').toLowerCase();
      const woundsText = `${servicesText} ${extractedData.functional_status?.wounds || ''}`.toLowerCase();
      const dmeNeeds = skilledNeeds.dme_supplies || [];
      const therapyRequirements = (skilledNeeds.services_ordered || [])
        .filter((s) => /physical therapy|occupational therapy|speech|\bpt\b|\bot\b|\bst\b|slp/i.test(s));

      if (/wound|ulcer|pressure injury|incision|dressing change/.test(woundsText)) {
        allSuggestedTasks.push({
          patient_id: updates.patient_id || null,
          title: "Coordinate wound care assessment and supplies",
          description: "Patient requires wound care services. Schedule wound care assessment and order necessary supplies.",
          type: "coordinate",
          priority: "high",
          status: "pending",
          source: "ai_generated",
          ai_reason: "Wound care identified in referral document",
          related_visit_id: referralId
        });
      }

      if (/\biv\b|infusion|intravenous|picc|central line|tpn/.test(servicesText)) {
        allSuggestedTasks.push({
          patient_id: updates.patient_id || null,
          title: "Arrange IV therapy services and supplies",
          description: "Patient requires IV therapy. Coordinate with pharmacy and schedule IV-certified nurse.",
          type: "coordinate",
          priority: "high",
          status: "pending",
          source: "ai_generated",
          ai_reason: "IV therapy identified in referral document",
          related_visit_id: referralId
        });
      }

      if (therapyRequirements.length > 0) {
        allSuggestedTasks.push({
          patient_id: updates.patient_id || null,
          title: `Coordinate ${therapyRequirements.join(', ')} therapy services`,
          description: `Patient requires ${therapyRequirements.join(', ')}. Contact therapy team for evaluation and scheduling.`,
          type: "coordinate",
          priority: "high",
          status: "pending",
          source: "ai_generated",
          ai_reason: `Therapy requirements identified: ${therapyRequirements.join(', ')}`,
          related_visit_id: referralId
        });
      }

      if (dmeNeeds.length > 0) {
        allSuggestedTasks.push({
          patient_id: updates.patient_id || null,
          title: "Order DME equipment",
          description: `Order the following DME: ${dmeNeeds.join(', ')}`,
          type: "order",
          priority: "high",
          status: "pending",
          source: "ai_generated",
          ai_reason: `DME needs identified: ${dmeNeeds.join(', ')}`,
          related_visit_id: referralId
        });
      }

      // Create all tasks and track success. Default assigned_to to the intake
      // coordinator (current user) so tasks aren't orphaned — assigned_to is
      // required on the Task entity and drives RLS visibility.
      let createdTasksCount = 0;
      if (allSuggestedTasks.length > 0) {
        const _taskResults = await Promise.all(allSuggestedTasks.map(task =>
          base44.entities.Task.create({ assigned_to: currentUser?.email, ...task })
            .then(() => { createdTasksCount++; return true; })
            .catch(err => { console.error('Failed to create task:', err); return false; })
        ));
      }
      
      // Optional fallback care-plan creation. The full extraction schema does not
      // carry `suggested_care_plans` (that is a quick-scan field), so this is a
      // no-op for the full-extraction path; care plans for processed referrals are
      // generated by the dedicated AIReferralCarePlanGenerator shown in this dialog.
      let createdCarePlansCount = 0;
      if (extractedData.suggested_care_plans?.length > 0 && updates.patient_id) {
        const carePlansToCreate = extractedData.suggested_care_plans.map(cp => ({
          patient_id: updates.patient_id,
          problem: cp.problem,
          goal: cp.goal,
          interventions: cp.interventions,
          status: 'active',
          baseline_measurement: 'To be assessed on first visit',
          target_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }));
        
        await Promise.all(carePlansToCreate.map(cp => 
          base44.entities.CarePlan.create(cp)
            .then(() => { createdCarePlansCount++; return true; })
            .catch(err => { console.error('Failed to create care plan:', err); return false; })
        ));
      }
      
      // Show automation summary
      const automationSummary = [];
      if (existingPatient && !updates.requires_manual_review) {
        automationSummary.push(`✓ Patient matched: ${existingPatient.first_name} ${existingPatient.last_name}${updates.match_confidence ? ` (${Math.round(updates.match_confidence)}% confidence)` : ''}`);
      } else if (!existingPatient && updates.patient_id) {
        automationSummary.push(`✓ New patient created`);
      }
      if (createdTasksCount > 0) {
        automationSummary.push(`✓ ${createdTasksCount} automated task${createdTasksCount > 1 ? 's' : ''} created`);
      }
      if (createdCarePlansCount > 0) {
        automationSummary.push(`✓ ${createdCarePlansCount} care plan${createdCarePlansCount > 1 ? 's' : ''} created`);
      }
      
      if (automationSummary.length > 0) {
        toast.success(`Referral processed successfully! AI Automation: ${automationSummary.join(', ')}`);
      }
      
      setProcessingReferralId(null);
      
      // If requires manual review, show the verification step
      if (updates.requires_manual_review) {
        const updatedReferral = await base44.entities.Referral.filter({ id: referralId });
        setVerificationReferral(updatedReferral[0]);
      }
      
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    } catch (error) {
      console.error('Error updating referral:', error);
      toast.error('Failed to process referral. Please try again.');
    }
  };

  const handleConfirmMatch = async (patientId) => {
    try {
      const referralToUpdate = verificationReferral || matchReviewReferral;
      await base44.entities.Referral.update(referralToUpdate.id, {
        patient_id: patientId,
        requires_manual_review: false,
        manually_confirmed: true,
        status: 'ready_for_admission'
      });
      setMatchReviewReferral(null);
      setVerificationReferral(null);
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
    } catch (error) {
      console.error('Error confirming match:', error);
      toast.error('Failed to confirm match');
    }
  };

  const handleDeleteReferral = async (referralId) => {
    try {
      await base44.entities.Referral.delete(referralId);
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      toast.success('Referral deleted successfully');
    } catch (error) {
      console.error('Error deleting referral:', error);
      toast.error('Failed to delete referral');
    }
  };

  const handleRejectReferral = async (referralId) => {
    try {
      await base44.entities.Referral.update(referralId, {
        status: 'declined',
        rejection_date: new Date().toISOString(),
        rejected_by: currentUser?.email
      });
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      toast.success('Referral rejected');
    } catch (error) {
      console.error('Error rejecting referral:', error);
      toast.error('Failed to reject referral');
    }
  };

  const handleCreateNewFromReview = async () => {
    try {
      const referralToUpdate = verificationReferral || matchReviewReferral;
      if (!referralToUpdate) return;
      const data = referralToUpdate.extracted_data || {};
      const demo = data.demographics || {};
      const nameParts = (demo.full_name || '').split(' ');
      
      const newPatient = await base44.entities.Patient.create({
        first_name: nameParts[0] || '',
        middle_name: nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '',
        last_name: nameParts.length > 1 ? nameParts[nameParts.length - 1] : '',
        medical_record_number: demo?.medical_record_number || demo?.mrn || null,
        date_of_birth: demo.date_of_birth,
        address: demo.address,
        phone: demo.phone,
        email: demo.email || null,
        payor: demo.insurance_primary || 'Unknown',
        emergency_contact_name: demo.emergency_contact,
        emergency_contact_phone: demo.emergency_phone,
        emergency_contact_relationship: demo.emergency_relationship,
        physician_name: demo.referring_physician || demo.primary_care_physician,
        physician_phone: demo.referring_physician_contact || demo.pcp_contact,
        primary_diagnosis: data.diagnoses?.primary_diagnosis,
        secondary_diagnoses: data.diagnoses?.secondary_diagnoses || [],
        allergies: data.diagnoses?.allergies,
        current_medications: data.medications?.map(med => ({
          name: med.name,
          dosage: med.dosage,
          frequency: med.frequency,
          prescriber: med.prescriber
        })) || [],
        past_medical_history: data.diagnoses?.past_medical_history || [],
        status: 'active',
        care_type: data.admission_details?.care_type || 'home_health'
      });

      await base44.entities.Referral.update(referralToUpdate.id, {
        patient_id: newPatient.id,
        requires_manual_review: false,
        manually_confirmed: true,
        status: 'ready_for_admission'
      });

      setMatchReviewReferral(null);
      setVerificationReferral(null);
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    } catch (error) {
      console.error('Error creating new patient:', error);
      toast.error('Failed to create new patient');
    }
  };

  const filteredReferrals = referrals.filter(r => {
    const statusMatch = statusFilter === 'all' || r.status === statusFilter;
    const priorityMatch = priorityFilter === 'all' || r.priority === priorityFilter;
    return statusMatch && priorityMatch;
  });

  const totalPages = Math.ceil(filteredReferrals.length / REFERRALS_PER_PAGE);
  const safePage = Math.min(currentPage, Math.max(1, totalPages));
  const paginatedReferrals = filteredReferrals.slice(
    (safePage - 1) * REFERRALS_PER_PAGE,
    safePage * REFERRALS_PER_PAGE
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'new': return 'bg-blue-500';
      case 'processing': return 'bg-amber-500';
      case 'awaiting_info': return 'bg-orange-500';
      case 'ready_for_admission': return 'bg-emerald-500';
      case 'archived': return 'bg-slate-500';
      case 'declined': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-600';
      case 'high': return 'bg-orange-600';
      case 'normal': return 'bg-blue-600';
      case 'low': return 'bg-slate-600';
      default: return 'bg-slate-600';
    }
  };

  const statusCounts = {
    new: referrals.filter(r => r.status === 'new').length,
    processing: referrals.filter(r => r.status === 'processing').length,
    awaiting_info: referrals.filter(r => r.status === 'awaiting_info').length,
    ready_for_admission: referrals.filter(r => r.status === 'ready_for_admission').length,
  };

  return (
    <PageContainer>
      <PageHeader
        icon={ClipboardList}
        eyebrow="Documentation"
        title="Referral Intake"
        description="Streamlined workflow for processing incoming referrals"
        favoritePage="ReferralIntake"
        actions={
          activeTab === "intake" ? (
            <Button
              onClick={() => setUploadDialogOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 min-h-[44px] w-full sm:w-auto"
            >
              <Upload className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">New Referral</span>
              <span className="sm:hidden">New</span>
            </Button>
          ) : null
        }
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="intake" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <ClipboardList className="h-4 w-4 mr-2" />
              Intake
            </TabsTrigger>
            <TabsTrigger value="process" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <RefreshCw className="h-4 w-4 mr-2" />
              Process
            </TabsTrigger>
            <TabsTrigger value="admission" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FileText className="h-4 w-4 mr-2" />
              Admission Note
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="intake" className="space-y-4 sm:space-y-6">
      {/* Status Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <StatCard label="New" value={statusCounts.new} icon={ClipboardList} tone="sky" />
        <StatCard label="Processing" value={statusCounts.processing} icon={RefreshCw} tone="amber" />
        <StatCard label="Awaiting Info" value={statusCounts.awaiting_info} icon={AlertCircle} tone="orange" />
        <StatCard label="Ready" value={statusCounts.ready_for_admission} icon={CheckCircle2} tone="emerald" />
      </div>

      {/* Filters */}
      <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-end">
            <div className="flex-1 min-w-0">
              <Label>Status Filter</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="awaiting_info">Awaiting Info</SelectItem>
                  <SelectItem value="ready_for_admission">Ready for Admission</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label>Priority Filter</Label>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Referrals Table */}
      <Card>
        <CardHeader className="p-3 sm:p-4 md:p-6">
          <CardTitle className="text-base sm:text-lg">Referrals ({filteredReferrals.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingState label="Loading referrals..." />
          ) : filteredReferrals.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <p className="text-slate-600">No referrals found</p>
              <Button
                onClick={() => setUploadDialogOpen(true)}
                variant="outline"
                className="mt-4"
              >
                Upload First Referral
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-3 sm:mx-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs sm:text-sm">Patient</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden md:table-cell">Referral Date</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Source</TableHead>
                    <TableHead className="text-xs sm:text-sm">Priority</TableHead>
                    <TableHead className="text-xs sm:text-sm">Status</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden xl:table-cell">Assigned To</TableHead>
                    <TableHead className="text-xs sm:text-sm">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedReferrals.map((referral) => (
                    <TableRow key={referral.id}>
                      <TableCell className="text-xs sm:text-sm font-medium">
                        {referral.patient_id ? (
                          <Link to={`/PatientDetails?id=${referral.patient_id}`} className="text-blue-600 hover:underline">
                            {referral.patient_name || 'Unknown'}
                          </Link>
                        ) : (
                          <span>{referral.patient_name || 'Unknown'}</span>
                        )}
                        {referral.patient_dob && (
                          <p className="text-xs text-slate-500">
                            DOB: {referral.patient_dob ? format(new Date(referral.patient_dob), 'MM/dd/yyyy') : 'N/A'}
                          </p>
                        )}
                        {referral.extracted_data?.demographics?.referring_physician && (
                          <p className="text-xs text-slate-500">
                            Dr. {referral.extracted_data.demographics.referring_physician}
                          </p>
                        )}
                        {referral.patient_id && !referral.requires_manual_review && referral.match_confidence && (
                          <Badge
                            variant={
                              referral.match_confidence >= 90 ? "success" :
                              referral.match_confidence >= 75 ? "info" :
                              "secondary"
                            }
                            className="gap-1 text-xs mt-1"
                          >
                            {referral.match_confidence >= 90 && <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                            Matched ({Math.round(referral.match_confidence)}%)
                          </Badge>
                        )}
                        {referral.patient_id && !referral.requires_manual_review && !referral.match_confidence && (
                          <Badge className="bg-emerald-600 text-xs mt-1">In System</Badge>
                        )}
                        {referral.requires_manual_review && (
                          <div className="flex flex-col gap-1 mt-1">
                            <Badge variant="warning" className="text-xs">
                              Review Match
                            </Badge>
                            {referral.match_confidence && (
                              <span className="text-xs text-amber-700">
                                {Math.round(referral.match_confidence)}% confidence
                              </span>
                            )}
                          </div>
                        )}
                        {referral.extracted_data?.diagnoses?.primary_diagnosis && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 text-xs mt-1">
                            {referral.extracted_data.diagnoses.primary_diagnosis}
                          </Badge>
                        )}
                        {referral.analysis_results?.intake_analysis?.category?.primary && (
                          <Badge className="bg-navy-100 text-navy-700 text-xs mt-1">
                            {referral.analysis_results.intake_analysis.category.primary.replace(/_/g, ' ')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm hidden md:table-cell">
                        {referral.referral_date ? format(new Date(referral.referral_date), 'MM/dd/yyyy') : 'N/A'}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm hidden lg:table-cell">{referral.referral_source || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge className={getPriorityColor(referral.priority)}>
                          {referral.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge className={getStatusColor(referral.status)}>
                            {referral.status.replace(/_/g, ' ')}
                          </Badge>
                          {referral.analysis_results?.intake_analysis?.risk_assessment?.clinical_complexity && (
                            <div className="text-xs text-slate-600">
                              Complexity: {referral.analysis_results.intake_analysis.risk_assessment.clinical_complexity}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm hidden xl:table-cell">
                        <Select
                          value={referral.assigned_to || "unassigned"}
                          onValueChange={(value) => handleNurseAssignment(referral.id, value)}
                        >
                          <SelectTrigger className="w-full min-w-[140px] h-11 touch-target">
                            <SelectValue placeholder="Assign nurse" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {users.filter(u => u.role === 'user' || u.role === 'admin').map(u => (
                              <SelectItem key={u.email} value={u.email}>
                                {u.full_name || u.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                       <div className="flex flex-col gap-2 min-w-[120px]">
                         {referral.requires_manual_review ? (
                           <Button
                             size="sm"
                             className="bg-amber-500 hover:bg-amber-600 text-white min-h-[36px] text-xs"
                             onClick={() => setVerificationReferral(referral)}
                           >
                              <UserCheck className="w-4 h-4 mr-1" />
                              Verify Patient
                            </Button>
                         ) : referral.status === 'ready_for_admission' && referral.patient_id && referral.extracted_data ? (
                           <Link to={`/SmartNoteAssistant?referral_id=${referral.id}`}>
                             <Button
                               size="sm"
                               className="bg-emerald-600 hover:bg-emerald-700 text-white min-h-[36px] text-xs w-full"
                             >
                               <Sparkles className="w-4 h-4 mr-1" />
                               Start Admission Note
                             </Button>
                           </Link>
                         ) : (
                           <>
                             <Button
                               size="sm"
                               variant="outline"
                               onClick={() => setProcessingReferralId(referral.id)}
                               className="min-h-[36px] text-xs"
                             >
                               <Eye className="w-4 h-4 mr-1" />
                               {referral.analysis_results?.intake_analysis ? 'View Analysis' : 'Process'}
                             </Button>
                             {referral.patient_id && referral.extracted_data && (
                              <Link to={`/SmartNoteAssistant?referral_id=${referral.id}`}>
                                 <Button
                                   size="sm"
                                   className="bg-navy-600 hover:bg-navy-700 text-white min-h-[36px] text-xs w-full"
                                 >
                                   <Sparkles className="w-4 h-4 mr-1" />
                                   Create Note
                                 </Button>
                               </Link>
                             )}
                              {referral.analysis_results?.intake_analysis && (
                                <div className="text-xs text-slate-600 space-y-0.5">
                                  {referral.analysis_results.intake_analysis.missing_critical_info?.high_priority?.length > 0 && (
                                    <div className="flex items-center gap-1 text-red-600">
                                      <AlertCircle className="w-3 h-3" />
                                      {referral.analysis_results.intake_analysis.missing_critical_info.high_priority.length} critical items
                                    </div>
                                  )}
                                  {referral.analysis_results.intake_analysis.suggested_next_steps?.filter(s => s.priority === 'immediate' || s.priority === 'urgent').length > 0 && (
                                    <div className="flex items-center gap-1 text-orange-600">
                                      <ClipboardCheck className="w-3 h-3" />
                                      {referral.analysis_results.intake_analysis.suggested_next_steps.filter(s => s.priority === 'immediate' || s.priority === 'urgent').length} urgent actions
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setReferralToReject(referral)}
                              className="text-orange-600 hover:bg-orange-50 min-h-[36px] text-xs flex-1"
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setReferralToDelete(referral)}
                              className="text-red-600 hover:bg-red-50 min-h-[36px] text-xs flex-1"
                            >
                              <Trash2 className="w-4 h-4 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-slate-500">
                Showing {(currentPage - 1) * REFERRALS_PER_PAGE + 1}-{Math.min(currentPage * REFERRALS_PER_PAGE, filteredReferrals.length)} of {filteredReferrals.length}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl sm:text-2xl">Upload New Referral</DialogTitle>
            <p className="text-sm text-slate-600">Upload a referral document (PDF, fax, or image). AI will automatically extract and populate patient information.</p>
          </DialogHeader>
          <div className="space-y-5">


            {extractedFormData && (
              <div className="space-y-3">
                <Alert className="bg-emerald-50 border-emerald-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <AlertDescription className="text-emerald-900 text-sm">
                    <strong>AI Extracted Data:</strong> Form fields have been auto-populated with comprehensive analysis.
                    {extractedFormData.confidence_score && (
                      <span className="ml-2 text-xs">
                        (Confidence: {Math.round(extractedFormData.confidence_score)}%)
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
                
                {/* AI Categorization Results */}
                {extractedFormData.category && (
                  <Alert className="bg-blue-50 border-blue-300">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-blue-900 text-sm">
                      <strong>Auto-Categorized:</strong> {extractedFormData.category.replace(/_/g, ' ').toUpperCase()}
                      {extractedFormData.urgency_factors?.length > 0 && (
                        <div className="mt-2 text-xs">
                          <strong>Urgency Factors:</strong>
                          <ul className="list-disc list-inside mt-1">
                            {extractedFormData.urgency_factors.slice(0, 3).map((factor, idx) => (
                              <li key={idx}>{factor}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                
                {/* Suggested Tasks Preview */}
                {extractedFormData.suggested_initial_tasks?.length > 0 && (
                  <Alert className="bg-navy-50 border-navy-300">
                    <ClipboardCheck className="w-4 h-4 text-navy-600" />
                    <AlertDescription className="text-navy-900 text-sm">
                      <strong>AI Suggested {extractedFormData.suggested_initial_tasks.length} Initial Tasks</strong>
                      <div className="mt-2 text-xs space-y-1">
                        {extractedFormData.suggested_initial_tasks.slice(0, 3).map((task, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <Badge className={
                              task.priority === 'critical' || task.priority === 'immediate' ? 'bg-red-600' :
                              task.priority === 'urgent' || task.priority === 'high' ? 'bg-orange-600' : 'bg-blue-600'
                            }>{task.priority}</Badge>
                            <span>{task.task}</span>
                          </div>
                        ))}
                        {extractedFormData.suggested_initial_tasks.length > 3 && (
                          <div className="text-xs text-slate-600">+ {extractedFormData.suggested_initial_tasks.length - 3} more tasks</div>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                
                {/* Suggested Care Plans Preview */}
                {extractedFormData.suggested_care_plans?.length > 0 && (
                  <Alert className="bg-indigo-50 border-indigo-300">
                    <Target className="w-4 h-4 text-indigo-600" />
                    <AlertDescription className="text-indigo-900 text-sm">
                      <strong>AI Suggested {extractedFormData.suggested_care_plans.length} Care Plans</strong>
                      <div className="mt-2 text-xs space-y-2">
                        {extractedFormData.suggested_care_plans.slice(0, 2).map((plan, idx) => (
                          <div key={idx} className="bg-white p-2 rounded border border-indigo-200">
                            <div className="font-semibold">{plan.problem}</div>
                            <div className="text-slate-700">Goal: {plan.goal}</div>
                          </div>
                        ))}
                        {extractedFormData.suggested_care_plans.length > 2 && (
                          <div className="text-xs text-slate-600">+ {extractedFormData.suggested_care_plans.length - 2} more care plans</div>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <div className="space-y-4 border-t border-slate-200 pt-5">
              <h3 className="font-semibold text-slate-900">Referral Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="patient-name" className="flex items-center gap-2 mb-1.5">
                    Patient Name (if known)
                    {extractedFormData?.patient_name && (
                      <Badge className="bg-emerald-100 text-emerald-700 text-xs">Extracted</Badge>
                    )}
                  </Label>
                  <Input
                    id="patient-name"
                    placeholder="First Last"
                    value={newReferral.patient_name}
                    onChange={(e) => setNewReferral({ ...newReferral, patient_name: e.target.value })}
                    className={`h-10 ${extractedFormData?.patient_name ? "border-emerald-300 bg-emerald-50" : ""}`}
                  />
                </div>
                <div>
                  <Label htmlFor="referral-source" className="flex items-center gap-2 mb-1.5">
                    Referral Source
                    {extractedFormData?.referral_source && (
                      <Badge className="bg-emerald-100 text-emerald-700 text-xs">Extracted</Badge>
                    )}
                  </Label>
                  <Input
                    id="referral-source"
                    placeholder="Hospital, physician, facility"
                    value={newReferral.referral_source}
                    onChange={(e) => setNewReferral({ ...newReferral, referral_source: e.target.value })}
                    className={`h-10 ${extractedFormData?.referral_source ? "border-emerald-300 bg-emerald-50" : ""}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="referral-date" className="flex items-center gap-2 mb-1.5">
                    Referral Date
                    {extractedFormData?.referral_date && (
                      <Badge className="bg-emerald-100 text-emerald-700 text-xs">Extracted</Badge>
                    )}
                  </Label>
                  <Input
                    id="referral-date"
                    type="date"
                    value={newReferral.referral_date}
                    onChange={(e) => setNewReferral({ ...newReferral, referral_date: e.target.value })}
                    className={`h-10 ${extractedFormData?.referral_date ? "border-emerald-300 bg-emerald-50" : ""}`}
                  />
                </div>
                <div>
                  <Label htmlFor="priority" className="flex items-center gap-2 mb-1.5">
                    Priority
                    {extractedFormData?.urgency_level && (
                      <Badge className="bg-emerald-100 text-emerald-700 text-xs">Suggested</Badge>
                    )}
                  </Label>
                  <Select
                    value={newReferral.priority}
                    onValueChange={(value) => setNewReferral({ ...newReferral, priority: value })}
                  >
                    <SelectTrigger id="priority" className={`h-10 ${extractedFormData?.urgency_level ? "border-emerald-300 bg-emerald-50" : ""}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="document-type" className="mb-1.5 block">Document Type</Label>
                  <Select
                    value={newReferral.document_type}
                    onValueChange={(value) => setNewReferral({ ...newReferral, document_type: value })}
                  >
                    <SelectTrigger id="document-type" className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pdf">PDF</SelectItem>
                      <SelectItem value="fax">Fax</SelectItem>
                      <SelectItem value="image">Image</SelectItem>
                      <SelectItem value="electronic">Electronic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-200 pt-5">
              <Label htmlFor="file-upload" className="font-semibold text-slate-900">Upload Document</Label>
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer">
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".pdf,image/*"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  {isUploading ? (
                    <div className="space-y-2">
                      <Sparkles className="w-12 h-12 text-navy-500 mx-auto animate-pulse" />
                      <p className="text-navy-600 font-medium">Analyzing document with AI...</p>
                      <p className="text-xs text-slate-500">Extracting patient information</p>
                    </div>
                  ) : uploadedFile ? (
                    <div className="flex items-center justify-center gap-2 text-emerald-600">
                      <CheckCircle2 className="w-6 h-6" />
                      <span>File uploaded & analyzed successfully</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="w-12 h-12 text-slate-400 mx-auto" />
                      <p className="text-slate-600">
                        {isUploading ? 'Uploading...' : 'Click to upload or drag and drop'}
                      </p>
                      <p className="text-xs text-slate-500">PDF, PNG, JPG, or TIFF</p>
                    </div>
                  )}
                </label>
              </div>
            </div>

            {/* Multi-referral PDF flow: when an uploaded PDF may contain several
                referrals, let the user review the detected split and create one
                Referral per selected document. Without this the create button is
                hidden (gated on !multiReferralDetection) and the PDF upload would
                otherwise dead-end with no way to proceed. */}
            {multiReferralDetection && (
              <div className="border-t border-slate-200 pt-5">
                <MultiReferralDetector
                  fileUrl={multiReferralDetection.fileUrl}
                  onDetectionComplete={handleMultiReferralDetectionComplete}
                  onDismiss={() => { setMultiReferralDetection(null); setUploadedFile(null); }}
                />
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-3 pt-5 border-t border-slate-200">
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)} className="min-h-[44px] w-full sm:w-auto order-2 sm:order-1">
              Cancel
            </Button>
            {!multiReferralDetection && (
              <Button
                onClick={handleCreateReferral}
                disabled={isUploading || !uploadedFile}
                className="bg-blue-600 hover:bg-blue-700 min-h-[44px] w-full sm:w-auto order-1 sm:order-2"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Create & Process Referral
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Processing Dialog */}
      {processingReferralId && (
        <Dialog open={!!processingReferralId} onOpenChange={(open) => !open && setProcessingReferralId(null)}>
          <DialogContent className="max-w-[98vw] sm:max-w-6xl max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-navy-600" />
                AI Referral Processor
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              <ReferralPDFSummarizer
                fileUrl={referrals.find(r => r.id === processingReferralId)?.document_url}
                onExtractionComplete={(data, analysis, pdfUrl) => handleProcessingComplete(processingReferralId, data, analysis, pdfUrl)}
              />
              
              {/* Show care plan generator after processing */}
              {referrals.find(r => r.id === processingReferralId)?.extracted_data && 
               referrals.find(r => r.id === processingReferralId)?.patient_id && (
                <AIReferralCarePlanGenerator
                  referralData={referrals.find(r => r.id === processingReferralId)?.extracted_data}
                  intakeAnalysis={referrals.find(r => r.id === processingReferralId)?.analysis_results?.intake_analysis}
                  patientId={referrals.find(r => r.id === processingReferralId)?.patient_id}
                  onCarePlansSaved={() => {
                    queryClient.invalidateQueries({ queryKey: ['referrals'] });
                    toast.success('Care plans saved successfully!');
                  }}
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Patient Verification Step Dialog */}
      {verificationReferral && (
        <Dialog open={!!verificationReferral} onOpenChange={(open) => !open && setVerificationReferral(null)}>
          <DialogContent className="max-w-[95vw] sm:max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserCheck className="w-6 h-6 text-amber-600" />
                Patient Verification Required
              </DialogTitle>
            </DialogHeader>
            <PatientVerificationStep
              referral={verificationReferral}
              onConfirmMatch={handleConfirmMatch}
              onCreateNew={handleCreateNewFromReview}
              onSkip={() => setVerificationReferral(null)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Legacy Patient Match Review Dialog (kept for backward compatibility) */}
      {matchReviewReferral && (
        <Dialog open={!!matchReviewReferral} onOpenChange={(open) => !open && setMatchReviewReferral(null)}>
          <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-amber-600" />
                Patient Match Review
              </DialogTitle>
            </DialogHeader>
            <PatientMatchReview
              referral={matchReviewReferral}
              onConfirmMatch={handleConfirmMatch}
              onCreateNew={handleCreateNewFromReview}
              onClose={() => setMatchReviewReferral(null)}
            />
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={!!referralToDelete} onOpenChange={(open) => { if (!open) setReferralToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Referral</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the referral for {referralToDelete?.patient_name || 'this patient'}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                handleDeleteReferral(referralToDelete.id);
                setReferralToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!referralToReject} onOpenChange={(open) => { if (!open) setReferralToReject(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Referral</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reject the referral for {referralToReject?.patient_name || 'this patient'}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 hover:bg-orange-700"
              onClick={() => {
                handleRejectReferral(referralToReject.id);
                setReferralToReject(null);
              }}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </TabsContent>

        <TabsContent value="process">
          <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}>
            <ReferralProcessor />
          </Suspense>
        </TabsContent>

        <TabsContent value="admission">
          <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}>
            <ReferralAdmissionNote />
          </Suspense>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}