import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, ShieldAlert, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buildTodayPriorities } from '@/components/dashboard/todayPriorities';

const severityStyles = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  high: 'border-amber-200 bg-amber-50 text-amber-700',
  medium: 'border-blue-200 bg-blue-50 text-blue-700',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const severityIcons = {
  critical: AlertTriangle,
  high: ShieldAlert,
  medium: ClipboardList,
  low: CheckCircle2,
};

export default function TodayPriorities({ currentUser, visits, patients, incidents, noteConversions, messages, dashboardError }) {
  const priorities = buildTodayPriorities({ currentUser, visits, patients, incidents, noteConversions, messages, dashboardError });

  return (
    <Card className="border-navy-100 bg-gradient-to-br from-white via-white to-navy-50/40 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-gold-200 bg-gold-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gold-700">
              <Sparkles className="h-3.5 w-3.5" /> Today’s command center
            </div>
            <CardTitle className="text-xl text-slate-900">Today’s priorities</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Ranked next steps based on your role, schedule, patient risk, messages, and operational exceptions.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-navy-200 bg-white text-navy-700">
            {priorities.length} item{priorities.length === 1 ? '' : 's'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {priorities.map((priority) => {
          const Icon = severityIcons[priority.severity] || ClipboardList;
          return (
            <div
              key={priority.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-navy-200 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 gap-3">
                <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${severityStyles[priority.severity] || severityStyles.medium}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{priority.title}</h3>
                    <Badge variant="secondary" className="capitalize">{priority.severity}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{priority.description}</p>
                </div>
              </div>
              <Button asChild variant="outline" className="shrink-0 justify-between border-navy-200 text-navy-700 hover:bg-navy-50">
                <Link to={priority.to}>
                  {priority.actionLabel}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
