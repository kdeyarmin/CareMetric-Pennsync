import { Link } from "react-router";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IMPROVEMENT_MEASURES } from "@/components/oasis/outcomeMeasureEngine";
import {
  TrendingUp,
  TrendingDown,
  Users,
  FileText,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  Star,
  ArrowRight
} from "lucide-react";

const KPI_COLOR_CLASSES = {
  purple: { border: "border-l-navy-500", bg: "bg-navy-100", text: "text-navy-700" },
  blue: { border: "border-l-blue-500", bg: "bg-blue-100", text: "text-blue-600" },
  green: { border: "border-l-green-500", bg: "bg-green-100", text: "text-green-600" },
  indigo: { border: "border-l-indigo-500", bg: "bg-indigo-100", text: "text-indigo-600" },
  emerald: { border: "border-l-emerald-500", bg: "bg-emerald-100", text: "text-emerald-600" },
  red: { border: "border-l-red-500", bg: "bg-red-100", text: "text-red-600" },
};

export default function KPIDashboard({ dateRange }) {
  // Base44 list/filter silently cap at 50 rows when no limit is passed, so these
  // KPI aggregates were computed over only the first 50 records — wrong totals and
  // percentages for any agency with more. Pass the SDK's 5000/request max.
  const { data: referrals = [] } = useQuery({
    queryKey: ['allReferrals', dateRange],
    queryFn: () => base44.entities.Referral.list('-created_date', 5000),
    initialData: [],
  });

  const { data: patients = [] } = useScopedPatients({ sort: '-created_date', limit: 5000 });

  const { data: noteConversions = [] } = useQuery({
    queryKey: ['allNoteConversions', dateRange],
    queryFn: () => base44.entities.NoteConversion.list('-created_date', 5000),
    initialData: [],
  });

  const { data: oasisAssessments = [] } = useAgencyScopedQuery({
    queryKey: ['allOASISAssessments', dateRange],
    fetch: () => base44.entities.OASISAssessment.list('-created_date', 5000),
    initialData: [],
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['allComplianceAudits', dateRange],
    queryFn: () => base44.entities.ComplianceAudit.list('-created_date', 5000),
    initialData: [],
  });

  const { data: patientAlerts = [] } = useAgencyScopedQuery({
    queryKey: ['allPatientAlerts'],
    fetch: () => base44.entities.PatientAlert.list('-created_date', 5000),
    initialData: [],
  });

  // Outcome-measure summary (QoPC star proxy). Deliberately NO initialData on
  // these two: the summary card renders an explicit "—" while loading instead
  // of a fabricated "0 of 0" mid-fetch.
  const { data: qualityKpis } = useQuery({
    queryKey: ['outcomeMeasureKpis'],
    queryFn: () => base44.entities.AgencyKPI.filter({ metric_category: 'quality' }, '-period_end', 1000),
  });
  const { data: outcomeMetrics } = useQuery({
    queryKey: ['patientOutcomeMetrics'],
    queryFn: () => base44.entities.PatientOutcomeMetric.filter(
      { outcome_measure_source: 'oasis_change_score' }, '-episode_end', 5000),
  });

  // Filter by date range. Parse BOTH bounds on the same (local) clock: a
  // date-only string parses as UTC midnight while a date-time string parses as
  // local, so an asymmetric pair shifted the start boundary into the prior
  // evening for any negative-UTC-offset zone and miscounted boundary records.
  const rangeStart = new Date(dateRange.start + 'T00:00:00');
  const rangeEnd = new Date(dateRange.end + 'T23:59:59.999');
  // Date-only values ("2026-07-27") parse as UTC midnight while the window
  // bounds above parse LOCAL — in every US timezone that dropped records
  // dated on the window's first day and counted day-after-end records.
  // Anchor date-only values to local midnight; datetimes parse as-is.
  const parseItemDate = (raw) => {
    const s = String(raw || '');
    return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s);
  };
  const filterByDate = (items, dateField) => {
    return items.filter(item => {
      const itemDate = parseItemDate(item[dateField]);
      return itemDate >= rangeStart && itemDate <= rangeEnd;
    });
  };

  const filteredReferrals = filterByDate(referrals, 'referral_date');
  const filteredVisits = filterByDate(noteConversions, 'created_date'); // Visits = enhancements
  const filteredOASIS = filterByDate(oasisAssessments, 'assessment_date');
  const filteredAudits = filterByDate(complianceAudits, 'audit_date');

  // Calculate KPIs
  const totalReferrals = filteredReferrals.length;
  const activePatients = patients.filter(p => p.status === 'active').length;
  const completedVisits = filteredVisits.length; // All enhancements count as completed visits
  const avgComplianceScore = filteredAudits.length > 0
    ? (filteredAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / filteredAudits.length).toFixed(1)
    : 0;
  const oasisCompletionRate = filteredOASIS.length > 0
    ? ((filteredOASIS.filter(o => o.status === 'completed').length / filteredOASIS.length) * 100).toFixed(1)
    : 0;
  // Real (not hardcoded) Critical Alerts count: open alerts at critical severity.
  const isAlertOpen = (a) => a.status === 'active' || a.status === 'acknowledged';
  const criticalAlerts = patientAlerts.filter(a => a.severity === 'critical' && isAlertOpen(a)).length;

  // Outcome-measure summary: latest AgencyKPI row per improvement measure
  // (newest period_end wins), counted against its national benchmark where one
  // is set. Coverage = complete episode pairs (SOC/ROC + Discharge OASIS)
  // documented in PennSync — the full detail lives on the OASIS Center Quality tab.
  const outcomeSummary = (() => {
    if (!qualityKpis || !outcomeMetrics) return null; // still loading (or failed) — show "—"
    const latestByLabel = new Map();
    for (const row of qualityKpis) {
      if (!IMPROVEMENT_MEASURES.some(m => m.label === row.metric_name)) continue;
      const prev = latestByLabel.get(row.metric_name);
      if (!prev || String(row.period_end || '') > String(prev.period_end || '')) {
        latestByLabel.set(row.metric_name, row);
      }
    }
    const rows = [...latestByLabel.values()];
    const benchmarked = rows.filter(r => r.benchmark_value != null);
    return {
      measuresComputed: rows.length,
      measuresTotal: IMPROVEMENT_MEASURES.length,
      benchmarkedCount: benchmarked.length,
      atOrAboveBenchmark: benchmarked.filter(r => r.metric_value >= r.benchmark_value).length,
      episodePairs: outcomeMetrics.length,
    };
  })();

  // Calculate trends by comparing each metric against the immediately-preceding
  // period of equal length. Returns null when there's no baseline to compare to, so
  // the card can omit the trend badge rather than show a fabricated number.
  const periodMs = rangeEnd - rangeStart;
  const previousStart = new Date(rangeStart.getTime() - periodMs);
  const inPreviousPeriod = (items, dateField) => items.filter(item => {
    // Same local-midnight anchoring as filterByDate — a raw parse counted
    // boundary-day records in both periods and dropped the previous period's
    // own first day.
    const date = parseItemDate(item[dateField]);
    return date >= previousStart && date < rangeStart;
  });
  const pctTrend = (current, previous) => {
    if (!(previous > 0)) return null;
    return (((current - previous) / previous) * 100).toFixed(1);
  };

  const prevReferrals = inPreviousPeriod(referrals, 'referral_date');
  const prevVisits = inPreviousPeriod(noteConversions, 'created_date');
  const prevAudits = inPreviousPeriod(complianceAudits, 'audit_date');
  const prevOASIS = inPreviousPeriod(oasisAssessments, 'assessment_date');

  const prevAvgCompliance = prevAudits.length > 0
    ? prevAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / prevAudits.length
    : 0;
  const prevOasisRate = prevOASIS.length > 0
    ? (prevOASIS.filter(o => o.status === 'completed').length / prevOASIS.length) * 100
    : 0;

  const referralTrend = pctTrend(totalReferrals, prevReferrals.length);
  const visitsTrend = pctTrend(completedVisits, prevVisits.length);
  const complianceTrend = pctTrend(parseFloat(avgComplianceScore), prevAvgCompliance);
  const oasisTrend = pctTrend(parseFloat(oasisCompletionRate), prevOasisRate);

  const kpis = [
    {
      title: "Total Referrals",
      value: totalReferrals,
      trend: referralTrend,
      icon: FileText,
      color: "purple",
      trendUp: parseFloat(referralTrend) >= 0
    },
    {
      // Active Patients is a current snapshot, not a period metric — no trend.
      title: "Active Patients",
      value: activePatients,
      trend: null,
      icon: Users,
      color: "blue"
    },
    {
      title: "Completed Visits",
      value: completedVisits,
      trend: visitsTrend,
      icon: CheckCircle2,
      color: "green",
      trendUp: parseFloat(visitsTrend) >= 0
    },
    {
      title: "Avg Compliance Score",
      value: `${avgComplianceScore}%`,
      trend: complianceTrend,
      icon: ClipboardCheck,
      color: "indigo",
      trendUp: parseFloat(complianceTrend) >= 0
    },
    {
      title: "OASIS Completion",
      value: `${oasisCompletionRate}%`,
      trend: oasisTrend,
      icon: ClipboardCheck,
      color: "emerald",
      trendUp: parseFloat(oasisTrend) >= 0
    },
    {
      // For alerts, fewer is better, so a decrease is the positive direction.
      title: "Critical Alerts",
      value: criticalAlerts,
      trend: null,
      icon: AlertTriangle,
      color: "red"
    }
  ];

  // Chart data - Monthly trends
  const _monthlyData = Array.from({ length: 6 }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - i));
    const monthName = date.toLocaleString('default', { month: 'short' });
    
    const monthReferrals = referrals.filter(r => {
      const refDate = new Date(r.referral_date + 'T00:00:00');
      return refDate.getMonth() === date.getMonth() && refDate.getFullYear() === date.getFullYear();
    }).length;

    const monthVisits = noteConversions.filter(nc => {
      const visitDate = new Date(nc.created_date);
      return visitDate.getMonth() === date.getMonth() && visitDate.getFullYear() === date.getFullYear();
    }).length;

    return {
      month: monthName,
      referrals: monthReferrals,
      visits: monthVisits
    };
  });

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi, index) => {
          const colorClasses = KPI_COLOR_CLASSES[kpi.color] || KPI_COLOR_CLASSES.blue;
          return (
            <Card key={index} className={`border-l-4 ${colorClasses.border}`}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 ${colorClasses.bg} rounded-2xl flex items-center justify-center`}>
                    <kpi.icon className={`w-6 h-6 ${colorClasses.text}`} />
                  </div>
                  {kpi.trend != null && (
                    <Badge className={kpi.trendUp ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                      {kpi.trendUp ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                      {kpi.trend}%
                    </Badge>
                  )}
                </div>
                <p className="text-3xl font-bold text-slate-900 mb-1">{kpi.value}</p>
                <p className="text-sm text-slate-600">{kpi.title}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Outcome-measures summary (QoPC star proxy) — computed nightly from
          episode pairs documented in PennSync; full detail on the OASIS Center
          Quality tab. Official CMS stars come from the EMR's submissions. */}
      <Card className="border-l-4 border-l-amber-500">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
                <Star className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-3xl font-bold text-slate-900 mb-1">
                  {outcomeSummary
                    ? (outcomeSummary.benchmarkedCount > 0
                      ? `${outcomeSummary.atOrAboveBenchmark} of ${outcomeSummary.benchmarkedCount}`
                      : `${outcomeSummary.measuresComputed} of ${outcomeSummary.measuresTotal}`)
                    : '—'}
                </p>
                <p className="text-sm text-slate-600">
                  {outcomeSummary && outcomeSummary.benchmarkedCount > 0
                    ? 'Outcome measures at/above benchmark'
                    : 'Outcome measures computed (no benchmark set)'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Based on {outcomeSummary ? outcomeSummary.episodePairs : '—'} complete episode
                  pair{outcomeSummary?.episodePairs === 1 ? '' : 's'} documented in PennSync —
                  early-warning star proxy, not the official CMS rating.
                </p>
              </div>
            </div>
            <Link
              to="/OASISCenter?tab=quality"
              className="inline-flex items-center gap-1 text-sm font-medium text-navy-700 hover:text-navy-900 whitespace-nowrap"
            >
              View outcome measures
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}