import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { exportToPDF } from "../utils/pdfExporter";
import { computeTurnaround } from "../referral/intakeToSocTracker";
import { format } from "date-fns";
import { toast } from 'sonner';
import { parseLocalDate } from '@/lib/dateLocal';
import ReportReadState from '@/components/analytics/ReportReadState';
import { reportRangeAvailable } from '@/components/analytics/reportReadContracts';
import useReferralReportRows from './useReferralReportRows';

// Most-severe-first so dominant-priority ties resolve to the more urgent level.
const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];
const PRIORITY_BADGE_VARIANT = { urgent: 'destructive', high: 'warning', normal: 'info', low: 'secondary' };

const dominantPriority = (priorities = {}) => {
  let best = null;
  for (const p of PRIORITY_ORDER) {
    const count = priorities[p] || 0;
    if (count > 0 && (best === null || count > (priorities[best] || 0))) best = p;
  }
  return best || 'unclassified';
};

export default function ReferralVolumeReport({ dateRange }) {
  const rangeAvailable = reportRangeAvailable(dateRange?.start, dateRange?.end);
  const referralQuery = useReferralReportRows({ enabled: rangeAvailable });
  if (!referralQuery.scopeAvailable) return <p role="status">Select an authorized agency before viewing referral reports.</p>;
  if (!rangeAvailable) return <p role="alert">Choose a valid date range covering at most 366 calendar days.</p>;
  if (!referralQuery.isSuccess || referralQuery.isError) return <ReportReadState queries={[referralQuery]} title="Referral report data" />;
  if (referralQuery.capped) return <div role="status" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
    <p>A source reached its record limit. A complete referral report cannot be verified, so totals and exports are unavailable.</p>
    <Button disabled>Export PDF</Button>
  </div>;
  const referrals = referralQuery.data;
  const undated = referrals.filter(row => !parseLocalDate(row.referral_date)).length;

  const filteredReferrals = referrals.filter(r => {
    // referral_date is an unconstrained string (AI-extracted, may be
    // "07/03/2026" or a full ISO timestamp). Anchor date-ONLY values to local
    // midnight; parse anything else as-is — appending "T00:00:00" to a
    // non-date-only value makes an invalid date and drops the referral.
    const date = parseLocalDate(r.referral_date);
    if (!date) return false;
    return date >= new Date(dateRange.start + 'T00:00:00') && date <= new Date(dateRange.end + 'T23:59:59.999');
  });

  // Analyze by source: volume, priority mix, and conversion to start of care.
  const sourceData = new Map();
  filteredReferrals.forEach(r => {
    const source = r.referral_source || 'Unknown';
    if (!sourceData.has(source)) sourceData.set(source, { count: 0, socCompleted: 0, priorities: Object.create(null) });
    const s = sourceData.get(source);
    s.count += 1;
    if (r.status === 'soc_completed') s.socCompleted += 1;
    const priority = r.priority || 'normal';
    s.priorities[priority] = (s.priorities[priority] || 0) + 1;
  });

  const sourceChartData = [...sourceData.entries()].map(([source, data]) => ({
    source,
    count: data.count,
    socCompleted: data.socCompleted,
    priorities: data.priorities,
    conversion: `${((data.socCompleted / data.count) * 100).toFixed(0)}%`,
  }));

  // Real referral→SOC turnaround (replaces the old hardcoded placeholder):
  // averaged over referrals in the period that reached a start-of-care date.
  const turnarounds = filteredReferrals
    .filter(r => r.soc_date || r.first_visit_date)
    .map(r => computeTurnaround(r))
    .filter(t => t.completed && t.turnaround_days != null);
  const avgTurnaroundDays = turnarounds.length > 0
    ? Math.round((turnarounds.reduce((sum, t) => sum + t.turnaround_days, 0) / turnarounds.length) * 10) / 10
    : null;

  // Analyze by priority
  const priorityData = [
    { priority: 'Urgent', count: filteredReferrals.filter(r => r.priority === 'urgent').length },
    { priority: 'High', count: filteredReferrals.filter(r => r.priority === 'high').length },
    { priority: 'Normal', count: filteredReferrals.filter(r => !r.priority || r.priority === 'normal').length },
    { priority: 'Low', count: filteredReferrals.filter(r => r.priority === 'low').length },
    { priority: 'Unclassified', count: filteredReferrals.filter(r => r.priority && !PRIORITY_ORDER.includes(r.priority)).length }
  ];

  const COLORS = ['#8b5cf6', '#3557b0', '#10b981', '#f59e0b', '#ef4444'];

  const handleExport = async () => {
    if (undated) return;
    try {
      await exportToPDF({
      filename: `referral-volume-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
      title: 'Referral Volume Report',
      subtitle: `Period: ${format(parseLocalDate(dateRange.start), 'MMM d, yyyy')} - ${format(parseLocalDate(dateRange.end), 'MMM d, yyyy')}`,
      content: [
        { type: 'heading', text: 'Summary Statistics' },
        { type: 'text', text: `Total Referrals: ${filteredReferrals.length}` },
        { type: 'text', text: `Urgent Priority: ${priorityData[0].count}` },
        { type: 'text', text: `Ready for Admission: ${filteredReferrals.filter(r => r.status === 'ready_for_admission').length}` },
        { type: 'text', text: `Avg Referral-to-SOC Turnaround: ${avgTurnaroundDays != null ? `${avgTurnaroundDays} days` : 'no completed referrals yet'}` },
        { type: 'spacer' },
        { type: 'heading', text: 'Referral Sources' },
        { type: 'table', data: sourceChartData, columns: [
          { header: 'Source', key: 'source' },
          { header: 'Count', key: 'count' },
          { header: 'SOC Conversion', key: 'conversion' }
        ]},
        { type: 'spacer' },
        { type: 'heading', text: 'Priority Distribution' },
        { type: 'table', data: priorityData, columns: [
          { header: 'Priority', key: 'priority' },
          { header: 'Count', key: 'count' }
        ]}
      ]
      });
    } catch {
      toast.error('The report could not be downloaded. Please try again.');
    }
  };

  return (
    <div className="space-y-6">
      {undated > 0 && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4">{undated} referral record(s) have no valid referral date. The displayed totals exclude them; export is unavailable until those dates are verified.</p>}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-semibold text-slate-900">Referral Volume Analysis</h3>
          <p className="text-sm text-slate-600">
            {format(parseLocalDate(dateRange.start), 'MMM d, yyyy')} - {format(parseLocalDate(dateRange.end), 'MMM d, yyyy')}
          </p>
        </div>
        <Button onClick={handleExport} disabled={undated > 0} className="bg-navy-600 hover:bg-navy-700">
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
            <p className="text-3xl font-bold text-blue-600">
              {avgTurnaroundDays != null ? `${avgTurnaroundDays}d` : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {avgTurnaroundDays != null
                ? `referral → start of care (${turnarounds.length} completed)`
                : 'no completed referrals yet'}
            </p>
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
                <TableHead>Dominant Priority</TableHead>
                <TableHead>SOC Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...sourceChartData].sort((a, b) => b.count - a.count).slice(0, 10).map((item) => {
                const dominant = dominantPriority(item.priorities);
                const mix = PRIORITY_ORDER.filter(p => item.priorities[p])
                  .map(p => `${item.priorities[p]} ${p}`)
                  .join(' · ');
                const isMixed = Object.keys(item.priorities).length > 1;
                return (
                  <TableRow key={item.source}>
                    <TableCell className="text-slate-900">{item.source}</TableCell>
                    <TableCell className="text-slate-900">{item.count}</TableCell>
                    <TableCell className="text-slate-900">
                      {((item.count / filteredReferrals.length) * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell>
                      <Badge variant={PRIORITY_BADGE_VARIANT[dominant] || 'info'} className="capitalize">
                        {dominant}
                      </Badge>
                      {isMixed && <p className="text-xs text-slate-500 mt-1">{mix}</p>}
                    </TableCell>
                    <TableCell className="text-slate-900">
                      {item.conversion}
                      <span className="text-xs text-slate-500 ml-1">({item.socCompleted}/{item.count})</span>
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
