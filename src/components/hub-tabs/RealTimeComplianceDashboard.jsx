import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Shield,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Users,
  BarChart3,
  Target,
  GraduationCap,
  ExternalLink,
  Brain,
  ClipboardList,
  Activity,
  Zap,
  Download,
} from "lucide-react";
import GranularComplianceGapAnalyzer from "@/components/compliance/GranularComplianceGapAnalyzer";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { format, subDays, startOfWeek, endOfWeek } from "date-fns";

export default function RealTimeComplianceDashboard() {
  const [dateRange, setDateRange] = useState("30");
  const [selectedFeature, setSelectedFeature] = useState("all");
  const [selectedNurse, setSelectedNurse] = useState("all");

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Fetch all compliance-related data
  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['complianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 1000),
  });

  const { data: userActivities = [] } = useQuery({
    queryKey: ['userActivities'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 1000),
  });

  const { data: oasisUploads = [] } = useQuery({
    queryKey: ['oasisUploads'],
    queryFn: () => base44.entities.OASISUpload.list('-created_date', 500),
  });

  const { data: trainingRecommendations = [] } = useQuery({
    queryKey: ['trainingRecommendations'],
    queryFn: () => base44.entities.TrainingRecommendation.list('-created_date', 500),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
  });

  const { data: allVisits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 500),
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
  });

  const { data: allCarePlans = [] } = useQuery({
    queryKey: ['allCarePlans'],
    queryFn: () => base44.entities.CarePlan.list(),
  });

  // Calculate date filter
  const filterDate = useMemo(() => {
    if (dateRange === "all") return null;
    const days = parseInt(dateRange);
    return subDays(new Date(), days);
  }, [dateRange]);

  // Filter data by date range
  const filteredAudits = useMemo(() => {
    if (!filterDate) return complianceAudits;
    return complianceAudits.filter(a => new Date(a.audit_date || a.created_date) >= filterDate);
  }, [complianceAudits, filterDate]);

  const filteredOASIS = useMemo(() => {
    if (!filterDate) return oasisUploads;
    return oasisUploads.filter(o => new Date(o.created_date) >= filterDate);
  }, [oasisUploads, filterDate]);

  const filteredActivities = useMemo(() => {
    if (!filterDate) return userActivities;
    return userActivities.filter(a => new Date(a.created_date) >= filterDate);
  }, [userActivities, filterDate]);

  // Overall Agency Compliance Score
  const overallComplianceScore = useMemo(() => {
    const scores = [];
    
    // Smart Note compliance scores
    const noteComplianceActivities = filteredActivities.filter(a => a.action === 'note_compliance_check');
    noteComplianceActivities.forEach(activity => {
      if (Number.isFinite(activity.details?.overall_score)) {
        scores.push(activity.details.overall_score);
      }
    });

    // Compliance audit scores
    filteredAudits.forEach(audit => {
      if (Number.isFinite(audit.compliance_score)) {
        scores.push(audit.compliance_score);
      }
    });

    // OASIS compliance scores
    filteredOASIS.forEach(oasis => {
      if (oasis.scores?.compliance) {
        scores.push(oasis.scores.compliance);
      }
    });

    return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  }, [filteredActivities, filteredAudits, filteredOASIS]);

  // Compliance Trend Data (last 30 days by week)
  const complianceTrendData = useMemo(() => {
    const weeks = [];
    const today = new Date();
    
    for (let i = 4; i >= 0; i--) {
      const weekStart = startOfWeek(subDays(today, i * 7));
      const weekEnd = endOfWeek(subDays(today, i * 7));
      
      const weekAudits = complianceAudits.filter(a => {
        const date = new Date(a.audit_date || a.created_date);
        return date >= weekStart && date <= weekEnd;
      });

      const weekOASIS = oasisUploads.filter(o => {
        const date = new Date(o.created_date);
        return date >= weekStart && date <= weekEnd;
      });

      const weekNoteChecks = userActivities.filter(a => {
        const date = new Date(a.created_date);
        return a.action === 'note_compliance_check' && date >= weekStart && date <= weekEnd;
      });

      const avgScore = [...weekAudits.map(a => a.compliance_score), 
                        ...weekOASIS.map(o => o.scores?.compliance),
                        ...weekNoteChecks.map(n => n.details?.overall_score)]
        .filter(s => Number.isFinite(s))
        .reduce((sum, s, idx, arr) => sum + s / arr.length, 0);

      weeks.push({
        week: format(weekStart, 'MMM d'),
        score: Math.round(avgScore) || 0,
        audits: weekAudits.length,
        oasis: weekOASIS.length,
        notes: weekNoteChecks.length
      });
    }
    
    return weeks;
  }, [complianceAudits, oasisUploads, userActivities]);

  // Common Compliance Issues
  const commonIssues = useMemo(() => {
    const issueMap = {};

    // From compliance audits
    filteredAudits.forEach(audit => {
      audit.issues?.forEach(issue => {
        const key = issue.element || issue.area || 'Unknown';
        if (!issueMap[key]) {
          issueMap[key] = {
            name: key,
            count: 0,
            severity: issue.severity,
            source: 'Compliance Audit',
            examples: [],
            affectedNurses: new Set()
          };
        }
        issueMap[key].count++;
        issueMap[key].affectedNurses.add(audit.nurse_email);
        if (issue.problem && issueMap[key].examples.length < 3) {
          issueMap[key].examples.push(issue.problem);
        }
      });
    });

    // From OASIS uploads
    filteredOASIS.forEach(oasis => {
      const issues = oasis.analysis_results?.compliance_concerns || [];
      issues.forEach(issue => {
        const key = issue.area || 'Unknown';
        if (!issueMap[key]) {
          issueMap[key] = {
            name: key,
            count: 0,
            severity: issue.severity,
            source: 'OASIS Analysis',
            examples: [],
            affectedNurses: new Set()
          };
        }
        issueMap[key].count++;
        if (oasis.created_by) {
          issueMap[key].affectedNurses.add(oasis.created_by);
        }
        if (issue.issue && issueMap[key].examples.length < 3) {
          issueMap[key].examples.push(issue.issue);
        }
      });
    });

    // From note compliance checks
    const noteComplianceChecks = filteredActivities.filter(a => a.action === 'note_compliance_check');
    noteComplianceChecks.forEach(activity => {
      const flaggedIssues = activity.details?.flagged_issues || 0;
      if (flaggedIssues > 0) {
        const key = 'Smart Note Compliance';
        if (!issueMap[key]) {
          issueMap[key] = {
            name: key,
            count: 0,
            severity: 'medium',
            source: 'Smart Notes',
            examples: [],
            affectedNurses: new Set()
          };
        }
        issueMap[key].count += flaggedIssues;
        issueMap[key].affectedNurses.add(activity.user_email);
      }
    });

    return Object.values(issueMap)
      .map(issue => ({
        ...issue,
        affectedNurses: issue.affectedNurses.size
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredAudits, filteredOASIS, filteredActivities]);

  // Feature-specific compliance data
  const featureCompliance = useMemo(() => {
    const features = {
      smartNotes: {
        name: 'Smart Notes',
        total: 0,
        avgScore: 0,
        enhancements: 0,
        complianceChecks: 0
      },
      oasisAnalyzer: {
        name: 'OASIS Analyzer',
        total: 0,
        avgScore: 0,
        uploads: 0,
        avgAccuracy: 0
      },
      complianceAudits: {
        name: 'Documentation Audits',
        total: 0,
        avgScore: 0,
        passed: 0,
        flagged: 0
      }
    };

    // Smart Notes
    const noteEnhancements = filteredActivities.filter(a => a.action === 'note_enhanced' || a.action === 'note_ai_generated');
    const noteChecks = filteredActivities.filter(a => a.action === 'note_compliance_check');
    features.smartNotes.total = noteEnhancements.length;
    features.smartNotes.enhancements = noteEnhancements.length;
    features.smartNotes.complianceChecks = noteChecks.length;
    const noteScores = noteChecks.map(n => n.details?.overall_score).filter(s => Number.isFinite(s));
    features.smartNotes.avgScore = noteScores.length > 0 
      ? Math.round(noteScores.reduce((a, b) => a + b, 0) / noteScores.length) 
      : 0;

    // OASIS
    features.oasisAnalyzer.total = filteredOASIS.length;
    features.oasisAnalyzer.uploads = filteredOASIS.length;
    const oasisComplianceScores = filteredOASIS.map(o => o.scores?.compliance).filter(s => Number.isFinite(s));
    const oasisAccuracyScores = filteredOASIS.map(o => o.scores?.accuracy).filter(s => Number.isFinite(s));
    features.oasisAnalyzer.avgScore = oasisComplianceScores.length > 0
      ? Math.round(oasisComplianceScores.reduce((a, b) => a + b, 0) / oasisComplianceScores.length)
      : 0;
    features.oasisAnalyzer.avgAccuracy = oasisAccuracyScores.length > 0
      ? Math.round(oasisAccuracyScores.reduce((a, b) => a + b, 0) / oasisAccuracyScores.length)
      : 0;

    // Audits
    features.complianceAudits.total = filteredAudits.length;
    features.complianceAudits.passed = filteredAudits.filter(a => a.status === 'passed').length;
    features.complianceAudits.flagged = filteredAudits.filter(a => a.status === 'flagged' || a.status === 'critical').length;
    const auditScores = filteredAudits.map(a => a.compliance_score).filter(s => Number.isFinite(s));
    features.complianceAudits.avgScore = auditScores.length > 0
      ? Math.round(auditScores.reduce((a, b) => a + b, 0) / auditScores.length)
      : 0;

    return Object.values(features);
  }, [filteredActivities, filteredOASIS, filteredAudits]);

  // Nurse Performance Data
  const nursePerformance = useMemo(() => {
    const nurseMap = {};

    allUsers.forEach(user => {
      nurseMap[user.email] = {
        name: user.full_name,
        email: user.email,
        role: user.role,
        noteCount: 0,
        noteAvgScore: 0,
        oasisCount: 0,
        oasisAvgScore: 0,
        auditCount: 0,
        auditAvgScore: 0,
        totalScore: 0,
        trainingNeeds: []
      };
    });

    // Smart Note scores
    filteredActivities.filter(a => a.action === 'note_compliance_check').forEach(activity => {
      if (nurseMap[activity.user_email] && Number.isFinite(activity.details?.overall_score)) {
        nurseMap[activity.user_email].noteCount++;
        nurseMap[activity.user_email].noteAvgScore += activity.details.overall_score;
      }
    });

    // OASIS scores
    filteredOASIS.forEach(oasis => {
      if (nurseMap[oasis.created_by] && oasis.scores?.compliance) {
        nurseMap[oasis.created_by].oasisCount++;
        nurseMap[oasis.created_by].oasisAvgScore += oasis.scores.compliance;
      }
    });

    // Audit scores
    filteredAudits.forEach(audit => {
      if (nurseMap[audit.nurse_email] && audit.compliance_score) {
        nurseMap[audit.nurse_email].auditCount++;
        nurseMap[audit.nurse_email].auditAvgScore += audit.compliance_score;
      }
    });

    // Training recommendations
    trainingRecommendations.forEach(rec => {
      if (nurseMap[rec.nurse_email] && !rec.addressed) {
        nurseMap[rec.nurse_email].trainingNeeds.push({
          type: rec.recommendation_type,
          severity: rec.severity,
          source: rec.source
        });
      }
    });

    // Calculate averages and total scores
    Object.values(nurseMap).forEach(nurse => {
      if (nurse.noteCount > 0) {
        nurse.noteAvgScore = Math.round(nurse.noteAvgScore / nurse.noteCount);
      }
      if (nurse.oasisCount > 0) {
        nurse.oasisAvgScore = Math.round(nurse.oasisAvgScore / nurse.oasisCount);
      }
      if (nurse.auditCount > 0) {
        nurse.auditAvgScore = Math.round(nurse.auditAvgScore / nurse.auditCount);
      }

      // Weighted total score
      const scores = [];
      if (nurse.noteAvgScore > 0) scores.push(nurse.noteAvgScore);
      if (nurse.oasisAvgScore > 0) scores.push(nurse.oasisAvgScore);
      if (nurse.auditAvgScore > 0) scores.push(nurse.auditAvgScore);
      
      nurse.totalScore = scores.length > 0 
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;
    });

    return Object.values(nurseMap)
      .filter(n => n.noteCount + n.oasisCount + n.auditCount > 0)
      .sort((a, b) => b.totalScore - a.totalScore);
  }, [allUsers, filteredActivities, filteredOASIS, filteredAudits, trainingRecommendations]);

  // Apply nurse filter
  const displayedNurses = useMemo(() => {
    if (selectedNurse === "all") return nursePerformance;
    return nursePerformance.filter(n => n.email === selectedNurse);
  }, [nursePerformance, selectedNurse]);

  // Feature filter for issues
  const displayedIssues = useMemo(() => {
    if (selectedFeature === "all") return commonIssues;
    return commonIssues.filter(issue => {
      if (selectedFeature === "smart_notes") return issue.source === 'Smart Notes';
      if (selectedFeature === "oasis") return issue.source === 'OASIS Analysis';
      if (selectedFeature === "audits") return issue.source === 'Compliance Audit';
      return true;
    });
  }, [commonIssues, selectedFeature]);

  // Actionable Insights
  const actionableInsights = useMemo(() => {
    const insights = [];

    // Low compliance score
    if (overallComplianceScore < 80) {
      insights.push({
        type: 'critical',
        title: 'Agency Compliance Score Below Target',
        message: `Current score is ${overallComplianceScore}%, target is 85%+`,
        action: 'Review top issues and assign training',
        link: null
      });
    }

    // Top issue affecting many nurses
    if (commonIssues.length > 0 && commonIssues[0].affectedNurses > 2) {
      insights.push({
        type: 'high',
        title: 'Widespread Compliance Gap Detected',
        message: `"${commonIssues[0].name}" affecting ${commonIssues[0].affectedNurses} nurses`,
        action: 'Create agency-wide training module',
        link: createPageUrl('AdminTraining'),
        linkText: 'Assign Training'
      });
    }

    // Low OASIS accuracy
    const lowAccuracyOASIS = filteredOASIS.filter(o => o.scores?.accuracy < 70);
    if (lowAccuracyOASIS.length > 3) {
      insights.push({
        type: 'medium',
        title: 'OASIS Accuracy Concerns',
        message: `${lowAccuracyOASIS.length} OASIS submissions with accuracy < 70%`,
        action: 'Review OASIS training materials',
        link: createPageUrl('AdminTraining'),
        linkText: 'OASIS Training'
      });
    }

    // Nurses needing training
    const nursesNeedingTraining = nursePerformance.filter(n => n.totalScore < 75 && n.totalScore > 0);
    if (nursesNeedingTraining.length > 0) {
      insights.push({
        type: 'medium',
        title: 'Staff Training Needed',
        message: `${nursesNeedingTraining.length} nurse(s) with compliance scores below 75%`,
        action: 'Assign personalized training plans',
        link: createPageUrl('AdminTraining'),
        linkText: 'Manage Training'
      });
    }

    // Unaddressed training recommendations
    const criticalTraining = trainingRecommendations.filter(t => !t.addressed && t.severity === 'critical');
    if (criticalTraining.length > 5) {
      insights.push({
        type: 'high',
        title: 'Critical Training Recommendations Pending',
        message: `${criticalTraining.length} critical training items not yet addressed`,
        action: 'Review and assign training immediately',
        link: createPageUrl('AdminTraining'),
        linkText: 'View Recommendations'
      });
    }

    return insights;
  }, [overallComplianceScore, commonIssues, filteredOASIS, nursePerformance, trainingRecommendations]);

  const getScoreColor = (score) => {
    if (score >= 85) return 'text-green-600';
    if (score >= 75) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBg = (score) => {
    if (score >= 85) return 'from-green-500 to-emerald-500';
    if (score >= 75) return 'from-yellow-500 to-orange-500';
    return 'from-red-500 to-gold-500';
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[severity] || 'bg-slate-100 text-slate-800';
  };

  const COLORS_PIE = ['#EF4444', '#F97316', '#EAB308', '#3557b0', '#10B981'];

  const featureDistribution = featureCompliance.map((f, _idx) => ({
    name: f.name,
    value: f.total,
    score: f.avgScore
  }));

  const exportComplianceData = () => {
    const reportData = {
      generated: new Date().toISOString(),
      dateRange: dateRange === "all" ? "All time" : `Last ${dateRange} days`,
      summary: {
        overallScore: overallComplianceScore,
        totalAudits: filteredAudits.length,
        totalOASIS: filteredOASIS.length,
        totalNoteChecks: filteredActivities.filter(a => a.action === 'note_compliance_check').length
      },
      commonIssues: commonIssues.slice(0, 10),
      nursePerformance: nursePerformance.map(n => ({
        name: n.name,
        email: n.email,
        totalScore: n.totalScore,
        noteScore: n.noteAvgScore,
        oasisScore: n.oasisAvgScore,
        auditScore: n.auditAvgScore,
        trainingNeeds: n.trainingNeeds.length
      })),
      insights: actionableInsights
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-dashboard-${format(new Date(), 'yyyy-MM-dd')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (userLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-slate-500">
            Loading...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-12 text-center">
            <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Restricted</h2>
            <p className="text-slate-600 mb-4">
              Only administrators can access the Real-Time Compliance Dashboard.
            </p>
            <p className="text-sm text-slate-500">
              Please contact your administrator if you need access to this feature.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">Aggregated insights across all features</p>
        <Button onClick={exportComplianceData} variant="outline" className="gap-2 w-full sm:w-auto min-h-[44px]">
          <Download className="w-4 h-4" />
          <span>Export</span>
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-full sm:w-[180px] h-11 touch-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedFeature} onValueChange={setSelectedFeature}>
              <SelectTrigger className="w-full sm:w-[180px] h-11 touch-target">
                <SelectValue placeholder="All Features" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Features</SelectItem>
                <SelectItem value="smart_notes">Smart Notes</SelectItem>
                <SelectItem value="oasis">OASIS Analyzer</SelectItem>
                <SelectItem value="audits">Documentation Audits</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedNurse} onValueChange={setSelectedNurse}>
              <SelectTrigger className="w-full sm:w-[200px] h-11 touch-target">
                <SelectValue placeholder="All Nurses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Nurses</SelectItem>
                {allUsers.map(user => (
                  <SelectItem key={user.id} value={user.email}>
                    {user.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Overall Compliance Score */}
      <Card className={`mb-4 sm:mb-6 bg-gradient-to-r ${getScoreBg(overallComplianceScore)} text-white`}>
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
            <div className="text-center sm:text-left w-full sm:w-auto">
              <p className="text-white/80 mb-1 text-xs sm:text-sm md:text-base truncate">Overall Agency Compliance Score</p>
              <p className="text-3xl sm:text-4xl md:text-5xl font-bold">{overallComplianceScore}%</p>
              <div className="flex items-center justify-center sm:justify-start gap-2 mt-2">
                {overallComplianceScore >= 85 ? (
                  <>
                    <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="text-xs sm:text-sm">Excellent Performance</span>
                  </>
                ) : overallComplianceScore >= 75 ? (
                  <>
                    <Activity className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="text-xs sm:text-sm">Good - Room for Improvement</span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="text-xs sm:text-sm">Needs Attention</span>
                  </>
                )}
              </div>
            </div>
            <Shield className="w-12 h-12 sm:w-16 sm:h-16 md:w-24 md:h-24 opacity-20 flex-shrink-0" />
          </div>
        </CardContent>
      </Card>

      {/* Actionable Insights */}
      {actionableInsights.length > 0 && (
        <div className="mb-4 sm:mb-6 space-y-2 sm:space-y-3">
          <h2 className="text-base sm:text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
            <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500 flex-shrink-0" />
            <span className="truncate">Actionable Insights</span>
          </h2>
          {actionableInsights.map((insight, idx) => (
            <Alert 
              key={idx}
              className={
                insight.type === 'critical' ? 'bg-red-50 border-red-300' :
                insight.type === 'high' ? 'bg-orange-50 border-orange-300' :
                'bg-blue-50 border-blue-300'
              }
            >
              <AlertTriangle className={`w-4 h-4 ${
                insight.type === 'critical' ? 'text-red-600' :
                insight.type === 'high' ? 'text-orange-600' :
                'text-blue-600'
              }`} />
              <AlertDescription>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900 mb-1">{insight.title}</p>
                    <p className="text-sm text-slate-700 mb-2">{insight.message}</p>
                    <p className="text-xs text-slate-600">
                      <strong>Recommended Action:</strong> {insight.action}
                    </p>
                  </div>
                  {insight.link && (
                    <Link to={insight.link}>
                      <Button size="sm" className="gap-1 whitespace-nowrap">
                        {insight.linkText || 'Take Action'}
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </Link>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Compliance Trend Chart */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-3 sm:p-4 md:p-6">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 flex-shrink-0" />
            <span className="truncate">Compliance Score Trends</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 md:p-6">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={complianceTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="score" stroke="#264491" strokeWidth={3} name="Compliance Score" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Feature-Specific Compliance */}
      <div className="mb-6">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" />
          Feature-Specific Compliance
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {featureCompliance.map((feature, idx) => (
            <Card key={idx} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{feature.name}</span>
                  <Badge className={`${getScoreColor(feature.avgScore)} bg-white border`}>
                    {feature.avgScore}%
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Total Items:</span>
                  <span className="font-semibold">{feature.total}</span>
                </div>
                {feature.enhancements > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Enhancements:</span>
                    <span className="font-semibold">{feature.enhancements}</span>
                  </div>
                )}
                {feature.uploads > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Uploads:</span>
                    <span className="font-semibold">{feature.uploads}</span>
                  </div>
                )}
                {feature.avgAccuracy > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Avg Accuracy:</span>
                    <span className="font-semibold">{feature.avgAccuracy}%</span>
                  </div>
                )}
                {feature.passed !== undefined && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Passed:</span>
                    <span className="font-semibold text-green-600">{feature.passed}</span>
                  </div>
                )}
                {feature.flagged !== undefined && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Flagged:</span>
                    <span className="font-semibold text-red-600">{feature.flagged}</span>
                  </div>
                )}
                <Progress value={feature.avgScore} className="h-2 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Granular Gap Analysis */}
      <GranularComplianceGapAnalyzer
        visits={allVisits}
        patients={allPatients}
        carePlans={allCarePlans}
        complianceAudits={filteredAudits}
        dateRange={parseInt(dateRange)}
      />

      {/* Common Compliance Issues */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              Common Compliance Issues
            </div>
            <Badge variant="outline">{displayedIssues.length} total</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {displayedIssues.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <p className="text-slate-600">No compliance issues detected</p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayedIssues.slice(0, 10).map((issue, idx) => (
                <div key={idx} className="p-4 border rounded-lg hover:bg-slate-50">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-semibold text-slate-900">{issue.name}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={getSeverityColor(issue.severity)}>
                          {issue.severity}
                        </Badge>
                        <Badge variant="outline" className="text-xs">{issue.source}</Badge>
                        <span className="text-xs text-slate-500">
                          {issue.affectedNurses} nurse{issue.affectedNurses !== 1 ? 's' : ''} affected
                        </span>
                      </div>
                    </div>
                    <Badge className="bg-red-600 text-white text-lg">
                      {issue.count}
                    </Badge>
                  </div>
                  
                  {issue.examples.length > 0 && (
                    <div className="bg-slate-50 p-2 rounded mt-2">
                      <p className="text-xs font-medium text-slate-700 mb-1">Example Issues:</p>
                      <ul className="text-xs text-slate-600 space-y-0.5">
                        {issue.examples.map((ex, eIdx) => (
                          <li key={eIdx}>• {ex}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-3 flex gap-2">
                    <Link to={createPageUrl('AdminTraining')}>
                      <Button size="sm" variant="outline" className="gap-1">
                        <GraduationCap className="w-3 h-3" />
                        Assign Training
                      </Button>
                    </Link>
                    {issue.source === 'OASIS Analysis' && (
                      <Link to={createPageUrl('OASISAnalyzer')}>
                        <Button size="sm" variant="outline" className="gap-1">
                          <ClipboardList className="w-3 h-3" />
                          Review OASIS
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Nurse Performance Drill-Down */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Users className="w-4 h-4 sm:w-5 sm:h-5 text-navy-600" />
            Nurse Performance - Compliance Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          {displayedNurses.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No performance data available</p>
          ) : (
            <div className="space-y-3">
              {displayedNurses.map((nurse, idx) => (
                <div key={idx} className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold text-slate-900">{nurse.name}</p>
                      <p className="text-sm text-slate-500">{nurse.email}</p>
                    </div>
                    <Badge className={`text-lg ${
                      nurse.totalScore >= 85 ? 'bg-green-600' :
                      nurse.totalScore >= 75 ? 'bg-yellow-600' :
                      'bg-red-600'
                    } text-white`}>
                      {nurse.totalScore}%
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-3">
                    <div className="bg-navy-50 p-2 rounded text-center">
                      <p className="text-[10px] sm:text-xs text-navy-600 mb-1">Smart Notes</p>
                      <p className={`text-lg sm:text-xl font-bold ${getScoreColor(nurse.noteAvgScore)}`}>
                        {nurse.noteAvgScore || '--'}
                      </p>
                      <p className="text-[10px] sm:text-xs text-slate-500">{nurse.noteCount} checks</p>
                    </div>
                    <div className="bg-blue-50 p-2 rounded text-center">
                      <p className="text-[10px] sm:text-xs text-blue-600 mb-1">OASIS</p>
                      <p className={`text-lg sm:text-xl font-bold ${getScoreColor(nurse.oasisAvgScore)}`}>
                        {nurse.oasisAvgScore || '--'}
                      </p>
                      <p className="text-[10px] sm:text-xs text-slate-500">{nurse.oasisCount} uploads</p>
                    </div>
                    <div className="bg-green-50 p-2 rounded text-center">
                      <p className="text-[10px] sm:text-xs text-green-600 mb-1">Audits</p>
                      <p className={`text-lg sm:text-xl font-bold ${getScoreColor(nurse.auditAvgScore)}`}>
                        {nurse.auditAvgScore || '--'}
                      </p>
                      <p className="text-[10px] sm:text-xs text-slate-500">{nurse.auditCount} audits</p>
                    </div>
                  </div>

                  {nurse.trainingNeeds.length > 0 && (
                    <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                      <p className="text-xs font-semibold text-yellow-800 mb-1">
                        {nurse.trainingNeeds.length} Training Recommendation{nurse.trainingNeeds.length !== 1 ? 's' : ''}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {nurse.trainingNeeds.slice(0, 3).map((training, tIdx) => (
                          <Badge key={tIdx} className={getSeverityColor(training.severity)}>
                            {training.type}
                          </Badge>
                        ))}
                        {nurse.trainingNeeds.length > 3 && (
                          <Badge variant="outline">+{nurse.trainingNeeds.length - 3} more</Badge>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <Link to={`${createPageUrl('NursePerformanceDashboard')}?nurse=${nurse.email}`} className="w-full sm:w-auto">
                      <Button size="sm" variant="outline" className="gap-1 w-full">
                        <BarChart3 className="w-3 h-3" />
                        View Details
                      </Button>
                    </Link>
                    {nurse.trainingNeeds.length > 0 && (
                      <Link to={createPageUrl('AdminTraining')} className="w-full sm:w-auto">
                        <Button size="sm" className="gap-1 bg-navy-600 w-full">
                          <GraduationCap className="w-3 h-3" />
                          Assign Training
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Activity Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Activity Distribution by Feature</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={featureDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#264491"
                  dataKey="value"
                >
                  {featureDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS_PIE[index % COLORS_PIE.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Weekly Activity Volume */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Weekly Compliance Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={complianceTrendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="audits" fill="#8B5CF6" name="Audits" />
                <Bar dataKey="oasis" fill="#3557b0" name="OASIS" />
                <Bar dataKey="notes" fill="#10B981" name="Notes" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Training Resources */}
      <Card className="bg-gradient-to-r from-navy-50 to-gold-50 border-navy-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-navy-600" />
            Training Resources for Common Issues
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-3">
            <Link to={createPageUrl('AdminTraining')}>
              <div className="p-3 bg-white rounded-lg border hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="w-4 h-4 text-navy-600" />
                  <span className="font-medium text-sm">Smart Note Documentation Training</span>
                </div>
                <p className="text-xs text-slate-600">
                  Learn Medicare compliance requirements and best practices
                </p>
              </div>
            </Link>

            <Link to={createPageUrl('AdminTraining')}>
              <div className="p-3 bg-white rounded-lg border hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center gap-2 mb-1">
                  <ClipboardList className="w-4 h-4 text-blue-600" />
                  <span className="font-medium text-sm">OASIS Accuracy Training</span>
                </div>
                <p className="text-xs text-slate-600">
                  Master M-item scoring and PDGM optimization
                </p>
              </div>
            </Link>

            <Link to={createPageUrl('AdminTraining')}>
              <div className="p-3 bg-white rounded-lg border hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-green-600" />
                  <span className="font-medium text-sm">Compliance Fundamentals</span>
                </div>
                <p className="text-xs text-slate-600">
                  CMS regulations, CoPs, and documentation standards
                </p>
              </div>
            </Link>

            <Link to={createPageUrl('AdminTraining')}>
              <div className="p-3 bg-white rounded-lg border hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-4 h-4 text-indigo-600" />
                  <span className="font-medium text-sm">Clinical Pathway Training</span>
                </div>
                <p className="text-xs text-slate-600">
                  Optimize care plans and documentation for better outcomes
                </p>
              </div>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}