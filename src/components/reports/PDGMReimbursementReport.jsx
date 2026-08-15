import { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import FinancialGate from "@/components/ui/FinancialGate";
import { Download, DollarSign, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { exportToPDF } from "../utils/pdfExporter";
import { format } from "date-fns";

export default function PDGMReimbursementReport({ dateRange }) {
  const { data: oasisAssessments = [] } = useAgencyScopedQuery({
    queryKey: ['allOASISAssessments'],
    // Without a limit Base44 caps at 50, truncating the reimbursement totals.
    fetch: () => base44.entities.OASISAssessment.list('-created_date', 10000),
    initialData: [],
  });

  // Real per-assessment PDGM engine estimates, via listOASISUploads — the same
  // existing function DocumentationImpact uses. It strips financial fields
  // server-side for non-financial users, so estimated_payment only arrives for
  // admins (FinancialGate below is defense-in-depth on the rendered figures).
  // Scoped server-side to the report's assessment-date range — date-filtering a
  // newest-N page undercounts any period holding more than N uploads.
  const UPLOADS_LIMIT = 1000;
  const { data: uploadsResp = {} } = useQuery({
    queryKey: ["oasis-uploads-pdgm-report", dateRange.start, dateRange.end],
    queryFn: async () => (await base44.functions.invoke("listOASISUploads", {
      sort: "-created_date",
      limit: UPLOADS_LIMIT,
      assessmentDateFrom: dateRange.start,
      assessmentDateTo: dateRange.end,
    }))?.data || {},
    initialData: {},
  });
  // A full page means the range may hold more rows than the bounded fetch —
  // say so rather than presenting a silently undercounted total.
  const uploadsMaybeTruncated = (uploadsResp.uploads?.length || 0) >= UPLOADS_LIMIT;

  // Parse both bounds on the same (local) clock so the start boundary isn't
  // shifted into the prior evening (date-only strings parse as UTC midnight).
  const rangeStart = new Date(dateRange.start + 'T00:00:00');
  const rangeEnd = new Date(dateRange.end + 'T23:59:59.999');
  const filteredOASIS = oasisAssessments.filter(o => {
    // Parse the date-only assessment_date on the local clock too, so a boundary-day
    // episode isn't shifted into the prior evening and dropped from the report.
    const date = new Date(o.assessment_date + 'T00:00:00');
    return date >= rangeStart && date <= rangeEnd;
  });

  // Analyzed assessments carrying a real engine estimate, within the range.
  const analyzed = useMemo(() => {
    const uploads = Array.isArray(uploadsResp.uploads) ? uploadsResp.uploads : [];
    const start = new Date(dateRange.start + 'T00:00:00');
    const end = new Date(dateRange.end + 'T23:59:59.999');
    return uploads.filter((u) => {
      if (!Number.isFinite(u?.estimated_payment) || u.estimated_payment <= 0 || !u?.assessment_date) return false;
      const d = new Date(u.assessment_date + 'T00:00:00');
      return d >= start && d <= end;
    });
  }, [uploadsResp, dateRange.start, dateRange.end]);

  // Prefer REAL data: when analyzed assessments exist in range, the report shows
  // the engine's per-patient estimates (captured at analysis time by the
  // canonical calculatePDGM) instead of the illustrative sample.
  const usingReal = analyzed.length > 0;

  const realTotal = useMemo(() => analyzed.reduce((s, u) => s + u.estimated_payment, 0), [analyzed]);
  const realCaseMix = useMemo(() => {
    const m = new Map();
    for (const u of analyzed) {
      const g = u?.pdgm_data?.clinical_group || "Ungrouped";
      const e = m.get(g) || { group: g, count: 0, total: 0 };
      e.count += 1;
      e.total += u.estimated_payment;
      m.set(g, e);
    }
    return Array.from(m.values())
      .map((e) => ({ group: e.group, count: e.count, avgReimbursement: Math.round(e.total / e.count) }))
      .sort((a, b) => b.count - a.count);
  }, [analyzed]);

  // ILLUSTRATIVE SAMPLE ONLY (fallback when no analyzed assessments exist) —
  // these case-mix proportions and per-group dollar amounts are assumed
  // placeholders, NOT derived from any patient's actual PDGM data. Real PDGM
  // reimbursement must come from the backend calculatePDGM function using the
  // agency's CMS case-mix data (see pdgmGrouper.js). These figures carry an
  // unmissable banner on screen and are excluded from the exported PDF so they
  // are never mistaken for authoritative reimbursement numbers.
  const illustrativeCaseMix = [
    { group: 'LPTA', count: Math.floor(filteredOASIS.length * 0.25), avgReimbursement: 3200 },
    { group: 'LTA', count: Math.floor(filteredOASIS.length * 0.20), avgReimbursement: 2800 },
    { group: 'MMTA', count: Math.floor(filteredOASIS.length * 0.30), avgReimbursement: 2500 },
    { group: 'MTA', count: Math.floor(filteredOASIS.length * 0.15), avgReimbursement: 2200 },
    { group: 'LTA-NRS', count: Math.floor(filteredOASIS.length * 0.10), avgReimbursement: 1900 }
  ];

  const caseMixData = usingReal ? realCaseMix : illustrativeCaseMix;
  const totalReimbursement = usingReal
    ? Math.round(realTotal)
    : illustrativeCaseMix.reduce((sum, item) => sum + (item.count * item.avgReimbursement), 0);
  const avgReimbursement = usingReal
    ? (analyzed.length > 0 ? (realTotal / analyzed.length).toFixed(0) : 0)
    : (filteredOASIS.length > 0 ? (totalReimbursement / filteredOASIS.length).toFixed(0) : 0);

  const COLORS = ['#8b5cf6', '#3557b0', '#10b981', '#f59e0b', '#ef4444'];

  const handleExport = () => {
    // Export ONLY truthful data (the real OASIS episode count). The on-screen
    // reimbursement dollars are either illustrative placeholders or point-in-time
    // engine estimates, so both stay deliberately excluded here — an exported
    // "reimbursement" PDF must not present estimated or fabricated dollar
    // amounts as authoritative.
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

  const body = (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Total Episodes</p>
            <p className="text-3xl font-bold text-slate-900">{filteredOASIS.length}</p>
            {usingReal && (
              <p className="text-xs text-slate-500 mt-1">{analyzed.length} analyzed with a PDGM estimate</p>
            )}
            {uploadsMaybeTruncated && (
              <p className="text-xs text-amber-700 mt-1">
                Showing the newest {UPLOADS_LIMIT} analyzed assessments in this range — engine totals may undercount. Narrow the date range for complete figures.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              <p className="text-sm text-slate-600">{usingReal ? 'Estimated Revenue (engine)' : 'Illustrative Revenue'}</p>
            </div>
            <p className="text-3xl font-bold text-emerald-600">${totalReimbursement.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1">
              {usingReal ? 'PDGM engine estimate — not billed/actual reimbursement' : 'Sample estimate — not actual reimbursement'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">{usingReal ? 'Est. Avg / Analyzed Episode' : 'Illustrative Avg / Episode'}</p>
            <p className="text-3xl font-bold text-blue-600">${avgReimbursement}</p>
            <p className="text-xs text-slate-500 mt-1">
              {usingReal ? 'PDGM engine estimate — not billed/actual reimbursement' : 'Sample estimate — not actual reimbursement'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Case Mix Distribution {usingReal ? '(Engine estimates)' : '(Illustrative)'}</CardTitle>
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
            <CardTitle>Average {usingReal ? 'Estimated Payment' : 'Reimbursement'} by Group {usingReal ? '(Engine estimates)' : '(Illustrative)'}</CardTitle>
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
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-semibold text-slate-900">
          PDGM Case-Mix Analysis{usingReal ? '' : ' (Illustrative)'}
        </h3>
        <Button onClick={handleExport} >
          <Download className="w-4 h-4 mr-2" />
          Export PDF
        </Button>
      </div>

      {usingReal ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <strong>PDGM engine estimates — not billed reimbursement.</strong> Figures come from each
          assessment&apos;s estimated payment captured at analysis time by the agency&apos;s PDGM
          calculation ({analyzed.length} analyzed assessment{analyzed.length === 1 ? '' : 's'} in
          this period). Dollar figures are excluded from the exported PDF.
        </div>
      ) : (
        // Unmissable: the entire report body below is a fabricated sample until
        // real analyzed assessments exist. Banner, not footnote.
        <div role="alert" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-base font-bold text-amber-900">
                Illustrative sample — every dollar figure and case-mix proportion below is a placeholder, not reimbursement data.
              </p>
              <p className="text-sm text-amber-900 mt-1.5">
                The distribution and per-group dollars use assumed proportions and placeholder rates, not any
                patient&apos;s actual PDGM data — do not use them for billing or forecasting. Real PDGM engine
                estimates replace this sample automatically once OASIS assessments are analyzed. These figures are
                excluded from the exported PDF.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Real engine-estimate dollars are financial data: gate them like every
          other PDGM payment surface (server-side stripping in listOASISUploads
          is the real boundary; this is defense-in-depth). The illustrative
          fallback contains no real financial data. */}
      {usingReal ? <FinancialGate>{body}</FinancialGate> : body}
    </div>
  );
}
