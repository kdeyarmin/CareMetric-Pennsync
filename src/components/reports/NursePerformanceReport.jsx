import { base44 } from "@/api/base44Client";
import { agencyQueryKey } from '@/lib/agencyRoster';
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Download, Award } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { exportToPDF } from "../utils/pdfExporter";
import { format } from "date-fns";
import { toast } from 'sonner';
import { isAdminView } from '@/lib/roles';
import { parseLocalDate } from '@/lib/dateLocal';
import { ALL_ROWS } from '@/lib/queryLimits';
import { isCallerAgencyScoped } from '@/lib/agencyScope';
import AccessDeniedState from '@/components/ui/AccessDeniedState';
import ReportReadState from '@/components/analytics/ReportReadState';
import { readReportRows, reportRangeAvailable, measuredAverage, displayMeasurement, REPORT_READ_OPTIONS } from '@/components/analytics/reportReadContracts';

export default function NursePerformanceReport({ dateRange }) {
  const userQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    ...REPORT_READ_OPTIONS,
  });
  const currentUser = userQuery.isSuccess ? userQuery.data : null;
  const isAdmin = isAdminView(currentUser);
  const authorityAvailable = Boolean(agencyQueryKey(currentUser)) && isCallerAgencyScoped(currentUser);
  const rangeAvailable = reportRangeAvailable(dateRange?.start, dateRange?.end);
  const notesQuery = useQuery({
    queryKey: ['allNoteConversions', 'nurse-report', agencyQueryKey(currentUser)],
    queryFn: async () => readReportRows(await base44.entities.NoteConversion.list('-created_date', ALL_ROWS), 'notes'),
    enabled: isAdmin && authorityAvailable && rangeAvailable,
    ...REPORT_READ_OPTIONS,
  });

  const auditsQuery = useQuery({
    queryKey: ['allComplianceAudits', 'nurse-report', agencyQueryKey(currentUser)],
    queryFn: async () => {
      const rows = readReportRows(await base44.entities.ComplianceAudit.list('-created_date', ALL_ROWS), 'audits');
      if (rows.some(row => row.status != null && !['passed', 'flagged', 'critical', 'pending_review'].includes(row.status))) throw new Error('REPORT_READ_INVALID');
      return rows;
    },
    enabled: isAdmin && authorityAvailable && rangeAvailable,
    ...REPORT_READ_OPTIONS,
  });

  const usersQuery = useQuery({
    queryKey: ['allUsers', 'nurse-report', ALL_ROWS, agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = readReportRows(await base44.entities.User.list('-created_date', ALL_ROWS), 'users');
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return { rows: filterUsersByCallerAgency(_rows, currentUser), capped: _rows.length >= ALL_ROWS };
    },
    enabled: isAdmin && authorityAvailable && rangeAvailable,
    ...REPORT_READ_OPTIONS,
  });

  if (!userQuery.isSuccess || userQuery.isError) return <ReportReadState queries={[userQuery]} title="Report access" />;
  if (!isAdmin) return <AccessDeniedState description="Nurse reports are available to administrators only." />;
  if (!authorityAvailable) return <p role="status">Select an authorized agency before viewing nurse reports.</p>;
  if (!rangeAvailable) return <p role="alert">Choose a valid date range covering at most 366 calendar days.</p>;
  const queries = [notesQuery, auditsQuery, usersQuery];
  if (!queries.every(query => query.isSuccess && !query.isError)) return <ReportReadState queries={queries} title="Nurse performance data" />;
  const noteConversions = notesQuery.data;
  const complianceAudits = auditsQuery.data;
  const users = usersQuery.data.rows;
  if (noteConversions.length >= ALL_ROWS || complianceAudits.length >= ALL_ROWS || usersQuery.data.capped) {
    return <div role="status" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p>A source reached its record limit. A complete nurse report cannot be verified, so totals and exports are unavailable.</p>
      <Button disabled>Export PDF</Button>
    </div>;
  }
  const nurses = users.filter(u => u.role !== 'admin');

  const filteredVisits = noteConversions.filter(nc => {
    const date = parseLocalDate(nc.created_date);
    return date >= new Date(dateRange.start + 'T00:00:00') && date <= new Date(dateRange.end + 'T23:59:59.999');
  });

  const filteredAudits = complianceAudits.filter(a => {
    const date = parseLocalDate(a.audit_date || a.created_date);
    return date >= new Date(dateRange.start + 'T00:00:00') && date <= new Date(dateRange.end + 'T23:59:59.999');
  });

  // These records measure note enhancements, not distinct completed visits.
  const nurseMetrics = nurses.map(nurse => {
    const nurseVisits = filteredVisits.filter(nc => nc.nurse_email === nurse.email);
    const nurseAudits = filteredAudits.filter(a => a.nurse_email === nurse.email);
    
    const completedVisits = nurseVisits.length;
    const avgComplianceScore = measuredAverage(nurseAudits, audit => audit.compliance_score);
    
    const passedAudits = nurseAudits.filter(a => a.status === 'passed').length;
    const reviewedAudits = nurseAudits.filter(a => ['passed', 'flagged', 'critical'].includes(a.status));
    const auditPassRate = reviewedAudits.length ? (passedAudits / reviewedAudits.length) * 100 : null;

    return {
      name: nurse.full_name || nurse.email,
      email: nurse.email,
      completedVisits,
      complianceMeasurement: avgComplianceScore,
      avgComplianceScore: displayMeasurement(avgComplianceScore, '%'),
      auditPassRate: displayMeasurement(auditPassRate, '%'),
      totalAudits: nurseAudits.length
    };
  }).sort((a, b) => b.completedVisits - a.completedVisits);

  const handleExport = async () => {
    try {
      await exportToPDF({
      filename: `nurse-performance-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
      title: 'Nurse Performance Report',
      subtitle: `Period: ${format(new Date(dateRange.start + 'T00:00:00'), 'MMM d, yyyy')} - ${format(new Date(dateRange.end + 'T23:59:59.999'), 'MMM d, yyyy')}`,
      content: [
        { type: 'heading', text: 'Performance Metrics' },
        { type: 'table', data: nurseMetrics, columns: [
          { header: 'Nurse', key: 'name' },
          { header: 'Notes Enhanced', key: 'completedVisits' },
          { header: 'Compliance', key: 'avgComplianceScore' },
          { header: 'Pass Rate', key: 'auditPassRate' }
        ]}
      ]
      });
    } catch {
      toast.error('The report could not be downloaded. Please try again.');
    }
  };

  const topPerformer = nurseMetrics.find(nurse => nurse.completedVisits > 0);
  const totalVisits = nurseMetrics.reduce((sum, n) => sum + n.completedVisits, 0);
  const totalTimeSavedMinutes = totalVisits * 20;
  const totalTimeSavedHours = Math.floor(totalTimeSavedMinutes / 60);
  const remainingMinutes = totalTimeSavedMinutes % 60;
  const timeSavedDisplay = totalTimeSavedHours > 0 
    ? `${totalTimeSavedHours}h ${remainingMinutes}m` 
    : `${totalTimeSavedMinutes}m`;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-semibold text-slate-900">Nurse Performance Analysis</h3>
          <p className="text-sm text-slate-600">
            {format(new Date(dateRange.start + 'T00:00:00'), 'MMM d, yyyy')} - {format(new Date(dateRange.end + 'T23:59:59.999'), 'MMM d, yyyy')}
          </p>
        </div>
        <Button onClick={handleExport} >
          <Download className="w-4 h-4 mr-2" />
          Export PDF
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-2">
              <Award className="w-8 h-8 text-orange-600" />
              <div>
                <p className="text-sm text-slate-600">Top Performer</p>
                <p className="text-lg font-bold text-slate-900">{topPerformer?.name || 'No activity in this period'}</p>
                {topPerformer && <p className="text-xs text-slate-500">{topPerformer.completedVisits} notes enhanced</p>}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Total Notes Enhanced</p>
            <p className="text-3xl font-bold text-slate-900">{totalVisits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Estimated Time Saved</p>
            <p className="text-3xl font-bold text-slate-900">{timeSavedDisplay}</p>
            <p className="text-xs text-slate-500 mt-1">Assumes 20 minutes per note; not measured time.</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Card>
        <CardHeader>
          <CardTitle>Notes Enhanced by Nurse</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={nurseMetrics.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="completedVisits" fill="#f97316" name="Notes Enhanced" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detailed Performance Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Performance Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Nurse</TableHead>
                <TableHead>Notes Enhanced</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead>Pass Rate</TableHead>
                <TableHead>Performance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nurseMetrics.map((nurse, index) => (
                <TableRow key={nurse.email}>
                  <TableCell className="font-semibold text-slate-900">
                    {index === 0 && nurse.completedVisits > 0 && <Award className="w-4 h-4 text-gold-500 inline mr-1" />}
                    #{index + 1}
                  </TableCell>
                  <TableCell className="text-slate-900">{nurse.name}</TableCell>
                  <TableCell className="text-slate-900">{nurse.completedVisits}</TableCell>
                  <TableCell className="text-slate-900">{nurse.avgComplianceScore}</TableCell>
                  <TableCell className="text-slate-900">{nurse.auditPassRate}</TableCell>
                  <TableCell>
                    <Badge variant={
                      nurse.complianceMeasurement === null ? 'secondary' :
                      parseFloat(nurse.avgComplianceScore) >= 90 ? 'success' :
                      parseFloat(nurse.avgComplianceScore) >= 80 ? 'info' :
                      parseFloat(nurse.avgComplianceScore) >= 70 ? 'warning' :
                      'destructive'
                    }>
                      {nurse.complianceMeasurement === null ? 'Not measured' :
                       parseFloat(nurse.avgComplianceScore) >= 90 ? 'Excellent' :
                       parseFloat(nurse.avgComplianceScore) >= 80 ? 'Good' :
                       parseFloat(nurse.avgComplianceScore) >= 70 ? 'Fair' : 'Needs Improvement'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
