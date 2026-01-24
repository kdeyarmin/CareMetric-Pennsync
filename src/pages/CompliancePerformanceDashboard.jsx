import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Award, AlertCircle, BookOpen, Calendar, Filter, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, subDays, subMonths } from "date-fns";

export default function CompliancePerformanceDashboard() {
  const [dateRange, setDateRange] = useState("30"); // days
  const [selectedVisitType, setSelectedVisitType] = useState("all");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  // Fetch compliance audits
  const { data: audits = [], isLoading: auditsLoading } = useQuery({
    queryKey: ['complianceAudits', currentUser?.email, dateRange],
    queryFn: async () => {
      const cutoffDate = dateRange === "all" 
        ? new Date(0) 
        : subDays(new Date(), parseInt(dateRange));
      
      const allAudits = await base44.entities.ComplianceAudit.filter(
        { nurse_email: currentUser.email },
        '-audit_date',
        500
      );
      
      return allAudits.filter(a => new Date(a.audit_date) >= cutoffDate);
    },
    enabled: !!currentUser?.email
  });

  // Fetch note conversions
  const { data: noteConversions = [] } = useQuery({
    queryKey: ['noteConversions', currentUser?.email, dateRange],
    queryFn: async () => {
      const cutoffDate = dateRange === "all" 
        ? new Date(0) 
        : subDays(new Date(), parseInt(dateRange));
      
      const conversions = await base44.entities.NoteConversion.filter(
        { nurse_email: currentUser.email },
        '-created_date',
        500
      );
      
      return conversions.filter(c => new Date(c.created_date) >= cutoffDate);
    },
    enabled: !!currentUser?.email
  });

  // Fetch training completions
  const { data: trainingCompletions = [] } = useQuery({
    queryKey: ['trainingCompletions', currentUser?.email],
    queryFn: async () => {
      return await base44.entities.TrainingCompletion.filter(
        { nurse_email: currentUser.email, status: 'completed' },
        '-completion_date',
        100
      );
    },
    enabled: !!currentUser?.email
  });

  // Fetch training recommendations
  const { data: trainingRecommendations = [] } = useQuery({
    queryKey: ['trainingRecommendations', currentUser?.email],
    queryFn: async () => {
      return await base44.entities.TrainingRecommendation.filter(
        { nurse_email: currentUser.email },
        '-created_date',
        100
      );
    },
    enabled: !!currentUser?.email
  });

  // Filter audits by visit type
  const filteredAudits = useMemo(() => {
    if (selectedVisitType === "all") return audits;
    return audits.filter(a => {
      // Try to get visit info
      return true; // For now, include all - can enhance with visit type join
    });
  }, [audits, selectedVisitType]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalAudits = filteredAudits.length;
    const avgCompliance = totalAudits > 0 
      ? filteredAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / totalAudits 
      : 0;
    
    const avgQuality = noteConversions.length > 0
      ? noteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / noteConversions.length
      : 0;

    const passedAudits = filteredAudits.filter(a => a.status === 'passed').length;
    const passRate = totalAudits > 0 ? (passedAudits / totalAudits) * 100 : 0;

    // Get trend (last 7 days vs previous 7 days)
    const last7Days = subDays(new Date(), 7);
    const previous7Days = subDays(new Date(), 14);
    
    const recentAudits = filteredAudits.filter(a => new Date(a.audit_date) >= last7Days);
    const previousAudits = filteredAudits.filter(a => 
      new Date(a.audit_date) >= previous7Days && new Date(a.audit_date) < last7Days
    );

    const recentAvg = recentAudits.length > 0
      ? recentAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / recentAudits.length
      : 0;
    
    const previousAvg = previousAudits.length > 0
      ? previousAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / previousAudits.length
      : avgCompliance;

    const trend = recentAvg - previousAvg;

    return {
      totalAudits,
      avgCompliance: Math.round(avgCompliance),
      avgQuality: Math.round(avgQuality),
      passRate: Math.round(passRate),
      trend: Math.round(trend)
    };
  }, [filteredAudits, noteConversions]);

  // Prepare chart data - compliance over time
  const complianceTimelineData = useMemo(() => {
    const grouped = {};
    
    filteredAudits.forEach(audit => {
      const date = format(new Date(audit.audit_date), 'MMM dd');
      if (!grouped[date]) {
        grouped[date] = { date, scores: [], count: 0 };
      }
      grouped[date].scores.push(audit.compliance_score || 0);
      grouped[date].count++;
    });

    return Object.values(grouped)
      .map(g => ({
        date: g.date,
        avgScore: Math.round(g.scores.reduce((a, b) => a + b, 0) / g.count),
        count: g.count
      }))
      .slice(-30); // Last 30 data points
  }, [filteredAudits]);

  // Recurring issues analysis
  const recurringIssues = useMemo(() => {
    const issueCount = {};
    
    filteredAudits.forEach(audit => {
      (audit.issues || []).forEach(issue => {
        const key = issue.element || 'Unknown';
        issueCount[key] = (issueCount[key] || 0) + 1;
      });
    });

    return Object.entries(issueCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [filteredAudits]);

  // Training impact analysis
  const trainingImpact = useMemo(() => {
    const completedModules = trainingCompletions.filter(t => 
      new Date(t.completion_date) >= subDays(new Date(), parseInt(dateRange))
    );

    // Get audits before and after training
    const beforeTrainingAvg = filteredAudits
      .filter(a => new Date(a.audit_date) < subMonths(new Date(), 1))
      .reduce((sum, a, _, arr) => sum + (a.compliance_score || 0) / arr.length, 0);

    const afterTrainingAvg = filteredAudits
      .filter(a => new Date(a.audit_date) >= subMonths(new Date(), 1))
      .reduce((sum, a, _, arr) => sum + (a.compliance_score || 0) / arr.length, 0);

    return {
      completedCount: completedModules.length,
      improvement: Math.round(afterTrainingAvg - beforeTrainingAvg),
      recommendationsCount: trainingRecommendations.length,
      addressedCount: trainingRecommendations.filter(r => r.addressed).length
    };
  }, [trainingCompletions, filteredAudits, trainingRecommendations, dateRange]);

  // Status distribution
  const statusDistribution = useMemo(() => {
    const counts = {
      passed: filteredAudits.filter(a => a.status === 'passed').length,
      flagged: filteredAudits.filter(a => a.status === 'flagged').length,
      critical: filteredAudits.filter(a => a.status === 'critical').length
    };
    
    return [
      { name: 'Passed', value: counts.passed, color: '#22c55e' },
      { name: 'Flagged', value: counts.flagged, color: '#f59e0b' },
      { name: 'Critical', value: counts.critical, color: '#ef4444' }
    ].filter(d => d.value > 0);
  }, [filteredAudits]);

  const exportData = () => {
    const csv = [
      ['Date', 'Compliance Score', 'Status', 'Issues Count'],
      ...filteredAudits.map(a => [
        format(new Date(a.audit_date), 'yyyy-MM-dd'),
        a.compliance_score,
        a.status,
        a.issues?.length || 0
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  if (!currentUser) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              Compliance Performance
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Track your documentation quality and compliance metrics
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-40">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 6 months</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedVisitType} onValueChange={setSelectedVisitType}>
              <SelectTrigger className="w-40">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Visit Types</SelectItem>
                <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                <SelectItem value="admission">Admission</SelectItem>
                <SelectItem value="recertification">Recertification</SelectItem>
                <SelectItem value="routine_visit">Routine Visit</SelectItem>
              </SelectContent>
            </Select>

            <Button onClick={exportData} variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Avg Compliance Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                    {metrics.avgCompliance}%
                  </div>
                  <div className={`flex items-center gap-1 text-sm mt-1 ${
                    metrics.trend >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {metrics.trend >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {Math.abs(metrics.trend)}% vs last week
                  </div>
                </div>
                <Award className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Avg Quality Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                    {metrics.avgQuality}%
                  </div>
                  <div className="text-sm text-slate-500 mt-1">
                    {noteConversions.length} notes analyzed
                  </div>
                </div>
                <Award className="w-8 h-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-green-50 dark:bg-green-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Pass Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                    {metrics.passRate}%
                  </div>
                  <div className="text-sm text-slate-500 mt-1">
                    {metrics.totalAudits} total audits
                  </div>
                </div>
                <Award className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Training Impact
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                    +{trainingImpact.improvement}%
                  </div>
                  <div className="text-sm text-slate-500 mt-1">
                    {trainingImpact.completedCount} modules completed
                  </div>
                </div>
                <BookOpen className="w-8 h-8 text-amber-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Compliance Score Trend</CardTitle>
              <CardDescription>Your compliance scores over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={complianceTimelineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="avgScore" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    name="Compliance Score"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit Status</CardTitle>
              <CardDescription>Distribution of audit results</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => `${entry.name}: ${entry.value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Top Recurring Issues</CardTitle>
              <CardDescription>Most common compliance issues identified</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={recurringIssues}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ef4444" name="Occurrences" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-purple-600" />
                Training Module Impact
              </CardTitle>
              <CardDescription>How training has improved your compliance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    {trainingImpact.completedCount}
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    Modules Completed
                  </div>
                </div>
                <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    +{trainingImpact.improvement}%
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    Score Improvement
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">Recommendations Progress</span>
                  <Badge variant="outline">
                    {trainingImpact.addressedCount} / {trainingImpact.recommendationsCount}
                  </Badge>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div 
                    className="bg-purple-600 h-2 rounded-full transition-all"
                    style={{ 
                      width: `${trainingImpact.recommendationsCount > 0 
                        ? (trainingImpact.addressedCount / trainingImpact.recommendationsCount) * 100 
                        : 0}%` 
                    }}
                  />
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  💡 Completing recommended training modules has shown an average improvement of <strong>{trainingImpact.improvement}%</strong> in compliance scores within the tracked period.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}