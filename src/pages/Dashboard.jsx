import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Calendar, Clock, MapPin, User, Plus, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { formatEastern, todayEastern } from "../components/utils/timezone";
import { isValid } from "date-fns";
import ComplianceDashboardWidget from "../components/compliance/ComplianceDashboardWidget";

import RealTimePatientAlerts from "../components/dashboard/RealTimePatientAlerts";

import SmartRouteOptimizer from "../components/scheduling/SmartRouteOptimizer";
import IntelligentTaskPrioritization from "../components/tasks/IntelligentTaskPrioritization";
import NurseRegulatoryAlerts from "../components/compliance/NurseRegulatoryAlerts";
import PDGMPredictiveAnalytics from "../components/pdgm/PDGMPredictiveAnalytics";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import AITrainingRecommendations from "../components/training/AITrainingRecommendations";
import NursePersonalizedInsights from "../components/dashboard/NursePersonalizedInsights";
import ComplianceAlertNotifications from "../components/alerts/ComplianceAlertNotifications";
import ProactiveClinicalSupport from "../components/clinical/ProactiveClinicalSupport";
import NewFeaturesBanner from "../components/dashboard/NewFeaturesBanner";
import AnnouncementsWidget from "../components/dashboard/AnnouncementsWidget";
import { calculateNurseStats } from "@/components/utils/statsCalculator";
import OfflineDataManager from "../components/mobile/OfflineDataManager";
import RiskAlertWidget from "../components/alerts/RiskAlertWidget";
import ProactiveCareGapIdentifier from "../components/predictive/ProactiveCareGapIdentifier";
import TaskNotifications from "../components/tasks/TaskNotifications";
import TrialStatusBanner from "../components/subscription/TrialStatusBanner";
import PersonalizedCoachingDashboard from "../components/coaching/PersonalizedCoachingDashboard";
import EmptyState from "../components/ui/EmptyState";
import { motion } from "framer-motion";
import PullToRefresh from "../components/mobile/PullToRefresh";

