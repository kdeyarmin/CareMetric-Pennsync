import { Button } from '@/components/ui/button';
export default function StaffTrainingFilters({ value, onChange }) {
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter staff by training status">
      <Button size="sm" variant={value === 'all' ? 'default' : 'outline'} aria-pressed={value === 'all'} onClick={() => onChange('all')}>All staff</Button>
      <Button size="sm" variant={value === 'overdue' ? 'default' : 'outline'} aria-pressed={value === 'overdue'} onClick={() => onChange('overdue')}>Overdue training</Button>
    </div>
    {value === 'overdue' && <p className="text-xs text-muted-foreground">Employees with at least one training plan marked overdue. Progress includes all their non-cancelled plans.</p>}
  </div>;
}