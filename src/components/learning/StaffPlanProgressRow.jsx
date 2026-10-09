import { Progress } from '@/components/ui/progress';
export default function StaffPlanProgressRow({ plan }) {
  return <div className="rounded-lg border border-border bg-background p-4">
    <div className="mb-3 flex items-start justify-between gap-4">
      <div className="min-w-0"><h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{plan.staff} staff assigned · {plan.completed_courses}/{plan.total_courses} course completions</p></div>
      <span className="shrink-0 text-lg font-semibold text-primary">{plan.progress}%</span>
    </div>
    <Progress value={plan.progress} role="progressbar" aria-label={`${plan.name} staff progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={plan.progress} className="h-2 bg-muted" />
  </div>;
}