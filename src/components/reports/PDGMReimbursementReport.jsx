import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, DollarSign } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { exportToPDF } from "../utils/pdfExporter";
import { format } from "date-fns";

export default function PDGMReimbursementReport({ dateRange }) {
  const { data: oasisAssessments = [] } = useQuery({
    queryKey: ['allOASISAssessments'],
    // Without a limit Base44 caps at 50, truncating the reimbursement totals.
    queryFn: () => base44.entities.OASISAssessment.list('-created_date', 10000),
    initialData: [],
  });

  const filteredOASIS = oasisAssessments.filter(o => {
    const date = new Date(o.assessment_date);
    return date >= new Date(dateRange.start) && date <= new Date(dateRange.end + 'T23:59:59.999');
  });

  // Simulate PDGM case mix groups
  const caseMixData = [
    { group: 'LPTA', count: Math.floor(filteredOASIS.length * 0.25), avgReimbursement: 3200 },
    { group: 'LTA', count: Math.floor(filteredOASIS.length * 0.20), avgReimbursement: 2800 },
    { group: 'MMTA', count: Math.floor(filteredOASIS.length * 0.30), avgReimbursement: 2500 },
    { group: 'MTA', count: Math.floor(filteredOASIS.length * 0.15), avgReimbursement: 2200 },
    { group: 'LTA-NRS', count: Math.floor(filteredOASIS.length * 0.10), avgReimbursement: 1900 }
  ];

  const totalReimbursement = caseMixData.reduce((sum, item) => sum + (item.count * item.avgReimbursement), 0);
  const avgReimbursement = filteredOASIS.length > 0 ? (totalReimbursement / filteredOASIS.length).toFixed(0) : 0;

  const COLORS = ['#8b5cf6', '#3557b0', '#10b981', '#f59e0b', '#ef4444'];

  const handleExport = () => {
    exportToPDF({
      filename: `pdgm-reimbursement-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
      title: 'PDGM Reimbursement Report',
      subtitle: `Period: ${format(new Date(dateRange.start), 'MMM d, yyyy')} - ${format(new Date(dateRange.end + 'T23:59:59.999'), 'MMM d, yyyy')}`,
      content: [
        { type: 'heading', text: 'Reimbursement Summary' },
        { type: 'text', text: `Total Estimated Revenue: $${totalReimbursement.toLocaleString()}` },
        { type: 'text', text: `Average per Episode: $${avgReimbursement}` },
        { type: 'spacer' },
        { type: 'heading', text: 'Case Mix Distribution' },
        { type: 'table', data: caseMixData, columns: [
          { header: 'PDGM Group', key: 'group' },
          { header: 'Count', key: 'count' },
          { header: 'Avg Reimbursement', key: 'avgReimbursement' }
        ]}
      ]
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-semibold text-slate-900">PDGM Reimbursement Analysis</h3>
        <Button onClick={handleExport} className="bg-emerald-600 hover:bg-emerald-700">
          <Download className="w-4 h-4 mr-2" />
          Export PDF
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Total Episodes</p>
            <p className="text-3xl font-bold text-slate-900">{filteredOASIS.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              <p className="text-sm text-slate-600">Estimated Revenue</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600">${totalReimbursement.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Avg per Episode</p>
            <p className="text-3xl font-bold text-blue-600">${avgReimbursement}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Case Mix Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={caseMixData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={entry => `${entry.group}: ${entry.count}`}
                  outerRadius={100}
                  fill="#264491"
                  dataKey="count"
                >
                  {caseMixData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Average Reimbursement by Group</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={caseMixData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="group" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="avgReimbursement" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}