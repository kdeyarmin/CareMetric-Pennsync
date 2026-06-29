import { useMemo, lazy, Suspense, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock, User, CheckCircle2, FileText, Mic, Send, Home, Heart, AlertTriangle, Loader2, Calendar, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/stat-card";
import { toast } from "sonner";
import { formatEastern } from "@/components/utils/timezone";
import CareScopeSelector from "@/components/profile/CareScopeSelector";
import PullToRefresh from "@/components/mobile/PullToRefresh";


// Critical above-the-fold — eager loaded
import SmartRouteOptimizer from "@/components/scheduling/SmartRouteOptimizer";
import ProactiveClinicalSupport from "@/components/clinical/ProactiveClinicalSupport";
import AnnouncementsWidget from "@/components/dashboard/AnnouncementsWidget";
import UpcomingTelehealthWidget from "@/components/dashboard/UpcomingTelehealthWidget";
import DashboardSkeleton from "@/components/loading/DashboardSkeleton";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import { calculateNurseStats } from "@/components/utils/statsCalculator";
import ProfileCompletenessAlert from "@/components/profile/ProfileCompletenessAlert";

// Non-critical below-the-fold — lazy loaded
const HighRiskPatientsWidget    = lazy(() => import("@/components/dashboard/HighRiskPatientsWidget"));
const PendingReferralsWidget    = lazy(() => import("@/components/referral/PendingReferralsWidget"));
const RealTimePatientAlerts     = lazy(() => import("@/components/dashboard/RealTimePatientAlerts"));
const TopTemplatesWidget        = lazy(() => import("@/components/clinical/TopTemplatesWidget"));
const HospitalizationRiskWidget = lazy(() => import("@/components/dashboard/HospitalizationRiskWidget"));
const CarePlanProposalReviewer = lazy(() => import("@/components/carePlan/CarePlanProposalReviewer"));


export default function Dashboard() {
  const queryClient = useQueryClient();
  const containerRef = useRef(null);
  const [_isRefreshing, setIsRefreshing] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        if (error.status === 403) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['dashboardData'] }),
        queryClient.refetchQueries({ queryKey: ['myNoteConversions'] }),
      ]);
      toast.success('Dashboard refreshed');
    } catch {
      toast.error('Some data failed to refresh. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

    // Log page visit with user context
    useEffect(() => {
      if (currentUser?.email) {
        logActivity(ActivityActions.PAGE_VISIT, {
          page: 'Dashboard',
          page_title: 'Dashboard',
          user_role: currentUser.role
        });
      }
    }, [currentUser?.email, currentUser?.role]);

  // Core datasets are fetched through a SERVER-SCOPED function so a non-admin's
  // browser only receives their assigned patients' data (admins: agency-wide).
  // Kept under a dedicated ['dashboardData'] key to avoid disturbing the shared
  // ['patients']/['todayVisits']/... cache used across the rest of the app.
  const { data: dashboardData = {}, isLoading, error: dashboardError } = useQuery({
    queryKey: ['dashboardData', currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('getDashboardData', {});
      return res?.data || {};
    },
    enabled: !!currentUser?.email,
    initialData: {},
    staleTime: 120000,
    gcTime: 300000,
  });
  const visits = useMemo(() => dashboardData.visits || [], [dashboardData.visits]);
  const patients = dashboardData.patients || [];
  const carePlans = dashboardData.carePlans || [];
  const incidents = dashboardData.incidents || [];
  const visitsError = dashboardError;
  const patientsError = dashboardError;

  const { data: noteConversions = [] } = useQuery({
    queryKey: ['myNoteConversions', currentUser?.email],
    queryFn: () => base44.entities.NoteConversion.filter({ nurse_email: currentUser.email }, '-created_date', 100), // reduced from 200
    initialData: [],
    staleTime: 600000,
    gcTime: 900000,
    enabled: !!currentUser?.email,
  });



  // Handle errors gracefully with user feedback
  if (visitsError || patientsError) {
    console.error('Dashboard data loading error:', visitsError || patientsError);
  }

  const hasDataError = visitsError || patientsError;

  const stats = useMemo(() => {
    if (!currentUser?.email) {
      return { noteConversions: 0, timeSavedDisplay: '0 hrs', noteEnhancements: { total: 0 } };
    }

    // Filter for current user's enhancements
    return calculateNurseStats(currentUser.email, {
      visits,
      noteConversions,
      dateRange: 30
    });
  }, [visits, noteConversions, currentUser]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  }, []);

  // Greet by first name only (e.g. "Good Morning, Kevin!"). The full name lives
  // on the user's profile (editable under Settings → Profile); we take the first
  // token and fall back to a friendly default if it hasn't been set yet.
  const firstName = (currentUser?.full_name || '').trim().split(/\s+/)[0] || 'there';
  const careScope = currentUser?.care_scope;
  const careScopeLabel = careScope === "hospice"
    ? "Hospice"
    : careScope === "both"
    ? "Home Health & Hospice"
    : "Home Health";

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  // If user hasn't set their care scope yet, prompt them
  if (currentUser && !careScope) {
    return (
      <div className="max-w-lg mx-auto pt-8 px-4">
        <div className="text-center mb-6">
          <div className="mb-4 inline-flex items-center gap-2">
            <img
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png"
              alt="PennSync"
              className="h-10 w-10 rounded-lg"
            />
            <span className="text-2xl font-bold tracking-tight text-navy-900">
              Penn<span className="text-gold-600">Sync</span>
            </span>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600">Welcome aboard</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Let’s set up your profile</h1>
          <p className="text-slate-500 mt-1">Choose your care scope and we’ll tailor your dashboard.</p>
        </div>
        <CareScopeSelector currentUser={currentUser} onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['currentUser'] });
          toast.success('Care scope saved! Loading your dashboard...');
        }} />
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={handleRefresh} containerRef={containerRef}>
    <div ref={containerRef} className="max-w-7xl mx-auto">
      {hasDataError && (
        <Card className="mb-4 border-red-200 bg-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <div>
                <p className="font-semibold text-red-900">Unable to load dashboard data</p>
                <p className="text-sm text-red-700">Please check your connection and try again.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Profile Completeness Alert */}
      <ProfileCompletenessAlert user={currentUser} />

      {/* Welcome header — personalized, but rendered through the standard PageHeader */}
      <PageHeader
        className="mb-4 sm:mb-6"
        icon={careScope === "hospice" ? Heart : Home}
        eyebrow={careScopeLabel}
        title={`${greeting}, ${firstName}!`}
        description={formatEastern(new Date(), 'EEEE, MMMM d, yyyy') || new Date().toLocaleDateString()}
        favoritePage="Dashboard"
      />



      {/* Quick Navigation Hint */}
      <div className="mb-3 flex items-center justify-center">
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1.5"
        >
          Press <kbd className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl+K</kbd> to quickly navigate anywhere
        </button>
      </div>

      {/* Admin Announcements */}
      <AnnouncementsWidget />

      {/* Scheduled Telehealth reminders */}
      <div className="mb-6">
        <UpcomingTelehealthWidget />
      </div>

      {/* Nurse Stats Cards — shared StatCard treatment (clean white + accent + icon chip).
          The first three deep-link into their domain so the metrics are actionable. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
        <Link to="/ClinicalDocumentation" className="block">
          <StatCard
            label="Today's Visits"
            value={visits.filter(v => v.status === 'scheduled').length}
            sub={`${visits.filter(v => v.status === 'completed').length} completed`}
            icon={Calendar}
            tone="emerald"
          />
        </Link>
        <Link to="/CarePlanManagement" className="block">
          <StatCard
            label="Active Care Plans"
            value={carePlans.length}
            sub={`${patients.length} patients`}
            icon={Target}
            tone="navy"
          />
        </Link>
        <Link to="/SmartNoteAssistant" className="block">
          <StatCard
            label="Note Enhancements"
            value={noteConversions.length}
            sub="AI-assisted"
            icon={FileText}
            tone="slate"
          />
        </Link>
        <StatCard
          label="Time Saved"
          value={stats.timeSavedDisplay}
          sub="last 30 days"
          icon={Clock}
          tone="gold"
        />
      </div>

      {/* Quick Action Buttons — consistent navy hover accent (no rainbow). */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 sm:gap-6 mb-8">
        {[
          { page: "SmartNoteAssistant", label: "Smart Notes",   Icon: FileText },
          { page: "SendFax",            label: "Send Fax",      Icon: Send },
          { page: "CarePlanManagement", label: "Care Plans",    Icon: CheckCircle2 },
          { page: "PatientEducationHub",label: "Pt. Education",  Icon: User },
          { page: "VisitScribe",        label: "Visit Scribe",  Icon: Mic },
          { page: "Incidents",          label: "Incidents",     Icon: AlertTriangle },
        ].map((item) => {
          const ItemIcon = item.Icon;
          return (
            <Link key={item.page} to={`/${item.page}`} className="group">
              <Card className="h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-navy-200 bg-white/50 hover:bg-white">
                <CardContent className="p-4 sm:p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[110px]">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200 transition-all group-hover:bg-navy-50 group-hover:text-navy-700 group-hover:ring-navy-200 shadow-sm">
                    <ItemIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-sm font-semibold leading-tight text-slate-600 transition-colors group-hover:text-navy-900">{item.label}</h3>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Route Optimizer */}
      {visits.length > 0 && (
        <div className="mb-8">
          <SmartRouteOptimizer
            visits={visits.filter(v => v.status === 'scheduled')}
            patients={patients}
            onOptimizedSchedule={() => {
              toast.success('Route optimized! Your schedule has been updated.');
              queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
            }}
          />
        </div>
      )}

      {/* Proactive Clinical Support - Show for first scheduled patient */}
      {visits.length > 0 && visits[0]?.patient_id && (
        <div className="mb-6">
          <ProactiveClinicalSupport
            patientId={visits[0].patient_id}
            compact={true}
          />
        </div>
      )}



      <Suspense fallback={<div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading...</div>}>
        {/* AI Care Plan Proposals - Nurse Review */}
        <div className="mb-8">
          <CarePlanProposalReviewer compact={true} />
        </div>

        {/* Hospitalization Risk Monitor */}
        <div className="mb-8">
          <HospitalizationRiskWidget autoAnalyze={false} />
        </div>

        {/* High-Risk Patients Alert */}
        <div className="mb-8">
          <HighRiskPatientsWidget />
        </div>

        {/* Pending Referrals */}
        <div className="mb-8">
          <PendingReferralsWidget />
        </div>

        {/* Real-time Patient Alerts */}
        <div className="mb-8">
          <RealTimePatientAlerts
            patients={patients}
            visits={visits}
            carePlans={carePlans}
            incidents={incidents}
            currentUser={currentUser}
          />
        </div>

        {/* Top Clinical Templates */}
         <div className="mb-8">
           <TopTemplatesWidget />
         </div>
        </Suspense>

    </div>
    </PullToRefresh>
  );
}