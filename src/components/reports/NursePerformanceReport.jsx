import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Download, Award } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { exportToPDF } from "../utils/pdfExporter";
import { format } from "date-fns";

export default function NursePerformanceReport({ dateRange }) {
  // Base44 caps un-limited list() at 50 rows; these per-nurse aggregates need the
  // full set or counts/averages are wrong and nurses go missing from the report.
  const { data: noteConversions = [] } = useQuery({
    queryKey: ['allNoteConversions', dateRange.start, dateRange.end],
    queryFn: () => base44.entities.NoteConversion.list('-created_date', 10000),
    initialData: [],
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['allComplianceAudits', dateRange.start, dateRange.end],
    queryFn: () => base44.entities.ComplianceAudit.list('-created_date', 10000),
    initialData: [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list('-created_date', 5000),
    initialData: [],
  });

  const nurses = users.filter(u => u.role !== 'admin');

  const filteredVisits = noteConversions.filter(nc => {
    const date = new Date(nc.created_date);
    return date >= new Date(dateRange.start) && date <= new Date(dateRange.end + 'T23:59:59.999');
  });

  const filteredAudits = complianceAudits.filter(a => {
    const date = new Date(a.audit_date);
    return date >= new Date(dateRange.start) && date <= new Date(dateRange.end + 'T23:59:59.999');
  });

  // Calculate performance metrics per nurse (visits = enhancements)
  const nurseMetrics = nurses.map(nurse => {
    const nurseVisits = filteredVisits.filter(nc => nc.nurse_email === nurse.email);
    const nurseAudits = filteredAudits.filter(a => a.nurse_email === nurse.email);
    
    const completedVisits = nurseVisits.length; // All enhancements are completed visits
    const avgComplianceScore = nurseAudits.length > 0
      ? (nurseAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / nurseAudits.length)
      : 0;
    
    const passedAudits = nurseAudits.filter(a => a.status === 'passed').length;
    const auditPassRate = nurseAudits.length > 0 ? (passedAudits / nurseAudits.length) * 100 : 0;

    return {
      name: nurse.full_name || nurse.email,
      email: nurse.email,
      completedVisits,
      avgComplianceScore: avgComplianceScore.toFixed(1),
      auditPassRate: auditPassRate.toFixed(1),
      totalAudits: nurseAudits.length
    };
  }).sort((a, b) => b.completedVisits - a.completedVisits);

  const handleExport = () => {
    exportToPDF({
      filename: `nurse-performance-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
      title: 'Nurse Performance Report',
      subtitle: `Period: ${format(new Date(dateRange.start), 'MMM d, yyyy')} - ${format(new Date(dateRange.end + 'T23:59:59.999'), 'MMM d, yyyy')}`,
      content: [
        { type: 'heading', text: 'Performance Metrics' },
        { type: 'table', data: nurseMetrics, columns: [
          { header: 'Nurse', key: 'name' },
          { header: 'Visits', key: 'completedVisits' },
          { header: 'Compliance', key: 'avgComplianceScore' },
          { header: 'Pass Rate', key: 'auditPassRate' }
        ]}
      ]
    });
  };

  const topPerformer = nurseMetrics[0];
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
            {format(new Date(dateRange.start), 'MMM d, yyyy')} - {format(new Date(dateRange.end + 'T23:59:59.999'), 'MMM d, yyyy')}
          </p>
        </div>
        <Button onClick={handleExport} className="bg-orange-600 hover:bg-orange-700">
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
                <p className="text-lg font-bold text-slate-900">{topPerformer?.name || 'N/A'}</p>
                <p className="text-xs text-slate-500">{topPerformer?.completedVisits} visits</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Total Visits</p>
            <p className="text-3xl font-bold text-slate-900">{totalVisits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Total Time Saved</p>
            <p className="text-3xl font-bold text-slate-900">{timeSavedDisplay}</p>
            <p className="text-xs text-slate-500 mt-1">{totalVisits} visits × 20 min</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Card>
        <CardHeader>
          <CardTitle>Visits Completed by Nurse</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={nurseMetrics.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="completedVisits" fill="#f97316" name="Completed Visits" />
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
                <TableHead>Visits</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead>Pass Rate</TableHead>
                <TableHead>Performance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nurseMetrics.map((nurse, index) => (
                <TableRow key={nurse.email}>
                  <TableCell className="font-semibold text-slate-900">
                    {index === 0 && <Award className="w-4 h-4 text-gold-500 inline mr-1" />}
                    #{index + 1}
                  </TableCell>
                  <TableCell className="text-slate-900">{nurse.name}</TableCell>
                  <TableCell className="text-slate-900">{nurse.completedVisits}</TableCell>
                  <TableCell className="text-slate-900">{nurse.avgComplianceScore}%</TableCell>
                  <TableCell className="text-slate-900">{nurse.auditPassRate}%</TableCell>
                  <TableCell>
                    <Badge variant={
                      parseFloat(nurse.avgComplianceScore) >= 90 ? 'success' :
                      parseFloat(nurse.avgComplianceScore) >= 80 ? 'info' :
                      parseFloat(nurse.avgComplianceScore) >= 70 ? 'warning' :
                      'destructive'
                    }>
                      {parseFloat(nurse.avgComplianceScore) >= 90 ? 'Excellent' :
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