import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart3,
  TrendingUp,
  Clock,
  Target,
  Sparkles,
  Calendar,
  Award,
  Brain
} from "lucide-react";
import NursePerformanceTrends from "../components/analytics/NursePerformanceTrends";
import DocumentationGapAnalysis from "../components/analytics/DocumentationGapAnalysis";
import AIFeatureUsageStats from "../components/analytics/AIFeatureUsageStats";
import PersonalizedCoachingInsights from "../components/analytics/PersonalizedCoachingInsights";
import { calculateNurseStats } from "@/components/utils/statsCalculator";

export default function NurseAnalyticsDashboard() {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState(30);
  const [activeTab, setActiveTab] = useState("performance");

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

  // Fetch nurse-specific data
  const { data: noteConversions = [] } = useQuery({
    queryKey: ['nurseNoteConversions', currentUser?.email, dateRange],
    queryFn: () => base44.entities.NoteConversion.filter({ 
      nurse_email: currentUser?.email 
    }, '-created_date', 500),
    enabled: !!currentUser?.email,
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['nurseComplianceAudits', currentUser?.email, dateRange],
    queryFn: () => base44.entities.ComplianceAudit.filter({ 
      nurse_email: currentUser?.email 
    }, '-audit_date', 200),
    enabled: !!currentUser?.email,
  });

  const { data: trainingRecommendations = [] } = useQuery({
    queryKey: ['nurseTrainingRecommendations', currentUser?.email],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ 
      nurse_email: currentUser?.email
    }),
    enabled: !!currentUser?.email,
  });

  const { data: userActivity = [] } = useQuery({
    queryKey: ['nurseActivity', currentUser?.email, dateRange],
    queryFn: () => base44.entities.UserActivity.filter({ 
      user_email: currentUser?.email 
    }, '-created_date', 500),
    enabled: !!currentUser?.email,
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['nurseVisits', currentUser?.email],
    queryFn: () => base44.entities.Visit.filter({ 
      created_by: currentUser?.email 
    }, '-visit_date', 200),
    enabled: !!currentUser?.email,
  });

  // Calculate aggregate stats
  const stats = React.useMemo(() => {
    return calculateNurseStats(currentUser?.email, {
      visits,
      noteConversions,
      dateRange
    });
  }, [currentUser?.email, visits, noteConversions, dateRange]);

  // Performance data for coaching
  const performanceData = React.useMemo(() => {
    const recentNotes = noteConversions.slice(0, 20);
    const recentAudits = complianceAudits.slice(0, 20);
    
    return {
      avgQuality: recentNotes.length > 0 ? 
        Math.round(recentNotes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / recentNotes.length) : 0,
      avgCompliance: recentAudits.length > 0 ?
        Math.round(recentAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / recentAudits.length) : 0,
      avgTime: recentNotes.length > 0 ?
        Math.round(recentNotes.reduce((sum, n) => sum + ((n.conversion_time_ms || 0) / 60000), 0) / recentNotes.length) : 0,
      totalNotes: noteConversions.length
    };
  }, [noteConversions, complianceAudits]);

  // Gap analysis
  const gapAnalysis = React.useMemo(() => {
    const elementCounts = {};
    complianceAudits.forEach(audit => {
      audit.issues?.forEach(issue => {
        const element = issue.element || 'Unknown';
        elementCounts[element] = (elementCounts[element] || 0) + 1;
      });
    });

    const sortedGaps = Object.entries(elementCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      sortedGaps,
      totalIssues: Object.values(elementCounts).reduce((sum, count) => sum + count, 0)
    };
  }, [complianceAudits]);

  // Feature usage
  const featureUsage = React.useMemo(() => {
    const usage = {};
    userActivity.forEach(activity => {
      if (activity.details?.feature) {
        const feature = activity.details.feature || activity.action;
        usage[feature] = (usage[feature] || 0) + 1;
      }
    });
    usage['note_enhanced'] = noteConversions.length;

    const chartData = Object.entries(usage)
      .map(([feature, count]) => ({
        feature: feature.replace(/_/g, ' '),
        count
      }))
      .sort((a, b) => b.count - a.count);

    const total = chartData.reduce((sum, item) => sum + item.count, 0);

    return { chartData, total };
  }, [userActivity, noteConversions]);

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">My Performance Analytics</h1>
             <p className="text-slate-600 dark:text-slate-400">AI-powered insights into your clinical documentation</p>
          </div>
          <Select value={dateRange.toString()} onValueChange={(val) => setDateRange(parseInt(val))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Key Stats Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">Notes Enhanced</p>
                  <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{stats.noteConversions}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Last {dateRange} days</p>
                </div>
                <BarChart3 className="w-10 h-10 text-slate-600 dark:text-slate-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">Time Saved</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.timeSavedDisplay}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">With AI assistance</p>
                </div>
                <Clock className="w-10 h-10 text-slate-600 dark:text-slate-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">Avg Compliance</p>
                  <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{performanceData.avgCompliance}%</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Recent average</p>
                </div>
                <Target className="w-10 h-10 text-slate-600 dark:text-slate-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">Total Visits</p>
                  <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{visits.length}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Last {dateRange} days</p>
                </div>
                <Calendar className="w-10 h-10 text-slate-600 dark:text-slate-400" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Analytics Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 mb-6">
          <TabsTrigger value="performance" className="gap-2">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">Performance</span>
          </TabsTrigger>
          <TabsTrigger value="gaps" className="gap-2">
            <Target className="w-4 h-4" />
            <span className="hidden sm:inline">Gaps</span>
          </TabsTrigger>
          <TabsTrigger value="ai-usage" className="gap-2">
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Feature Usage</span>
          </TabsTrigger>
          <TabsTrigger value="coaching" className="gap-2">
            <Brain className="w-4 h-4" />
            <span className="hidden sm:inline">Coaching</span>
          </TabsTrigger>
        </TabsList>

        {/* Performance Trends Tab */}
        <TabsContent value="performance">
          <NursePerformanceTrends
            noteConversions={noteConversions}
            complianceAudits={complianceAudits}
            dateRange={dateRange}
          />
        </TabsContent>

        {/* Documentation Gaps Tab */}
        <TabsContent value="gaps">
          <DocumentationGapAnalysis
            trainingRecommendations={trainingRecommendations}
            complianceAudits={complianceAudits}
            onViewTraining={(category) => {
              navigate(createPageUrl("StaffTrainingHub") + `?filter=${category}`);
            }}
          />
        </TabsContent>

        {/* Feature Usage Tab */}
        <TabsContent value="ai-usage">
          <AIFeatureUsageStats
            userActivity={userActivity}
            noteConversions={noteConversions}
          />
        </TabsContent>

        {/* Coaching Tab */}
        <TabsContent value="coaching">
          <PersonalizedCoachingInsights
            nurseEmail={currentUser?.email}
            performanceData={performanceData}
            gapAnalysis={gapAnalysis}
            featureUsage={featureUsage}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}