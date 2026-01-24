import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Award, FileText, Clock } from "lucide-react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";

export default function ProviderPerformanceHistory({ providerEmail }) {
  const { data: complianceAudits = [], isLoading: auditsLoading } = useQuery({
    queryKey: ['providerComplianceHistory', providerEmail],
    queryFn: () => base44.entities.ComplianceAudit.filter(
      { nurse_email: providerEmail },
      '-audit_date',
      500
    )
  });

  const { data: noteConversions = [], isLoading: notesLoading } = useQuery({
    queryKey: ['providerNotesHistory', providerEmail],
    queryFn: () => base44.entities.NoteConversion.filter(
      { nurse_email: providerEmail },
      '-created_date',
      500
    )
  });

  const { data: visits = [], isLoading: visitsLoading } = useQuery({
    queryKey: ['providerVisitsHistory', providerEmail],
    queryFn: () => base44.entities.Visit.filter(
      { created_by: providerEmail },
      '-visit_date',
      500
    )
  });

  // Calculate monthly trends for the last 6 months
  const monthlyTrends = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(new Date(), i);
      const monthStart = startOfMonth(monthDate);
      const monthEnd = endOfMonth(monthDate);

      // Compliance data
      const monthAudits = complianceAudits.filter(a => {
        const auditDate = new Date(a.audit_date);
        return auditDate >= monthStart && auditDate <= monthEnd;
      });

      const avgCompliance = monthAudits.length > 0
        ? Math.round(monthAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / monthAudits.length)
        : 0;

      // Quality data
      const monthNotes = noteConversions.filter(n => {
        const noteDate = new Date(n.created_date);
        return noteDate >= monthStart && noteDate <= monthEnd;
      });

      const avgQuality = monthNotes.length > 0
        ? Math.round(monthNotes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / monthNotes.length)
        : 0;

      // Productivity data
      const monthVisits = visits.filter(v => {
        const visitDate = new Date(v.visit_date);
        return visitDate >= monthStart && visitDate <= monthEnd;
      });

      months.push({
        month: format(monthDate, 'MMM yyyy'),
        compliance: avgCompliance,
        quality: avgQuality,
        visits: monthVisits.length,
        audits: monthAudits.length
      });
    }

    return months;
  }, [complianceAudits, noteConversions, visits]);

  // Calculate overall trends
  const trends = useMemo(() => {
    if (monthlyTrends.length < 2) return null;

    const recent = monthlyTrends.slice(-3);
    const older = monthlyTrends.slice(0, 3);

    const recentCompliance = recent.reduce((sum, m) => sum + m.compliance, 0) / recent.length;
    const olderCompliance = older.reduce((sum, m) => sum + m.compliance, 0) / older.length;

    const recentQuality = recent.reduce((sum, m) => sum + m.quality, 0) / recent.length;
    const olderQuality = older.reduce((sum, m) => sum + m.quality, 0) / older.length;

    const recentVisits = recent.reduce((sum, m) => sum + m.visits, 0) / recent.length;
    const olderVisits = older.reduce((sum, m) => sum + m.visits, 0) / older.length;

    return {
      compliance: {
        value: Math.round(recentCompliance),
        change: Math.round(recentCompliance - olderCompliance),
        trend: recentCompliance > olderCompliance ? 'up' : 'down'
      },
      quality: {
        value: Math.round(recentQuality),
        change: Math.round(recentQuality - olderQuality),
        trend: recentQuality > olderQuality ? 'up' : 'down'
      },
      productivity: {
        value: Math.round(recentVisits),
        change: Math.round(recentVisits - olderVisits),
        trend: recentVisits > olderVisits ? 'up' : 'down'
      }
    };
  }, [monthlyTrends]);

  const isLoading = auditsLoading || notesLoading || visitsLoading;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {trends && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Avg Compliance</p>
                  <p className="text-2xl font-bold text-slate-900">{trends.compliance.value}%</p>
                  <div className="flex items-center gap-1 mt-1">
                    {trends.compliance.trend === 'up' ? (
                      <TrendingUp className="w-4 h-4 text-green-600" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-600" />
                    )}
                    <span className={`text-sm ${trends.compliance.trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                      {Math.abs(trends.compliance.change)}% vs prev period
                    </span>
                  </div>
                </div>
                <Award className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Avg Quality</p>
                  <p className="text-2xl font-bold text-slate-900">{trends.quality.value}%</p>
                  <div className="flex items-center gap-1 mt-1">
                    {trends.quality.trend === 'up' ? (
                      <TrendingUp className="w-4 h-4 text-green-600" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-600" />
                    )}
                    <span className={`text-sm ${trends.quality.trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                      {Math.abs(trends.quality.change)}% vs prev period
                    </span>
                  </div>
                </div>
                <FileText className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Avg Visits/Month</p>
                  <p className="text-2xl font-bold text-slate-900">{trends.productivity.value}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {trends.productivity.trend === 'up' ? (
                      <TrendingUp className="w-4 h-4 text-green-600" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-600" />
                    )}
                    <span className={`text-sm ${trends.productivity.trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                      {Math.abs(trends.productivity.change)} vs prev period
                    </span>
                  </div>
                </div>
                <Clock className="w-8 h-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts */}
      <Tabs defaultValue="compliance">
        <TabsList>
          <TabsTrigger value="compliance">Compliance Trend</TabsTrigger>
          <TabsTrigger value="quality">Quality Trend</TabsTrigger>
          <TabsTrigger value="productivity">Productivity</TabsTrigger>
        </TabsList>

        <TabsContent value="compliance">
          <Card>
            <CardHeader>
              <CardTitle>Compliance Score Trend</CardTitle>
              <CardDescription>6-month compliance score history</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={monthlyTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="compliance" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    name="Compliance Score"
                    dot={{ fill: '#3b82f6', r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality">
          <Card>
            <CardHeader>
              <CardTitle>Quality Score Trend</CardTitle>
              <CardDescription>6-month documentation quality history</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={monthlyTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="quality" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    name="Quality Score"
                    dot={{ fill: '#10b981', r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="productivity">
          <Card>
            <CardHeader>
              <CardTitle>Productivity Metrics</CardTitle>
              <CardDescription>Monthly visits and audits completed</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="visits" fill="#8b5cf6" name="Visits" />
                  <Bar dataKey="audits" fill="#f59e0b" name="Audits" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}