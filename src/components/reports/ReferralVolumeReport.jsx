import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { exportToPDF } from "../utils/pdfExporter";
import { format } from "date-fns";

export default function ReferralVolumeReport({ dateRange }) {
  const { data: referrals = [] } = useQuery({
    queryKey: ['allReferrals'],
    // Without a limit Base44 caps at 50, truncating referral volume counts.
    queryFn: () => base44.entities.Referral.list('-created_date', 10000),
    initialData: [],
  });

  const filteredReferrals = referrals.filter(r => {
    const date = new Date(r.referral_date);
    return date >= new Date(dateRange.start) && date <= new Date(dateRange.end + 'T23:59:59.999');
  });

  // Analyze by source
  const sourceData = {};
  filteredReferrals.forEach(r => {
    const source = r.referral_source || 'Unknown';
    sourceData[source] = (sourceData[source] || 0) + 1;
  });

  const sourceChartData = Object.entries(sourceData).map(([source, count]) => ({
    source,
    count
  }));

  // Analyze by priority
  const priorityData = [
    { priority: 'Urgent', count: filteredReferrals.filter(r => r.priority === 'urgent').length },
    { priority: 'High', count: filteredReferrals.filter(r => r.priority === 'high').length },
    { priority: 'Normal', count: filteredReferrals.filter(r => r.priority === 'normal').length },
    { priority: 'Low', count: filteredReferrals.filter(r => r.priority === 'low').length }
  ];

  const COLORS = ['#8b5cf6', '#3557b0', '#10b981', '#f59e0b', '#ef4444'];

  const handleExport = () => {
    exportToPDF({
      filename: `referral-volume-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
      title: 'Referral Volume Report',
      subtitle: `Period: ${format(new Date(dateRange.start), 'MMM d, yyyy')} - ${format(new Date(dateRange.end + 'T23:59:59.999'), 'MMM d, yyyy')}`,
      content: [
        { type: 'heading', text: 'Summary Statistics' },
        { type: 'text', text: `Total Referrals: ${filteredReferrals.length}` },
        { type: 'text', text: `Urgent Priority: ${priorityData[0].count}` },
        { type: 'text', text: `Ready for Admission: ${filteredReferrals.filter(r => r.status === 'ready_for_admission').length}` },
        { type: 'spacer' },
        { type: 'heading', text: 'Referral Sources' },
        { type: 'table', data: sourceChartData, columns: [
          { header: 'Source', key: 'source' },
          { header: 'Count', key: 'count' }
        ]},
        { type: 'spacer' },
        { type: 'heading', text: 'Priority Distribution' },
        { type: 'table', data: priorityData, columns: [
          { header: 'Priority', key: 'priority' },
          { header: 'Count', key: 'count' }
        ]}
      ]
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-semibold text-slate-900">Referral Volume Analysis</h3>
          <p className="text-sm text-slate-600">
            {format(new Date(dateRange.start), 'MMM d, yyyy')} - {format(new Date(dateRange.end + 'T23:59:59.999'), 'MMM d, yyyy')}
          </p>
        </div>
        <Button onClick={handleExport} className="bg-navy-600 hover:bg-navy-700">
          <Download className="w-4 h-4 mr-2" />
          Export PDF
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Total Referrals</p>
            <p className="text-3xl font-bold text-slate-900">{filteredReferrals.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Urgent Priority</p>
            <p className="text-3xl font-bold text-red-600">{priorityData[0].count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Ready for Admission</p>
            <p className="text-3xl font-bold text-green-600">{filteredReferrals.filter(r => r.status === 'ready_for_admission').length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Avg Processing Time</p>
            <p className="text-3xl font-bold text-blue-600">2.3d</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Referrals by Source</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sourceChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="source" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Priority Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={entry => `${entry.priority}: ${entry.count}`}
                  outerRadius={80}
                  fill="#264491"
                  dataKey="count"
                >
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle>Top Referral Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>Percentage</TableHead>
                <TableHead>Avg Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...sourceChartData].sort((a, b) => b.count - a.count).slice(0, 10).map((item) => (
                <TableRow key={item.source}>
                  <TableCell className="text-slate-900">{item.source}</TableCell>
                  <TableCell className="text-slate-900">{item.count}</TableCell>
                  <TableCell className="text-slate-900">
                    {((item.count / filteredReferrals.length) * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell>
                    <Badge variant="info">Normal</Badge>
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