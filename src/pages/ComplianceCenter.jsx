import { lazy, Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import PageHeader from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield, AlertTriangle, TrendingDown, Users, FileText, Calendar, BarChart3, Clock, Award, Bell, Search, CheckCircle2,
  BookOpen, LayoutDashboard, Lock, Loader2
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format, subDays, startOfDay, parseISO, differenceInDays } from "date-fns";
import { toast } from "sonner";
import ComplianceReportGenerator from "@/components/compliance/ComplianceReportGenerator";
import AIComplianceAssistant from "@/components/compliance/AIComplianceAssistant";

const RegulatoryCompliance = lazy(() => import("@/components/hub-tabs/RegulatoryCompliance"));
const ComplianceMonitoringDashboard = lazy(() => import("@/components/hub-tabs/ComplianceMonitoringDashboard"));
const RealTimeComplianceDashboard = lazy(() => import("@/components/hub-tabs/RealTimeComplianceDashboard"));
const SecurityCompliance = lazy(() => import("@/components/hub-tabs/SecurityCompliance"));
const SecurityPolicy = lazy(() => import("@/components/hub-tabs/SecurityPolicy"));

// Top-level tab keys, kept in sync with the TabsTrigger values below. Used to
// validate the ?tab= deep-link so the retired standalone pages (Compliance
// Monitoring, Real-Time Compliance, Regulatory Compliance, Security & Compliance,
// Security Policy) redirect straight to the right tab.
const TAB_KEYS = ["dashboard", "regulatory", "security"];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

