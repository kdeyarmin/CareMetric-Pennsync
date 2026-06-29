import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Users,
  FileText,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2
} from "lucide-react";

const KPI_COLOR_CLASSES = {
  purple: { border: "border-l-purple-500", bg: "bg-purple-100", text: "text-purple-600" },
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

  const { data: patients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list('-created_date', 5000),
    initialData: [],
  });

  const { data: noteConversions = [] } = useQuery({
    queryKey: ['allNoteConversions', dateRange],
    queryFn: () => base44.entities.NoteConversion.list('-created_date', 5000),
    initialData: [],
  });

  const { data: oasisAssessments = [] } = useQuery({
    queryKey: ['allOASISAssessments', dateRange],
    queryFn: () => base44.entities.OASISAssessment.list('-created_date', 5000),
    initialData: [],
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['allComplianceAudits', dateRange],
    queryFn: () => base44.entities.ComplianceAudit.list('-created_date', 5000),
    initialData: [],
  });

  const { data: patientAlerts = [] } = useQuery({
    queryKey: ['allPatientAlerts'],
    queryFn: () => base44.entities.PatientAlert.list('-created_date', 5000),
    initialData: [],
  });

  // Filter by date range
  const filterByDate = (items, dateField) => {
    return items.filter(item => {
      const itemDate = new Date(item[dateField]);
      return itemDate >= new Date(dateRange.start) && itemDate <= new Date(dateRange.end + 'T23:59:59.999');
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

  // Calculate trends by comparing each metric against the immediately-preceding
  // period of equal length. Returns null when there's no baseline to compare to, so
  // the card can omit the trend badge rather than show a fabricated number.
  const periodMs = new Date(dateRange.end + 'T23:59:59.999') - new Date(dateRange.start);
  const previousStart = new Date(new Date(dateRange.start).getTime() - periodMs);
  const inPreviousPeriod = (items, dateField) => items.filter(item => {
    const date = new Date(item[dateField]);
    return date >= previousStart && date < new Date(dateRange.start);
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
      const refDate = new Date(r.referral_date);
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
                  <div className={`w-12 h-12 ${colorClasses.bg} rounded-lg flex items-center justify-center`}>
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


    </div>
  );
}