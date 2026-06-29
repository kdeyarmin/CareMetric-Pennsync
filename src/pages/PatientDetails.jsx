import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Calendar, Plus, User, FileText, AlertTriangle, Phone, MapPin, Heart, Stethoscope, Activity, ClipboardList, ExternalLink, Users } from "lucide-react";
import { format, isValid, parseISO } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

import { logSecurityEvent, sanitizeInput } from "@/components/utils/security";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

import ProactiveClinicalTaskGenerator from "../components/tasks/ProactiveClinicalTaskGenerator";
import AIPatientHistorySummary from "../components/patient/AIPatientHistorySummary";
import AICarePlanSuggestions from "../components/carePlan/AICarePlanSuggestions";
import PatientRiskStratification from "../components/patient/PatientRiskStratification";
import DischargeSummaryGenerator from "../components/discharge/DischargeSummaryGenerator";
import AIPatientDashboardSummary from "../components/patient/AIPatientDashboardSummary";
import QuickActionsPanel from "../components/patient/QuickActionsPanel";
import AIComplianceAuditor from "../components/compliance/AIComplianceAuditor";
import PredictiveRiskAnalyzer from "../components/analytics/PredictiveRiskAnalyzer";
import RiskAlertWidget from "../components/alerts/RiskAlertWidget";
import ReferralLetterGenerator from "../components/documents/ReferralLetterGenerator";
import PatientDeteriorationPredictor from "../components/predictive/PatientDeteriorationPredictor";
import CarePlanGapAnalyzer from "../components/carePlan/CarePlanGapAnalyzer";
import InterdisciplinaryTeamCoordinator from "../components/coordination/InterdisciplinaryTeamCoordinator";
import OptimalCommunicationAdvisor from "../components/coordination/OptimalCommunicationAdvisor";
import ProgressReportGenerator from "../components/documents/ProgressReportGenerator";
import PersonalizedEducationGenerator from "../components/patient/PersonalizedEducationGenerator";
import { Sparkles } from "lucide-react";
import AIPatientAnalyzer from "../components/patient/AIPatientAnalyzer";
import PatientSummaryGenerator from "../components/patient/PatientSummaryGenerator";
import AIProactiveOASISAssistant from "../components/oasis/AIProactiveOASISAssistant";
import AIGeneratedOASISAssessment from "../components/oasis/AIGeneratedOASISAssessment";
import ReferralDocumentViewer from "../components/documents/ReferralDocumentViewer";
import HealthHistorySection from "../components/patient/HealthHistorySection";
import ClinicalEventsTimeline from "../components/patient/ClinicalEventsTimeline";
import DocumentUploader from "../components/documents/DocumentUploader";
import DocumentList from "../components/documents/DocumentList";
import VitalSignsTrendDashboard from "../components/patient/VitalSignsTrendDashboard";
import CarePlanProposalReviewer from "../components/carePlan/CarePlanProposalReviewer";
import PatientTelehealthPanel from "../components/telehealth/PatientTelehealthPanel";
import CareTeamMessaging from "../components/messaging/CareTeamMessaging";
import PatientContactActions from "../components/voice/PatientContactActions";

