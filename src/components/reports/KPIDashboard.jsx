import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import useReferralReportRows from '@/components/reports/useReferralReportRows';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Users,
  FileText,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

const KPI_COLOR_CLASSES = {
  purple: { border: "border-l-navy-500", bg: "bg-navy-100", text: "text-navy-700" },
  blue: { border: "border-l-blue-500", bg: "bg-blue-100", text: "text-blue-600" },
  green: { border: "border-l-green-500", bg: "bg-green-100", text: "text-green-600" },
  indigo: { border: "border-l-indigo-500", bg: "bg-indigo-100", text: "text-indigo-600" },
  red: { border: "border-l-red-500", bg: "bg-red-100", text: "text-red-600" },
};

const ROW_LIMIT = 5000;

// Date-only values ("2026-07-27") parse as UTC midnight while the window
// bounds parse LOCAL — in every US timezone that dropped records dated on the
// window's first day. Anchor date-only values to local midnight.
export function parseKpiDate(raw) {
  const s = String(raw || '');
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
}

export function averageScore(audits) {
  // A missing score is not a zero: Number(null) is 0, so absent values are
  // dropped before conversion rather than averaged in.
  const scores = audits
    .map((audit) => audit?.compliance_score)
    .filter((score) => typeof score === 'number' || (typeof score === 'string' && score.trim()))
    .map(Number)
    .filter((score) => Number.isFinite(score));
  return scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
}

// Compare a metric against the immediately preceding period of equal length.
// Null when there is no baseline, so the card omits the badge rather than
// showing a fabricated trend.
export function percentTrend(current, previous) {
  if (current === null || !(previous > 0)) return null;
  return (((current - previous) / previous) * 100).toFixed(1);
}

/**
 * Agency KPI summary. Every source is a reviewed read: referrals through the
 * authorized referral broker, patients and visits through their purpose-limited
 * brokers, and the compliance audits and patient alerts through the agency
 * filter. A source that has not loaded shows "—", never 0. OASIS completion and
 * outcome measures live in the OASIS Center rather than here.
 */
export default function KPIDashboard({ dateRange }) {
  const referralQuery = useReferralReportRows();
  const patientQuery = useScopedPatients({ purpose: 'roster', sort: '-updated_date', limit: ROW_LIMIT });
  const visitQuery = useAuthorizedVisits({ purpose: 'reporting', sort: '-visit_date', limit: ROW_LIMIT });
  const auditQuery = useAgencyScopedQuery({
    queryKey: ['kpiComplianceAudits', ROW_LIMIT],
    fetch: () => base44.entities.ComplianceAudit.list('-audit_date', ROW_LIMIT),
    authorOf: (audit) => audit?.nurse_email,
  });
  const alertQuery = useAgencyScopedQuery({
    queryKey: ['kpiPatientAlerts', ROW_LIMIT],
    fetch: () => base44.entities.PatientAlert.list('-created_date', ROW_LIMIT),
  });

  const rangeStart = new Date(`${dateRange.start}T00:00:00`);
  const rangeEnd = new Date(`${dateRange.end}T23:59:59.999`);
  const periodMs = rangeEnd - rangeStart;
  const previousStart = new Date(rangeStart.getTime() - periodMs);
  const inRange = (items, field) => items.filter((item) => {
    const date = parseKpiDate(item?.[field]);
    return date >= rangeStart && date <= rangeEnd;
  });
  const inPrevious = (items, field) => items.filter((item) => {
    const date = parseKpiDate(item?.[field]);
    return date >= previousStart && date < rangeStart;
  });
  const rows = (query) => (query.isSuccess && Array.isArray(query.data) ? query.data : null);

  const referrals = rows(referralQuery);
  const patients = rows(patientQuery);
  const completed = rows(visitQuery)?.filter((visit) => visit.status === 'completed') ?? null;
  const audits = rows(auditQuery);
  const alerts = rows(alertQuery);

  const totalReferrals = referrals ? inRange(referrals, 'referral_date').length : null;
  const completedVisits = completed ? inRange(completed, 'visit_date').length : null;
  const avgCompliance = audits ? averageScore(inRange(audits, 'audit_date')) : null;
  const isAlertOpen = (alert) => alert.status === 'active' || alert.status === 'acknowledged';

  const kpis = [
    {
      title: "Total Referrals",
      value: totalReferrals,
      trend: referrals ? percentTrend(totalReferrals, inPrevious(referrals, 'referral_date').length) : null,
      icon: FileText,
      color: "purple",
      unavailable: referralQuery.isError || !referralQuery.scopeAvailable,
    },
    {
      // A current snapshot, not a period metric — no trend.
      title: "Active Patients",
      value: patients ? patients.filter((patient) => patient.status === 'active').length : null,
      trend: null,
      icon: Users,
      color: "blue",
      unavailable: patientQuery.isError,
    },
    {
      title: "Completed Visits",
      value: completedVisits,
      trend: completed ? percentTrend(completedVisits, inPrevious(completed, 'visit_date').length) : null,
      icon: CheckCircle2,
      color: "green",
      unavailable: visitQuery.isError,
    },
    {
      title: "Avg Compliance Score",
      value: avgCompliance === null ? null : `${avgCompliance.toFixed(1)}%`,
      trend: audits ? percentTrend(avgCompliance, averageScore(inPrevious(audits, 'audit_date'))) : null,
      icon: ClipboardCheck,
      color: "indigo",
      unavailable: auditQuery.isError,
      emptyLabel: audits ? 'No scored audits' : null,
    },
    {
      // Fewer is better, so no up/down trend colouring is implied here.
      title: "Critical Alerts",
      value: alerts ? alerts.filter((alert) => alert.severity === 'critical' && isAlertOpen(alert)).length : null,
      trend: null,
      icon: AlertTriangle,
      color: "red",
      unavailable: alertQuery.isError,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi) => {
          const colorClasses = KPI_COLOR_CLASSES[kpi.color] || KPI_COLOR_CLASSES.blue;
          const trendUp = kpi.trend !== null && parseFloat(kpi.trend) >= 0;
          return (
            <Card key={kpi.title} className={`border-l-4 ${colorClasses.border}`}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 ${colorClasses.bg} rounded-2xl flex items-center justify-center`}>
                    <kpi.icon className={`w-6 h-6 ${colorClasses.text}`} />
                  </div>
                  {kpi.trend !== null && (
                    <Badge className={trendUp ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                      {trendUp ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                      {kpi.trend}%
                    </Badge>
                  )}
                </div>
                <p className="text-3xl font-bold text-slate-900 mb-1">
                  {kpi.value ?? (kpi.unavailable ? 'Unavailable' : kpi.emptyLabel || '—')}
                </p>
                <p className="text-sm text-slate-600">{kpi.title}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
