import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Users, FileText, TrendingUp, DollarSign, Shield, 
  GraduationCap, AlertTriangle, Activity, Clock, 
  CheckCircle2, BarChart3, Calendar, Zap, Brain,
  UserCheck, Award, Target, Search, ChevronLeft, ChevronRight,
  RefreshCw, BookOpen, Download, CreditCard, TrendingDown
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { formatEastern } from "@/components/utils/timezone";
import { calculateStats, formatNumber, formatCurrency } from "@/components/utils/statsCalculator";
import AIFeedbackAnalytics from "../components/admin/AIFeedbackAnalytics";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function AdminDashboard() {
  const [dateRange, setDateRange] = useState(30);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityPage, setActivityPage] = useState(1);
  const activityPerPage = 10;
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list(),
  });

  const { data: allVisits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date'),
  });

  const { data: allNoteConversions = [] } = useQuery({
    queryKey: ['allNoteConversions'],
    queryFn: () => base44.entities.NoteConversion.list('-created_date'),
  });

  const { data: allComplianceAudits = [] } = useQuery({
    queryKey: ['allComplianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date'),
  });

  const { data: allTrainingCompletions = [] } = useQuery({
    queryKey: ['allTrainingCompletions'],
    queryFn: () => base44.entities.TrainingCompletion.list(),
  });

  const { data: allIncidents = [] } = useQuery({
    queryKey: ['allIncidents'],
    queryFn: () => base44.entities.Incident.list('-incident_date'),
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ['allTasks'],
    queryFn: () => base44.entities.Task.list(),
  });

  const { data: allActivity = [] } = useQuery({
    queryKey: ['allUserActivity'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 100),
  });

  const { data: allAlerts = [] } = useQuery({
    queryKey: ['allAlerts'],
    queryFn: () => base44.entities.PatientAlert.list('-created_date'),
  });

  const { data: allSubscriptions = [] } = useQuery({
    queryKey: ['allSubscriptions'],
    queryFn: () => base44.asServiceRole.entities.Subscription.list('-created_date'),
    enabled: currentUser?.role === 'admin'
  });

  const { data: allPayments = [] } = useQuery({
    queryKey: ['allPayments'],
    queryFn: () => base44.entities.Payment.list('-payment_date'),
    enabled: currentUser?.role === 'admin'
  });

  const autoFetchGuidelinesMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('autoFetchCMSGuidelines', {});
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicareGuidelines'] });
    },
  });

  // Calculate comprehensive statistics
  const stats = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - dateRange);

    const inRangeVisits = allVisits.filter(v => new Date(v.created_date) >= cutoffDate);
    const inRangeConversions = allNoteConversions.filter(n => new Date(n.created_date) >= cutoffDate);
    const inRangeAudits = allComplianceAudits.filter(a => new Date(a.audit_date) >= cutoffDate);
    const inRangeTraining = allTrainingCompletions.filter(t => t.completion_date && new Date(t.completion_date) >= cutoffDate);
    const inRangeIncidents = allIncidents.filter(i => new Date(i.incident_date) >= cutoffDate);

    return {
      // User metrics
      totalUsers: allUsers.length,
      activeUsers: allUsers.length,
      pendingUsers: 0,
      
      // Patient metrics
      totalPatients: allPatients.length,
      activePatients: allPatients.filter(p => p.status === 'active').length,
      
      // Visit metrics
      totalVisits: inRangeVisits.length,
      completedVisits: inRangeVisits.filter(v => v.status === 'completed').length,
      avgVisitsPerDay: (inRangeVisits.length / dateRange).toFixed(1),
      
      // Documentation metrics
      totalEnhancements: inRangeConversions.length,
      avgQualityScore: inRangeConversions.length > 0
        ? (inRangeConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / inRangeConversions.length).toFixed(1)
        : 0,
      avgComplianceScore: inRangeConversions.length > 0
        ? (inRangeConversions.reduce((sum, n) => sum + (n.enhanced_note_compliance || 0), 0) / inRangeConversions.length).toFixed(1)
        : 0,
      avgComplianceImprovement: inRangeConversions.length > 0
        ? (inRangeConversions.filter(n => n.compliance_improvement).reduce((sum, n) => sum + n.compliance_improvement, 0) / inRangeConversions.filter(n => n.compliance_improvement).length).toFixed(1)
        : 0,
      totalTimeSaved: Math.round(inRangeConversions.length * 8.5),
      
      // Compliance metrics
      totalAudits: inRangeAudits.length,
      passedAudits: inRangeAudits.filter(a => a.status === 'passed').length,
      flaggedAudits: inRangeAudits.filter(a => a.status === 'flagged' || a.status === 'critical').length,
      avgAuditScore: inRangeAudits.length > 0
        ? (inRangeAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / inRangeAudits.length).toFixed(1)
        : 0,
      
      // Training metrics
      totalTrainingCompleted: inRangeTraining.filter(t => t.status === 'completed').length,
      avgTrainingScore: inRangeTraining.filter(t => t.score).length > 0
        ? (inRangeTraining.filter(t => t.score).reduce((sum, t) => sum + t.score, 0) / inRangeTraining.filter(t => t.score).length).toFixed(1)
        : 0,
      
      // Incident metrics
      totalIncidents: inRangeIncidents.length,
      criticalIncidents: inRangeIncidents.filter(i => i.severity === 'high').length,
      
      // Task metrics
      pendingTasks: allTasks.filter(t => t.status === 'pending').length,
      overdueTasks: allTasks.filter(t => t.status === 'pending' && t.due_date && new Date(t.due_date) < new Date()).length,
      
      // Alert metrics
      activeAlerts: allAlerts.filter(a => a.status === 'active').length,
      criticalAlerts: allAlerts.filter(a => a.status === 'active' && a.severity === 'critical').length,
      
      // AI adoption
      aiAdoptionRate: allUsers.length > 0
        ? ((inRangeConversions.map(c => c.nurse_email).filter((v, i, a) => a.indexOf(v) === i).length / allUsers.filter(u => u.is_approved).length) * 100).toFixed(0)
        : 0
    };
  }, [allUsers, allPatients, allVisits, allNoteConversions, allComplianceAudits, allTrainingCompletions, allIncidents, allTasks, allAlerts, dateRange]);

  // Subscription & Revenue Metrics
  const subscriptionStats = useMemo(() => {
    const activeSubscriptions = allSubscriptions.filter(s => s.status === 'active');
    const trialingSubscriptions = allSubscriptions.filter(s => s.status === 'trialing');
    const canceledSubscriptions = allSubscriptions.filter(s => s.status === 'canceled');
    const totalMRR = activeSubscriptions.reduce((sum, s) => sum + (s.monthly_amount || 0), 0);
    const totalRevenue = allPayments.filter(p => p.status === 'succeeded').reduce((sum, p) => sum + (p.amount || 0), 0);
    const avgRevenuePerUser = activeSubscriptions.length > 0 ? totalMRR / activeSubscriptions.length : 0;
    
    return {
      activeSubscriptions: activeSubscriptions.length,
      trialingSubscriptions: trialingSubscriptions.length,
      canceledSubscriptions: canceledSubscriptions.length,
      totalMRR,
      totalRevenue,
      avgRevenuePerUser,
      churnRate: allSubscriptions.length > 0 
        ? ((canceledSubscriptions.length / allSubscriptions.length) * 100).toFixed(1) 
        : 0
    };
  }, [allSubscriptions, allPayments]);

  // MRR Trend Data (30 days)
  const mrrTrendData = useMemo(() => {
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return date.toISOString().split('T')[0];
    });

    return last30Days.map(date => {
      const dayPayments = allPayments.filter(p => 
        p.payment_date && p.payment_date.startsWith(date) && p.status === 'succeeded'
      );
      const dayRevenue = dayPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
      
      return {
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenue: dayRevenue,
        count: dayPayments.length
      };
    });
  }, [allPayments]);

  // Subscription Status Distribution
  const subscriptionDistribution = useMemo(() => {
    const statusCounts = allSubscriptions.reduce((acc, sub) => {
      acc[sub.status] = (acc[sub.status] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(statusCounts).map(([status, count]) => ({
      name: status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: count,
      color: status === 'active' ? '#10B981' : status === 'trialing' ? '#3B82F6' : status === 'canceled' ? '#EF4444' : '#F59E0B'
    }));
  }, [allSubscriptions]);

  // Export data functionality
  const exportData = () => {
    const data = {
      exportDate: new Date().toISOString(),
      dateRange: `${dateRange} days`,
      userMetrics: {
        totalUsers: stats.totalUsers,
        activeUsers: stats.activeUsers,
        pendingUsers: stats.pendingUsers
      },
      subscriptionMetrics: subscriptionStats,
      patientMetrics: {
        totalPatients: stats.totalPatients,
        activePatients: stats.activePatients
      },
      visitMetrics: {
        totalVisits: stats.totalVisits,
        completedVisits: stats.completedVisits,
        avgVisitsPerDay: stats.avgVisitsPerDay
      },
      documentationMetrics: {
        totalEnhancements: stats.totalEnhancements,
        avgQualityScore: stats.avgQualityScore,
        avgComplianceScore: stats.avgComplianceScore,
        totalTimeSaved: stats.totalTimeSaved
      },
      complianceMetrics: {
        totalAudits: stats.totalAudits,
        passedAudits: stats.passedAudits,
        flaggedAudits: stats.flaggedAudits,
        avgAuditScore: stats.avgAuditScore
      },
      topPerformers,
      recentPayments: allPayments.slice(0, 50),
      subscriptions: allSubscriptions
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `admin-dashboard-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Top performers
  const topPerformers = useMemo(() => {
    const nurseStats = {};
    
    allNoteConversions.forEach(conv => {
      if (!nurseStats[conv.nurse_email]) {
        nurseStats[conv.nurse_email] = {
          email: conv.nurse_email,
          enhancements: 0,
          totalQuality: 0,
          totalCompliance: 0
        };
      }
      nurseStats[conv.nurse_email].enhancements++;
      nurseStats[conv.nurse_email].totalQuality += conv.quality_score || 0;
      nurseStats[conv.nurse_email].totalCompliance += conv.enhanced_note_compliance || 0;
    });

    return Object.values(nurseStats)
      .map(n => ({
        ...n,
        avgQuality: (n.totalQuality / n.enhancements).toFixed(0),
        avgCompliance: (n.totalCompliance / n.enhancements).toFixed(0)
      }))
      .sort((a, b) => b.avgCompliance - a.avgCompliance)
      .slice(0, 5);
  }, [allNoteConversions]);

  // Recent activity with search and pagination
  const filteredActivity = useMemo(() => {
    return allActivity.filter(a => 
      a.user_name?.toLowerCase().includes(activitySearch.toLowerCase()) ||
      a.action?.toLowerCase().includes(activitySearch.toLowerCase()) ||
      a.user_email?.toLowerCase().includes(activitySearch.toLowerCase())
    );
  }, [allActivity, activitySearch]);

  const paginatedActivity = useMemo(() => {
    const startIdx = (activityPage - 1) * activityPerPage;
    return filteredActivity.slice(startIdx, startIdx + activityPerPage);
  }, [filteredActivity, activityPage, activityPerPage]);

  const totalActivityPages = Math.ceil(filteredActivity.length / activityPerPage);

  // Compliance trends - 30 day trend for line chart
  const complianceTrendData = useMemo(() => {
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return date.toISOString().split('T')[0];
    });

    return last30Days.map(date => {
      const dayAudits = allComplianceAudits.filter(a => 
        a.audit_date && a.audit_date.startsWith(date)
      );
      return {
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        score: dayAudits.length > 0
          ? Math.round(dayAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / dayAudits.length)
          : null,
        count: dayAudits.length
      };
    });
  }, [allComplianceAudits]);

  // AI Feature Usage breakdown
  const aiFeatureUsage = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - dateRange);
    
    const recentActivity = allActivity.filter(a => new Date(a.created_date) >= cutoffDate);
    
    return [
      { name: "Note Enhancements", value: allNoteConversions.filter(n => new Date(n.created_date) >= cutoffDate).length, color: "#3B82F6" },
      { name: "Voice Dictation", value: recentActivity.filter(a => a.action === 'voice_dictation_used').length, color: "#8B5CF6" },
      { name: "AI Care Plans", value: recentActivity.filter(a => a.action === 'ai_care_plan_generated').length, color: "#10B981" },
      { name: "Compliance Checks", value: allComplianceAudits.filter(a => new Date(a.audit_date) >= cutoffDate).length, color: "#F59E0B" },
      { name: "Patient Analysis", value: recentActivity.filter(a => a.action === 'ai_patient_analysis').length, color: "#EF4444" }
    ];
  }, [allNoteConversions, allActivity, allComplianceAudits, dateRange]);

  // Visit types breakdown
  const visitTypeData = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - dateRange);
    
    const recentVisits = allVisits.filter(v => 
      v.status === 'completed' && new Date(v.created_date) >= cutoffDate
    );
    
    const typeCounts = recentVisits.reduce((acc, visit) => {
      const type = visit.visit_type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(typeCounts).map(([type, count]) => ({
      type: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      count
    })).sort((a, b) => b.count - a.count);
  }, [allVisits, dateRange]);

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Admin Access Required</h2>
            <p className="text-gray-600">This page is only accessible to administrators.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600">Comprehensive analytics and system overview</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={exportData}
            variant="outline"
            size="sm"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Data
          </Button>
          {[7, 30, 90].map(days => (
            <Button
              key={days}
              size="sm"
              variant={dateRange === days ? "default" : "outline"}
              onClick={() => setDateRange(days)}
            >
              {days}d
            </Button>
          ))}
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-blue-600" />
              <Badge className="bg-blue-600">{stats.activeUsers}/{stats.totalUsers}</Badge>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.activeUsers}</p>
            <p className="text-xs text-gray-600">Active Nurses</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <UserCheck className="w-8 h-8 text-green-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalPatients}</p>
            <p className="text-xs text-gray-600">Total Patients</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <FileText className="w-8 h-8 text-purple-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.completedVisits}</p>
            <p className="text-xs text-gray-600">Visits ({dateRange}d)</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-indigo-50 to-indigo-100 border-indigo-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Brain className="w-8 h-8 text-indigo-600" />
              <Badge className="bg-indigo-600">{stats.aiAdoptionRate}%</Badge>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalEnhancements}</p>
            <p className="text-xs text-gray-600">AI Enhancements</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-8 h-8 text-orange-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalTimeSaved}</p>
            <p className="text-xs text-gray-600">Minutes Saved</p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-blue-600" />
              <p className="text-sm font-medium text-gray-600">Compliance</p>
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.avgComplianceScore}%</p>
            <p className="text-xs text-green-600">↑ +{stats.avgComplianceImprovement}% avg improvement</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-purple-600" />
              <p className="text-sm font-medium text-gray-600">Quality</p>
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.avgQualityScore}%</p>
            <p className="text-xs text-gray-500">{stats.totalAudits} audits</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <GraduationCap className="w-4 h-4 text-green-600" />
              <p className="text-sm font-medium text-gray-600">Training</p>
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.totalTrainingCompleted}</p>
            <p className="text-xs text-gray-500">{stats.avgTrainingScore}% avg score</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <p className="text-sm font-medium text-gray-600">Incidents</p>
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.totalIncidents}</p>
            <p className="text-xs text-red-600">{stats.criticalIncidents} critical</p>
          </CardContent>
        </Card>
      </div>

      {/* Auto-Fetch Guidelines Success/Error */}
      {autoFetchGuidelinesMutation.isSuccess && (
        <Card className="mb-6 bg-green-50 border-2 border-green-300">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <p className="font-semibold text-green-900 mb-1">Guidelines Updated Successfully</p>
                <p className="text-sm text-green-800">
                  {autoFetchGuidelinesMutation.data?.message || 'CMS guidelines have been fetched and stored.'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {autoFetchGuidelinesMutation.isError && (
        <Card className="mb-6 bg-red-50 border-2 border-red-300">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <p className="font-semibold text-red-900 mb-1">Failed to Fetch Guidelines</p>
                <p className="text-sm text-red-800">
                  {autoFetchGuidelinesMutation.error?.message || 'An error occurred while fetching CMS guidelines.'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Critical Alerts Banner */}
      {(stats.criticalAlerts > 0 || stats.flaggedAudits > 0 || stats.pendingUsers > 0) && (
        <Card className="mb-6 bg-red-50 border-2 border-red-300">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <p className="font-semibold text-red-900 mb-2">Action Required</p>
                <div className="space-y-1 text-sm">
                  {stats.criticalAlerts > 0 && (
                    <p className="text-red-800">• {stats.criticalAlerts} critical patient alert{stats.criticalAlerts > 1 ? 's' : ''}</p>
                  )}
                  {stats.flaggedAudits > 0 && (
                    <p className="text-red-800">• {stats.flaggedAudits} flagged compliance audit{stats.flaggedAudits > 1 ? 's' : ''}</p>
                  )}
                  {stats.pendingUsers > 0 && (
                    <p className="text-red-800">• {stats.pendingUsers} user{stats.pendingUsers > 1 ? 's' : ''} pending approval</p>
                  )}
                </div>
              </div>
              <Link to={createPageUrl("UserManagement")}>
                <Button size="sm" className="bg-red-600 hover:bg-red-700">
                  Review
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
          <TabsTrigger value="ai-feedback">AI Feedback</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Revenue Tab */}
        <TabsContent value="revenue" className="space-y-6">
          {/* Revenue Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <DollarSign className="w-8 h-8 text-green-600" />
                  <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">${subscriptionStats.totalMRR.toFixed(2)}</p>
                <p className="text-xs text-gray-600">Monthly Recurring Revenue</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <CreditCard className="w-8 h-8 text-blue-600" />
                  <Badge className="bg-blue-600">{subscriptionStats.activeSubscriptions}</Badge>
                </div>
                <p className="text-2xl font-bold text-gray-900">{subscriptionStats.activeSubscriptions}</p>
                <p className="text-xs text-gray-600">Active Subscriptions</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <TrendingUp className="w-8 h-8 text-purple-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">${subscriptionStats.totalRevenue.toFixed(2)}</p>
                <p className="text-xs text-gray-600">Total Revenue (All Time)</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Users className="w-8 h-8 text-orange-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">${subscriptionStats.avgRevenuePerUser.toFixed(2)}</p>
                <p className="text-xs text-gray-600">Avg Revenue Per User</p>
              </CardContent>
            </Card>
          </div>

          {/* Subscription Status & Trial Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-blue-600" />
                  Subscription Status Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <span className="font-medium">Active Subscriptions</span>
                    </div>
                    <Badge className="bg-green-600 text-lg">{subscriptionStats.activeSubscriptions}</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Clock className="w-5 h-5 text-blue-600" />
                      <span className="font-medium">Trial Users</span>
                    </div>
                    <Badge className="bg-blue-600 text-lg">{subscriptionStats.trialingSubscriptions}</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-5 h-5 text-red-600" />
                      <span className="font-medium">Canceled</span>
                    </div>
                    <Badge className="bg-red-600 text-lg">{subscriptionStats.canceledSubscriptions}</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <span className="font-medium">Churn Rate</span>
                    <Badge variant="outline" className="text-lg">{subscriptionStats.churnRate}%</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  Subscription Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={subscriptionDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {subscriptionDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Revenue Trend Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                30-Day Revenue Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={mrrTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-white p-3 border border-gray-200 rounded shadow-lg">
                            <p className="text-sm font-semibold">{payload[0].payload.date}</p>
                            <p className="text-sm text-green-600">Revenue: ${payload[0].value.toFixed(2)}</p>
                            <p className="text-xs text-gray-500">{payload[0].payload.count} payments</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#10B981" 
                    strokeWidth={3}
                    dot={{ fill: '#10B981', r: 4 }}
                    name="Daily Revenue"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Recent Payments */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                Recent Payments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">User</th>
                      <th className="text-center p-2">Amount</th>
                      <th className="text-center p-2">Status</th>
                      <th className="text-left p-2">Plan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPayments
                      .slice(0, 10)
                      .map((payment, idx) => (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="p-2">
                            {payment.payment_date ? formatEastern(payment.payment_date, 'MMM d, yyyy') : 'N/A'}
                          </td>
                          <td className="p-2">{payment.user_email}</td>
                          <td className="text-center p-2 font-semibold">${(payment.amount || 0).toFixed(2)}</td>
                          <td className="text-center p-2">
                            <Badge className={payment.status === 'succeeded' ? 'bg-green-600' : 'bg-red-600'}>
                              {payment.status}
                            </Badge>
                          </td>
                          <td className="p-2">{payment.plan_name || 'N/A'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {allPayments.length === 0 && (
                  <p className="text-center text-gray-500 py-8">No payments yet</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Active Subscriptions List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                Active Subscriptions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">User</th>
                      <th className="text-center p-2">Status</th>
                      <th className="text-center p-2">Plan</th>
                      <th className="text-center p-2">Monthly Amount</th>
                      <th className="text-left p-2">Started</th>
                      <th className="text-left p-2">Next Billing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allSubscriptions
                      .filter(s => s.status === 'active' || s.status === 'trialing')
                      .slice(0, 20)
                      .map((sub, idx) => (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="p-2">{sub.user_email}</td>
                          <td className="text-center p-2">
                            <Badge className={sub.status === 'active' ? 'bg-green-600' : 'bg-blue-600'}>
                              {sub.status}
                            </Badge>
                          </td>
                          <td className="text-center p-2">{sub.plan_name || 'N/A'}</td>
                          <td className="text-center p-2 font-semibold">${(sub.monthly_amount || 0).toFixed(2)}</td>
                          <td className="p-2">
                            {sub.subscription_start ? formatEastern(sub.subscription_start, 'MMM d, yyyy') : 'N/A'}
                          </td>
                          <td className="p-2">
                            {sub.current_period_end ? formatEastern(sub.current_period_end, 'MMM d, yyyy') : 'N/A'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {allSubscriptions.filter(s => s.status === 'active' || s.status === 'trialing').length === 0 && (
                  <p className="text-center text-gray-500 py-8">No active subscriptions</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Subscription Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <DollarSign className="w-8 h-8 text-green-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">${subscriptionStats.totalMRR.toFixed(2)}</p>
                <p className="text-xs text-gray-600">Monthly Recurring Revenue</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <CreditCard className="w-8 h-8 text-blue-600" />
                  <Badge className="bg-blue-600">{subscriptionStats.activeSubscriptions}</Badge>
                </div>
                <p className="text-2xl font-bold text-gray-900">{subscriptionStats.activeSubscriptions}</p>
                <p className="text-xs text-gray-600">Active Subscriptions</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <TrendingUp className="w-8 h-8 text-purple-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">${subscriptionStats.totalRevenue.toFixed(2)}</p>
                <p className="text-xs text-gray-600">Total Revenue</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <TrendingDown className="w-8 h-8 text-orange-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">{subscriptionStats.churnRate}%</p>
                <p className="text-xs text-gray-600">Churn Rate</p>
              </CardContent>
            </Card>
          </div>
          {/* Top Performers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="w-5 h-5 text-yellow-600" />
                Top Performing Nurses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topPerformers.map((nurse, idx) => (
                  <div key={nurse.email} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white ${
                      idx === 0 ? 'bg-yellow-500' : idx === 1 ? 'bg-gray-400' : idx === 2 ? 'bg-orange-600' : 'bg-gray-300'
                    }`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{nurse.email}</p>
                      <p className="text-xs text-gray-600">{nurse.enhancements} enhancements</p>
                    </div>
                    <div className="text-right">
                      <Badge className="bg-green-600">{nurse.avgCompliance}%</Badge>
                      <p className="text-xs text-gray-500 mt-1">Quality: {nurse.avgQuality}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Compliance Trend - Line Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                30-Day Compliance Score Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={complianceTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-white p-3 border border-gray-200 rounded shadow-lg">
                            <p className="text-sm font-semibold">{payload[0].payload.date}</p>
                            <p className="text-sm text-blue-600">Score: {payload[0].value}%</p>
                            <p className="text-xs text-gray-500">{payload[0].payload.count} audits</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="score" 
                    stroke="#3B82F6" 
                    strokeWidth={3}
                    dot={{ fill: '#3B82F6', r: 4 }}
                    name="Compliance Score"
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* AI Feature Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-indigo-600" />
                AI Feature Usage Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={aiFeatureUsage}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {aiFeatureUsage.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-3">
                  {aiFeatureUsage.map((feature, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: feature.color }}
                        />
                        <span className="text-sm font-medium">{feature.name}</span>
                      </div>
                      <Badge variant="outline">{feature.value}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Visit Types Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-purple-600" />
                Visit Types Completed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={visitTypeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="type" 
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={100}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar 
                    dataKey="count" 
                    fill="#8B5CF6" 
                    name="Visits Completed"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link to={createPageUrl("UserManagement")}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer border-2 border-blue-200">
                <CardContent className="p-4 text-center">
                  <Users className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                  <p className="font-medium">Manage Users</p>
                </CardContent>
              </Card>
            </Link>
            <Link to={createPageUrl("TrainingManagement")}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer border-2 border-green-200">
                <CardContent className="p-4 text-center">
                  <GraduationCap className="w-8 h-8 text-green-600 mx-auto mb-2" />
                  <p className="font-medium">Training Mgmt</p>
                </CardContent>
              </Card>
            </Link>

            <Link to={createPageUrl("AuditTrail")}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer border-2 border-orange-200">
                <CardContent className="p-4 text-center">
                  <Activity className="w-8 h-8 text-orange-600 mx-auto mb-2" />
                  <p className="font-medium">Audit Trail</p>
                </CardContent>
              </Card>
            </Link>
            <Link to={createPageUrl("Test2FA")}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer border-2 border-red-200">
                <CardContent className="p-4 text-center">
                  <Shield className="w-8 h-8 text-red-600 mx-auto mb-2" />
                  <p className="font-medium">Test 2FA</p>
                </CardContent>
              </Card>
            </Link>
            <Card 
              className="hover:shadow-lg transition-shadow cursor-pointer border-2 border-green-200"
              onClick={() => autoFetchGuidelinesMutation.mutate()}
            >
              <CardContent className="p-4 text-center">
                {autoFetchGuidelinesMutation.isPending ? (
                  <RefreshCw className="w-8 h-8 text-green-600 mx-auto mb-2 animate-spin" />
                ) : (
                  <BookOpen className="w-8 h-8 text-green-600 mx-auto mb-2" />
                )}
                <p className="font-medium">
                  {autoFetchGuidelinesMutation.isPending ? 'Fetching...' : 'Update CMS Guidelines'}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Documentation Performance */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Documentation Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <span className="text-sm text-gray-700">Avg Quality Score</span>
                  <Badge className="bg-blue-600 text-lg">{stats.avgQualityScore}%</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <span className="text-sm text-gray-700">Avg Compliance</span>
                  <Badge className="bg-green-600 text-lg">{stats.avgComplianceScore}%</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                  <span className="text-sm text-gray-700">Compliance Gain</span>
                  <Badge className="bg-purple-600 text-lg">+{stats.avgComplianceImprovement}%</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                  <span className="text-sm text-gray-700">Visits/Day</span>
                  <Badge className="bg-orange-600 text-lg">{stats.avgVisitsPerDay}</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Nurse Rankings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Nurse Rankings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {topPerformers.map((nurse, idx) => (
                    <div key={nurse.email} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                        idx === 0 ? 'bg-yellow-500' : idx === 1 ? 'bg-gray-400' : 'bg-orange-600'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{nurse.email}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{nurse.avgCompliance}%</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Visit Statistics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-600" />
                Visit Analytics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-gray-900">{stats.totalVisits}</p>
                  <p className="text-xs text-gray-600">Total Visits</p>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-900">{stats.completedVisits}</p>
                  <p className="text-xs text-gray-600">Completed</p>
                </div>
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <p className="text-2xl font-bold text-blue-900">{stats.avgVisitsPerDay}</p>
                  <p className="text-xs text-gray-600">Per Day</p>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <p className="text-2xl font-bold text-purple-900">{stats.totalEnhancements}</p>
                  <p className="text-xs text-gray-600">AI Enhanced</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Compliance Tab */}
        <TabsContent value="compliance" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className={stats.flaggedAudits > 0 ? 'border-2 border-red-300' : ''}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-600">Flagged Audits</p>
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{stats.flaggedAudits}</p>
                <p className="text-xs text-gray-500">Needs review</p>
              </CardContent>
            </Card>

            <Card className="border-2 border-green-300">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-600">Passed Audits</p>
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{stats.passedAudits}</p>
                <p className="text-xs text-gray-500">{((stats.passedAudits / Math.max(stats.totalAudits, 1)) * 100).toFixed(0)}% pass rate</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-600">Avg Score</p>
                  <Target className="w-5 h-5 text-blue-600" />
                </div>
                <p className="text-3xl font-bold text-gray-900">{stats.avgAuditScore}%</p>
                <p className="text-xs text-gray-500">Audit compliance</p>
              </CardContent>
            </Card>
          </div>

          {/* Recent Flagged Audits */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Flagged Audits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {allComplianceAudits
                  .filter(a => a.status === 'flagged' || a.status === 'critical')
                  .slice(0, 5)
                  .map((audit, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{audit.nurse_email}</p>
                        <p className="text-xs text-gray-600">
                          {audit.audit_date ? formatEastern(audit.audit_date, 'MMM d, yyyy') : 'Unknown date'}
                        </p>
                      </div>
                      <Badge className={audit.status === 'critical' ? 'bg-red-600' : 'bg-orange-600'}>
                        {audit.compliance_score}%
                      </Badge>
                    </div>
                  ))}
                {allComplianceAudits.filter(a => a.status === 'flagged' || a.status === 'critical').length === 0 && (
                  <p className="text-center text-gray-500 py-8">No flagged audits</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Training Tab */}
        <TabsContent value="training" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Training Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-green-50 rounded">
                  <span className="text-sm">Completed Modules</span>
                  <span className="font-bold text-lg">{stats.totalTrainingCompleted}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-blue-50 rounded">
                  <span className="text-sm">Average Score</span>
                  <span className="font-bold text-lg">{stats.avgTrainingScore}%</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Training Completion Rate</CardTitle>
              </CardHeader>
              <CardContent>
                {allUsers.filter(u => u.is_approved).map((user, idx) => {
                  const userCompletions = allTrainingCompletions.filter(t => 
                    t.nurse_email === user.email && t.status === 'completed'
                  ).length;
                  return (
                    <div key={idx} className="mb-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="truncate">{user.email}</span>
                        <span>{userCompletions} modules</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-green-600 h-2 rounded-full"
                          style={{ width: `${Math.min((userCompletions / 10) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                }).slice(0, 5)}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* AI Feedback Tab */}
        <TabsContent value="ai-feedback" className="space-y-6">
          <AIFeedbackAnalytics />
        </TabsContent>

        {/* Performance Tab - Individual Nurse Performance */}
        <TabsContent value="performance" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Individual Nurse Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Nurse</th>
                      <th className="text-center p-2">Enhancements</th>
                      <th className="text-center p-2">Avg Quality</th>
                      <th className="text-center p-2">Avg Compliance</th>
                      <th className="text-center p-2">Time Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPerformers.map((nurse, idx) => (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="p-2">{nurse.email}</td>
                        <td className="text-center p-2">{nurse.enhancements}</td>
                        <td className="text-center p-2">
                          <Badge variant="outline">{nurse.avgQuality}%</Badge>
                        </td>
                        <td className="text-center p-2">
                          <Badge className="bg-green-600">{nurse.avgCompliance}%</Badge>
                        </td>
                        <td className="text-center p-2">{Math.round(nurse.enhancements * 8.5)} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600" />
                  Recent System Activity
                </CardTitle>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search activity..."
                    value={activitySearch}
                    onChange={(e) => {
                      setActivitySearch(e.target.value);
                      setActivityPage(1);
                    }}
                    className="pl-9 h-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 min-h-[400px]">
                {paginatedActivity.length > 0 ? (
                  paginatedActivity.map((activity, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded">
                      <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{activity.user_name}</p>
                        <p className="text-xs text-gray-600">{activity.action}</p>
                        {activity.user_email && (
                          <p className="text-xs text-gray-500">{activity.user_email}</p>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 flex-shrink-0">
                        {activity.created_date ? formatEastern(activity.created_date, 'MMM d, h:mm a') : ''}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p>No activity found</p>
                  </div>
                )}
              </div>
              
              {/* Pagination */}
              {totalActivityPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <p className="text-sm text-gray-600">
                    Showing {((activityPage - 1) * activityPerPage) + 1} to {Math.min(activityPage * activityPerPage, filteredActivity.length)} of {filteredActivity.length} activities
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActivityPage(p => Math.max(1, p - 1))}
                      disabled={activityPage === 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalActivityPages) }, (_, i) => {
                        let pageNum;
                        if (totalActivityPages <= 5) {
                          pageNum = i + 1;
                        } else if (activityPage <= 3) {
                          pageNum = i + 1;
                        } else if (activityPage >= totalActivityPages - 2) {
                          pageNum = totalActivityPages - 4 + i;
                        } else {
                          pageNum = activityPage - 2 + i;
                        }
                        
                        return (
                          <Button
                            key={pageNum}
                            size="sm"
                            variant={activityPage === pageNum ? "default" : "outline"}
                            onClick={() => setActivityPage(pageNum)}
                            className="w-8"
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActivityPage(p => Math.min(totalActivityPages, p + 1))}
                      disabled={activityPage === totalActivityPages}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Critical Events */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                Critical Events
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {allIncidents
                  .filter(i => i.severity === 'high')
                  .slice(0, 5)
                  .map((incident, idx) => (
                    <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex justify-between items-start mb-1">
                        <p className="text-sm font-medium">{incident.incident_name || incident.incident_type}</p>
                        <Badge className="bg-red-600">High</Badge>
                      </div>
                      <p className="text-xs text-gray-600">
                        {incident.incident_date ? new Date(incident.incident_date).toLocaleDateString() : 'Unknown date'}
                      </p>
                    </div>
                  ))}
                {allIncidents.filter(i => i.severity === 'high').length === 0 && (
                  <p className="text-center text-gray-500 py-8">No critical incidents</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}