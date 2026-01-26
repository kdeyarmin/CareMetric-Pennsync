import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { 
  TrendingUp, TrendingDown, Users, FileText, Shield, 
  GraduationCap, Target, Activity, BarChart3, Sparkles 
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function EnhancedAgencyAnalytics({ agencyCode, users }) {
  const { data: noteConversions = [] } = useQuery({
    queryKey: ['agencyNoteConversions', agencyCode],
    queryFn: async () => {
      const allNotes = await base44.entities.NoteConversion.list('-created_date', 500);
      const providerEmails = users.map(u => u.email);
      return allNotes.filter(n => providerEmails.includes(n.nurse_email));
    },
    enabled: users.length > 0
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['agencyComplianceAudits', agencyCode],
    queryFn: async () => {
      const allAudits = await base44.entities.ComplianceAudit.list('-audit_date', 500);
      const providerEmails = users.map(u => u.email);
      return allAudits.filter(a => providerEmails.includes(a.nurse_email));
    },
    enabled: users.length > 0
  });

  const { data: trainingCompletions = [] } = useQuery({
    queryKey: ['agencyTrainingCompletions', agencyCode],
    queryFn: async () => {
      const allTraining = await base44.entities.TrainingCompletion.list('-completion_date', 500);
      const providerEmails = users.map(u => u.email);
      return allTraining.filter(t => providerEmails.includes(t.nurse_email));
    },
    enabled: users.length > 0
  });

  // Calculate comprehensive metrics
  const metrics = useMemo(() => {
    const avgCompliance = complianceAudits.length > 0
      ? complianceAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / complianceAudits.length
      : 0;

    const avgQuality = noteConversions.length > 0
      ? noteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / noteConversions.length
      : 0;

    const trainingCompletionRate = users.length > 0
      ? (trainingCompletions.filter(t => t.status === 'completed').length / users.length) * 100
      : 0;

    const totalDocumentation = noteConversions.length;
    const avgDocPerProvider = users.length > 0 ? totalDocumentation / users.length : 0;
    const timeSaved = noteConversions.length * 8.5; // minutes

    // Previous period comparison (30 days ago)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentAudits = complianceAudits.filter(a => new Date(a.audit_date) >= thirtyDaysAgo);
    const prevAudits = complianceAudits.filter(a => new Date(a.audit_date) < thirtyDaysAgo);
    
    const recentAvgCompliance = recentAudits.length > 0
      ? recentAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / recentAudits.length
      : 0;
    
    const prevAvgCompliance = prevAudits.length > 0
      ? prevAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / prevAudits.length
      : 0;

    const complianceChange = prevAvgCompliance > 0 
      ? ((recentAvgCompliance - prevAvgCompliance) / prevAvgCompliance) * 100
      : 0;

    return {
      avgCompliance: Math.round(avgCompliance),
      avgQuality: Math.round(avgQuality),
      trainingCompletionRate: Math.round(trainingCompletionRate),
      totalDocumentation,
      avgDocPerProvider: Math.round(avgDocPerProvider),
      timeSaved: Math.round(timeSaved),
      complianceChange: Math.round(complianceChange * 10) / 10,
      activeProviders: users.length
    };
  }, [noteConversions, complianceAudits, trainingCompletions, users]);

  // 30-day trend data for charts
  const trendData = useMemo(() => {
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return date.toISOString().split('T')[0];
    });

    return last30Days.map(date => {
      const dayAudits = complianceAudits.filter(a => 
        a.audit_date && a.audit_date.startsWith(date)
      );
      const dayNotes = noteConversions.filter(n =>
        n.created_date && n.created_date.startsWith(date)
      );
      
      const avgComplianceScore = dayAudits.length > 0
        ? Math.round(dayAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / dayAudits.length)
        : null;
      
      const avgQualityScore = dayNotes.length > 0
        ? Math.round(dayNotes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / dayNotes.length)
        : null;

      return {
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        compliance: avgComplianceScore,
        quality: avgQualityScore,
        notes: dayNotes.length
      };
    });
  }, [complianceAudits, noteConversions]);

  // Provider distribution by performance
  const providerDistribution = useMemo(() => {
    const providerScores = users.map(u => {
      const userAudits = complianceAudits.filter(a => a.nurse_email === u.email);
      const avgScore = userAudits.length > 0
        ? userAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / userAudits.length
        : 0;
      return avgScore;
    });

    const excellent = providerScores.filter(s => s >= 90).length;
    const good = providerScores.filter(s => s >= 75 && s < 90).length;
    const needsImprovement = providerScores.filter(s => s >= 60 && s < 75).length;
    const critical = providerScores.filter(s => s < 60).length;

    return [
      { category: 'Excellent (≥90%)', count: excellent, color: '#10B981' },
      { category: 'Good (75-89%)', count: good, color: '#3B82F6' },
      { category: 'Needs Improvement', count: needsImprovement, color: '#F59E0B' },
      { category: 'Critical (<60%)', count: critical, color: '#EF4444' }
    ];
  }, [users, complianceAudits]);

  const metricCards = [
    {
      title: "Avg Compliance Score",
      value: `${metrics.avgCompliance}%`,
      change: metrics.complianceChange,
      icon: Shield,
      color: metrics.avgCompliance >= 85 ? "text-green-600" : "text-yellow-600"
    },
    {
      title: "Avg Documentation Quality",
      value: `${metrics.avgQuality}%`,
      icon: FileText,
      color: metrics.avgQuality >= 85 ? "text-green-600" : "text-yellow-600"
    },
    {
      title: "Training Completion Rate",
      value: `${metrics.trainingCompletionRate}%`,
      icon: GraduationCap,
      color: metrics.trainingCompletionRate >= 80 ? "text-green-600" : "text-yellow-600"
    },
    {
      title: "Productivity (Docs/Provider)",
      value: metrics.avgDocPerProvider,
      icon: Activity,
      color: "text-blue-600"
    },
    {
      title: "Total Documentation",
      value: metrics.totalDocumentation,
      icon: FileText,
      color: "text-blue-600"
    },
    {
      title: "Time Saved",
      value: `${Math.round(metrics.timeSaved / 60)}hrs`,
      icon: Target,
      color: "text-green-600"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metricCards.map((metric, idx) => (
          <Card key={idx}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                {metric.title}
              </CardTitle>
              <metric.icon className={`w-4 h-4 ${metric.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {metric.value}
              </div>
              {metric.change !== null && metric.change !== undefined && (
                <div className={`flex items-center text-xs mt-1 ${
                  metric.change >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {metric.change >= 0 ? (
                    <TrendingUp className="w-3 h-3 mr-1" />
                  ) : (
                    <TrendingDown className="w-3 h-3 mr-1" />
                  )}
                  {Math.abs(metric.change)}% from last period
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 30-Day Trend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              30-Day Compliance & Quality Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="compliance" 
                  stroke="#10B981" 
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="Compliance Score"
                  connectNulls
                />
                <Line 
                  type="monotone" 
                  dataKey="quality" 
                  stroke="#3B82F6" 
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="Quality Score"
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              Provider Performance Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={providerDistribution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="category" 
                  tick={{ fontSize: 11 }}
                  angle={-20}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar 
                  dataKey="count" 
                  fill="#64748B"
                  name="Providers"
                  radius={[8, 8, 0, 0]}
                >
                  {providerDistribution.map((entry, index) => (
                    <cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Productivity Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Daily Documentation Productivity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar 
                dataKey="notes" 
                fill="#8B5CF6" 
                name="Notes Generated"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Feature Usage Analytics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            Feature Usage Insights
          </CardTitle>
          <CardDescription>
            Track which AI features are being used most by your team
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{noteConversions.length}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Smart Notes</p>
            </div>
            <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{complianceAudits.length}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Compliance Checks</p>
            </div>
            <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {trainingCompletions.filter(t => t.status === 'completed').length}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Trainings Completed</p>
            </div>
            <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-center">
              <p className="text-2xl font-bold text-green-600">{Math.round(metrics.timeSaved / 60)}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Hours Saved</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}