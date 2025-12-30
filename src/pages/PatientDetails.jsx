import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  ArrowLeft,
  Calendar,
  Plus,
  User,
  FileText,
  AlertTriangle,
  Phone,
  MapPin,
  Shield,
  Heart,
  Stethoscope,
  Activity,
  Pill,
  History,
  ClipboardList,
  ExternalLink
} from "lucide-react";
import { format, isValid, parseISO } from "date-fns";
import { formatEastern } from "@/components/utils/timezone";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";

import {
  canAccessPatient,
  logSecurityEvent,
  sanitizeInput
} from "@/components/utils/security";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

import HospitalReadmissionRisk from "../components/patient/HospitalReadmissionRisk";
import ClinicalBestPracticeAlerts from "../components/quality/ClinicalBestPracticeAlerts";
import AIPatientSummary from "../components/patient/AIPatientSummary";
import AIPatientHistorySummary from "../components/patient/AIPatientHistorySummary";
import AICarePlanSuggestions from "../components/carePlan/AICarePlanSuggestions";
import CarePlanTimelinePredictor from "../components/carePlan/CarePlanTimelinePredictor";
import PatientFriendlyCarePlanSummary from "../components/carePlan/PatientFriendlyCarePlanSummary";
import CarePlanEvolution from "../components/carePlan/CarePlanEvolution";
import PatientRiskStratification from "../components/patient/PatientRiskStratification";
import DischargeSummaryGenerator from "../components/discharge/DischargeSummaryGenerator";
import AIPatientDashboardSummary from "../components/patient/AIPatientDashboardSummary";
import QuickActionsPanel from "../components/patient/QuickActionsPanel";
import AIPatientHistoryAnalyzer from "../components/patient/AIPatientHistoryAnalyzer";
import AIComplianceAuditor from "../components/compliance/AIComplianceAuditor";
import FavoriteButton from "../components/navigation/FavoriteButton";
import PredictiveRiskAnalyzer from "../components/analytics/PredictiveRiskAnalyzer";
import RiskAlertWidget from "../components/alerts/RiskAlertWidget";
import ReferralLetterGenerator from "../components/documents/ReferralLetterGenerator";
import PatientDeteriorationPredictor from "../components/predictive/PatientDeteriorationPredictor";
import MedicationInteractionChecker from "../components/medication/MedicationInteractionChecker";
import CarePlanGapAnalyzer from "../components/carePlan/CarePlanGapAnalyzer";
import InterdisciplinaryTeamCoordinator from "../components/coordination/InterdisciplinaryTeamCoordinator";
import AutomatedTaskAssigner from "../components/coordination/AutomatedTaskAssigner";
import OptimalCommunicationAdvisor from "../components/coordination/OptimalCommunicationAdvisor";
import PatientEducationGenerator from "../components/documents/PatientEducationGenerator";
import ProgressReportGenerator from "../components/documents/ProgressReportGenerator";
import ClinicalNoteReviewer from "../components/review/ClinicalNoteReviewer";
import { Sparkles, FileOutput, GraduationCap, TrendingUp, Brain } from "lucide-react";
import PredictiveAnalyticsPanel from "../components/oasis/PredictiveAnalyticsPanel";
import PatientChartRecommendations from "../components/patient/PatientChartRecommendations";
import AIPatientAnalyzer from "../components/patient/AIPatientAnalyzer";
import PatientSummaryGenerator from "../components/patient/PatientSummaryGenerator";
import PatientEventsTimeline from "../components/patient/PatientEventsTimeline";
import VitalSignsTrendsChart from "../components/patient/VitalSignsTrendsChart";
import PatientRiskAnalysisPanel from "../components/risk/PatientRiskAnalysisPanel";
import RiskAlertConfiguration from "../components/risk/RiskAlertConfiguration";

