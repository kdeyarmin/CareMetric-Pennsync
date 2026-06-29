import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { exportToPDF } from "../utils/pdfExporter";
import { format } from "date-fns";

export default function OASISComplianceReport({ dateRange }) {
  // Without a limit Base44 caps at 50, truncating the compliance rates below.
  const { data: oasisAssessments = [] } = useQuery({
    queryKey: ['allOASISAssessments'],
    queryFn: () => base44.entities.OASISAssessment.list('-created_date', 10000),
    initialData: [],
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['allComplianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-created_date', 10000),
    initialData: [],
  });

  const filteredOASIS = oasisAssessments.filter(o => {
    const date = new Date(o.assessment_date);
    return date >= new Date(dateRange.start) && date <= new Date(dateRange.end + 'T23:59:59.999');
  });

  const filteredAudits = complianceAudits.filter(a => {
    const date = new Date(a.audit_date);
    return date >= new Date(dateRange.start) && date <= new Date(dateRange.end + 'T23:59:59.999');
  });

  // Calculate metrics
  const totalOASIS = filteredOASIS.length;
  const completedOASIS = filteredOASIS.filter(o => o.status === 'completed').length;
  const completionRate = totalOASIS > 0 ? ((completedOASIS / totalOASIS) * 100).toFixed(1) : 0;
  
  const avgCompletionPercentage = filteredOASIS.length > 0
    ? (filteredOASIS.reduce((sum, o) => sum + (o.completion_percentage || 0), 0) / filteredOASIS.length).toFixed(1)
    : 0;

  const avgComplianceScore = filteredAudits.length > 0
    ? (filteredAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / filteredAudits.length).toFixed(1)
    : 0;

  // Analyze by visit type
  const visitTypeData = [
    { type: 'Start of Care', count: filteredOASIS.filter(o => o.visit_type === 'Start of Care').length },
    { type: 'Resumption', count: filteredOASIS.filter(o => o.visit_type === 'Resumption of Care').length },
    { type: 'Recertification', count: filteredOASIS.filter(o => o.visit_type === 'Recertification').length },
    { type: 'Discharge', count: filteredOASIS.filter(o => o.visit_type === 'Discharge').length }
  ];

  // Monthly trend
  const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
    const date = new Date();
    // Pin to the 1st before shifting months: on the 29th-31st, subtracting a
    // month can overflow into a shorter month (e.g. Mar 31 -> "Feb 31" = Mar 3),
    // which skips and duplicates buckets in the 6-month trend.
    date.setDate(1);
    date.setMonth(date.getMonth() - (5 - i));
    const monthName = date.toLocaleString('default', { month: 'short' });
    
    const monthOASIS = oasisAssessments.filter(o => {
      const oasisDate = new Date(o.assessment_date);
      return oasisDate.getMonth() === date.getMonth() && oasisDate.getFullYear() === date.getFullYear();
    });

    return {
      month: monthName,
      completed: monthOASIS.filter(o => o.status === 'completed').length,
      total: monthOASIS.length
    };
  });

  const handleExport = () => {
    exportToPDF({
      filename: `oasis-compliance-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
      title: 'OASIS Compliance Report',
      subtitle: `Period: ${format(new Date(dateRange.start), 'MMM d, yyyy')} - ${format(new Date(dateRange.end + 'T23:59:59.999'), 'MMM d, yyyy')}`,
      content: [
        { type: 'heading', text: 'Compliance Summary' },
        { type: 'text', text: `Total OASIS Assessments: ${totalOASIS}` },
        { type: 'text', text: `Completed: ${completedOASIS} (${completionRate}%)` },
        { type: 'text', text: `Average Compliance Score: ${avgComplianceScore}%` },
        { type: 'spacer' },
        { type: 'heading', text: 'Visit Type Distribution' },
        { type: 'table', data: visitTypeData, columns: [
          { header: 'Visit Type', key: 'type' },
          { header: 'Count', key: 'count' }
        ]}
      ]
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-semibold text-slate-900">OASIS Compliance Analysis</h3>
          <p className="text-sm text-slate-600">
            {format(new Date(dateRange.start), 'MMM d, yyyy')} - {format(new Date(dateRange.end + 'T23:59:59.999'), 'MMM d, yyyy')}
          </p>
        </div>
        <Button onClick={handleExport} className="bg-indigo-600 hover:bg-indigo-700">
          <Download className="w-4 h-4 mr-2" />
          Export PDF
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Total OASIS</p>
            <p className="text-3xl font-bold text-slate-900">{totalOASIS}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Completion Rate</p>
            <p className="text-3xl font-bold text-indigo-600">{completionRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Avg Completion %</p>
            <p className="text-3xl font-bold text-blue-600">{avgCompletionPercentage}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Avg Compliance</p>
            <p className="text-3xl font-bold text-green-600">{avgComplianceScore}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>OASIS Completion Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="completed" stroke="#264491" strokeWidth={2} name="Completed" />
                <Line type="monotone" dataKey="total" stroke="#94a3b8" strokeWidth={2} name="Total" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>OASIS by Visit Type</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={visitTypeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" angle={-15} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#264491" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Compliance Status */}
      <Card>
        <CardHeader>
          <CardTitle>Compliance Status Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-green-900 mb-1">Excellent (≥90%)</p>
              <p className="text-2xl font-bold text-green-600">
                {filteredAudits.filter(a => a.compliance_score >= 90).length}
              </p>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-yellow-900 mb-1">Good (80-89%)</p>
              <p className="text-2xl font-bold text-yellow-600">
                {filteredAudits.filter(a => a.compliance_score >= 80 && a.compliance_score < 90).length}
              </p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-red-900 mb-1">Needs Improvement (&lt;80%)</p>
              <p className="text-2xl font-bold text-red-600">
                {filteredAudits.filter(a => a.compliance_score < 80).length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}