import { Progress } from '@/components/ui/progress';
export default function DepartmentCompletionRow({ department }) {
  return <div className="rounded-lg border border-border bg-background p-4">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-foreground">{department.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{department.completed} of {department.total} assigned courses completed</p>
      </div>
      <span className="shrink-0 text-lg font-semibold text-primary">{department.percentage}%</span>
    </div>
    <Progress value={department.percentage} className="h-2 bg-muted" role="progressbar" aria-label={`${department.name} course completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={department.percentage} />
  </div>;
}