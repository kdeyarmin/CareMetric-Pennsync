import { Progress } from '@/components/ui/progress';
import StaffProgressBadges from '@/components/training/StaffProgressBadges';
export default function StaffTrainingLeaderboardRow({ staff }) {
  return <li className="flex items-start gap-3 rounded-lg border border-border bg-background p-4">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground" aria-label={`Rank ${staff.rank}`}>#{staff.rank}</span>
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">{staff.name}</span>
        <span className="font-semibold text-primary">{staff.progress}%</span>
      </div>
      <Progress value={staff.progress} className="h-2 bg-muted" role="progressbar" aria-label={`${staff.name} training plan progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={staff.progress} />
      <p className="mt-2 text-sm text-muted-foreground">{staff.completed_courses} completed plan courses · {staff.plans} training {staff.plans === 1 ? 'plan' : 'plans'}</p>
      <StaffProgressBadges staff={staff} />
    </div>
  </li>;
}