export default function PatientDetails() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const patientId = urlParams.get("id") || urlParams.get("patientId");

  const [showVisitForm, setShowVisitForm] = useState(false);
  const [newVisit, setNewVisit] = useState({
    visit_date: format(new Date(), "yyyy-MM-dd"),
    visit_time: "",
    visit_type: "routine_visit",
    status: "scheduled"
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  // Log access when component mounts
  React.useEffect(() => {
    if (patientId && currentUser?.email) {
      logSecurityEvent("PATIENT_DETAILS_ACCESSED", { patient_id: patientId });
      logActivity(ActivityActions.VIEW, {
        entity_type: "Patient",
        entity_id: patientId,
        page: "PatientDetails"
      });
    }
  }, [patientId, currentUser?.email]);

  const { data: patients } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  const patient = patients?.find((p) => p.id === patientId);
  const isLoading = !patients;

  const { data: visits } = useQuery({
    queryKey: ["patientVisits", patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, "-visit_date"),
    initialData: [],
    enabled: !!patientId
  });

  const { data: carePlans } = useQuery({
    queryKey: ["patientCarePlans", patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    initialData: [],
    enabled: !!patientId
  });

  const { data: incidents } = useQuery({
    queryKey: ["patientIncidents", patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }, "-incident_date"),
    initialData: [],
    enabled: !!patientId
  });

  const { data: tasks } = useQuery({
    queryKey: ["patientTasks", patientId],
    queryFn: () => base44.entities.Task.filter({ patient_id: patientId }),
    initialData: [],
    enabled: !!patientId
  });

  const { data: patientOASIS = [] } = useQuery({
    queryKey: ["patientOASIS", patientId],
    queryFn: () => base44.entities.OASISUpload.filter({ patient_id: patientId }, "-created_date"),
    initialData: [],
    enabled: !!patientId
  });

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ["patientActiveAlerts", patientId],
    queryFn: () => base44.entities.PatientAlert.filter({ patient_id: patientId, status: "active" }),
    initialData: [],
    enabled: !!patientId
  });

  const [detectedCarePlanGaps, setDetectedCarePlanGaps] = useState(null);
  const [detectedMedicationIssues, setDetectedMedicationIssues] = useState(null);

  // Calculate critical indicators
  const hasCriticalAlerts = activeAlerts.some((a) => a.severity === "critical");
  const hasHighAlerts = activeAlerts.some((a) => a.severity === "high");
  const criticalAlertCount = activeAlerts.filter((a) => a.severity === "critical").length;
  const highAlertCount = activeAlerts.filter((a) => a.severity === "high").length;

  const createCarePlanMutation = useMutation({
    mutationFn: (carePlanData) =>
      base44.entities.CarePlan.create({ ...carePlanData, patient_id: patientId }),
    onSuccess: (newPlan) => {
      queryClient.invalidateQueries({ queryKey: ["patientCarePlans", patientId] });
      logActivity(ActivityActions.CARE_PLAN_CREATE, {
        entity_type: "CarePlan",
        entity_id: newPlan.id,
        patient_id: patientId,
        problem: newPlan.problem,
        page: "PatientDetails"
      });
    }
  });

  const createVisitMutation = useMutation({
    mutationFn: (visitData) => base44.entities.Visit.create({ ...visitData, patient_id: patientId }),
    onSuccess: (newVisit) => {
      queryClient.invalidateQueries({ queryKey: ["patientVisits", patientId] });
      setShowVisitForm(false);
      setNewVisit({
        visit_date: format(new Date(), "yyyy-MM-dd"),
        visit_time: "",
        visit_type: "routine_visit",
        status: "scheduled"
      });
      logActivity(ActivityActions.CREATE, {
        entity_type: "Visit",
        entity_id: newVisit.id,
        patient_id: patientId,
        visit_type: newVisit.visit_type,
        visit_date: newVisit.visit_date,
        page: "PatientDetails"
      });
    }
  });

  const handleCreateVisit = () => {
    // Sanitize inputs
    const sanitizedVisit = {
      ...newVisit,
      visit_time: sanitizeInput(newVisit.visit_time)
    };
    createVisitMutation.mutate(sanitizedVisit);
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-gray-500">
            Loading patient information...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isLoading && !patient) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Patient not found</h2>
            <p className="text-sm text-gray-600 mb-4">Patient ID: {patientId}</p>
            <Button onClick={() => navigate(createPageUrl("Patients"))}>Return to Patients</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    // MOBILE FIX: enforce max width + prevent horizontal overflow
    <div className="w-full max-w-full overflow-x-hidden">
      {/* MOBILE FIX: add max-w-full + overflow-x-hidden + min-w-0 so children can shrink */}
      <div className="p-2 sm:p-3 md:p-4 lg:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 w-full max-w-full overflow-x-hidden min-w-0">
        <Button
          variant="outline"
          onClick={() => navigate(createPageUrl("Patients"))}
          className="mb-3 sm:mb-4 w-full sm:w-auto touch-target"
          size="sm"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Patients
        </Button>

        <Card
          className={`mb-3 sm:mb-4 w-full max-w-full ${
            hasCriticalAlerts
              ? "bg-gradient-to-r from-red-50 to-orange-50 border-red-300"
              : hasHighAlerts
              ? "bg-gradient-to-r from-orange-50 to-yellow-50 border-orange-300"
              : "bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200"
          }`}
        >
          <CardContent className="p-3 sm:p-4 w-full max-w-full overflow-hidden">
            <div className="flex items-start gap-2 sm:gap-3 w-full min-w-0">
              <div
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center shadow-lg flex-shrink-0 relative ${
                  hasCriticalAlerts
                    ? "bg-gradient-to-br from-red-500 to-orange-500"
                    : hasHighAlerts
                    ? "bg-gradient-to-br from-orange-500 to-yellow-500"
                    : "bg-gradient-to-br from-blue-500 to-indigo-500"
                }`}
              >
                <User className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                {(hasCriticalAlerts || hasHighAlerts) && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-red-600 rounded-full border-2 border-white animate-pulse flex items-center justify-center">
                    <AlertTriangle className="w-2 h-2 sm:w-2.5 sm:h-2.5 text-white" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex items-start justify-between gap-2 mb-1.5 min-w-0">
                  <h1 className="text-base sm:text-lg md:text-xl font-bold text-gray-900 break-words leading-tight min-w-0">
                    {sanitizeInput(patient.first_name)} {sanitizeInput(patient.last_name)}
                  </h1>
                  <div className="flex-shrink-0">
                    <FavoriteButton type="patient" id={patient.id} name={`${patient.first_name} ${patient.last_name}`} />
                  </div>
                </div>

                <div className="flex flex-col gap-0.5 text-xs text-gray-600 mb-1.5 overflow-hidden">
                  <span className="truncate">
                    MRN: {sanitizeInput(patient.medical_record_number) || "N/A"}
                  </span>
                  <span className="truncate">
                    DOB:{" "}
                    {patient.date_of_birth && isValid(new Date(patient.date_of_birth))
                      ? format(new Date(patient.date_of_birth), "MM/dd/yyyy")
                      : "N/A"}
                  </span>
                </div>

                <div className="flex flex-wrap items-start gap-1 overflow-hidden">
                  <Badge
                    className={`text-xs whitespace-nowrap ${
                      patient.care_type === "hospice"
                        ? "bg-purple-100 text-purple-800 border-purple-200"
                        : "bg-blue-100 text-blue-800 border-blue-200"
                    }`}
                  >
                    {patient.care_type === "hospice" ? "Hospice" : "Home Health"}
                  </Badge>

                  {patient.primary_diagnosis && (
                    // MOBILE FIX: allow smaller max width on phones to avoid pushing layout
                    <Badge className="bg-green-100 text-green-800 border-green-200 text-xs max-w-[72vw] sm:max-w-[200px] truncate">
                      {sanitizeInput(patient.primary_diagnosis)}
                    </Badge>
                  )}

                  {patient.secondary_diagnoses && patient.secondary_diagnoses.length > 0 && (
                    <Badge variant="outline" className="bg-gray-50 text-gray-500 text-xs whitespace-nowrap">
                      +{patient.secondary_diagnoses.length} more
                    </Badge>
                  )}

                  {hasCriticalAlerts && (
                    <Badge className="bg-red-600 text-white animate-pulse text-xs whitespace-nowrap">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      {criticalAlertCount} Critical
                    </Badge>
                  )}

                  {hasHighAlerts && !hasCriticalAlerts && (
                    <Badge className="bg-orange-600 text-white text-xs whitespace-nowrap">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      {highAlertCount} High
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI-Generated Recommendations from OASIS */}
        <div className="mb-3 sm:mb-4 w-full max-w-full overflow-hidden min-w-0">
          <PatientChartRecommendations patientId={patientId} />
        </div>

        {/* Care Coordination Tools */}
        {/* MOBILE FIX: ensure grid items can shrink; prevent overflow */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4 w-full max-w-full overflow-hidden min-w-0">
          <div className="min-w-0 max-w-full overflow-hidden">
            <InterdisciplinaryTeamCoordinator
              patientId={patientId}
              patientData={patient}
              carePlans={carePlans}
              recentVisits={visits?.filter((v) => v.status === "completed").slice(0, 5)}
              incidents={incidents}
              alerts={activeAlerts}
              autoAnalyze={true}
            />
          </div>

          <div className="min-w-0 max-w-full overflow-hidden">
            <OptimalCommunicationAdvisor
              patientId={patientId}
              patientData={patient}
              recentVisits={visits?.filter((v) => v.status === "completed").slice(0, 3)}
              upcomingVisits={visits?.filter((v) => v.status === "scheduled")}
              outreachPurpose="Care coordination and status update"
            />
          </div>
        </div>

        {/* Automated Task Assignment */}
        {(detectedCarePlanGaps || detectedMedicationIssues || activeAlerts.length > 0) && (
          <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <AutomatedTaskAssigner
              patientId={patientId}
              patientName={`${patient?.first_name} ${patient?.last_name}`}
              detectedGaps={detectedCarePlanGaps?.missing_elements}
              medicationIssues={detectedMedicationIssues?.critical_interactions}
              carePlanGaps={detectedCarePlanGaps}
            />
          </div>
        )}

        {/* AI Risk Analysis Panel */}
        <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
          <PatientRiskAnalysisPanel patientId={patientId} />
        </div>

        {/* Risk Alert Configuration */}
        <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
          <RiskAlertConfiguration patientId={patientId} />
        </div>

        {/* Risk Alerts & Predictive Analytics */}
        {/* MOBILE FIX: prevent overflow by ensuring each cell can shrink */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
          <div className="min-w-0 max-w-full overflow-hidden">
            <RiskAlertWidget patientId={patientId} compact={false} />
          </div>

          <div className="min-w-0 max-w-full overflow-hidden">
            <PatientDeteriorationPredictor
              patientId={patientId}
              recentVisits={visits?.filter((v) => v.status === "completed").slice(0, 10)}
              autoAnalyze={true}
            />
          </div>

          <div className="min-w-0 max-w-full overflow-hidden">
            <MedicationInteractionChecker
              medications={patient?.current_medications || []}
              patientDiagnoses={[
                patient?.primary_diagnosis,
                ...(patient?.secondary_diagnoses || [])
              ].filter(Boolean)}
              patientAge={
                patient?.date_of_birth
                  ? Math.floor(
                      (new Date().getTime() - new Date(patient.date_of_birth).getTime()) /
                        (365.25 * 24 * 60 * 60 * 1000)
                    )
                  : null
              }
              patientAllergies={patient?.allergies}
              autoCheck={true}
            />
          </div>

          <div className="min-w-0 max-w-full overflow-hidden">
            <CarePlanGapAnalyzer
              patientId={patientId}
              diagnosis={patient?.primary_diagnosis}
              carePlans={carePlans}
              recentVisits={visits?.filter((v) => v.status === "completed").slice(0, 5)}
              patientData={patient}
              autoAnalyze={true}
            />
          </div>

          <div className="min-w-0 max-w-full overflow-hidden">
            <PredictiveRiskAnalyzer
              patientId={patientId}
              patientName={`${patient.first_name} ${patient.last_name}`}
              onAlertsCreated={(count) => {
                queryClient.invalidateQueries({ queryKey: ["patientRiskAlerts", patientId] });
                queryClient.invalidateQueries({ queryKey: ["patientActiveAlerts", patientId] });
              }}
              autoAnalyze={false}
            />
          </div>
        </div>

        {/* Vital Signs Trends Chart */}
        <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
          <VitalSignsTrendsChart visits={visits} patient={patient} />
        </div>

        {/* Patient Events Timeline */}
        <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
          <PatientEventsTimeline visits={visits} incidents={incidents} carePlans={carePlans} patient={patient} />
        </div>

        {/* AI Patient Dashboard Summary & Quick Actions */}
        {/* MOBILE FIX: ensure children can shrink; prevent overflow */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
          <div className="lg:col-span-2 min-w-0 max-w-full overflow-hidden">
            <AIPatientDashboardSummary patient={patient} visits={visits} carePlans={carePlans} tasks={tasks} incidents={incidents} />
          </div>
          <div className="min-w-0 max-w-full overflow-hidden">
            <QuickActionsPanel
              patient={patient}
              recentVisits={visits.filter((v) => v.status === "completed").slice(0, 5)}
              upcomingVisits={visits.filter((v) => v.status === "scheduled")}
              activeCarePlans={carePlans.filter((cp) => cp.status === "active")}
              pendingTasks={tasks.filter((t) => t.status === "pending")}
            />
          </div>
        </div>

        {/* AI Compliance Auditor - Prominent */}
        {patient && (
          <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <AIComplianceAuditor patientId={patientId} autoRun={false} scope="comprehensive" />
          </div>
        )}

        {/* AI Risk Stratification - Prominent */}
        {patient && (
          <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <PatientRiskStratification patient={patient} visits={visits} carePlans={carePlans} incidents={incidents} autoCalculate={true} />
          </div>
        )}

        {/* AI Patient History Summary - Prominent */}
        {patient && (
          <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <AIPatientHistorySummary
              patient={patient}
              visits={visits}
              carePlans={carePlans}
              incidents={incidents}
              autoGenerate={true}
              prominent={true}
            />
          </div>
        )}

        {/* AI Predictive Analytics - Outcomes & Interventions */}
        {patient && (
          <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <PredictiveAnalyticsPanel
              patient={patient}
              oasisData={patientOASIS[0]?.extracted_data}
              historicalVisits={visits}
              carePlans={carePlans}
              incidents={incidents}
            />
          </div>
        )}

        {/* AI Patient History Analyzer - Comprehensive Analysis with Gap Detection */}
        {patient && (
          <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <AIPatientHistoryAnalyzer patient={patient} visits={visits} carePlans={carePlans} oasisData={patientOASIS} incidents={incidents} />
          </div>
        )}

        {/* AI-Powered Clinical Analysis - Diagnoses, Risks, Care Recommendations */}
        {patient && (
          <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <AIPatientAnalyzer patient={patient} visits={visits} carePlans={carePlans} incidents={incidents} />
          </div>
        )}

        {/* Patient Summary Generator - Multiple Formats */}
        {patient && (
          <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <PatientSummaryGenerator patient={patient} visits={visits} carePlans={carePlans} incidents={incidents} />
          </div>
        )}

        {/* AI Care Plan Evolution */}
        {patient && carePlans.length > 0 && (
          <div className="mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <CarePlanEvolution
              patientId={patientId}
              patientName={`${patient.first_name} ${patient.last_name}`}
              carePlans={carePlans}
              visits={visits}
              onCarePlanUpdated={() => queryClient.invalidateQueries({ queryKey: ["patientCarePlans", patientId] })}
            />
          </div>
        )}

        {/* AI Care Plan Tools */}
        {patient && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4 max-w-full overflow-hidden min-w-0">
            <div className="min-w-0 max-w-full overflow-hidden">
              <AICarePlanSuggestions
                patient={patient}
                existingCarePlans={carePlans}
                onAddCarePlan={(data) => createCarePlanMutation.mutate(data)}
              />
            </div>
            <div className="space-y-3 sm:space-y-4 min-w-0 max-w-full overflow-hidden">
              <CarePlanTimelinePredictor patient={patient} carePlans={carePlans} />
              <PatientFriendlyCarePlanSummary patient={patient} carePlans={carePlans} />
            </div>
          </div>
        )}

        {/* Critical Alerts Banner */}
        {activeAlerts.length > 0 && (
          <Alert className={`mb-3 sm:mb-4 ${hasCriticalAlerts ? "bg-red-50 border-red-300" : "bg-orange-50 border-orange-300"}`}>
            <AlertTriangle className={`w-4 h-4 ${hasCriticalAlerts ? "text-red-600" : "text-orange-600"}`} />
            <AlertDescription>
              <p className="font-semibold mb-1">Active Patient Alerts ({activeAlerts.length})</p>
              <div className="space-y-1">
                {activeAlerts.slice(0, 3).map((alert, idx) => (
                  <p key={idx} className="text-sm">
                    • {alert.title}
                  </p>
                ))}
                {activeAlerts.length > 3 && (
                  <p className="text-sm text-gray-600">+ {activeAlerts.length - 3} more alerts</p>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4 w-full max-w-full overflow-hidden min-w-0">
          <Card className="w-full max-w-full overflow-hidden min-w-0">
            <CardHeader className="p-3 sm:p-4">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                Patient Information
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 space-y-2 sm:space-y-3 overflow-hidden">
              <div className="overflow-hidden">
                <p className="text-sm font-medium text-gray-500 flex items-center gap-1">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  Address
                </p>
                <p className="text-gray-900 text-sm break-words">{sanitizeInput(patient.address) || "Not specified"}</p>
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-medium text-gray-500 flex items-center gap-1">
                  <Phone className="w-3 h-3 flex-shrink-0" />
                  Phone
                </p>
                <p className="text-gray-900 text-sm break-words">{sanitizeInput(patient.phone) || "Not specified"}</p>
              </div>
              {patient.email && (
                <div className="overflow-hidden">
                  <p className="text-sm font-medium text-gray-500">Email</p>
                  <p className="text-gray-900 text-sm break-all">{sanitizeInput(patient.email)}</p>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-gray-500">Status</p>
                <Badge variant="outline">{patient.status || "active"}</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="w-full max-w-full overflow-hidden min-w-0">
            <CardHeader className="p-3 sm:p-4">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Heart className="w-4 h-4 text-red-600" />
                Emergency Contact
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 space-y-2 sm:space-y-3 overflow-hidden">
              {patient.emergency_contact_name ? (
                <>
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium text-gray-500">Name</p>
                    <p className="text-gray-900 text-sm break-words">{sanitizeInput(patient.emergency_contact_name)}</p>
                  </div>
                  {patient.emergency_contact_relationship && (
                    <div className="overflow-hidden">
                      <p className="text-sm font-medium text-gray-500">Relationship</p>
                      <p className="text-gray-900 text-sm break-words">{sanitizeInput(patient.emergency_contact_relationship)}</p>
                    </div>
                  )}
                  {patient.emergency_contact_phone && (
                    <div className="overflow-hidden">
                      <p className="text-sm font-medium text-gray-500 flex items-center gap-1">
                        <Phone className="w-3 h-3 flex-shrink-0" />
                        Phone
                      </p>
                      <p className="text-gray-900 text-sm break-words">{sanitizeInput(patient.emergency_contact_phone)}</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500">No emergency contact information on file</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4 w-full max-w-full overflow-hidden min-w-0">
          <Card className="w-full max-w-full overflow-hidden min-w-0">
            <CardHeader className="p-3 sm:p-4">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-green-600" />
                Physician & Payor
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 space-y-3 sm:space-y-4 overflow-hidden">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Primary Care Physician</p>
                {patient.physician_name ? (
                  <div className="space-y-2 overflow-hidden">
                    <p className="text-gray-900 font-medium text-sm break-words">{sanitizeInput(patient.physician_name)}</p>
                    {patient.physician_phone && (
                      <p className="text-sm text-gray-600 flex items-center gap-1 break-words">
                        <Phone className="w-3 h-3 flex-shrink-0" />
                        <span className="break-all">{sanitizeInput(patient.physician_phone)}</span>
                      </p>
                    )}
                    {patient.physician_email && (
                      <p className="text-sm text-gray-600 break-all">{sanitizeInput(patient.physician_email)}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No physician information</p>
                )}
              </div>

              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Payor / Insurance</p>
                {patient.payor ? (
                  <Badge className="bg-purple-100 text-purple-800 text-sm">{sanitizeInput(patient.payor)}</Badge>
                ) : (
                  <p className="text-sm text-gray-500">No payor specified</p>
                )}
              </div>

              {(patient.insurance_primary?.provider || patient.insurance_secondary?.provider) && (
                <div className="border-t pt-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Additional Insurance</p>
                  {patient.insurance_primary?.provider && (
                    <div className="mb-3">
                      <p className="text-sm font-medium text-gray-700">Primary</p>
                      <p className="text-gray-900">{sanitizeInput(patient.insurance_primary.provider)}</p>
                      {patient.insurance_primary.policy_number && (
                        <p className="text-xs text-gray-600">
                          Policy: {sanitizeInput(patient.insurance_primary.policy_number)}
                        </p>
                      )}
                    </div>
                  )}
                  {patient.insurance_secondary?.provider && (
                    <div>
                      <p className="text-sm font-medium text-gray-700">Secondary</p>
                      <p className="text-gray-900">{sanitizeInput(patient.insurance_secondary.provider)}</p>
                      {patient.insurance_secondary.policy_number && (
                        <p className="text-xs text-gray-600">
                          Policy: {sanitizeInput(patient.insurance_secondary.policy_number)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detailed Medical Information Tabs */}
        <Card className="mb-3 sm:mb-4 w-full max-w-full overflow-hidden min-w-0">
          <CardHeader className="p-3 sm:p-4">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              Medical Information
            </CardTitle>
          </CardHeader>

          <CardContent className="p-3 sm:p-4 overflow-hidden">
            <Tabs defaultValue="allergies" className="w-full overflow-hidden">
              {/* MOBILE FIX: make tab list horizontally scrollable instead of grid-cols-6 */}
              <div className="w-full overflow-x-auto">
                <TabsList className="flex w-max min-w-full gap-1 p-1">
                  <TabsTrigger value="allergies" className="text-xs py-2 whitespace-nowrap shrink-0">
                    Allergies
                  </TabsTrigger>
                  <TabsTrigger value="medications" className="text-xs py-2 whitespace-nowrap shrink-0">
                    Meds
                  </TabsTrigger>
                  <TabsTrigger value="history" className="text-xs py-2 whitespace-nowrap shrink-0">
                    History
                  </TabsTrigger>
                  <TabsTrigger value="careplans" className="text-xs py-2 whitespace-nowrap shrink-0">
                    Plans
                  </TabsTrigger>
                  <TabsTrigger value="visits" className="text-xs py-2 whitespace-nowrap shrink-0">
                    Visits
                  </TabsTrigger>
                  <TabsTrigger value="documents" className="flex items-center justify-center gap-1 text-xs py-2 whitespace-nowrap shrink-0">
                    <Sparkles className="w-3 h-3" />
                    <span>Docs</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Allergies Tab */}
              <TabsContent value="allergies" className="space-y-4">
                <Alert
                  className={
                    patient.allergies &&
                    patient.allergies !== "NKDA" &&
                    patient.allergies.toLowerCase() !== "none"
                      ? "bg-red-50 border-red-300"
                      : "bg-green-50 border-green-300"
                  }
                >
                  <AlertTriangle
                    className={`w-4 h-4 ${
                      patient.allergies &&
                      patient.allergies !== "NKDA" &&
                      patient.allergies.toLowerCase() !== "none"
                        ? "text-red-600"
                        : "text-green-600"
                    }`}
                  />
                  <AlertDescription>
                    <p className="font-semibold mb-2">Allergy Information</p>
                    <p className="text-sm">
                      {sanitizeInput(patient.allergies) || "No Known Drug Allergies (NKDA)"}
                    </p>
                  </AlertDescription>
                </Alert>
              </TabsContent>

              {/* Medications Tab */}
              <TabsContent value="medications" className="space-y-3 sm:space-y-4">
                {patient.current_medications && patient.current_medications.length > 0 ? (
                  <div className="space-y-2 sm:space-y-3">
                    {patient.current_medications.map((med, index) => (
                      <Card key={index} className="border-l-4 border-l-blue-500 max-w-full overflow-hidden">
                        <CardContent className="p-3 sm:p-4">
                          <div className="flex flex-col gap-3 min-w-0">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2 min-w-0">
                                <Pill className="w-4 h-4 text-blue-600 flex-shrink-0" />
                                <h4 className="font-semibold text-gray-900 break-words min-w-0">
                                  {sanitizeInput(med.name)}
                                </h4>
                              </div>
                              <div className="space-y-1 text-xs sm:text-sm min-w-0">
                                <p className="text-gray-700 break-words">
                                  <span className="font-medium">Dosage:</span>{" "}
                                  {sanitizeInput(med.dosage) || "Not specified"}
                                </p>
                                <p className="text-gray-700 break-words">
                                  <span className="font-medium">Frequency:</span>{" "}
                                  {sanitizeInput(med.frequency) || "Not specified"}
                                </p>
                                {med.prescriber && (
                                  <p className="text-gray-600 break-words">
                                    <span className="font-medium">Prescriber:</span>{" "}
                                    {sanitizeInput(med.prescriber)}
                                  </p>
                                )}
                                {med.start_date && (
                                  <p className="text-gray-600 text-xs break-words">
                                    Started:{" "}
                                    {isValid(new Date(med.start_date))
                                      ? format(new Date(med.start_date), "MMM d, yyyy")
                                      : "N/A"}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Pill className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p>No current medications documented</p>
                  </div>
                )}
              </TabsContent>

              {/* Medical History Tab */}
              <TabsContent value="history" className="space-y-4">
                <Card className="max-w-full overflow-hidden">
                  <CardHeader>
                    <CardTitle className="text-base">Diagnoses</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Primary Diagnosis</p>
                      <p className="text-gray-900 font-semibold break-words">
                        {sanitizeInput(patient.primary_diagnosis) || "Not specified"}
                      </p>
                    </div>
                    {patient.secondary_diagnoses && patient.secondary_diagnoses.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-500 mb-2">Secondary Diagnoses</p>
                        <div className="flex flex-wrap gap-2">
                          {patient.secondary_diagnoses.map((diagnosis, index) => (
                            <Badge key={index} variant="outline" className="max-w-[80vw] sm:max-w-none truncate">
                              {sanitizeInput(diagnosis)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {patient.past_medical_history && patient.past_medical_history.length > 0 && (
                  <Card className="max-w-full overflow-hidden">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <History className="w-4 h-4" />
                        Past Medical Conditions
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {patient.past_medical_history.map((condition, index) => (
                          <li key={index} className="flex items-start gap-2 p-2 bg-gray-50 rounded min-w-0">
                            <span className="text-blue-600 font-bold">•</span>
                            <span className="text-sm text-gray-900 break-words min-w-0">
                              {sanitizeInput(condition)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {patient.past_hospitalizations && patient.past_hospitalizations.length > 0 && (
                  <Card className="max-w-full overflow-hidden">
                    <CardHeader>
                      <CardTitle className="text-base">Hospitalization History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="max-h-96">
                        <div className="space-y-3">
                          {patient.past_hospitalizations.map((hosp, index) => (
                            <Card key={index} className="border-l-4 border-l-purple-500 max-w-full overflow-hidden">
                              <CardContent className="p-3">
                                <p className="font-semibold text-gray-900 break-words">{hosp.reason}</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs text-gray-600">
                                  <p className="break-words">
                                    <span className="font-medium">Date:</span>{" "}
                                    {hosp.date && isValid(new Date(hosp.date))
                                      ? format(new Date(hosp.date), "MMM d, yyyy")
                                      : "Unknown"}
                                  </p>
                                  <p className="break-words">
                                    <span className="font-medium">Hospital:</span> {hosp.hospital || "N/A"}
                                  </p>
                                  {hosp.length_of_stay && (
                                    <p className="break-words">
                                      <span className="font-medium">Length:</span> {hosp.length_of_stay} days
                                    </p>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Care Plans Tab */}
              <TabsContent value="careplans" className="space-y-4">
                {carePlans.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p>No care plans on file</p>
                  </div>
                ) : (
                  <ScrollArea className="max-h-[500px]">
                    <div className="space-y-3">
                      {carePlans.map((plan) => (
                        <Card
                          key={plan.id}
                          className={`border-l-4 max-w-full overflow-hidden ${
                            plan.status === "met"
                              ? "border-l-green-500 bg-green-50"
                              : plan.status === "not_met"
                              ? "border-l-red-500 bg-red-50"
                              : plan.status === "revised"
                              ? "border-l-yellow-500 bg-yellow-50"
                              : "border-l-blue-500"
                          }`}
                        >
                          <CardContent className="p-4">
                            <div className="flex justify-between items-start mb-3 gap-2 min-w-0">
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-900 break-words">{sanitizeInput(plan.problem)}</p>
                                <p className="text-sm text-gray-600 mt-1 break-words">{sanitizeInput(plan.goal)}</p>
                              </div>
                              <Badge
                                className={
                                  plan.status === "met"
                                    ? "bg-green-500"
                                    : plan.status === "not_met"
                                    ? "bg-red-500"
                                    : plan.status === "revised"
                                    ? "bg-yellow-500"
                                    : "bg-blue-500"
                                }
                              >
                                {plan.status.replace("_", " ")}
                              </Badge>
                            </div>

                            {plan.interventions && plan.interventions.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs font-semibold text-gray-500 mb-1">Interventions:</p>
                                <ul className="space-y-1">
                                  {plan.interventions.map((intervention, idx) => (
                                    <li key={idx} className="text-xs text-gray-700 break-words">
                                      • {sanitizeInput(intervention)}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 text-xs text-gray-500">
                              {plan.target_date && (
                                <span className="break-words">
                                  Target:{" "}
                                  {isValid(new Date(plan.target_date))
                                    ? format(new Date(plan.target_date), "MMM d, yyyy")
                                    : "N/A"}
                                </span>
                              )}
                              {plan.frequency && (
                                <span className="break-words">Frequency: {sanitizeInput(plan.frequency)}</span>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </TabsContent>

              {/* Visit Notes Tab */}
              <TabsContent value="visits" className="space-y-4">
                {visits.length > 0 && visits[0].nurse_notes && (
                  <ClinicalNoteReviewer
                    noteContent={visits[0].nurse_notes}
                    visitType={visits[0].visit_type}
                    diagnosis={patient?.primary_diagnosis}
                    patientData={patient}
                    autoReview={false}
                    onApplySuggestion={(text) => console.log("Suggestion:", text)}
                  />
                )}

                {visits.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p>No visit notes available</p>
                  </div>
                ) : (
                  <ScrollArea className="max-h-[500px]">
                    <div className="space-y-3">
                      {visits
                        .filter((v) => v.nurse_notes || v.status === "completed")
                        .map((visit) => (
                          <Card key={visit.id} className="border-l-4 border-l-indigo-500 max-w-full overflow-hidden">
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start mb-3 gap-2 min-w-0">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1 min-w-0">
                                    <p className="font-semibold text-gray-900 break-words min-w-0">
                                      {visit.visit_date && isValid(new Date(visit.visit_date))
                                        ? format(new Date(visit.visit_date), "MMM d, yyyy")
                                        : "Invalid date"}
                                    </p>
                                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                                      {visit.visit_type.replace(/_/g, " ")}
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-gray-500 break-words">
                                    By: {visit.created_by} •{" "}
                                    {visit.created_date ? formatEastern(visit.created_date, "hh:mm a") : ""}
                                  </p>
                                </div>

                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="shrink-0"
                                  onClick={() => navigate(`${createPageUrl("DocumentVisit")}?visitId=${visit.id}`)}
                                >
                                  <ExternalLink className="w-3 h-3 mr-1" />
                                  View
                                </Button>
                              </div>

                              {visit.nurse_notes && (
                                <div className="bg-gray-50 p-3 rounded-lg max-w-full overflow-hidden">
                                  <p className="text-sm text-gray-900 whitespace-pre-wrap line-clamp-4 break-words">
                                    {sanitizeInput(visit.nurse_notes)}
                                  </p>
                                </div>
                              )}

                              {visit.vital_signs && Object.keys(visit.vital_signs).length > 0 && (
                                <div className="mt-3 pt-3 border-t">
                                  <p className="text-xs font-semibold text-gray-500 mb-2">Vital Signs:</p>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    {visit.vital_signs.blood_pressure_systolic && (
                                      <div className="bg-white p-2 rounded">
                                        <p className="text-gray-500">BP</p>
                                        <p className="font-semibold">
                                          {visit.vital_signs.blood_pressure_systolic}/
                                          {visit.vital_signs.blood_pressure_diastolic}
                                        </p>
                                      </div>
                                    )}
                                    {visit.vital_signs.heart_rate && (
                                      <div className="bg-white p-2 rounded">
                                        <p className="text-gray-500">HR</p>
                                        <p className="font-semibold">{visit.vital_signs.heart_rate} bpm</p>
                                      </div>
                                    )}
                                    {visit.vital_signs.temperature && (
                                      <div className="bg-white p-2 rounded">
                                        <p className="text-gray-500">Temp</p>
                                        <p className="font-semibold">{visit.vital_signs.temperature}°F</p>
                                      </div>
                                    )}
                                    {visit.vital_signs.oxygen_saturation && (
                                      <div className="bg-white p-2 rounded">
                                        <p className="text-gray-500">O2 Sat</p>
                                        <p className="font-semibold">{visit.vital_signs.oxygen_saturation}%</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                    </div>
                  </ScrollArea>
                )}
              </TabsContent>

              {/* Documents Tab */}
              <TabsContent value="documents" className="space-y-4">
                <Tabs defaultValue="discharge" className="space-y-4">
                  {/* MOBILE FIX: make docs sub-tabs scrollable */}
                  <div className="w-full overflow-x-auto">
                    <TabsList className="flex w-max min-w-full gap-2 p-1">
                      <TabsTrigger value="discharge" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4 whitespace-nowrap shrink-0">
                        <FileOutput className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span className="hidden sm:inline">Discharge</span>
                        <span className="sm:hidden">DC</span>
                      </TabsTrigger>
                      <TabsTrigger value="referral" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4 whitespace-nowrap shrink-0">
                        <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span className="hidden sm:inline">Referral</span>
                        <span className="sm:hidden">Ref</span>
                      </TabsTrigger>
                      <TabsTrigger value="education" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4 whitespace-nowrap shrink-0">
                        <GraduationCap className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span className="hidden sm:inline">Education</span>
                        <span className="sm:hidden">Edu</span>
                      </TabsTrigger>
                      <TabsTrigger value="progress" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4 whitespace-nowrap shrink-0">
                        <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span className="hidden sm:inline">Progress</span>
                        <span className="sm:hidden">Prog</span>
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="discharge">
                    <DischargeSummaryGenerator patientId={patientId} patient={patient} />
                  </TabsContent>

                  <TabsContent value="referral">
                    <ReferralLetterGenerator patientId={patientId} patient={patient} />
                  </TabsContent>

                  <TabsContent value="education">
                    <PatientEducationGenerator patientId={patientId} patient={patient} />
                  </TabsContent>

                  <TabsContent value="progress">
                    <ProgressReportGenerator patientId={patientId} patient={patient} />
                  </TabsContent>
                </Tabs>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="w-full max-w-full overflow-hidden min-w-0">
          <CardHeader className="p-3 sm:p-4">
            <div className="flex flex-col gap-3">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Quick Actions
              </CardTitle>
              <Button onClick={() => setShowVisitForm(!showVisitForm)} className="bg-blue-600 hover:bg-blue-700 w-full touch-target">
                <Plus className="w-4 h-4 mr-2" />
                Schedule Visit
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-3 sm:p-4 overflow-hidden">
            {showVisitForm && (
              <Card className="mb-3 sm:mb-4 bg-blue-50 border-blue-200 max-w-full overflow-hidden">
                <CardContent className="p-3 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <Label className="text-sm">Visit Date</Label>
                      <Input
                        type="date"
                        value={newVisit.visit_date}
                        onChange={(e) => setNewVisit({ ...newVisit, visit_date: e.target.value })}
                        className="h-11 sm:h-10"
                      />
                    </div>
                    <div>
                      <Label className="text-sm">Visit Time</Label>
                      <Input
                        type="time"
                        value={newVisit.visit_time}
                        onChange={(e) => setNewVisit({ ...newVisit, visit_time: e.target.value })}
                        className="h-11 sm:h-10"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm">Visit Type</Label>
                    <Select value={newVisit.visit_type} onValueChange={(value) => setNewVisit({ ...newVisit, visit_type: value })}>
                      <SelectTrigger className="h-11 sm:h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                        <SelectItem value="admission">Admission</SelectItem>
                        <SelectItem value="recertification">Recertification</SelectItem>
                        <SelectItem value="discharge">Discharge</SelectItem>
                        <SelectItem value="routine_visit">Routine Visit</SelectItem>
                        <SelectItem value="prn">PRN Visit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button onClick={handleCreateVisit} className="bg-blue-600 hover:bg-blue-700 w-full touch-target">
                      Create Visit
                    </Button>
                    <Button variant="outline" onClick={() => setShowVisitForm(false)} className="w-full touch-target">
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}