export default function PatientDetails() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const patientId = urlParams.get('id') || urlParams.get('patientId');

  const [showVisitForm, setShowVisitForm] = useState(false);
  const [showOASISPrompt, setShowOASISPrompt] = useState(false);
  const [oasisTriggerVisit, setOasisTriggerVisit] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [aiToolsTab, setAiToolsTab] = useState("analysis");
  const [isDocumentUploaderOpen, setIsDocumentUploaderOpen] = useState(false);
  const [newVisit, setNewVisit] = useState({
    visit_date: format(new Date(), 'yyyy-MM-dd'),
    visit_time: '',
    visit_type: 'routine_visit',
    status: 'scheduled'
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Log access when component mounts
  React.useEffect(() => {
    if (patientId && currentUser?.email) {
      logSecurityEvent('PATIENT_DETAILS_ACCESSED', { patient_id: patientId });
      logActivity(ActivityActions.VIEW, {
        entity_type: 'Patient',
        entity_id: patientId,
        page: 'PatientDetails'
      });
    }
  }, [patientId, currentUser?.email]);

  // One server-side fetch (getPatientContext) replaces six per-load entity
  // queries. Its queryFn SEEDS the per-entity caches that this page's child
  // components read (['patient',id], ['patientVisits',id], …) so they get cache
  // hits instead of each firing their own request. Re-seeding on every (re)fetch
  // keeps those mirrors fresh after an invalidation. OASIS uploads are
  // intentionally left to the children — that cache key is shape-inconsistent
  // across components (financial-stripped function result vs. raw entity).
  const { data: ctx = {}, isLoading } = useQuery({
    queryKey: ['patientContext', patientId],
    queryFn: async () => {
      const data = (await base44.functions.invoke('getPatientContext', { patientId }))?.data || {};
      queryClient.setQueryData(['patient', patientId], data.patient ? [data.patient] : []);
      queryClient.setQueryData(['patientVisits', patientId], data.visits || []);
      queryClient.setQueryData(['patientCarePlans', patientId], data.carePlans || []);
      queryClient.setQueryData(['patientIncidents', patientId], data.incidents || []);
      queryClient.setQueryData(['patientTasks', patientId], data.tasks || []);
      queryClient.setQueryData(['patientActiveAlerts', patientId], data.activeAlerts || []);
      return data;
    },
    enabled: !!patientId,
  });

  const patient = ctx.patient ?? null;
  const visits = ctx.visits ?? [];
  const carePlans = ctx.carePlans ?? [];
  const incidents = ctx.incidents ?? [];
  const tasks = ctx.tasks ?? [];
  const activeAlerts = ctx.activeAlerts ?? [];

  const [_detectedCarePlanGaps, _setDetectedCarePlanGaps] = useState(null);

  // Critical alerts drive the banner styling below the header.
  const hasCriticalAlerts = activeAlerts.some(a => a.severity === 'critical');

  const createCarePlanMutation = useMutation({
    mutationFn: (carePlanData) => base44.entities.CarePlan.create({ ...carePlanData, patient_id: patientId }),
    onSuccess: (newPlan) => {
      // Refetch the consolidated context (re-seeds the care-plan mirror the page
      // renders from); also invalidate the per-key cache for any mounted child.
      queryClient.invalidateQueries({ queryKey: ['patientContext', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patientCarePlans', patientId] });
      logActivity(ActivityActions.CARE_PLAN_CREATE, {
        entity_type: 'CarePlan',
        entity_id: newPlan.id,
        patient_id: patientId,
        problem: newPlan.problem,
        page: 'PatientDetails'
      });
    },
    onError: () => toast.error('Failed to create care plan. Please try again.'),
  });

  const createVisitMutation = useMutation({
    mutationFn: (visitData) => base44.entities.Visit.create({ ...visitData, patient_id: patientId }),
    onSuccess: (newVisit) => {
      queryClient.invalidateQueries({ queryKey: ['patientContext', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patientVisits', patientId] });
      setShowVisitForm(false);
      setNewVisit({
        visit_date: format(new Date(), 'yyyy-MM-dd'),
        visit_time: '',
        visit_type: 'routine_visit',
        status: 'scheduled'
      });
      logActivity(ActivityActions.CREATE, {
        entity_type: 'Visit',
        entity_id: newVisit.id,
        patient_id: patientId,
        visit_type: newVisit.visit_type,
        visit_date: newVisit.visit_date,
        page: 'PatientDetails'
      });
      
      // Trigger OASIS prompt for admission or recertification visits
      const oasisTriggerTypes = ['admission', 'recertification', 'discharge'];
      if (oasisTriggerTypes.includes(newVisit.visit_type)) {
        setOasisTriggerVisit(newVisit);
        setShowOASISPrompt(true);
      }
    },
    onError: () => toast.error('Failed to create visit. Please try again.'),
  });

  const handleCreateVisit = () => {
    // Sanitize inputs
    const sanitizedVisit = {
      ...newVisit,
      visit_time: sanitizeInput(newVisit.visit_time),
    };
    createVisitMutation.mutate(sanitizedVisit);
  };

  if (isLoading && !patient) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-slate-500">
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
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Patient not found</h2>
            <p className="text-sm text-slate-600 mb-4">Patient ID: {patientId}</p>
            <Button onClick={() => navigate(createPageUrl("Patients"))}>
              Return to Patients
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Users}
        eyebrow="Patient Care"
        title={`${sanitizeInput(patient.first_name)} ${sanitizeInput(patient.last_name)}`}
        description={`MRN: ${sanitizeInput(patient.medical_record_number) || 'N/A'} · DOB: ${patient.date_of_birth && isValid(new Date(patient.date_of_birth)) ? format(new Date(patient.date_of_birth), 'MM/dd/yyyy') : 'N/A'}`}
        favoritePage="PatientDetails"
        actions={
          <Button
            variant="outline"
            onClick={() => navigate(createPageUrl("Patients"))}
            size="sm"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Back to Patients</span>
            <span className="sm:hidden">Back</span>
          </Button>
        }
      />

      {/* Critical Alerts Banner */}
      {activeAlerts.length > 0 && (
        <Alert className={`mb-6 ${hasCriticalAlerts ? 'bg-red-50 border-red-300' : 'bg-orange-50 border-orange-300'}`}>
          <AlertTriangle className={`w-4 h-4 ${hasCriticalAlerts ? 'text-red-600' : 'text-orange-600'}`} />
          <AlertDescription>
            <p className="font-semibold mb-1">Active Patient Alerts ({activeAlerts.length})</p>
            <div className="space-y-1">
              {activeAlerts.slice(0, 3).map((alert, idx) => (
                <p key={idx} className="text-sm">• {alert.title}</p>
              ))}
              {activeAlerts.length > 3 && (
                <p className="text-sm text-slate-600">+ {activeAlerts.length - 3} more alerts</p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Patient Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <div className="overflow-x-auto -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 pb-1 scrollbar-hide">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            {[
              { value: "overview",      label: "Overview"  },
              { value: "vitals-trends", label: "Vitals"    },
              { value: "health-history",label: "History"   },
              { value: "clinical",      label: "Clinical"  },
              { value: "events",        label: "Events"    },
              { value: "ai-tools",      label: "AI Tools"  },
              { value: "care",          label: "Care Plans"},
              { value: "telehealth",    label: "Telehealth"},
              { value: "documents",     label: "Docs"      },
              { value: "messaging",     label: "Messaging" },
            ].map(({ value, label }) => (
              <TabsTrigger key={value} value={value} className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] min-w-[72px] text-xs sm:text-sm whitespace-nowrap">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Vital Signs Trends Tab */}
         <TabsContent value="vitals-trends" className="space-y-6 mt-4">
           <VitalSignsTrendDashboard patientId={patientId} />
         </TabsContent>

        {/* Health History Tab */}
         <TabsContent value="health-history" className="space-y-6 mt-4">
           <Card>
             <CardHeader>
               <CardTitle className="text-slate-900">Health History</CardTitle>
             </CardHeader>
             <CardContent className="space-y-6">
               <HealthHistorySection patient={patient} />
             </CardContent>
           </Card>
         </TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <AIPatientDashboardSummary
                patient={patient}
                visits={visits}
                carePlans={carePlans}
                tasks={tasks}
                incidents={incidents}
              />
            </div>
            <div className="space-y-6">
              <PatientContactActions patient={patient} currentUser={currentUser} />
              <QuickActionsPanel
                patient={patient}
                recentVisits={visits.filter(v => v.status === 'completed').slice(0, 5)}
                upcomingVisits={visits.filter(v => v.status === 'scheduled')}
                activeCarePlans={carePlans.filter(cp => cp.status === 'active')}
                pendingTasks={tasks.filter(t => t.status === 'pending')}
              />
            </div>
          </div>

          <RiskAlertWidget patientId={patientId} compact={false} />
        </TabsContent>

        {/* Clinical Events Tab */}
        <TabsContent value="events" className="space-y-4 mt-4">
          <ClinicalEventsTimeline patientId={patient.id} limit={30} />
        </TabsContent>

        {/* Clinical Info Tab */}
        <TabsContent value="clinical" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5 text-navy-600" />
                  Contact Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    Address
                  </p>
                  <p className="text-slate-900">{sanitizeInput(patient.address) || 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500 flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    Phone
                  </p>
                  <p className="text-slate-900">{sanitizeInput(patient.phone) || 'Not specified'}</p>
                </div>
                {patient.email && (
                  <div>
                    <p className="text-sm font-medium text-slate-500">Email</p>
                    <p className="text-slate-900">{sanitizeInput(patient.email)}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Heart className="w-5 h-5 text-red-600" />
                  Emergency Contact
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {patient.emergency_contact_name ? (
                  <>
                    <div>
                      <p className="text-sm font-medium text-slate-500">Name</p>
                      <p className="text-slate-900">{sanitizeInput(patient.emergency_contact_name)}</p>
                    </div>
                    {patient.emergency_contact_relationship && (
                      <div>
                        <p className="text-sm font-medium text-slate-500">Relationship</p>
                        <p className="text-slate-900">{sanitizeInput(patient.emergency_contact_relationship)}</p>
                      </div>
                    )}
                    {patient.emergency_contact_phone && (
                      <div>
                        <p className="text-sm font-medium text-slate-500">Phone</p>
                        <p className="text-slate-900">{sanitizeInput(patient.emergency_contact_phone)}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-500">No emergency contact on file</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Stethoscope className="w-5 h-5 text-emerald-600" />
                  Physician & Payor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {patient.physician_name ? (
                  <div>
                    <p className="text-sm font-medium text-slate-500">Primary Physician</p>
                    <p className="text-slate-900">{sanitizeInput(patient.physician_name)}</p>
                    {patient.physician_phone && (
                      <p className="text-sm text-slate-600">{sanitizeInput(patient.physician_phone)}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No physician on file</p>
                )}
                {patient.payor && (
                  <div>
                    <p className="text-sm font-medium text-slate-500">Payor</p>
                    <Badge className="bg-navy-100 text-navy-800">{sanitizeInput(patient.payor)}</Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-navy-600" />
                Medical Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="allergies">
                <div className="overflow-x-auto scrollbar-hide">
                  <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
                    <TabsTrigger value="allergies" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Allergies</TabsTrigger>
                    <TabsTrigger value="history" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">History</TabsTrigger>
                    <TabsTrigger value="visits" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Recent Visits</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="allergies" className="space-y-4">
                  <Alert className={patient.allergies && patient.allergies !== 'NKDA' && patient.allergies.toLowerCase() !== 'none' ? 'bg-red-50 border-red-300' : 'bg-emerald-50 border-emerald-300'}>
                    <AlertTriangle className={`w-4 h-4 ${patient.allergies && patient.allergies !== 'NKDA' && patient.allergies.toLowerCase() !== 'none' ? 'text-red-600' : 'text-emerald-600'}`} />
                    <AlertDescription>
                      <p className="font-semibold mb-2">Allergy Information</p>
                      <p className="text-sm">{sanitizeInput(patient.allergies) || 'No Known Drug Allergies (NKDA)'}</p>
                    </AlertDescription>
                  </Alert>
                </TabsContent>

                <TabsContent value="history" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Diagnoses</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-slate-500">Primary</p>
                        <p className="text-slate-900 font-semibold">{sanitizeInput(patient.primary_diagnosis) || 'Not specified'}</p>
                      </div>
                      {patient.secondary_diagnoses && patient.secondary_diagnoses.length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-slate-500 mb-2">Secondary</p>
                          <div className="flex flex-wrap gap-2">
                            {patient.secondary_diagnoses.map((diagnosis, index) => (
                              <Badge key={index} variant="outline">{sanitizeInput(diagnosis)}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {patient.past_medical_history && patient.past_medical_history.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Past Conditions</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2">
                          {patient.past_medical_history.map((condition, index) => (
                            <Badge key={index} variant="outline">{sanitizeInput(condition)}</Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="visits" className="space-y-4">
                  {visits.length === 0 ? (
                    <EmptyState icon={FileText} title="No visit notes" description="Visit notes will appear here once recorded." />
                  ) : (
                    <ScrollArea className="max-h-[500px]">
                      <div className="space-y-3">
                        {visits.filter(v => v.nurse_notes).slice(0, 5).map((visit) => (
                          <Card key={visit.id} className="border-l-4 border-l-indigo-500">
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <p className="font-semibold text-slate-900">
                                    {visit.visit_date && isValid(parseISO(visit.visit_date)) ? format(parseISO(visit.visit_date), 'MMM d, yyyy') : 'Invalid date'}
                                  </p>
                                  <Badge variant="outline" className="text-xs mt-1">
                                    {(visit.visit_type || '').replace(/_/g, ' ')}
                                  </Badge>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => navigate(`${createPageUrl("ClinicalDocumentation")}?visitId=${visit.id}`)}
                                >
                                  <ExternalLink className="w-3 h-3 mr-1" />
                                  View
                                </Button>
                              </div>
                              {visit.nurse_notes && (
                                <div className="bg-slate-50 p-3 rounded-lg">
                                  <p className="text-sm text-slate-900 whitespace-pre-wrap line-clamp-3">
                                    {sanitizeInput(visit.nurse_notes)}
                                  </p>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Tools Tab */}
        <TabsContent value="ai-tools" className="space-y-6">
          <Tabs value={aiToolsTab} onValueChange={setAiToolsTab} className="w-full">
            <div className="overflow-x-auto scrollbar-hide">
              <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
                <TabsTrigger value="analysis" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Analysis</TabsTrigger>
                <TabsTrigger value="risk" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Risk & Alerts</TabsTrigger>
                <TabsTrigger value="coordination" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Coordination</TabsTrigger>
                <TabsTrigger value="documentation" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Documentation</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="analysis" className="space-y-6">
              <ProactiveClinicalTaskGenerator
                patientId={patient.id}
                patientName={`${patient.first_name} ${patient.last_name}`}
                onTasksCreated={() => {
                  queryClient.invalidateQueries({ queryKey: ['tasks'] });
                }}
                autoAnalyze={false}
              />
              <AIPatientHistorySummary
                patient={patient}
                visits={visits}
                carePlans={carePlans}
                incidents={incidents}
                autoGenerate={false}
              />
              <AIPatientAnalyzer
                patient={patient}
                visits={visits}
                carePlans={carePlans}
                incidents={incidents}
              />
            </TabsContent>

            <TabsContent value="risk" className="space-y-6">
              <PatientRiskStratification
                patient={patient}
                visits={visits}
                carePlans={carePlans}
                incidents={incidents}
                autoCalculate={false}
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PatientDeteriorationPredictor
                  patientId={patientId}
                  recentVisits={visits?.filter(v => v.status === 'completed').slice(0, 10)}
                  autoAnalyze={false}
                />
                <PredictiveRiskAnalyzer 
                  patientId={patientId} 
                  patientName={`${patient.first_name} ${patient.last_name}`}
                  onAlertsCreated={(_count) => {
                    queryClient.invalidateQueries({ queryKey: ['patientContext', patientId] });
                    queryClient.invalidateQueries({ queryKey: ['patientActiveAlerts', patientId] });
                  }}
                  autoAnalyze={false}
                />
              </div>
            </TabsContent>

            <TabsContent value="coordination" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <InterdisciplinaryTeamCoordinator
                  patientId={patientId}
                  patientData={patient}
                  carePlans={carePlans}
                  recentVisits={visits?.filter(v => v.status === 'completed').slice(0, 5)}
                  incidents={incidents}
                  alerts={activeAlerts}
                  autoAnalyze={false}
                />
                <OptimalCommunicationAdvisor
                  patientId={patientId}
                  patientData={patient}
                  recentVisits={visits?.filter(v => v.status === 'completed').slice(0, 3)}
                  upcomingVisits={visits?.filter(v => v.status === 'scheduled').sort((a, b) => `${a.visit_date || ''}${a.visit_time || ''}`.localeCompare(`${b.visit_date || ''}${b.visit_time || ''}`))}
                  outreachPurpose="Care coordination and status update"
                />
              </div>
            </TabsContent>

            <TabsContent value="documentation" className="space-y-6">
              {oasisTriggerVisit && (
                <AIGeneratedOASISAssessment
                  patientId={patientId}
                  visitId={oasisTriggerVisit.id}
                  visitType={oasisTriggerVisit.visit_type === 'admission' ? 'Start of Care' : oasisTriggerVisit.visit_type === 'recertification' ? 'Recertification' : 'Start of Care'}
                  onSaved={() => {
                    queryClient.invalidateQueries({ queryKey: ['oasisAssessments', patientId] });
                    setOasisTriggerVisit(null);
                  }}
                />
              )}
              <AIProactiveOASISAssistant patientId={patientId} autoAnalyze={false} />
              <AIComplianceAuditor
                patientId={patientId}
                autoRun={false}
                scope="comprehensive"
              />
              <PatientSummaryGenerator
                patient={patient}
                visits={visits}
                carePlans={carePlans}
                incidents={incidents}
              />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Care Plans Tab */}
        <TabsContent value="care" className="space-y-6">
          <CarePlanProposalReviewer patientId={patientId} />
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AICarePlanSuggestions 
              patient={patient} 
              existingCarePlans={carePlans}
              onAddCarePlan={(data) => createCarePlanMutation.mutate(data)}
            />
            <div className="space-y-6">
              <CarePlanGapAnalyzer
                patientId={patientId}
                diagnosis={patient?.primary_diagnosis}
                carePlans={carePlans}
                recentVisits={visits?.filter(v => v.status === 'completed').slice(0, 5)}
                patientData={patient}
                autoAnalyze={false}
              />
            </div>
          </div>

          {carePlans.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Active Care Plans</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[500px]">
                  <div className="space-y-3">
                    {carePlans.map((plan) => (
                      <Card key={plan.id} className={`border-l-4 ${
                        plan.status === 'met' ? 'border-l-emerald-500' :
                        plan.status === 'not_met' ? 'border-l-red-500' :
                        plan.status === 'revised' ? 'border-l-amber-500' :
                        'border-l-navy-500'
                      }`}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-2">
                            <p className="font-semibold text-slate-900">{sanitizeInput(plan.problem)}</p>
                            <Badge className={
                              plan.status === 'met' ? 'bg-emerald-500' :
                              plan.status === 'not_met' ? 'bg-red-500' :
                              plan.status === 'revised' ? 'bg-amber-500' :
                              'bg-navy-500'
                            }>
                              {(plan.status || '').replace('_', ' ')}
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-600">{sanitizeInput(plan.goal)}</p>
                          {plan.target_date && (
                            <p className="text-xs text-slate-500 mt-2">
                              Target: {format(new Date(plan.target_date), 'MMM d, yyyy')}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="telehealth" className="space-y-6">
          <PatientTelehealthPanel patient={patient} currentUser={currentUser} />
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-6">
          <Tabs defaultValue="uploaded">
            <div className="overflow-x-auto scrollbar-hide">
              <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
                <TabsTrigger value="uploaded" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Uploaded</TabsTrigger>
                <TabsTrigger value="referral-docs" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Referral PDFs</TabsTrigger>
                <TabsTrigger value="discharge" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Discharge</TabsTrigger>
                <TabsTrigger value="referral" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Referral Letter</TabsTrigger>
                <TabsTrigger value="education" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Education</TabsTrigger>
                <TabsTrigger value="progress" className="px-3 py-2.5 min-h-[48px] sm:min-h-[40px] text-xs sm:text-sm whitespace-nowrap">Progress</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="uploaded" className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>Patient Documents</CardTitle>
                    <Button onClick={() => setIsDocumentUploaderOpen(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Upload Document
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <DocumentList patientId={patientId} showPatientInfo={false} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="referral-docs">
              <ReferralDocumentViewer patientId={patientId} />
            </TabsContent>

            <TabsContent value="discharge">
              <DischargeSummaryGenerator patientId={patientId} patient={patient} />
            </TabsContent>

            <TabsContent value="referral">
              <ReferralLetterGenerator patientId={patientId} patient={patient} />
            </TabsContent>

            <TabsContent value="education">
              <PersonalizedEducationGenerator patient={patient} visits={visits} />
            </TabsContent>

            <TabsContent value="progress">
              <ProgressReportGenerator patientId={patientId} patient={patient} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Messaging Tab */}
        <TabsContent value="messaging" className="space-y-6">
          <CareTeamMessaging patientId={patientId} />
        </TabsContent>
      </Tabs>

      {/* OASIS Generation Prompt */}
      {showOASISPrompt && oasisTriggerVisit && (
        <Alert className="mb-6 bg-navy-50 border-navy-300">
          <Sparkles className="w-4 h-4 text-navy-600" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-navy-900 mb-1">OASIS Assessment Required</p>
                <p className="text-sm text-navy-800">
                  A {oasisTriggerVisit.visit_type} visit has been created. Generate OASIS assessment now?
                </p>
              </div>
              <div className="flex gap-2 ml-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowOASISPrompt(false)}
                >
                  Later
                </Button>
                <Button
                  size="sm"
                  className="bg-navy-600 hover:bg-navy-700"
                  onClick={() => {
                    // Take the user to the AI Tools → Documentation tab, where
                    // AIGeneratedOASISAssessment renders for this trigger visit.
                    setShowOASISPrompt(false);
                    setActiveTab("ai-tools");
                    setAiToolsTab("documentation");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <ClipboardList className="w-4 h-4 mr-1" />
                  Generate Now
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Schedule Visit Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2 justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Schedule New Visit
            </CardTitle>
            <Button
              onClick={() => setShowVisitForm(!showVisitForm)}
              className="bg-navy-600 hover:bg-navy-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Visit
            </Button>
          </div>
        </CardHeader>
        {showVisitForm && (
          <CardContent>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-4 space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Visit Date</Label>
                    <Input
                      type="date"
                      value={newVisit.visit_date}
                      onChange={(e) => setNewVisit({...newVisit, visit_date: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Visit Time</Label>
                    <Input
                      type="time"
                      value={newVisit.visit_time}
                      onChange={(e) => setNewVisit({...newVisit, visit_time: e.target.value})}
                    />
                  </div>
                </div>
                <div>
                  <Label>Visit Type</Label>
                  <Select
                    value={newVisit.visit_type}
                    onValueChange={(value) => setNewVisit({...newVisit, visit_type: value})}
                  >
                    <SelectTrigger className="h-12 sm:h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[50vh]">
                      <SelectItem value="skilled_nursing" className="py-3 sm:py-2">Skilled Nursing</SelectItem>
                      <SelectItem value="admission" className="py-3 sm:py-2">Admission</SelectItem>
                      <SelectItem value="recertification" className="py-3 sm:py-2">Recertification</SelectItem>
                      <SelectItem value="discharge" className="py-3 sm:py-2">Discharge</SelectItem>
                      <SelectItem value="routine_visit" className="py-3 sm:py-2">Routine Visit</SelectItem>
                      <SelectItem value="prn" className="py-3 sm:py-2">PRN Visit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col sm:flex-row justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowVisitForm(false)} className="min-h-[48px] sm:min-h-[40px]">
                      Cancel
                    </Button>
                    <Button onClick={handleCreateVisit} className="bg-navy-600 hover:bg-navy-700 min-h-[48px] sm:min-h-[40px]">
                      Create Visit
                    </Button>
                  </div>
              </CardContent>
            </Card>
          </CardContent>
        )}
      </Card>

      <DocumentUploader
        patientId={patientId}
        open={isDocumentUploaderOpen}
        onOpenChange={setIsDocumentUploaderOpen}
        onUploadComplete={() => {
          setIsDocumentUploaderOpen(false);
          queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId] });
        }}
      />
    </PageContainer>
  );
}