import { Badge } from '@/components/ui/badge';
import { Progress, clampPercent } from '@/components/ui/progress';
import { formatLocalDate, isPastLocalDueDate } from '@/lib/dateLocal';
export default function EmployeeRequiredCourseRow({ item }) {
  const overdue = item.status === 'overdue' || isPastLocalDueDate(item.due_date);
  const progress = clampPercent(item.progress_percentage);
  return <li className="rounded-lg border border-border bg-background p-4 space-y-2">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="text-base font-semibold text-foreground">{item.course_title}</h3><Badge variant="outline" className="border-border text-foreground">{overdue ? 'Overdue' : (item.status || 'assigned').replaceAll('_', ' ')}</Badge></div>
    <p className="text-sm text-muted-foreground">Due: {formatLocalDate(item.due_date) || 'No due date set'} · Priority: {item.priority || 'normal'}</p>
    <p className="text-sm text-foreground">{progress}% complete</p>
    <Progress value={progress} className="bg-muted" role="progressbar" aria-label={`${item.course_title} progress`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} />
  </li>;
}