import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Calendar, Clock, MapPin, User, Plus, CheckCircle2, AlertCircle, FileText, Mic, Brain, Phone, Video, Shield, Target, Activity } from "lucide-react";
import { formatEastern, todayEastern } from "../components/utils/timezone";
import { isValid } from "date-fns";
import ComplianceDashboardWidget from "../components/compliance/ComplianceDashboardWidget";

import RealTimePatientAlerts from "../components/dashboard/RealTimePatientAlerts";

import NurseRegulatoryAlerts from "../components/compliance/NurseRegulatoryAlerts";
import PDGMPredictiveAnalytics from "../components/pdgm/PDGMPredictiveAnalytics";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

import ComplianceAlertNotifications from "../components/alerts/ComplianceAlertNotifications";
import ProactiveClinicalSupport from "../components/clinical/ProactiveClinicalSupport";
import RegulatoryAlertsDashboard from "../components/regulatory/RegulatoryAlertsDashboard";
import NewFeaturesBanner from "../components/dashboard/NewFeaturesBanner";
import AnnouncementsWidget from "../components/dashboard/AnnouncementsWidget";
import { calculateNurseStats } from "@/components/utils/statsCalculator";
import RiskAlertWidget from "../components/alerts/RiskAlertWidget";
import TaskNotifications from "../components/tasks/TaskNotifications";
import TrialStatusBanner from "../components/subscription/TrialStatusBanner";
import EmptyState from "../components/ui/EmptyState";
import { motion } from "framer-motion";
import PullToRefresh from "../components/mobile/PullToRefresh";

