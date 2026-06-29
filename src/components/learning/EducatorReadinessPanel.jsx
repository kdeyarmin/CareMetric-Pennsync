import { useQuery } from '@tanstack/react-query';
import { BarChart3, ShieldCheck, AlertTriangle, Users, Loader2, Download } from 'lucide-react';
import { getTeamTrainingReadiness } from '@/functions/getTeamTrainingReadiness';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toCsv, exportTimestamp } from '@/components/admin/csvExport';

const readinessColor = (pct) =>
  pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600';
const barColor = (pct) =>
  pct >= 90 ? '[&>div]:bg-emerald-500' : pct >= 70 ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500';

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '');

/** Trigger a client-side CSV file download (browser only). */
function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Org-wide required-training readiness for educators and admins. Data is fetched
 * through the admin-authorized getTeamTrainingReadiness function (service role)
 * so non-admin educators see true team rollups rather than RLS-filtered rows.
 */
export default function EducatorReadinessPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['team-training-readiness'],
    queryFn: async () => {
      const res = await getTeamTrainingReadiness({});
      return res?.data || res;
    },
  });

  const overall = data?.overall || { total: 0, done: 0, overdue: 0, pct: 100, staff: 0 };
  const byBusinessLine = data?.byBusinessLine || [];
  const rolesNeedingAttention = data?.rolesNeedingAttention || [];
  const rows = data?.rows || [];

  const exportReadinessCsv = () => {
    const columns = [
      { key: 'employee', label: 'Employee' },
      { key: 'role', label: 'Role' },
      { key: 'business_line', label: 'Business Line' },
      { key: 'course', label: 'Course' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Required Status' },
      { key: 'due_date', label: 'Due Date', format: (v) => formatDate(v) },
      { key: 'completion_date', label: 'Completion Date', format: (v) => formatDate(v) },
      { key: 'score', label: 'Score (%)' },
    ];
    downloadCsv(`team_required_training_readiness_${exportTimestamp()}.csv`, toCsv(columns, rows));
  };

  if (isLoading) {
    return (
      <Card className="border-indigo-200">
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-indigo-200">
        <CardContent className="p-6 text-center text-sm text-slate-500">
          Team readiness is unavailable for your account.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-indigo-200 bg-indigo-50/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2 text-indigo-900">
            <BarChart3 className="w-5 h-5" />
            Team Required-Training Readiness
          </CardTitle>
          <Button variant="outline" size="sm" onClick={exportReadinessCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Headline metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5" /> Overall readiness
            </div>
            <p className={`text-2xl font-bold mt-1 ${readinessColor(overall.pct)}`}>{overall.pct}%</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Required completed</p>
            <p className="text-2xl font-bold mt-1 text-slate-800">{overall.done}/{overall.total}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <AlertTriangle className="w-3.5 h-3.5" /> Overdue
            </div>
            <p className={`text-2xl font-bold mt-1 ${overall.overdue ? 'text-red-600' : 'text-slate-800'}`}>{overall.overdue}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Users className="w-3.5 h-3.5" /> Staff tracked
            </div>
            <p className="text-2xl font-bold mt-1 text-slate-800">{overall.staff}</p>
          </div>
        </div>

        {/* By business line */}
        {byBusinessLine.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">By business line</p>
            <div className="space-y-2">
              {byBusinessLine.map((row) => (
                <div key={row.key} className="flex items-center gap-3">
                  <span className="w-28 text-sm text-slate-600 flex-shrink-0">{row.label}</span>
                  <Progress value={row.pct} className={`h-2.5 flex-1 ${barColor(row.pct)}`} />
                  <span className={`text-sm font-semibold w-24 text-right flex-shrink-0 ${readinessColor(row.pct)}`}>
                    {row.done}/{row.total} ({row.pct}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Roles needing attention */}
        {rolesNeedingAttention.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Roles to watch (lowest readiness)</p>
            <div className="space-y-2">
              {rolesNeedingAttention.map((row) => (
                <div key={row.role} className="flex items-center justify-between gap-3 p-2.5 bg-white rounded-lg border border-slate-200">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate capitalize">{row.role}</p>
                    <p className="text-xs text-slate-500">{row.done}/{row.total} required complete</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {row.overdue > 0 && (
                      <Badge className="bg-red-100 text-red-700">{row.overdue} overdue</Badge>
                    )}
                    <span className={`text-sm font-bold ${readinessColor(row.pct)}`}>{row.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {overall.total === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">
            No required training assignments yet. Assign annual in-services to see readiness here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
