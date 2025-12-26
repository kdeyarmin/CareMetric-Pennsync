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
import VoiceCommandListener from "../components/voice/VoiceCommandListener";
import { getCommandsForContext } from "../components/voice/voiceCommands";
import EnhancedVoiceCommands from "../components/voice/EnhancedVoiceCommands";
import ComplianceDashboardWidget from "../components/compliance/ComplianceDashboardWidget";

import RealTimePatientAlerts from "../components/dashboard/RealTimePatientAlerts";

import SmartRouteOptimizer from "../components/scheduling/SmartRouteOptimizer";
import IntelligentTaskPrioritization from "../components/tasks/IntelligentTaskPrioritization";
import NurseRegulatoryAlerts from "../components/compliance/NurseRegulatoryAlerts";
import PDGMPredictiveAnalytics from "../components/pdgm/PDGMPredictiveAnalytics";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import AITrainingRecommendations from "../components/training/AITrainingRecommendations";
import ComplianceAlertNotifications from "../components/alerts/ComplianceAlertNotifications";
import ProactiveClinicalSupport from "../components/clinical/ProactiveClinicalSupport";
import NewFeaturesBanner from "../components/dashboard/NewFeaturesBanner";
import AnnouncementsWidget from "../components/dashboard/AnnouncementsWidget";
import { calculateNurseStats } from "@/components/utils/statsCalculator";
import OfflineDataManager from "../components/mobile/OfflineDataManager";
import RiskAlertWidget from "../components/alerts/RiskAlertWidget";
import ProactiveCareGapIdentifier from "../components/predictive/ProactiveCareGapIdentifier";

export default function Dashboard() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data: currentUser } = useQuery({
      queryKey: ['currentUser'],
      queryFn: () => base44.auth.me(),
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
    queryFn: () => base44.entities.NoteConversion.filter({ nurse_email: currentUser?.email }),
    enabled: !!currentUser?.email,
    initialData: [],
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
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto min-h-screen">
      {/* Welcome Banner */}
      <Card className="mb-4 sm:mb-6 bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 text-white border-none shadow-xl overflow-hidden">
        <CardContent className="p-4 sm:p-6 md:p-8 relative">
          <div className="absolute top-0 right-0 w-48 h-48 sm:w-64 sm:h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-24 h-24 sm:w-32 sm:h-32 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative z-10">
            <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold mb-2">
              {getGreeting()}, {fullName}! 👋
            </h1>
            <p className="text-white/80 text-xs sm:text-sm md:text-base">
              {isValid(new Date()) ? formatEastern(new Date(), 'EEEE, MMMM d, yyyy').replace(' ET', '') : new Date().toLocaleDateString()}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* New Features Banner */}
      <NewFeaturesBanner />

      {/* Admin Announcements */}
      <AnnouncementsWidget />

      {/* Nurse Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600 font-medium mb-1">Note Enhancements</p>
                <p className="text-3xl font-bold text-blue-900">{stats.noteConversions}</p>
              </div>
              <FileText className="w-12 h-12 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-600 font-medium mb-1">Time Saved</p>
                <p className="text-3xl font-bold text-green-900">{stats.timeSavedDisplay}</p>
              </div>
              <Clock className="w-12 h-12 text-green-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Link to={createPageUrl("SmartNoteAssistant")}>
          <Card className="hover:shadow-lg transition-all cursor-pointer border-2 border-blue-200 hover:border-blue-400">
            <CardContent className="p-6 text-center">
              <FileText className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <h3 className="font-semibold text-gray-900">Smart Note</h3>
            </CardContent>
          </Card>
        </Link>
        <Link to={createPageUrl("CarePlanManagement")}>
          <Card className="hover:shadow-lg transition-all cursor-pointer border-2 border-green-200 hover:border-green-400">
            <CardContent className="p-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <h3 className="font-semibold text-gray-900">Care Plans</h3>
            </CardContent>
          </Card>
        </Link>
        <Link to={createPageUrl("PatientEducationHub")}>
          <Card className="hover:shadow-lg transition-all cursor-pointer border-2 border-purple-200 hover:border-purple-400">
            <CardContent className="p-6 text-center">
              <User className="w-8 h-8 text-purple-600 mx-auto mb-2" />
              <h3 className="font-semibold text-gray-900">Patient Education</h3>
            </CardContent>
          </Card>
        </Link>
        <Link to={createPageUrl("StaffTrainingHub")}>
          <Card className="hover:shadow-lg transition-all cursor-pointer border-2 border-orange-200 hover:border-orange-400">
            <CardContent className="p-6 text-center">
              <Calendar className="w-8 h-8 text-orange-600 mx-auto mb-2" />
              <h3 className="font-semibold text-gray-900">Nurse Training Hub</h3>
            </CardContent>
          </Card>
        </Link>
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

      {/* Dashboard Widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <ComplianceAlertNotifications 
          nurseEmail={currentUser?.email}
          showAll={false}
          maxAlerts={5}
          compact={true}
        />
        <SmartRouteOptimizer
          visits={visits.filter(v => v.status === 'scheduled')}
          patients={patients}
          onOptimizedSchedule={(order) => console.log('Optimized:', order)}
        />
        <IntelligentTaskPrioritization
          nurseEmail={currentUser?.email}
          patients={patients}
          onTaskCompleted={() => queryClient.invalidateQueries({ queryKey: ['nurseTasks'] })}
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

      {/* Enhanced Voice Commands */}
      <div className="fixed bottom-6 right-6 z-50">
        <EnhancedVoiceCommands
          onTranscription={(text) => console.log('Dictation:', text)}
          onCommand={handleVoiceCommand}
          commands={getCommandsForContext('dashboard')}
          mode="command"
          showSettings={true}
        />
      </div>
    </div>
  );
}