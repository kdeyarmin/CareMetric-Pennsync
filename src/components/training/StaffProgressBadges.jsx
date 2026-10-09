import { Award, CheckCircle2, Clock, Circle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
const statuses = {
  completed: { label: 'All plans completed', variant: 'success', Icon: CheckCircle2 },
  in_progress: { label: 'In progress', variant: 'info', Icon: Clock },
  not_started: { label: 'Not started', variant: 'secondary', Icon: Circle },
  overdue: { label: 'Overdue training', variant: 'warning', Icon: AlertTriangle },
};
export default function StaffProgressBadges({ staff }) {
  const status = statuses[staff.completion_status];
  const Icon = status?.Icon || Circle;
  const earned = staff.certificates_earned;
  return <div className="mt-3 flex flex-wrap items-center gap-2" aria-label={`${staff.name} training achievements`}>
    <Badge variant={status?.variant || 'outline'} className="gap-1.5 dark:bg-secondary dark:text-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{status?.label || 'Status unavailable'}
    </Badge>
    {staff.completed_plans != null && <Badge variant="outline" className="border-border bg-background text-foreground gap-1.5">
      {staff.completed_plans} of {staff.plans} plans completed
    </Badge>}
    <Badge variant={earned > 0 ? 'success' : 'secondary'} className="gap-1.5 dark:bg-secondary dark:text-foreground">
      <Award className="h-3.5 w-3.5" aria-hidden="true" />{earned == null ? 'Certificates unavailable' : `${earned} training certificate${earned === 1 ? '' : 's'} earned`}
    </Badge>
  </div>;
}