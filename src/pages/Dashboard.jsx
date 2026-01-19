import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import RoleBasedOnboarding from "@/components/onboarding/RoleBasedOnboarding";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Clock, MapPin, User, Plus, CheckCircle2, AlertCircle, FileText, Mic, Brain, Phone, Video, Shield, Target, Activity, ListTodo, ChevronRight } from "lucide-react";
import { formatEastern, todayEastern } from "../components/utils/timezone";
import { isValid } from "date-fns";
import ComplianceDashboardWidget from "../components/compliance/ComplianceDashboardWidget";

import RealTimePatientAlerts from "../components/dashboard/RealTimePatientAlerts";

import NurseRegulatoryAlerts from "../components/compliance/NurseRegulatoryAlerts";
import PDGMPredictiveAnalytics from "../components/pdgm/PDGMPredictiveAnalytics";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

import ComplianceAlertNotifications from "../components/alerts/ComplianceAlertNotifications";
import ProactiveClinicalSupport from "../components/clinical/ProactiveClinicalSupport";
import NewFeaturesBanner from "../components/dashboard/NewFeaturesBanner";
import AnnouncementsWidget from "../components/dashboard/AnnouncementsWidget";
import { calculateNurseStats } from "@/components/utils/statsCalculator";
import RiskAlertWidget from "../components/alerts/RiskAlertWidget";
import TaskNotifications from "../components/tasks/TaskNotifications";
import TrialStatusBanner from "../components/subscription/TrialStatusBanner";
import EmptyState from "../components/ui/EmptyState";
import { motion } from "framer-motion";
import PullToRefresh from "../components/mobile/PullToRefresh";
import ClinicalStaffPerformanceInsights from "../components/analytics/ClinicalStaffPerformanceInsights";