export default function Dashboard() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data: currentUser } = useQuery({
      queryKey: ['currentUser'],
      queryFn: async () => {
        try {
          return await base44.auth.me();
        } catch (error) {
          navigate(createPageUrl("Home"));
          return null;
        }
      },
    });

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

  // Handle errors gracefully
  if (visitsError || patientsError) {
    console.error('Dashboard data loading error:', visitsError || patientsError);
  }

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
        console.log('Unhandled voice command:', action);
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
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto min-h-screen">
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



      {/* Quick Action Buttons */}
      <motion.div 
        className="grid grid-cols-2 gap-3 sm:gap-4 mb-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <Link to={createPageUrl("SmartNoteAssistant")} className="block">
          <motion.div whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
            <Card className="hover:shadow-xl transition-all cursor-pointer border-2 border-blue-200 dark:border-blue-800 hover:border-blue-400 dark:hover:border-blue-600 active:scale-95 touch-target h-full hover-lift">
              <CardContent className="p-4 sm:p-6 text-center flex flex-col items-center justify-center min-h-[100px] sm:min-h-[120px]">
                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600 dark:text-blue-400 mb-1 sm:mb-2" />
                <h3 className="font-semibold text-sm sm:text-base text-gray-900 dark:text-white">Document Visit</h3>
              </CardContent>
            </Card>
          </motion.div>
        </Link>
        <Link to={createPageUrl("Patients")} className="block">
          <motion.div whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
            <Card className="hover:shadow-xl transition-all cursor-pointer border-2 border-green-200 dark:border-green-800 hover:border-green-400 dark:hover:border-green-600 active:scale-95 touch-target h-full hover-lift">
              <CardContent className="p-4 sm:p-6 text-center flex flex-col items-center justify-center min-h-[100px] sm:min-h-[120px]">
                <User className="w-6 h-6 sm:w-8 sm:h-8 text-green-600 dark:text-green-400 mb-1 sm:mb-2" />
                <h3 className="font-semibold text-sm sm:text-base text-gray-900 dark:text-white">My Patients</h3>
              </CardContent>
            </Card>
          </motion.div>
        </Link>
        <Link to={createPageUrl("CarePlanManagement")} className="block">
          <motion.div whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
            <Card className="hover:shadow-xl transition-all cursor-pointer border-2 border-purple-200 dark:border-purple-800 hover:border-purple-400 dark:hover:border-purple-600 active:scale-95 touch-target h-full hover-lift">
              <CardContent className="p-4 sm:p-6 text-center flex flex-col items-center justify-center min-h-[100px] sm:min-h-[120px]">
                <CheckCircle2 className="w-6 h-6 sm:w-8 sm:h-8 text-purple-600 dark:text-purple-400 mb-1 sm:mb-2" />
                <h3 className="font-semibold text-sm sm:text-base text-gray-900 dark:text-white">Care Plans</h3>
              </CardContent>
            </Card>
          </motion.div>
        </Link>
        <Link to={createPageUrl("StaffTrainingHub")} className="block">
          <motion.div whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
            <Card className="hover:shadow-xl transition-all cursor-pointer border-2 border-orange-200 dark:border-orange-800 hover:border-orange-400 dark:hover:border-orange-600 active:scale-95 touch-target h-full hover-lift">
              <CardContent className="p-4 sm:p-6 text-center flex flex-col items-center justify-center min-h-[100px] sm:min-h-[120px]">
                <Calendar className="w-6 h-6 sm:w-8 sm:h-8 text-orange-600 dark:text-orange-400 mb-1 sm:mb-2" />
                <h3 className="font-semibold text-sm sm:text-base text-gray-900 dark:text-white">My Training</h3>
              </CardContent>
            </Card>
          </motion.div>
        </Link>
      </motion.div>

      {/* Nurse Stats Cards */}
      <motion.div 
        className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200 dark:border-blue-800 hover-lift">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">Note Enhancements</p>
                  <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">0</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Start documenting to see your progress</p>
                </div>
                <FileText className="w-12 h-12 text-blue-400 dark:text-blue-500" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
          <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800 hover-lift">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">Time Saved</p>
                  <p className="text-3xl font-bold text-green-900 dark:text-green-100">0h 0m</p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">Time saved through AI enhancements</p>
                </div>
                <Clock className="w-12 h-12 text-green-400 dark:text-green-500" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Task Notifications */}
      <div className="mb-6">
        <TaskNotifications userEmail={currentUser?.email} />
      </div>

      {/* Personalized Nurse Insights */}
      <div className="mb-6">
        <NursePersonalizedInsights
          nurseEmail={currentUser?.email}
          recentActivity={nurseActivity}
          noteConversions={noteConversions}
          trainingRecommendations={nurseTrainingRecommendations}
          complianceAudits={nurseComplianceAudits}
          pendingTasks={nurseTasks}
        />
      </div>

      {/* AI Coaching System */}
      <div className="mb-6">
        <PersonalizedCoachingDashboard nurseEmail={currentUser?.email} />
      </div>

      {/* Proactive Care Gap Identification */}
      <div className="mb-6">
        <ProactiveCareGapIdentifier
          patients={patients}
          visits={visits}
          carePlans={carePlans}
          alerts={[]}
          autoAnalyze={false}
          maxGaps={8}
          compact={false}
        />
      </div>

      {/* High-Risk Patient Alerts */}
      <div className="mb-6">
        <RiskAlertWidget showAllPatients={true} compact={false} />
      </div>

      {/* Offline Data Manager */}
      <div className="mb-6">
        <OfflineDataManager />
      </div>

      {/* My Daily Tools */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <IntelligentTaskPrioritization
          nurseEmail={currentUser?.email}
          patients={patients}
          onTaskCompleted={() => queryClient.invalidateQueries({ queryKey: ['nurseTasks'] })}
        />
        <SmartRouteOptimizer
          visits={visits.filter(v => v.status === 'scheduled')}
          patients={patients}
          onOptimizedSchedule={(order) => console.log('Optimized:', order)}
        />
      </div>
      
      {/* My Compliance Alerts */}
      <div className="mb-6">
        <ComplianceAlertNotifications 
          nurseEmail={currentUser?.email}
          showAll={false}
          maxAlerts={5}
          compact={false}
        />
      </div>

      {/* Proactive Clinical Support - Show for first scheduled patient */}
      {visits.length > 0 && visits[0]?.patient_id && (
        <div className="mb-6">
          <ProactiveClinicalSupport 
            patientId={visits[0].patient_id}
            compact={true}
          />
        </div>
      )}



      {/* Real-time Patient Alerts */}
      <div className="mb-6">
        <RealTimePatientAlerts
          patients={patients}
          visits={visits}
          carePlans={carePlans}
          incidents={incidents}
        />
      </div>

      {/* Regulatory Alerts for Nurses */}
      <div className="mb-6">
        <NurseRegulatoryAlerts nurseEmail={currentUser?.email} compact={true} />
      </div>



      {/* Add Compliance Widget */}
      <ComplianceDashboardWidget />
    </div>
  );
}