import DashboardCustomizer from "../components/dashboard/DashboardCustomizer";
import PersonalizedDashboardWidget from "../components/personalization/PersonalizedDashboardWidget";
import SmartQuickActions from "../components/personalization/SmartQuickActions";
import PersonalizationEngine from "../components/personalization/PersonalizationEngine";
import QuickTelehealthLauncher from "../components/telehealth/QuickTelehealthLauncher";
import { getAccessibleWidgets } from "../components/utils/providerAccessControl";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import QuickAccessCards from "../components/dashboard/QuickAccessCards";
import DashboardSection from "../components/dashboard/DashboardSection";
import QuickStatsSummary from "../components/dashboard/QuickStatsSummary";
import WorkflowShortcuts from "../components/dashboard/WorkflowShortcuts";

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
      },
    });

    // Get role-specific widgets
    const accessibleWidgets = currentUser?.provider_type 
      ? getAccessibleWidgets(currentUser.provider_type)
      : [];
    
    const canAccessWidget = (widgetName) => accessibleWidgets.includes(widgetName);

    // Redirect to onboarding if not completed
    React.useEffect(() => {
      if (currentUser && !currentUser.onboarding_completed) {
        navigate(createPageUrl("Onboarding"));
      }
    }, [currentUser, navigate]);

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
      staleTime: 60000,
    });

  const { data: patients, error: patientsError } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 500),
    initialData: [],
    staleTime: 300000,
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['allCarePlans'],
    queryFn: () => base44.entities.CarePlan.list('-updated_date', 200),
    initialData: [],
    staleTime: 300000,
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['recentIncidents'],
    queryFn: () => base44.entities.Incident.filter({}, '-incident_date', 50),
    initialData: [],
    staleTime: 180000,
  });

  const { data: noteConversions = [] } = useQuery({
    queryKey: ['nurseNoteConversions', currentUser?.email],
    queryFn: () => base44.entities.NoteConversion.filter({ nurse_email: currentUser?.email }, '-created_date', 10),
    enabled: !!currentUser?.email,
    initialData: [],
  });

  const { data: nurseTrainingRecommendations = [] } = useQuery({
    queryKey: ['nurseTrainingRecommendations', currentUser?.email],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ nurse_email: currentUser?.email, addressed: false }),
    enabled: !!currentUser?.email,
    initialData: [],
  });

  const { data: nurseComplianceAudits = [] } = useQuery({
    queryKey: ['nurseComplianceAudits', currentUser?.email],
    queryFn: () => base44.entities.ComplianceAudit.filter({ nurse_email: currentUser?.email }, '-audit_date', 5),
    enabled: !!currentUser?.email,
    initialData: [],
  });

  const { data: nurseTasks = [] } = useQuery({
    queryKey: ['nurseTasks', currentUser?.email],
    queryFn: () => base44.entities.Task.filter({ 
      assigned_to: currentUser?.email,
      status: 'pending'
    }),
    enabled: !!currentUser?.email,
    initialData: [],
  });

  const { data: nurseActivity = [] } = useQuery({
    queryKey: ['nurseRecentActivity', currentUser?.email],
    queryFn: () => base44.entities.UserActivity.filter({ user_email: currentUser?.email }, '-created_date', 20),
    enabled: !!currentUser?.email,
    initialData: [],
  });

  const { data: subscription } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: () => base44.entities.Subscription.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email,
    select: (data) => data[0]
  });

  const { data: todayTelehealthAppointments = [] } = useQuery({
    queryKey: ['todayTelehealthAppointments', currentUser?.email],
    queryFn: async () => {
      const today = todayEastern();
      const appointments = await base44.entities.Appointment.filter({
        provider_email: currentUser.email,
        appointment_type: 'telehealth',
        appointment_date: today
      }, 'start_time');
      
      return appointments.map(apt => {
        const patient = patients.find(p => p.id === apt.patient_id);
        return {
          ...apt,
          patient_name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown'
        };
      });
    },
    enabled: !!currentUser?.email && patients.length > 0
  });

  // Handle errors gracefully (logged server-side)

  const getPatient = (patientId) => {
    return patients.find(p => p.id === patientId);
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
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <PullToRefresh onRefresh={async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['currentUser'] }),
        queryClient.invalidateQueries({ queryKey: ['myPatients'] }),
        queryClient.invalidateQueries({ queryKey: ['myVisits'] }),
        queryClient.invalidateQueries({ queryKey: ['nurseNoteConversions'] }),
        queryClient.invalidateQueries({ queryKey: ['myAlerts'] }),
        queryClient.invalidateQueries({ queryKey: ['myTasks'] })
      ]);
    }}>
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto min-h-screen w-full max-w-full overflow-x-hidden min-w-0">
      {/* Header with integrated banners */}
      <DashboardHeader fullName={fullName} subscription={subscription} providerType={currentUser?.provider_type || currentUser?.credential_type} />

      {/* Quick Stats */}
      <QuickStatsSummary stats={{
        activePatients: patients.length,
        completedVisits: visits.length,
        pendingAlerts: 0,
        upcomingVisits: todayTelehealthAppointments.length
      }} />

      {/* Workflow Shortcuts */}
      <WorkflowShortcuts />



      {/* Dashboard Customizer */}
      {currentUser && (
        <div className="flex justify-end mb-4">
          <DashboardCustomizer user={currentUser} />
        </div>
      )}





      {/* AI-Powered Personalization Engine */}
      {currentUser && (!currentUser.dashboard_config || currentUser.dashboard_config?.personalizationEngine) && (
        <div className="mb-6">
          <PersonalizationEngine 
            userEmail={currentUser?.email}
            providerType={currentUser?.provider_type || currentUser?.credential_type}
          />
        </div>
      )}

      {/* Personalized AI Recommendations */}
      {currentUser && (!currentUser.dashboard_config || currentUser.dashboard_config?.personalizedWidget) && (
        <div className="mb-6">
          <PersonalizedDashboardWidget 
            userEmail={currentUser?.email}
            providerType={currentUser?.provider_type || currentUser?.credential_type}
          />
        </div>
      )}

      {/* Telehealth Quick Launcher */}
      <QuickTelehealthLauncher
        todayAppointments={todayTelehealthAppointments}
        onScheduleNew={() => navigate(createPageUrl("TelehealthDashboard"))}
      />


      {/* Critical Alerts & Compliance Section */}
      <DashboardSection title="Alerts & Compliance" icon={AlertCircle} defaultOpen={true} collapsible={true}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 w-full max-w-full overflow-x-hidden">
          {(!currentUser?.dashboard_config || currentUser.dashboard_config?.complianceScore) && (
            <ComplianceAlertNotifications 
              nurseEmail={currentUser?.email}
              showAll={false}
              maxAlerts={5}
              compact={true}
            />
          )}
          {(!currentUser?.dashboard_config || currentUser.dashboard_config?.clinicalSupport) && visits.length > 0 && visits[0]?.patient_id && (
            <ProactiveClinicalSupport 
              patientId={visits[0].patient_id}
              compact={true}
            />
          )}
        </div>
      </DashboardSection>

      {/* Regulatory & Compliance Updates */}
      <DashboardSection title="Regulatory Updates" icon={Shield} defaultOpen={false} collapsible={true}>
        <RegulatoryAlertsDashboard />
      </DashboardSection>

    </div>
    </PullToRefresh>
  );
}