import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import {
  Users,
  Calendar,
  CheckCircle,
  AlertTriangle,
  FileText,
  Clock,
  Activity,
  AlertCircle,
  Bell,
  Megaphone,
  BarChart3,
  Target,
  Award,
  Settings
} from "lucide-react";
import SessionTimeoutWarning from "@/components/security/SessionTimeoutWarning";
import OfflineDataSync from "@/components/mobile/OfflineDataSync";
import QuickAccessPatientCard from "@/components/dashboard/QuickAccessPatientCard";
import TimeSavingsWidget from "@/components/dashboard/TimeSavingsWidget";
import DashboardWidgetCustomizer, { useDashboardWidgets } from "@/components/dashboard/DashboardWidgetCustomizer";
import MobileOfflineBanner from "@/components/mobile/MobileOfflineBanner";
import ProactiveComplianceTraining from "@/components/training/ProactiveComplianceTraining";
import CollapsibleMobileSection from "@/components/mobile/CollapsibleMobileSection";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";
import TrialStatusBanner from "@/components/subscription/TrialStatusBanner";

export default function Home() {
  const [showCustomizer, setShowCustomizer] = useState(false);
  const { widgets, setWidgets, isVisible } = useDashboardWidgets();

  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list(),
    initialData: [],
  });

  const { data: visits = [] } = useQuery({
    queryKey: ["visits"],
    queryFn: () => base44.entities.Visit.list(),
    initialData: [],
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => base44.entities.Task.list(),
    initialData: [],
  });

  const { data: complianceViolations = [] } = useQuery({
    queryKey: ["complianceViolations"],
    queryFn: () => base44.entities.ComplianceViolation.filter({ status: "open" }),
    initialData: [],
  });

  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => base44.entities.Announcement.filter({ is_active: true }),
    initialData: [],
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ["carePlans"],
    queryFn: () => base44.entities.CarePlan.list(),
    initialData: [],
  });

  const { data: patientAlerts = [] } = useQuery({
    queryKey: ["patientAlerts"],
    queryFn: () => base44.entities.PatientAlert.filter({ status: "active" }),
    initialData: [],
  });

  const totalPatients = patients.length;
  const pendingTasks = tasks.filter(t => t.status !== "completed").length;
  const upcomingVisits = visits.filter(v => {
    const visitDate = new Date(v.scheduled_date || v.visit_date);
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return visitDate >= today && visitDate <= nextWeek;
  }).length;

  const activeCarePlans = carePlans.filter(cp => cp.status === "active").length;
  const completedTasksToday = tasks.filter(t => {
    const completedDate = new Date(t.completed_date);
    const today = new Date();
    return t.status === "completed" && 
           completedDate.toDateString() === today.toDateString();
  }).length;

  const highRiskPatients = patients
    .filter(p => p.risk_level === "high" || p.risk_score > 70)
    .slice(0, 5);

  const quickActions = [
    { label: "Create Note", icon: FileText, page: "SmartNoteAssistant", color: "bg-blue-500" },
    { label: "Voice Scribe", icon: Activity, page: "MedicalScribe", color: "bg-pink-500" },
    { label: "View Patients", icon: Users, page: "Patients", color: "bg-green-500" },
    { label: "OASIS Review", icon: FileText, page: "OASIS", color: "bg-indigo-500" },
    { label: "Send Fax", icon: FileText, page: "SendFax", color: "bg-purple-500" },
    { label: "Care Plans", icon: Target, page: "CarePlanManagement", color: "bg-cyan-500" },
    { label: "Analytics", icon: BarChart3, page: "AnalyticsDashboard", color: "bg-emerald-500" },
  ];

  return (
    <PremiumFeatureGate featureName="Dashboard" featureDescription="Your central hub for patient management, tasks, and clinical insights." allowTrial={true}>
    <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 min-h-screen bg-gradient-to-br from-slate-200 via-blue-100 to-slate-300">
      <SessionTimeoutWarning />
      <OfflineDataSync />
      <TrialStatusBanner />
      
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-700 to-blue-900 bg-clip-text text-transparent truncate">
            Welcome, {user?.full_name?.split(' ')[0] || "Nurse"} 👋
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5 hidden sm:block">
            Here's what's happening with your patients today
          </p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => setShowCustomizer(!showCustomizer)} className="h-8 px-2 sm:px-3">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline ml-1.5">Customize</span>
          </Button>
          {user?.role === "admin" && (
            <Link to={createPageUrl("AdminDashboard")}>
              <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3">
                <Award className="h-4 w-4" />
                <span className="hidden sm:inline ml-1.5">Admin</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      {showCustomizer && (
        <DashboardWidgetCustomizer widgets={widgets} setWidgets={setWidgets} onClose={() => setShowCustomizer(false)} />
      )}

      <MobileOfflineBanner />

      {announcements.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Announcements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {announcements.slice(0, 3).map((announcement) => (
                <div key={announcement.id} className="flex items-start gap-2">
                  <Bell className="h-4 w-4 text-blue-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">{announcement.title}</p>
                    <p className="text-xs text-muted-foreground">{announcement.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isVisible("stats") && (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="bg-gradient-to-br from-blue-200 to-slate-300 border-blue-400">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
              <Users className="h-4 w-4 text-blue-700" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalPatients}</div>
              <p className="text-xs text-slate-600">Active in your care</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-slate-200 to-blue-200 border-slate-400">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Upcoming Visits</CardTitle>
              <Calendar className="h-4 w-4 text-blue-700" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{upcomingVisits}</div>
              <p className="text-xs text-slate-600">Next 7 days</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-200 to-slate-300 border-blue-400">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
              <Clock className="h-4 w-4 text-blue-700" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pendingTasks}</div>
              <p className="text-xs text-slate-600">To be completed</p>
              {completedTasksToday > 0 && (
                <p className="text-xs text-green-700 mt-1">+{completedTasksToday} completed today</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {isVisible("timeSavings") && <TimeSavingsWidget />}

      {isVisible("secondaryStats") && (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-3">
          <Card className="bg-gradient-to-br from-blue-200 to-slate-300 border-blue-400">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Care Plans</CardTitle>
              <Target className="h-4 w-4 text-blue-700" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{activeCarePlans}</div>
              <p className="text-xs text-slate-600">In progress</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-slate-200 to-blue-200 border-slate-400">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">High Risk Patients</CardTitle>
              <AlertCircle className="h-4 w-4 text-blue-700" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{highRiskPatients.length}</div>
              <p className="text-xs text-slate-600">Require attention</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-200 to-slate-300 border-blue-400">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Patient Alerts</CardTitle>
              <Bell className="h-4 w-4 text-blue-700" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{patientAlerts.length}</div>
              <p className="text-xs text-slate-600">Active notifications</p>
            </CardContent>
          </Card>
        </div>
      )}

      {user?.email && <ProactiveComplianceTraining userEmail={user.email} />}

      {isVisible("quickActions") && (
        <Card>
          <CardHeader className="p-3 sm:p-4 pb-2">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 sm:p-4 pt-1">
            <div className="grid gap-2 grid-cols-4 sm:grid-cols-4 md:grid-cols-7">
              {quickActions.map((action) => (
                <Link key={action.page} to={createPageUrl(action.page)} className="block">
                  <button className="w-full flex flex-col items-center justify-center gap-1 p-2 sm:p-3 bg-gradient-to-br from-blue-50 to-slate-50 hover:from-blue-100 hover:to-slate-100 active:scale-95 rounded-xl border border-slate-200 transition-all touch-manipulation">
                    <div className={`p-2 rounded-lg ${action.color}`}>
                      <action.icon className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-[10px] sm:text-xs font-medium text-center leading-tight">{action.label}</span>
                  </button>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <QuickAccessPatientCard />

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Recent Tasks</span>
              <Link to={createPageUrl("Tasks")}><Button variant="ghost" size="sm">View All</Button></Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No tasks yet</p>
            ) : (
              <div className="space-y-3">
                {tasks.slice(0, 5).map((task) => (
                  <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg border bg-gradient-to-r from-blue-50/60 to-slate-50/60 transition-colors card-hover">
                    <div className={`mt-1 ${task.status === "completed" ? "text-green-500" : "text-gray-400"}`}>
                      <CheckCircle className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <p className="text-xs text-muted-foreground">{task.priority} priority • {task.status}</p>
                    </div>
                    {task.due_date && <Badge variant="outline" className="text-xs">{new Date(task.due_date).toLocaleDateString()}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {isVisible("compliance") && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Compliance Alerts</span>
                <Link to={createPageUrl("ComplianceDashboard")}><Button variant="ghost" size="sm">View All</Button></Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {complianceViolations.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-green-600">All Clear!</p>
                  <p className="text-xs text-muted-foreground">No compliance issues</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {complianceViolations.slice(0, 5).map((v) => (
                    <div key={v.id} className="flex items-start gap-3 p-3 rounded-lg border border-orange-200 bg-orange-50 card-hover">
                      <AlertTriangle className="h-4 w-4 text-orange-500 mt-1" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{v.rule_name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{v.violation_description}</p>
                      </div>
                      <Badge variant="outline" className={`text-xs ${v.severity === "critical" ? "border-red-500 text-red-700" : v.severity === "high" ? "border-orange-500 text-orange-700" : "border-yellow-500 text-yellow-700"}`}>{v.severity}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isVisible("patientAlerts") && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Patient Alerts</span>
                <Link to={createPageUrl("PatientAlerts")}><Button variant="ghost" size="sm">View All</Button></Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {patientAlerts.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-green-600">No Alerts</p>
                  <p className="text-xs text-muted-foreground">All patients stable</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {patientAlerts.slice(0, 5).map((a) => (
                    <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg border bg-gradient-to-r from-blue-50/60 to-slate-50/60 transition-colors card-hover">
                      <Bell className="h-4 w-4 text-blue-500 mt-1" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{a.alert_type}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{a.description}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{a.priority}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
    </PremiumFeatureGate>
  );
}