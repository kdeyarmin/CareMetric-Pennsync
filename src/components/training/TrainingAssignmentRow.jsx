import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { formatLocalDate } from '@/lib/dateLocal';
export default function TrainingAssignmentRow({ assignment }) {
  const needsHelp = ['overdue', 'failed', 'locked'].includes(assignment.status);
  return <li className="rounded-lg border border-border bg-background p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="text-base font-semibold text-foreground">{assignment.staff_name}</h3><p className="text-sm text-muted-foreground">{assignment.course_title}</p></div>
      <div className="flex gap-2"><Badge variant={needsHelp ? 'destructive' : 'secondary'} className="capitalize">{assignment.status.replace(/_/g, ' ')}</Badge><Badge variant="outline" className="capitalize">{assignment.priority} priority</Badge></div>
    </div>
    <p className="my-3 text-sm text-muted-foreground">{assignment.department} · {assignment.due_date ? `Due ${formatLocalDate(assignment.due_date, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No due date'}</p>
    <div className="flex items-center gap-3"><Progress value={assignment.progress} className="h-2 flex-1 bg-muted" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={assignment.progress} /><span className="text-sm text-foreground">{Math.round(assignment.progress)}%</span></div>
  </li>;
}