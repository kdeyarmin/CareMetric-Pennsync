import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Download,
  TrendingUp,
  Users,
  Award,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { exportToPDF } from "../utils/pdfExporter";
import { toast } from 'sonner';

export default function StaffEducationComplianceReport() {
  const [timeframe, setTimeframe] = useState('30');
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
  });

  // Derive compliance from the entities the grading/certificate pipeline
  // actually writes (TrainingAssignment). The legacy TrainingCompletion entity
  // is no longer written, so reading it produced an empty/stale report.
  const { data: allAssignments = [] } = useQuery({
    queryKey: ['complianceAssignments'],
    queryFn: () => base44.entities.TrainingAssignment.list('-created_date', 5000),
  });

  const complianceData = React.useMemo(() => {
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(timeframe));

    const isCompleted = (a) => a.status === 'completed' || a.pass_fail_result === 'passed';
    const isOverdue = (a) =>
      !isCompleted(a) && (a.status === 'overdue' || (a.due_date && new Date(a.due_date) < now));
    // Recency is based on when the assignment was acted on (completed) or, if
    // still open, when it was assigned — so the timeframe filter reflects activity.
    const activityDate = (a) => new Date(a.completion_date || a.submitted_at || a.assigned_date || a.created_date);

    const nurses = allUsers.filter(u => u.role === 'user' && u.is_approved);

    const staffMetrics = nurses.map(nurse => {
      const nurseAssignments = allAssignments.filter(a => a.assigned_to_user_id === nurse.email);
      const recent = nurseAssignments.filter(a => activityDate(a) >= cutoffDate);
      const scored = recent.filter(a => typeof a.score_percentage === 'number');
      const avgScore = scored.reduce((sum, a) => sum + a.score_percentage, 0) / (scored.length || 1);
      // Overdue is a current-state measure (not time-windowed) so audits surface
      // every staff member who is behind, regardless of the selected timeframe.
      const overdue = nurseAssignments.filter(isOverdue).length;

      return {
        name: nurse.full_name,
        email: nurse.email,
        completed: recent.filter(isCompleted).length,
        avgScore: Math.round(avgScore),
        overdue,
        total: recent.length,
      };
    });

    // Compliance rate = required assignments completed / required assignments,
    // measured over current state across active nurses.
    const requiredAssignments = allAssignments.filter(
      a => a.required && nurses.some(n => n.email === a.assigned_to_user_id)
    );
    const totalRequired = requiredAssignments.length;
    const completedRequired = requiredAssignments.filter(isCompleted).length;
    const complianceRate = totalRequired > 0 ? (completedRequired / totalRequired * 100).toFixed(1) : 0;

    const allRecent = allAssignments.filter(a => activityDate(a) >= cutoffDate);
    const allScored = allRecent.filter(a => typeof a.score_percentage === 'number');

    return {
      staffMetrics: staffMetrics.sort((a, b) => b.completed - a.completed),
      totalStaff: nurses.length,
      totalCompletions: allRecent.filter(isCompleted).length,
      avgScore: Math.round(allScored.reduce((sum, a) => sum + a.score_percentage, 0) / (allScored.length || 1)),
      complianceRate,
      totalRequired,
      completedRequired,
      totalOverdue: staffMetrics.reduce((sum, s) => sum + s.overdue, 0),
      atRiskStaff: staffMetrics.filter(s => s.overdue > 0 || s.avgScore < 70).length
    };
  }, [allUsers, allAssignments, timeframe]);

  const statusLabel = (staff) =>
    (staff.avgScore >= 90 && staff.overdue === 0) ? 'Excellent'
      : (staff.overdue > 0 || staff.avgScore < 70) ? 'At Risk'
      : 'On Track';

  const exportCSV = () => {
    const headers = ['Staff Member', 'Email', 'Completed', 'Total', 'Avg Score (%)', 'Overdue', 'Status'];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = complianceData.staffMetrics.map((s) =>
      [s.name || '', s.email || '', s.completed, s.total, s.avgScore, s.overdue, statusLabel(s)].map(escape).join(',')
    );
    const summary = [
      ['Compliance rate (%)', complianceData.complianceRate],
      ['Required completed', `${complianceData.completedRequired} of ${complianceData.totalRequired}`],
      ['Active staff', complianceData.totalStaff],
      ['At-risk staff', complianceData.atRiskStaff],
      ['Overdue trainings', complianceData.totalOverdue],
    ].map(([k, v]) => `${escape(k)},${escape(v)}`);
    const csv = ['Staff Education Compliance Report', `Generated,${formatEastern(new Date(), 'yyyy-MM-dd')}`, '', 'Summary', ...summary, '', headers.map(escape).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Staff_Training_Compliance_${formatEastern(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const generatePDF = async () => {
    setIsGenerating(true);
    try {
      const timeframeLabels = {
        '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days',
        '180': 'Last 6 months', '365': 'Last year',
      };

      const statusFor = (staff) =>
        (staff.avgScore >= 90 && staff.overdue === 0) ? 'Excellent'
          : (staff.overdue > 0 || staff.avgScore < 70) ? 'At Risk'
          : 'On Track';

      await exportToPDF({
        filename: `Staff_Training_Report_${formatEastern(new Date(), 'yyyy-MM-dd')}.pdf`,
        title: 'Staff Education Compliance Report',
        subtitle: timeframeLabels[timeframe] || `Last ${timeframe} days`,
        orientation: 'landscape',
        content: [
          { type: 'heading', text: 'Summary', size: 14 },
          { type: 'text', text: `Compliance rate: ${complianceData.complianceRate}% (${complianceData.completedRequired} of ${complianceData.totalRequired} required trainings completed)` },
          { type: 'text', text: `Total completions: ${complianceData.totalCompletions}  |  Average score: ${complianceData.avgScore}%` },
          { type: 'text', text: `Active staff: ${complianceData.totalStaff}  |  At-risk staff: ${complianceData.atRiskStaff}  |  Overdue trainings: ${complianceData.totalOverdue}` },
          { type: 'spacer', height: 6 },
          { type: 'heading', text: 'Staff Training Performance', size: 14 },
          {
            type: 'table',
            headers: ['Staff Member', 'Email', 'Completed', 'Avg Score', 'Overdue', 'Status'],
            rows: complianceData.staffMetrics.map((staff) => [
              staff.name || 'N/A',
              staff.email || '',
              `${staff.completed} / ${staff.total}`,
              `${staff.avgScore}%`,
              staff.overdue > 0 ? String(staff.overdue) : '-',
              statusFor(staff),
            ]),
          },
        ],
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate report. Please try again.');
    }
    setIsGenerating(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-navy-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-6 h-6 text-indigo-600" />
              Staff Education Compliance Report
            </CardTitle>
            <div className="flex items-center gap-3">
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="180">Last 6 months</SelectItem>
                  <SelectItem value="365">Last year</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={exportCSV}>
                <FileText className="w-4 h-4 mr-2" /> Export CSV
              </Button>
              <Button onClick={generatePDF} disabled={isGenerating}>
                {isGenerating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                ) : (
                  <><Download className="w-4 h-4 mr-2" /> Export PDF</>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-2 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm text-slate-600">Compliance Rate</p>
                <p className="text-3xl font-bold text-green-600">{complianceData.complianceRate}%</p>
              </div>
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <Progress value={parseFloat(complianceData.complianceRate)} className="h-2" />
            <p className="text-xs text-slate-600 mt-2">
              {complianceData.completedRequired} of {complianceData.totalRequired} required
            </p>
          </CardContent>
        </Card>

        <Card className="border-2 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Completions</p>
                <p className="text-3xl font-bold text-blue-600">{complianceData.totalCompletions}</p>
              </div>
              <Award className="w-10 h-10 text-blue-600" />
            </div>
            <p className="text-xs text-slate-600 mt-2">
              Avg Score: {complianceData.avgScore}%
            </p>
          </CardContent>
        </Card>

        <Card className="border-2 border-orange-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">At-Risk Staff</p>
                <p className="text-3xl font-bold text-orange-600">{complianceData.atRiskStaff}</p>
              </div>
              <AlertTriangle className="w-10 h-10 text-orange-600" />
            </div>
            <p className="text-xs text-slate-600 mt-2">
              {complianceData.totalOverdue} overdue trainings
            </p>
          </CardContent>
        </Card>

        <Card className="border-2 border-navy-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Active Staff</p>
                <p className="text-3xl font-bold text-navy-600">{complianceData.totalStaff}</p>
              </div>
              <Users className="w-10 h-10 text-navy-600" />
            </div>
            <p className="text-xs text-slate-600 mt-2">
              Enrolled in training
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Staff Performance Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff Training Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff Member</TableHead>
                <TableHead className="text-center">Completed</TableHead>
                <TableHead className="text-center">Avg Score</TableHead>
                <TableHead className="text-center">Overdue</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {complianceData.staffMetrics.map((staff, idx) => {
                const isAtRisk = staff.overdue > 0 || staff.avgScore < 70;
                const isExcellent = staff.avgScore >= 90 && staff.overdue === 0;

                return (
                  <TableRow key={idx}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{staff.name}</p>
                      <p className="text-xs text-slate-500">{staff.email}</p>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{staff.completed} / {staff.total}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={
                        staff.avgScore >= 90 ? 'success' :
                        staff.avgScore >= 80 ? 'info' :
                        staff.avgScore >= 70 ? 'warning' :
                        'destructive'
                      }>
                        {staff.avgScore}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {staff.overdue > 0 ? (
                        <Badge variant="destructive">{staff.overdue}</Badge>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {isExcellent ? (
                        <Badge variant="success">
                          <Award className="w-3 h-3 mr-1" />
                          Excellent
                        </Badge>
                      ) : isAtRisk ? (
                        <Badge variant="warning">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          At Risk
                        </Badge>
                      ) : (
                        <Badge variant="info">
                          <TrendingUp className="w-3 h-3 mr-1" />
                          On Track
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}