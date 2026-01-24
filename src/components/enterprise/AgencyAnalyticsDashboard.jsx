import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, Users, Award } from "lucide-react";

export default function AgencyAnalyticsDashboard({ providers }) {
  // Fetch all compliance data
  const { data: allAudits = [] } = useQuery({
    queryKey: ['allAudits'],
    queryFn: async () => {
      const audits = await base44.entities.ComplianceAudit.list('-audit_date', 1000);
      return audits;
    }
  });

  const { data: allNotes = [] } = useQuery({
    queryKey: ['allNotes'],
    queryFn: async () => {
      const notes = await base44.entities.NoteConversion.list('-created_date', 1000);
      return notes;
    }
  });

  // Calculate agency-wide metrics
  const metrics = useMemo(() => {
    const avgCompliance = allAudits.length > 0
      ? allAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / allAudits.length
      : 0;

    const avgQuality = allNotes.length > 0
      ? allNotes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / allNotes.length
      : 0;

    return {
      avgCompliance: Math.round(avgCompliance),
      avgQuality: Math.round(avgQuality),
      totalNotes: allNotes.length,
      totalAudits: allAudits.length
    };
  }, [allAudits, allNotes]);

  // Provider comparison data
  const providerComparison = useMemo(() => {
    return providers.slice(0, 10).map(p => {
      const providerAudits = allAudits.filter(a => a.nurse_email === p.email);
      const avgScore = providerAudits.length > 0
        ? providerAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / providerAudits.length
        : 0;
      
      return {
        name: p.full_name?.split(' ')[0] || p.email.split('@')[0],
        score: Math.round(avgScore)
      };
    }).sort((a, b) => b.score - a.score);
  }, [providers, allAudits]);

  // Trend over time
  const trendData = useMemo(() => {
    const grouped = {};
    allAudits.forEach(audit => {
      const date = new Date(audit.audit_date).toISOString().split('T')[0];
      if (!grouped[date]) {
        grouped[date] = { date, scores: [] };
      }
      grouped[date].scores.push(audit.compliance_score || 0);
    });

    return Object.values(grouped)
      .map(g => ({
        date: g.date,
        avgScore: Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length)
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);
  }, [allAudits]);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="w-4 h-4" />
              Agency Avg Compliance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              {metrics.avgCompliance}%
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Based on {metrics.totalAudits} audits
            </p>
          </CardContent>
        </Card>

        <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="w-4 h-4" />
              Agency Avg Quality
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">
              {metrics.avgQuality}%
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Based on {metrics.totalNotes} notes
            </p>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50 dark:bg-green-950">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4" />
              Active Providers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {providers.length}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Across agency
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Agency Compliance Trend</CardTitle>
            <CardDescription>Average compliance score over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="avgScore" stroke="#3b82f6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Performers</CardTitle>
            <CardDescription>Providers with highest compliance scores</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={providerComparison}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="score" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}