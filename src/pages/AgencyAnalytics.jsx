import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  TrendingUp,
  Clock,
  FileText,
  Shield,
  DollarSign,
  Download,
  AlertCircle,
  CheckCircle2,
  BarChart3
} from "lucide-react";
import { calculateStats, calculateNurseStats, formatCurrency } from "../components/utils/statsCalculator";
import { toCsvRows } from "@/components/admin/csvExport";
import { toast } from "sonner";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/stat-card";

export default function AgencyAnalytics() {
  const [_dateRange, _setDateRange] = useState("30days");

  // Fetch all necessary data
  const { data: visits = [] } = useQuery({
    queryKey: ['all-visits'],
    queryFn: () => base44.entities.Visit.list('-created_date', 1000),
    initialData: [],
  });

  const { data: noteConversions = [] } = useQuery({
    queryKey: ['note-conversions'],
    queryFn: () => base44.entities.NoteConversion.list('-created_date', 1000),
    initialData: [],
  });

  // Sibling Incident/ComplianceAudit/TrainingCompletion queries pass limits;
  // these two didn't, capping agency stats and top-performers at 50 rows.
  const { data: users = [] } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => base44.entities.User.list('-created_date', 5000),
    initialData: [],
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ['all-patients'],
    queryFn: () => base44.entities.Patient.list('-created_date', 5000),
    initialData: [],
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['all-incidents'],
    queryFn: () => base44.entities.Incident.list('-created_date', 1000),
    initialData: [],
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['compliance-audits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-created_date', 1000),
    initialData: [],
  });

  // Training activity from the live assignment system (TrainingCompletion retired).
  const { data: trainingAssignments = [] } = useQuery({
    queryKey: ['training-assignments-agency'],
    queryFn: () => base44.entities.TrainingAssignment.list('-created_date', 5000),
    initialData: [],
  });

  // Calculate overall statistics
  const overallStats = useMemo(() => {
    return calculateStats({
      visits,
      noteConversions,
      users,
      patients: allPatients,
      incidents,
      complianceAudits
    });
  }, [visits, noteConversions, users, allPatients, incidents, complianceAudits]);

  // Calculate nurse performance stats
  const nurseStats = useMemo(() => {
    const nurses = users.filter(u => u.role === 'user');
    return nurses.map(nurse => ({
      ...nurse,
      stats: calculateNurseStats(nurse.email, { visits, noteConversions })
    }));
  }, [users, visits, noteConversions]);

  // Top performers
  const topPerformers = useMemo(() => {
    return [...nurseStats]
      .filter(n => n.stats.totalVisits > 0)
      .sort((a, b) => b.stats.completionRate - a.stats.completionRate)
      .slice(0, 5);
  }, [nurseStats]);

  // Training completion stats
  const trainingStats = useMemo(() => {
    const completed = trainingAssignments.filter(t => t.status === 'completed' || t.pass_fail_result === 'passed').length;
    const total = trainingAssignments.length;
    return {
      completed,
      total,
      rate: total > 0 ? ((completed / total) * 100).toFixed(1) : 0
    };
  }, [trainingAssignments]);

  const handleExport = () => {
    try {
      const summaryRows = [
        ['Agency Analytics Report'],
        ['Generated', new Date().toISOString()],
        [],
        ['Metric', 'Value'],
        ['Total Visits', overallStats.visits.total],
        ['Completed Visits', overallStats.visits.completed],
        ['Visit Completion Rate (%)', overallStats.visits.completionRate],
        ['Total Patients', overallStats.patients.total],
        ['Active Patients', overallStats.patients.active],
        ['Total Incidents', overallStats.incidents.total],
        ['Avg Compliance Score', overallStats.compliance.avgScore],
        ['Estimated Revenue', overallStats.financial.estimatedRevenue],
        ['Cost Savings', overallStats.financial.costSavings],
        ['Training Completion Rate (%)', trainingStats.rate],
        [],
        ['Top Performers'],
        ['Name', 'Email', 'Total Visits', 'Completion Rate (%)'],
        ...topPerformers.map((n) => [
          n.full_name || '',
          n.email || '',
          n.stats.totalVisits,
          n.stats.completionRate,
        ]),
      ];

      const csv = toCsvRows(summaryRows);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agency_analytics_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Agency analytics export error:', error);
      toast.error('Failed to export report: ' + error.message);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={BarChart3}
        eyebrow="Analytics"
        title="Agency Analytics & Performance"
        description="Comprehensive overview of agency operations and metrics"
        favoritePage="AgencyAnalytics"
        actions={
          <Button variant="outline" className="gap-2" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export Report
          </Button>
        }
      />

      <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="financial">Financial</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Documentation Efficiency */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    Documentation Efficiency
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-slate-600">AI Enhancement Rate</span>
                        <span className="text-sm font-semibold">{overallStats.visits.total > 0 ? Math.min(100, Math.round((overallStats.noteEnhancements.total / overallStats.visits.total) * 100)) : 0}%</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div className="bg-indigo-600 h-2 rounded-full" style={{ width: `${overallStats.visits.total > 0 ? Math.min(100, Math.round((overallStats.noteEnhancements.total / overallStats.visits.total) * 100)) : 0}%` }}></div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                      <div>
                        <p className="text-2xl font-bold text-slate-900">{overallStats.compliance.avgScore}</p>
                        <p className="text-sm text-slate-600">Avg Quality Score</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-slate-900">{overallStats.noteEnhancements.total}</p>
                        <p className="text-sm text-slate-600">Notes Enhanced</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Patient Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-600" />
                    Patient Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Active</span>
                      <span className="text-sm font-semibold text-emerald-600">{overallStats.patients.active}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Discharged</span>
                      <span className="text-sm font-semibold text-slate-600">{overallStats.patients.discharged}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Total</span>
                      <span className="text-sm font-semibold text-slate-600">{overallStats.patients.total}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top Performers */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-indigo-600" />
                  Top Performing Nurses
                </CardTitle>
                <CardDescription>Based on visit completion rate and documentation quality</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topPerformers.map((nurse, idx) => (
                    <div key={nurse.email} className="flex items-center gap-4 p-3 rounded-lg bg-slate-50">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold">
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{nurse.full_name}</p>
                        <p className="text-sm text-slate-500">{nurse.stats.totalVisits} visits</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-indigo-600">{nurse.stats.completionRate}%</p>
                        <p className="text-xs text-slate-500">completion</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Compliance Tab */}
          <TabsContent value="compliance" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <StatCard
                title="Avg Compliance Score"
                value={`${overallStats.compliance.avgScore}%`}
                icon={Shield}
                color="green"
              />
              <StatCard
                title="Total Audits"
                value={overallStats.compliance.auditsInRange}
                subtitle={`${overallStats.compliance.passedAudits} passed`}
                icon={CheckCircle2}
                color="indigo"
              />
              <StatCard
                title="Quality Score"
                value={`${overallStats.compliance.qualityScore}%`}
                subtitle="Overall quality"
                icon={AlertCircle}
                color="indigo"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Compliance Status Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm font-medium text-emerald-700">Passed</span>
                      <span className="text-sm font-semibold">{overallStats.compliance.passedAudits}</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div className="bg-emerald-600 h-2 rounded-full" style={{ width: `${overallStats.compliance.qualityScore}%` }}></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm font-medium text-indigo-700">Total Audits</span>
                      <span className="text-sm font-semibold">{overallStats.compliance.auditsInRange}</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div className="bg-indigo-600 h-2 rounded-full" style={{ width: `100%` }}></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">Avg Score</span>
                      <span className="text-sm font-semibold">{overallStats.compliance.avgScore}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div className="bg-slate-600 h-2 rounded-full" style={{ width: `${overallStats.compliance.avgScore}%` }}></div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Staff Performance Metrics</CardTitle>
                <CardDescription>Individual nurse statistics and productivity</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nurse</TableHead>
                      <TableHead>Visits</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Time Saved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nurseStats.map((nurse) => (
                      <TableRow key={nurse.email}>
                        <TableCell className="font-medium text-slate-900">{nurse.full_name}</TableCell>
                        <TableCell className="text-slate-600">{nurse.stats.totalVisits}</TableCell>
                        <TableCell className="text-slate-600">{nurse.stats.completedVisits}</TableCell>
                        <TableCell>
                          <Badge variant={
                            nurse.stats.completionRate >= 80 ? 'success' :
                            nurse.stats.completionRate >= 60 ? 'warning' :
                            'destructive'
                          }>
                            {nurse.stats.completionRate}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-600">{nurse.stats.timeSavedHours}h</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Training Tab */}
          <TabsContent value="training" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <StatCard
                title="Total Trainings"
                value={trainingStats.total}
                icon={FileText}
                color="indigo"
              />
              <StatCard
                title="Completed"
                value={trainingStats.completed}
                subtitle={`${trainingStats.rate}% rate`}
                icon={CheckCircle2}
                color="green"
              />
              <StatCard
                title="In Progress"
                value={trainingStats.total - trainingStats.completed}
                icon={Clock}
                color="amber"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Training Completion Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-slate-600">Overall Completion Rate</span>
                    <span className="text-sm font-semibold">{trainingStats.rate}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-3">
                    <div className="bg-indigo-600 h-3 rounded-full transition-all" style={{ width: `${trainingStats.rate}%` }}></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Financial Tab */}
          <TabsContent value="financial" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <StatCard
                title="Est. Time Saved Value"
                value={formatCurrency(overallStats.financial.costSavings)}
                subtitle="Based on documentation efficiency"
                icon={DollarSign}
                color="green"
              />
              <StatCard
                title="Productivity Gain"
                value={overallStats.timeSaved.displayTotal}
                subtitle="Through AI automation"
                icon={TrendingUp}
                color="indigo"
              />
              <StatCard
                title="Est. Revenue"
                value={formatCurrency(overallStats.financial.estimatedRevenue)}
                subtitle="From completed visits"
                icon={Clock}
                color="purple"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Financial Impact Summary</CardTitle>
                <CardDescription>Estimated value from AI-powered documentation and efficiency gains</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-4 bg-emerald-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-emerald-700">Total Time Saved</p>
                      <p className="text-2xl font-bold text-emerald-900">{overallStats.timeSaved.displayTotal}</p>
                    </div>
                    <DollarSign className="w-8 h-8 text-emerald-600" />
                  </div>
                  <div className="flex justify-between items-center p-4 bg-indigo-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-indigo-700">Estimated Value</p>
                      <p className="text-2xl font-bold text-indigo-900">{formatCurrency(overallStats.financial.costSavings)}</p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-indigo-600" />
                  </div>
                  <p className="text-sm text-slate-500 mt-4">
                    * Estimates based on industry average hourly rates and documented time savings through AI documentation assistance
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
    </PageContainer>
  );
}