import DashboardCustomizer from "../components/dashboard/DashboardCustomizer";
import { getAccessibleWidgets } from "../components/utils/providerAccessControl";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import QuickAccessCards from "../components/dashboard/QuickAccessCards";
import DashboardSection from "../components/dashboard/DashboardSection";
import QuickStatsSummary from "../components/dashboard/QuickStatsSummary";
import WorkflowShortcuts from "../components/dashboard/WorkflowShortcuts";
import SkillGapWidget from "../components/dashboard/SkillGapWidget";
import PatientRiskWidget from "../components/dashboard/PatientRiskWidget";
import ProactiveInsights from "../components/insights/ProactiveInsights";
import { ErrorBoundary } from "../components/utils/ErrorBoundary";
import HighRiskPatientsWidget from "../components/dashboard/HighRiskPatientsWidget";

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: currentUser, isLoading: userLoading } = useQuery({
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

  // Get role-specific widgets
  const accessibleWidgets = currentUser?.credential_type ?
  getAccessibleWidgets(currentUser.credential_type) :
  [];

  const canAccessWidget = (widgetName) => accessibleWidgets.includes(widgetName);

  // Onboarding will show as overlay instead of redirect

  // Log page visit with user context
  React.useEffect(() => {
    if (currentUser?.email) {
      logActivity(ActivityActions.PAGE_VISIT, {
        page: 'Dashboard',
        page_title: 'Dashboard',
        user_role: currentUser.role
      });
    }
  }, [currentUser?.email]);

  const { data: visits, isLoading, error: visitsError } = useQuery({
    queryKey: ['todayVisits'],
    queryFn: async () => {
      const today = todayEastern();
      return base44.entities.Visit.filter({ visit_date: today }, '-visit_time');
    },
    initialData: [],
    staleTime: 60000
  });

  const { data: patients, error: patientsError } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 500),
    initialData: [],
    staleTime: 300000
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['allCarePlans'],
    queryFn: () => base44.entities.CarePlan.list('-updated_date', 200),
    initialData: [],
    staleTime: 300000
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['recentIncidents'],
    queryFn: () => base44.entities.Incident.filter({}, '-incident_date', 50),
    initialData: [],
    staleTime: 180000
  });

  const { data: noteConversions = [] } = useQuery({
    queryKey: ['nurseNoteConversions', currentUser?.email],
    queryFn: () => base44.entities.NoteConversion.filter({ nurse_email: currentUser?.email }, '-created_date', 10),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: nurseTrainingRecommendations = [] } = useQuery({
    queryKey: ['nurseTrainingRecommendations', currentUser?.email],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ nurse_email: currentUser?.email, addressed: false }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: nurseComplianceAudits = [] } = useQuery({
    queryKey: ['nurseComplianceAudits', currentUser?.email],
    queryFn: () => base44.entities.ComplianceAudit.filter({ nurse_email: currentUser?.email }, '-audit_date', 5),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: nurseTasks = [] } = useQuery({
    queryKey: ['nurseTasks', currentUser?.email],
    queryFn: () => base44.entities.Task.filter({
      assigned_to: currentUser?.email,
      status: { "$ne": "completed" }
    }, '-due_date'),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: nurseActivity = [] } = useQuery({
    queryKey: ['nurseRecentActivity', currentUser?.email],
    queryFn: () => base44.entities.UserActivity.filter({ user_email: currentUser?.email }, '-created_date', 20),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: subscription } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: () => base44.entities.Subscription.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email,
    select: (data) => data[0]
  });

  // Handle errors gracefully (logged server-side)

  const getPatient = (patientId) => {
    return patients.find((p) => p.id === patientId);
  };

  const getStatusColor = (status) => {
    const colors = {
      scheduled: "bg-blue-100 text-blue-800 border-blue-200",
      in_progress: "bg-yellow-100 text-yellow-800 border-yellow-200",
      completed: "bg-green-100 text-green-800 border-green-200",
      cancelled: "bg-gray-100 text-gray-800 border-gray-200"
    };
    return colors[status] || colors.scheduled;
  };

  const getVisitTypeLabel = (type) => {
    const labels = {
      skilled_nursing: "Skilled Nursing",
      admission: "Admission",
      recertification: "Recertification",
      discharge: "Discharge",
      routine_visit: "Routine Visit",
      prn: "PRN Visit"
    };
    return labels[type] || type;
  };

  // Voice command handler
  const handleVoiceCommand = (action, spokenText) => {
    switch (action) {
      case 'navigate_patients':
        navigate(createPageUrl("Patients"));
        break;
      case 'refresh_data':
        queryClient.invalidateQueries({ queryKey: ['todayVisits'] });
        break;
      case 'search':
        // Extract search term from spoken text
        const searchTerm = spokenText.replace(/search for|find patient|look for/gi, '').trim();
        if (searchTerm) {
          navigate(`${createPageUrl("Patients")}?search=${encodeURIComponent(searchTerm)}`);
        }
        break;
      case 'navigate_dashboard':
        window.location.reload();
        break;
      default:
      // Unhandled command
    }
  };

  const stats = useMemo(() => {
    return calculateNurseStats(currentUser?.email, {
      visits,
      noteConversions,
      dateRange: 30
    });
  }, [visits, noteConversions, currentUser]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  const fullName = currentUser?.full_name || 'there';

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-600 dark:border-slate-400 border-t-transparent"></div>
      </div>
    );

  }

  if (!currentUser) {
    return null;
  }

  return (
    <>
      {currentUser && !currentUser.onboarding_completed && (
        <RoleBasedOnboarding user={currentUser} />
      )}
      
      <PullToRefresh onRefresh={async () => {
      await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['currentUser'] }),
      queryClient.invalidateQueries({ queryKey: ['myPatients'] }),
      queryClient.invalidateQueries({ queryKey: ['myVisits'] }),
      queryClient.invalidateQueries({ queryKey: ['nurseNoteConversions'] }),
      queryClient.invalidateQueries({ queryKey: ['myAlerts'] }),
      queryClient.invalidateQueries({ queryKey: ['nurseTasks'] })]
      );
    }}>
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto min-h-screen w-full max-w-full overflow-x-hidden min-w-0">
      {/* Header with integrated banners */}
      <DashboardHeader fullName={fullName} subscription={subscription} providerType={currentUser?.credential_type || currentUser?.provider_type} />

      {/* Proactive Insights */}
      <ErrorBoundary>
        <ProactiveInsights userEmail={currentUser?.email} />
      </ErrorBoundary>

      {/* Quick Stats */}
      <QuickStatsSummary stats={{
          activePatients: patients.length,
          completedVisits: visits.length,
          pendingAlerts: 0,
          upcomingVisits: 0
        }} />

      {/* Workflow Shortcuts */}
      <WorkflowShortcuts />

      {/* Skill Gap & Risk Widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        <SkillGapWidget userEmail={currentUser?.email} />
        <HighRiskPatientsWidget />
      </div>

      {/* AI Performance Insights */}
      {currentUser?.credential_type && (
        <div className="mb-6">
          <ClinicalStaffPerformanceInsights 
            providerType={currentUser.credential_type}
            careSetting={currentUser.service_type || 'home_health'}
            timeRange={30}
          />
        </div>
      )}

      {/* My Tasks Widget */}
      {canAccessWidget('tasks') &&
        <Card className="hover-lift">
          <CardHeader className="bg-slate-100 pb-2 p-6 space-y-1.5 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ListTodo className="w-5 h-5 text-blue-600" />
              My Tasks
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(createPageUrl('Tasks'))}
              className="text-xs">

              View All
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </CardHeader>
          <CardContent className="bg-slate-100 pt-0 p-6">
            {nurseTasks && nurseTasks.length > 0 ?
            <div className="space-y-2">
                {nurseTasks.slice(0, 5).map((task) => {
                const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.due_date !== new Date().toISOString().split('T')[0];
                const isDueToday = task.due_date && task.due_date === new Date().toISOString().split('T')[0];

                return (
                  <div
                    key={task.id}
                    className={`p-3 rounded-lg border ${
                    isOverdue ? 'border-red-300 bg-red-50 dark:bg-red-950' :
                    isDueToday ? 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950' :
                    'border-slate-200 bg-slate-50 dark:bg-slate-800'}`
                    }>

                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={
                          task.priority === 'critical' ? 'bg-red-600' :
                          task.priority === 'high' ? 'bg-orange-500' :
                          task.priority === 'medium' ? 'bg-yellow-500' :
                          'bg-blue-500'
                          }>
                              {task.priority}
                            </Badge>
                            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{task.title}</span>
                          </div>
                          {task.due_date &&
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                              Due: {new Date(task.due_date).toLocaleDateString()}
                              {isOverdue && <span className="text-red-600 ml-1">• Overdue</span>}
                              {isDueToday && <span className="text-yellow-600 ml-1">• Due Today</span>}
                            </p>
                        }
                        </div>
                        <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await base44.entities.Task.update(task.id, { status: 'completed' });
                          queryClient.invalidateQueries({ queryKey: ['nurseTasks'] });
                        }}
                        className="flex-shrink-0">

                          <CheckCircle2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>);

              })}
                {nurseTasks.length > 5 &&
              <p className="text-xs text-center text-slate-500 dark:text-slate-400 pt-2">
                    +{nurseTasks.length - 5} more tasks
                  </p>
              }
              </div> :

            <div className="text-center py-8">
                <ListTodo className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm text-slate-500 dark:text-slate-400">No pending tasks</p>
                <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => navigate(createPageUrl('Tasks'))}>

                  Create Task
                </Button>
              </div>
            }
          </CardContent>
        </Card>
        }











      {/* Critical Alerts & Compliance Section - only for providers with access */}
      {(canAccessWidget('complianceScore') || canAccessWidget('clinicalSupport')) &&
        <DashboardSection title="Alerts & Compliance" icon={AlertCircle} defaultOpen={true} collapsible={true}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 w-full max-w-full overflow-x-hidden">
            {canAccessWidget('complianceScore') && (!currentUser?.dashboard_config || currentUser.dashboard_config?.complianceScore) &&
            <ComplianceAlertNotifications
              nurseEmail={currentUser?.email}
              showAll={false}
              maxAlerts={5}
              compact={true} />

            }
            {canAccessWidget('clinicalSupport') && (!currentUser?.dashboard_config || currentUser.dashboard_config?.clinicalSupport) && visits.length > 0 && visits[0]?.patient_id &&
            <ProactiveClinicalSupport
              patientId={visits[0].patient_id}
              compact={true} />

            }
          </div>
          </DashboardSection>
          }

          </div>
          </PullToRefresh>
    </>
  );
}