export default function ComplianceCenter() {
  const [timeRange, setTimeRange] = useState(30);
  const [selectedNurse, setSelectedNurse] = useState("all");
  const ai = useAICall();
  const [aiInsights, setAIInsights] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const _queryClient = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedView = searchParams.get("view");
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "dashboard";

  // Nested sub-tab selection, driven by ?view= so deep links (e.g. a retired
  // /ComplianceMonitoringDashboard or /SecurityPolicy bookmark) open the right
  // inner page instead of the sub-tab default.
  const DASHBOARD_VIEWS = ["overview", "live", "monitoring", "realtime"];
  const SECURITY_VIEWS = ["audit-logs", "policies"];
  const dashboardView = DASHBOARD_VIEWS.includes(requestedView) ? requestedView : "overview";
  const securityView = SECURITY_VIEWS.includes(requestedView) ? requestedView : "audit-logs";
  const handleViewChange = (view) => setSearchParams({ tab: activeTab, view });

  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and
  // redirects from the retired pages deep-link correctly. "dashboard" is the
  // default, so it stays a clean /ComplianceCenter with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "dashboard" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= so the
  // default tab is plain /ComplianceCenter. Skipped while a meaningful ?view= is
  // present (a deep-linked sub-tab).
  useEffect(() => {
    if (requestedTab !== null && activeTab === "dashboard" && !requestedView) {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, requestedView, setSearchParams]);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: audits = [] } = useQuery({
    queryKey: ['complianceAudits', timeRange],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 1000),
    initialData: [],
  });

  const { data: _medicareRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  const { data: _patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: [],
  });

  const { data: allUsers = [], refetch: _refetchUsers } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
    refetchInterval: 30000,
  });

  const { data: trainingAssignments = [], refetch: _refetchAssignments } = useQuery({
    queryKey: ['allTrainingAssignments'],
    queryFn: () => base44.entities.TrainingAssignment.list('-updated_date', 500),
    initialData: [],
    refetchInterval: 30000,
  });

  const { data: personnelCredentials = [], refetch: _refetchCredentials } = useQuery({
    queryKey: ['allPersonnelCredentials'],
    queryFn: () => base44.entities.PersonnelCredential.list('-updated_date', 500),
    initialData: [],
    refetchInterval: 30000,
  });

  const { data: _visits = [], refetch: _refetchVisits } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.filter({}, '-visit_date', 500),
    initialData: [],
    refetchInterval: 30000,
  });

  const isAdmin = currentUser?.role === 'admin';

  // Filter audits by time range
  const cutoffDate = subDays(new Date(), timeRange);
  const filteredAudits = audits.filter(audit => {
    const auditDate = new Date(audit.audit_date || audit.created_date);
    const afterCutoff = auditDate >= cutoffDate;
    const matchesNurse = selectedNurse === "all" || audit.nurse_email === selectedNurse;
    return afterCutoff && matchesNurse;
  });

  // Calculate metrics
  const avgComplianceScore = filteredAudits.length > 0
    ? filteredAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / filteredAudits.length
    : 0;

  const criticalIssuesCount = filteredAudits.reduce((sum, a) => 
    sum + (a.issues?.filter(i => i.severity === 'critical').length || 0), 0
  );

  const totalIssuesCount = filteredAudits.reduce((sum, a) => 
    sum + (a.issues?.length || 0), 0
  );

  const uniqueNurses = [...new Set(audits.map(a => a.nurse_email))].filter(Boolean);

  // Trend data
  const trendData = [];
  const daysToShow = Math.min(timeRange, 30);
  for (let i = daysToShow - 1; i >= 0; i--) {
    const date = subDays(new Date(), i);
    const dateStr = format(date, 'MMM dd');
    const dayAudits = filteredAudits.filter(a => {
      const auditDate = startOfDay(new Date(a.audit_date || a.created_date));
      return auditDate.getTime() === startOfDay(date).getTime();
    });
    
    if (dayAudits.length > 0) {
      const avgScore = dayAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / dayAudits.length;
      trendData.push({
        date: dateStr,
        score: Math.round(avgScore),
        audits: dayAudits.length
      });
    }
  }

  // Issue frequency
  const issueFrequency = {};
  filteredAudits.forEach(audit => {
    (audit.issues || []).forEach(issue => {
      const key = issue.element || 'Unknown';
      if (!issueFrequency[key]) {
        issueFrequency[key] = {
          count: 0,
          severity: issue.severity || 'medium',
          cop_reference: issue.cop_reference || 'N/A'
        };
      }
      issueFrequency[key].count++;
    });
  });

  const topIssues = Object.entries(issueFrequency)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([issue, data]) => ({
      name: issue,
      count: data.count,
      severity: data.severity,
      cop_reference: data.cop_reference,
      // Clamp: an issue can recur across/within audits, so raw occurrences/audits
      // can exceed 100%. Cap at 100 so the share is never nonsensical.
      percentage: Math.min((filteredAudits.length > 0 ? (data.count / filteredAudits.length) * 100 : 0), 100).toFixed(1)
    }));

  // Nurse performance
  const _nursePerformance = uniqueNurses.map(email => {
    const nurseAudits = filteredAudits.filter(a => a.nurse_email === email);
    const avgScore = nurseAudits.length > 0
      ? nurseAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / nurseAudits.length
      : 0;
    return {
      nurse: email?.split('@')[0] || 'Unknown',
      score: Math.round(avgScore),
      audits: nurseAudits.length
    };
  }).sort((a, b) => b.score - a.score);

  // Calculate monitoring issues
  const complianceIssues = useMemo(() => {
    const issues = [];
    const today = new Date();

    // Overdue training
    trainingAssignments.forEach(assignment => {
      if (assignment.status !== 'completed' && assignment.due_date) {
        const dueDate = parseISO(assignment.due_date);
        const daysOverdue = differenceInDays(today, dueDate);
        
        if (daysOverdue > 0) {
          const user = allUsers.find(u => u.email === assignment.assigned_to_user_id);
          if (user) {
            issues.push({
              type: 'overdue_training',
              severity: daysOverdue > 30 ? 'critical' : daysOverdue > 14 ? 'high' : 'medium',
              userId: user.email,
              userName: user.full_name,
              userRole: user.role,
              title: assignment.course_title,
              daysOverdue,
              dueDate: assignment.due_date,
              details: `Training "${assignment.course_title}" is ${daysOverdue} days overdue`
            });
          }
        }
      }
    });

    // Expiring credentials
    personnelCredentials.forEach(cred => {
      if (cred.expiration_date) {
        const expDate = parseISO(cred.expiration_date);
        const daysUntilExpiry = differenceInDays(expDate, today);
        
        if (daysUntilExpiry <= 30 || cred.status === 'expired') {
          const user = allUsers.find(u => u.email === cred.user_id);
          if (user) {
            issues.push({
              type: 'expiring_credential',
              severity: daysUntilExpiry <= 0 ? 'critical' : daysUntilExpiry <= 7 ? 'high' : 'medium',
              userId: user.email,
              userName: user.full_name,
              userRole: user.role,
              title: cred.title,
              daysUntilExpiry,
              expirationDate: cred.expiration_date,
              details: daysUntilExpiry <= 0 
                ? `${cred.title} expired ${Math.abs(daysUntilExpiry)} days ago`
                : `${cred.title} expires in ${daysUntilExpiry} days`
            });
          }
        }
      }
    });

    return issues;
  }, [trainingAssignments, personnelCredentials, allUsers]);

  const filteredIssues = complianceIssues.filter(issue => {
    const matchesSearch = !searchTerm ||
      (issue.userName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (issue.title || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || issue.type === categoryFilter;
    const matchesSeverity = severityFilter === 'all' || issue.severity === severityFilter;
    return matchesSearch && matchesCategory && matchesSeverity;
  });

  const groupedByUser = filteredIssues.reduce((acc, issue) => {
    if (!acc[issue.userId]) {
      acc[issue.userId] = {
        userName: issue.userName,
        userRole: issue.userRole,
        issues: []
      };
    }
    acc[issue.userId].issues.push(issue);
    return acc;
  }, {});

  const criticalCount = complianceIssues.filter(i => i.severity === 'critical').length;
  const highCount = complianceIssues.filter(i => i.severity === 'high').length;
  const affectedUsers = Object.keys(groupedByUser).length;
  const overdueTraining = complianceIssues.filter(i => i.type === 'overdue_training').length;
  const expiringCreds = complianceIssues.filter(i => i.type === 'expiring_credential').length;

  const sendNotificationMutation = useMutation({
    mutationFn: async ({ userEmails, message, subject }) => {
      return await Promise.all(
        userEmails.map(email => 
          base44.integrations.Core.SendEmail({ to: email, subject, body: message })
        )
      );
    },
    onSuccess: (_, variables) => {
      toast.success(`Notifications sent to ${variables.userEmails.length} employee(s)`);
      setSelectedUsers(new Set());
    },
    onError: () => {
      toast.error("Failed to send notifications");
    }
  });

  const handleNotifySelected = () => {
    if (selectedUsers.size === 0) {
      toast.error("Please select at least one employee");
      return;
    }

    const userEmails = Array.from(selectedUsers);
    const issuesSummary = userEmails.map(email => {
      const userData = groupedByUser[email];
      const issues = userData.issues.map(issue => `• ${issue.details}`).join('\n');
      return `${userData.userName}:\n${issues}`;
    }).join('\n\n');

    sendNotificationMutation.mutate({
      userEmails,
      subject: "⚠️ Compliance Action Required",
      message: `You have compliance items requiring immediate attention:\n\n${issuesSummary}\n\nPlease address these items as soon as possible.`
    });
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-amber-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-slate-900 mb-2">Admin Access Required</h2>
        <p className="text-slate-600">Compliance Center is available to administrators only.</p>
      </div>
    );
  }

  const _COLORS = ['#3557b0', '#10B981', '#F59E0B', '#EF4444'];

  return (
    <PageContainer>
      <PageHeader
        icon={Shield}
        eyebrow="Compliance"
        title="Compliance Center"
        description="Compliance monitoring, real-time alerts, regulatory tracking, and security & policies — all in one place."
        favoritePage="ComplianceCenter"
      />

      <EmbeddedPage>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="dashboard" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="regulatory" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BookOpen className="w-4 h-4 mr-2" />
              Regulatory
            </TabsTrigger>
            <TabsTrigger value="security" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Lock className="w-4 h-4 mr-2" />
              Security &amp; Policies
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Dashboard: Overview + live monitoring + merged dashboards */}
        <TabsContent value="dashboard" className="space-y-6">
          <Tabs value={dashboardView} onValueChange={handleViewChange} className="space-y-6">
            <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
              <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
                <TabsTrigger value="overview" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  <Shield className="w-4 h-4 mr-2" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="live" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Real-Time Monitoring
                </TabsTrigger>
                <TabsTrigger value="monitoring" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  <Clock className="w-4 h-4 mr-2" />
                  Monitoring
                </TabsTrigger>
                <TabsTrigger value="realtime" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Real-Time Insights
                </TabsTrigger>
              </TabsList>
            </div>

        {/* Medicare Compliance Dashboard */}
        <TabsContent value="overview" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex flex-col sm:flex-row gap-3 flex-1">
              <Select value={timeRange.toString()} onValueChange={(v) => setTimeRange(parseInt(v))}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="60">Last 60 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                </SelectContent>
              </Select>
              {isAdmin && (
                <Select value={selectedNurse} onValueChange={setSelectedNurse}>
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Nurses</SelectItem>
                    {uniqueNurses.map(nurse => (
                      <SelectItem key={nurse} value={nurse}>{nurse}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button className="w-full sm:w-auto" onClick={async () => {
              try {
                const result = await ai.run({
                  model: "claude_opus_4_8",
                  prompt: `Analyze Medicare compliance data and provide executive insights.
METRICS: ${filteredAudits.length} audits, ${avgComplianceScore.toFixed(1)}% avg score, ${criticalIssuesCount} critical issues
TOP ISSUES: ${topIssues.slice(0, 5).map(i => `${i.name}: ${i.count}`).join(', ')}
Provide: overall_assessment, critical_priorities (array), systemic_issues, action_plan, trend_analysis`,
                  response_json_schema: {
                    type: "object",
                    properties: {
                      overall_assessment: { type: "string" },
                      critical_priorities: { type: "array", items: { type: "object" } },
                      systemic_issues: { type: "array", items: { type: "string" } },
                      action_plan: { type: "array", items: { type: "object" } },
                      trend_analysis: { type: "string" }
                    }
                  }
                });
                setAIInsights(result);
              } catch {
                toast.error('Failed to generate insights');
              }
            }} disabled={ai.loading}>
              {ai.loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Analyzing...
                </>
              ) : (
                <>
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Generate AI Insights
                </>
              )}
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Avg Compliance" value={`${avgComplianceScore.toFixed(1)}%`} icon={Shield} tone="navy" />
            <StatCard label="Critical Issues" value={criticalIssuesCount} icon={AlertTriangle} tone="red" />
            <StatCard label="Total Issues" value={totalIssuesCount} icon={FileText} tone="amber" />
            <StatCard label="Audits Reviewed" value={filteredAudits.length} icon={Calendar} tone="emerald" />
          </div>

          {aiInsights && (
            <Card className="border-l-4 border-l-gold-400">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-navy-600" />
                  AI Strategic Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-white p-4 rounded-lg border-2 border-navy-200">
                  <h3 className="font-bold text-navy-900 mb-2">Overall Assessment</h3>
                  <p className="text-slate-700">{aiInsights.overall_assessment}</p>
                </div>
                {aiInsights.action_plan && (
                  <div>
                    <h3 className="font-bold text-slate-900 mb-3">30-Day Action Plan</h3>
                    <div className="space-y-2">
                      {aiInsights.action_plan.map((action, idx) => (
                        <div key={idx} className="bg-white p-3 rounded border flex gap-3">
                          <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-blue-600">{idx + 1}</span>
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-slate-900">{action.action}</p>
                            <p className="text-xs text-slate-600 mt-1">{action.timeline}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Compliance Score Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="score" stroke="#3557b0" strokeWidth={3} name="Compliance Score (%)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <ComplianceReportGenerator dateRange={timeRange} nurseEmail={selectedNurse === "all" ? null : selectedNurse} />
            <AIComplianceAssistant />
          </div>
        </TabsContent>

        {/* Real-Time Monitoring (live, computed in this hub) */}
        <TabsContent value="live" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Critical Issues" value={criticalCount} icon={AlertTriangle} tone="red" />
            <StatCard label="High Priority" value={highCount} icon={TrendingDown} tone="amber" />
            <StatCard label="Affected Staff" value={affectedUsers} icon={Users} tone="navy" />
            <StatCard label="Overdue Training" value={overdueTraining} icon={Clock} tone="slate" />
            <StatCard label="Expiring Creds" value={expiringCreds} icon={Award} tone="gold" />
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col lg:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search by employee or issue..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-full lg:w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="overdue_training">Overdue Training</SelectItem>
                    <SelectItem value="expiring_credential">Expiring Credentials</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={severityFilter} onValueChange={setSeverityFilter}>
                  <SelectTrigger className="w-full lg:w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleNotifySelected}
                  disabled={selectedUsers.size === 0}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  <Bell className="w-4 h-4 mr-2" />
                  Notify ({selectedUsers.size})
                </Button>
              </div>
            </CardContent>
          </Card>

          {filteredIssues.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-slate-900 mb-2">All Clear!</h3>
                <p className="text-slate-600">No compliance issues found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedByUser).map(([userId, userData]) => {
                const isSelected = selectedUsers.has(userId);
                const criticalIssues = userData.issues.filter(i => i.severity === 'critical').length;

                return (
                  <Card key={userId} className={`border-l-4 ${
                    isSelected ? 'border-l-orange-500 bg-orange-50' : 
                    criticalIssues > 0 ? 'border-l-red-500' : 'border-l-slate-300'
                  }`}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              const newSelected = new Set(selectedUsers);
                              isSelected ? newSelected.delete(userId) : newSelected.add(userId);
                              setSelectedUsers(newSelected);
                            }}
                            className="w-5 h-5 rounded"
                          />
                          <div>
                            <h3 className="text-lg font-bold text-slate-900">{userData.userName}</h3>
                            <p className="text-sm text-slate-600">{userData.userRole} • {userId}</p>
                          </div>
                        </div>
                        <Badge variant="outline">{userData.issues.length} issue(s)</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {userData.issues.map((issue, idx) => (
                          <div key={idx} className="p-3 bg-white rounded-lg border">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold text-slate-900">{issue.title}</h4>
                              <Badge className={getSeverityColor(issue.severity)}>{issue.severity}</Badge>
                            </div>
                            <p className="text-sm text-slate-700">{issue.details}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

            {/* Compliance Monitoring (merged page) */}
            <TabsContent value="monitoring">
              <Suspense fallback={tabLoader}>
                <ComplianceMonitoringDashboard />
              </Suspense>
            </TabsContent>

            {/* Real-Time Compliance (merged page) */}
            <TabsContent value="realtime">
              <Suspense fallback={tabLoader}>
                <RealTimeComplianceDashboard />
              </Suspense>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Regulatory Tab */}
        <TabsContent value="regulatory">
          <Suspense fallback={tabLoader}>
            <RegulatoryCompliance />
          </Suspense>
        </TabsContent>

        {/* Security & Policies Tab */}
        <TabsContent value="security">
          <Tabs value={securityView} onValueChange={handleViewChange} className="space-y-6">
            <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
              <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
                <TabsTrigger value="audit-logs" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  <Shield className="w-4 h-4 mr-2" />
                  Audit Logs
                </TabsTrigger>
                <TabsTrigger value="policies" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  <Lock className="w-4 h-4 mr-2" />
                  Policies
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="audit-logs">
              <Suspense fallback={tabLoader}>
                <SecurityCompliance />
              </Suspense>
            </TabsContent>

            <TabsContent value="policies">
              <Suspense fallback={tabLoader}>
                <SecurityPolicy />
              </Suspense>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
      </EmbeddedPage>
    </PageContainer>
  );
}