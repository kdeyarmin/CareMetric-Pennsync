import React from "react";
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
  TrendingUp,
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
import TimeSavingsWidget from "@/components/dashboard/TimeSavingsWidget";
import DashboardWidgetCustomizer, { useDashboardWidgets } from "@/components/dashboard/DashboardWidgetCustomizer";
import OfflinePatientViewer from "@/components/mobile/OfflinePatientViewer";
import ProactiveComplianceTraining from "@/components/training/ProactiveComplianceTraining";

export default function Dashboard() {
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

  // Calculate stats
  const totalPatients = patients.length;
  const pendingTasks = tasks.filter(t => t.status !== "completed").length;
  const openViolations = complianceViolations.length;
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

  // High risk patients
  const highRiskPatients = patients
    .filter(p => p.risk_level === "high" || p.risk_score > 70)
    .slice(0, 5);

  const { widgets, setWidgets, isVisible, getOrder } = useDashboardWidgets();
  const [showCustomizer, setShowCustomizer] = useState(false);

  const quickActions = [
    { label: "Create Note", icon: FileText, page: "SmartNoteAssistant", color: "bg-blue-500" },
    { label: "View Patients", icon: Users, page: "Patients", color: "bg-green-500" },
    { label: "Check Compliance", icon: CheckCircle, page: "ComplianceDashboard", color: "bg-orange-500" },
    { label: "OASIS Review", icon: FileText, page: "OASIS", color: "bg-indigo-500" },
    { label: "Medical Scribe", icon: Activity, page: "MedicalScribe", color: "bg-pink-500" },
    { label: "Care Plans", icon: Target, page: "CarePlanManagement", color: "bg-cyan-500" },
    { label: "Analytics", icon: BarChart3, page: "AnalyticsDashboard", color: "bg-emerald-500" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6 min-h-screen bg-gradient-to-br from-slate-200 via-blue-100 to-slate-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-700 to-blue-900 bg-clip-text text-transparent">
            Welcome back, {user?.full_name || "User"}
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 mt-1">
            Here's what's happening with your patients today
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowCustomizer(!showCustomizer)} className="touch-target">
            <Settings className="h-4 w-4 mr-2" />
            Customize
          </Button>
          {user?.role === "admin" && (
            <Link to={createPageUrl("AdminDashboard")}>
              <Button variant="outline" size="sm" className="touch-target">
                <Award className="h-4 w-4 mr-2" />
                Admin Panel
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Dashboard Customizer */}
      {showCustomizer && (
        <DashboardWidgetCustomizer widgets={widgets} setWidgets={setWidgets} onClose={() => setShowCustomizer(false)} />
      )}

      {/* Offline Patient Access */}
      <OfflinePatientViewer userEmail={user?.email} />

      {/* Announcements */}
      {announcements.length > 0 && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-900/20">
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

      {/* Stats Grid */}
      {isVisible("stats") && <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
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
              <p className="text-xs text-green-700 mt-1">
                +{completedTasksToday} completed today
              </p>
            )}
          </CardContent>
        </Card>
      </div>}

      {/* Time Savings Widget */}
      {isVisible("timeSavings") && <TimeSavingsWidget />}

      {/* Secondary Stats */}
      {isVisible("secondaryStats") && <div className="grid gap-4 md:grid-cols-3">
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
      </div>}

      {/* Proactive Compliance Training */}
      {user?.email && <ProactiveComplianceTraining userEmail={user.email} />}

      {/* Quick Actions */}
      {isVisible("quickActions") && <Card>
        <CardHeader className="p-3 sm:p-4">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Activity className="h-4 w-4 sm:h-5 sm:w-5" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          <div className="grid gap-2 sm:gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            {quickActions.map((action) => (
              <Link key={action.page} to={createPageUrl(action.page)} className="block">
                <Button
                  variant="outline"
                  className="w-full h-20 sm:h-24 flex flex-col items-center justify-center gap-1 sm:gap-2 bg-gradient-to-br from-blue-50 to-slate-50 dark:from-slate-800/60 dark:to-slate-900/40 hover:from-blue-100 hover:to-slate-100 dark:hover:from-slate-700/60 dark:hover:to-slate-800/40 hover:shadow-md transition-all rounded-lg card-hover touch-target"
                >
                  <div className={`p-1.5 sm:p-2 rounded-lg ${action.color}`}>
                    <action.icon className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-medium text-center leading-tight px-1">{action.label}</span>
                </Button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>}

      {/* High Risk Patients & Recent Activity */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* High Risk Patients */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-500" />
                High Risk Patients
              </span>
              <Link to={createPageUrl("Patients")}>
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {highRiskPatients.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-green-600">All Stable</p>
                <p className="text-xs text-muted-foreground">No high-risk patients</p>
              </div>
            ) : (
              <div className="space-y-3">
                {highRiskPatients.map((patient) => (
                  <Link key={patient.id} to={createPageUrl("PatientDetails") + `?id=${patient.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 hover:shadow-md transition-all card-hover">
                      <div>
                        <p className="text-sm font-medium">{patient.first_name} {patient.last_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {patient.primary_diagnosis || "No diagnosis"}
                        </p>
                      </div>
                      <Badge variant="destructive">High Risk</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Recent Tasks</span>
              <Link to={createPageUrl("Tasks")}>
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No tasks yet
              </p>
            ) : (
              <div className="space-y-3">
                {tasks.slice(0, 5).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-gradient-to-r from-blue-50/60 to-slate-50/60 dark:from-slate-800/40 dark:to-slate-900/30 hover:from-blue-100/60 hover:to-slate-100/60 dark:hover:from-slate-700/40 dark:hover:to-slate-800/30 transition-colors card-hover"
                  >
                    <div className={`mt-1 ${task.status === "completed" ? "text-green-500" : "text-gray-400"}`}>
                      <CheckCircle className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.priority} priority • {task.status}
                      </p>
                    </div>
                    {task.due_date && (
                      <Badge variant="outline" className="text-xs">
                        {new Date(task.due_date).toLocaleDateString()}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Compliance Alerts & Patient Alerts */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* Compliance Alerts */}
        {isVisible("compliance") && <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Compliance Alerts</span>
              <Link to={createPageUrl("ComplianceDashboard")}>
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
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
                {complianceViolations.slice(0, 5).map((violation) => (
                  <div
                    key={violation.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-900/20 card-hover"
                  >
                    <AlertTriangle className="h-4 w-4 text-orange-500 mt-1" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{violation.rule_name}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {violation.violation_description}
                      </p>
                    </div>
                    <Badge 
                      variant="outline" 
                      className={`text-xs ${
                        violation.severity === "critical" ? "border-red-500 text-red-700" :
                        violation.severity === "high" ? "border-orange-500 text-orange-700" :
                        "border-yellow-500 text-yellow-700"
                      }`}
                    >
                      {violation.severity}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>}

        {/* Patient Alerts */}
        {isVisible("patientAlerts") && <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Patient Alerts</span>
              <Link to={createPageUrl("PatientAlerts")}>
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
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
                {patientAlerts.slice(0, 5).map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-gradient-to-r from-blue-50/60 to-slate-50/60 dark:from-slate-800/40 dark:to-slate-900/30 hover:from-blue-100/60 hover:to-slate-100/60 dark:hover:from-slate-700/40 dark:hover:to-slate-800/30 transition-colors card-hover"
                  >
                    <Bell className="h-4 w-4 text-blue-500 mt-1" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{alert.alert_type}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {alert.description}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {alert.priority}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>}
      </div>
    </div>
  );
}