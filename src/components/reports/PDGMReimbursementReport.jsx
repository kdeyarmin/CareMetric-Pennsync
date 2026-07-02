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

  // Parse both bounds on the same (local) clock so the start boundary isn't
  // shifted into the prior evening (date-only strings parse as UTC midnight).
  const rangeStart = new Date(dateRange.start + 'T00:00:00');
  const rangeEnd = new Date(dateRange.end + 'T23:59:59.999');
  const filteredOASIS = oasisAssessments.filter(o => {
    const date = new Date(o.assessment_date);
    return date >= rangeStart && date <= rangeEnd;
  });

  // ILLUSTRATIVE SAMPLE ONLY — these case-mix proportions and per-group dollar
  // amounts are assumed placeholders, NOT derived from any patient's actual PDGM
  // data. Real PDGM reimbursement must come from the backend calculatePDGM
  // function using the agency's CMS case-mix data (see pdgmGrouper.js). These
  // figures are labelled illustrative on screen and excluded from the exported
  // PDF so they are never mistaken for authoritative reimbursement numbers.
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
    // Export ONLY truthful data (the real OASIS episode count). The case-mix
    // distribution and reimbursement dollars shown on screen are illustrative
    // placeholders (assumed proportions + placeholder rates), so they are
    // deliberately excluded here — an exported "reimbursement" PDF must not
    // present fabricated dollar amounts as authoritative.
    exportToPDF({
      filename: `pdgm-episode-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
      title: 'PDGM Episode Report',
      subtitle: `Period: ${format(rangeStart, 'MMM d, yyyy')} - ${format(rangeEnd, 'MMM d, yyyy')}`,
      content: [
        { type: 'heading', text: 'Episode Summary' },
        { type: 'text', text: `Total OASIS Episodes: ${filteredOASIS.length}` },
        { type: 'spacer' },
        { type: 'text', text: 'Note: PDGM case-mix distribution and reimbursement estimates are illustrative sample figures only and are intentionally excluded from this report. Actual PDGM reimbursement must be derived from the agency’s CMS case-mix data.' }
      ]
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-semibold text-slate-900">PDGM Case-Mix Analysis (Illustrative)</h3>
        <Button onClick={handleExport} >
          <Download className="w-4 h-4 mr-2" />
          Export PDF
        </Button>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Illustrative sample only — not for billing.</strong> The case-mix
        distribution and reimbursement dollars below use assumed proportions and
        placeholder per-group rates, not any patient&apos;s actual PDGM data.
        Actual reimbursement must be derived from the agency&apos;s CMS case-mix
        data. These figures are excluded from the exported PDF.
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
              <p className="text-sm text-slate-600">Illustrative Revenue</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600">${totalReimbursement.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1">Sample estimate — not actual reimbursement</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Illustrative Avg / Episode</p>
            <p className="text-3xl font-bold text-blue-600">${avgReimbursement}</p>
            <p className="text-xs text-slate-500 mt-1">Sample estimate — not actual reimbursement</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Case Mix Distribution (Illustrative)</CardTitle>
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
            <CardTitle>Average Reimbursement by Group (Illustrative)</CardTitle>
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