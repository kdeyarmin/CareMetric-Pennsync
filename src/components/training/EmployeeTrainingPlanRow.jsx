import { Progress, clampPercent } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { formatLocalDate, isPastLocalDueDate } from '@/lib/dateLocal';
export default function EmployeeTrainingPlanRow({ item }) {
  const progress = clampPercent(item.progress_percentage);
  const status = item.status === 'overdue' || isPastLocalDueDate(item.due_date) ? 'Overdue' : (item.status || 'active').replaceAll('_', ' ');
  return <li className="rounded-lg border border-border bg-background p-4 space-y-3">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="text-base font-semibold text-foreground">{item.plan_name}</h3><Badge variant="outline" className="border-border text-foreground">{status}</Badge></div>
    <div className="flex flex-wrap justify-between gap-2 text-sm text-foreground"><span>{item.courses_completed ?? 0} of {item.courses_total ?? '—'} courses completed</span><span>{progress}%</span></div>
    <Progress value={progress} className="bg-muted" role="progressbar" aria-label={`${item.plan_name} progress`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} />
    <p className="text-sm text-muted-foreground">Due: {formatLocalDate(item.due_date) || 'No due date set'} · Enrolled: {formatLocalDate(item.enrolled_at) || 'Not recorded'}</p>
  </li>;
}