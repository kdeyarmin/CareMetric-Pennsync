import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Calendar, Clock, MapPin, User, Plus, CheckCircle2, AlertCircle, FileText, Mic, Brain, Phone } from "lucide-react";
import { formatEastern, todayEastern } from "../components/utils/timezone";
import { isValid } from "date-fns";
import ComplianceDashboardWidget from "../components/compliance/ComplianceDashboardWidget";

import RealTimePatientAlerts from "../components/dashboard/RealTimePatientAlerts";

import NurseRegulatoryAlerts from "../components/compliance/NurseRegulatoryAlerts";
import PDGMPredictiveAnalytics from "../components/pdgm/PDGMPredictiveAnalytics";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import AITrainingRecommendations from "../components/training/AITrainingRecommendations";

import ComplianceAlertNotifications from "../components/alerts/ComplianceAlertNotifications";
import ProactiveClinicalSupport from "../components/clinical/ProactiveClinicalSupport";
import NewFeaturesBanner from "../components/dashboard/NewFeaturesBanner";
import AnnouncementsWidget from "../components/dashboard/AnnouncementsWidget";
import { calculateNurseStats } from "@/components/utils/statsCalculator";
import RiskAlertWidget from "../components/alerts/RiskAlertWidget";
import TaskNotifications from "../components/tasks/TaskNotifications";
import TrialStatusBanner from "../components/subscription/TrialStatusBanner";
import PersonalizedCoachingDashboard from "../components/coaching/PersonalizedCoachingDashboard";
import EmptyState from "../components/ui/EmptyState";
import { motion } from "framer-motion";
import PullToRefresh from "../components/mobile/PullToRefresh";
import ProviderSpecificDashboard from "../components/dashboard/ProviderSpecificDashboard";
import DashboardCustomizer from "../components/dashboard/DashboardCustomizer";
import PersonalizedDashboardWidget from "../components/personalization/PersonalizedDashboardWidget";
import SmartQuickActions from "../components/personalization/SmartQuickActions";
import PersonalizationEngine from "../components/personalization/PersonalizationEngine";

export default function Dashboard() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

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
      {/* Welcome Banner */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="mb-4 sm:mb-6 bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 dark:from-blue-700 dark:via-blue-800 dark:to-blue-900 text-white border-none shadow-xl overflow-hidden hover-glow">
          <CardContent className="p-4 sm:p-6 md:p-8 relative">
            <div className="absolute top-0 right-0 w-48 h-48 sm:w-64 sm:h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-24 h-24 sm:w-32 sm:h-32 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2" />
            <div className="relative z-10">
              <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold mb-2">
                {getGreeting()}, {fullName}! 👋
              </h1>
              <p className="text-white/80 text-xs sm:text-sm md:text-base mb-3">
                {isValid(new Date()) ? formatEastern(new Date(), 'EEEE, MMMM d, yyyy').replace(' ET', '') : new Date().toLocaleDateString()}
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* New Features Banner */}
      <NewFeaturesBanner />

      {/* Admin Announcements */}
      <AnnouncementsWidget />

      {/* Trial Status Banner */}
      {subscription && subscription.status === 'trialing' && (
        <div className="mb-6">
          <TrialStatusBanner subscription={subscription} />
        </div>
      )}



      {/* Dashboard Customizer */}
      {currentUser && (
        <div className="flex justify-end mb-4">
          <DashboardCustomizer user={currentUser} />
        </div>
      )}

      {/* Provider-Specific Dashboard */}
      {currentUser && (!currentUser.dashboard_config || currentUser.dashboard_config?.providerMetrics) && (
        <div className="mb-6">
          <ProviderSpecificDashboard user={currentUser} />
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

      {/* Smart Quick Actions - Learns what you use most */}
      {currentUser && (
        <div className="mb-6">
          <SmartQuickActions 
            userEmail={currentUser?.email}
            maxActions={6}
          />
        </div>
      )}

      {/* Quick Action Cards - Mobile Optimized */}
       <motion.div 
         className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6 w-full max-w-full overflow-x-hidden"
         initial={{ opacity: 0, y: 20 }}
         animate={{ opacity: 1, y: 0 }}
         transition={{ delay: 0.3 }}
       >
         <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
           <Link to={createPageUrl("SmartNoteAssistant")} className="block">
             <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200 dark:border-blue-800 hover-lift h-full cursor-pointer">
               <CardContent className="p-4 sm:p-6">
                 <div className="flex items-center gap-3 mb-2">
                   <Brain className="w-6 h-6 text-blue-600" />
                   <p className="text-sm font-medium text-blue-900">Smart Notes</p>
                 </div>
                 <p className="text-xs text-blue-700">AI-powered note enhancement</p>
               </CardContent>
             </Card>
           </Link>
         </motion.div>
         <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
           <Link to={createPageUrl("MedicalScribe")} className="block">
             <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border-purple-200 dark:border-purple-800 hover-lift h-full cursor-pointer">
               <CardContent className="p-4 sm:p-6">
                 <div className="flex items-center gap-3 mb-2">
                   <Mic className="w-6 h-6 text-purple-600" />
                   <p className="text-sm font-medium text-purple-900">Medical Scribe</p>
                 </div>
                 <p className="text-xs text-purple-700">Record & auto-generate notes</p>
               </CardContent>
             </Card>
           </Link>
         </motion.div>
         <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
           <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800 hover-lift">
             <CardContent className="p-4 sm:p-6">
               <div className="flex items-center gap-3 mb-2">
                 <Clock className="w-6 h-6 text-green-600" />
                 <p className="text-sm font-medium text-green-900">Time Saved</p>
               </div>
               <p className="text-xs text-green-700">0h 0m through AI</p>
             </CardContent>
           </Card>
         </motion.div>
       </motion.div>





      {/* Compliance & Clinical Support */}
      {(!currentUser?.dashboard_config || currentUser.dashboard_config?.complianceScore || currentUser.dashboard_config?.clinicalSupport) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6 w-full max-w-full overflow-x-hidden">
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
      )}


    </div>
    </PullToRefresh>
  );
}