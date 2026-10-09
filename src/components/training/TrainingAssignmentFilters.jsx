import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
const statuses = [['assigned', 'Assigned'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['overdue', 'Overdue'], ['failed', 'Failed'], ['locked', 'Locked']];
const priorities = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']];
export default function TrainingAssignmentFilters({ filters, departments, onChange }) {
  const fields = [
    { key: 'status', label: 'Status', all: 'All statuses', options: statuses },
    { key: 'department', label: 'Department', all: 'All departments', options: [...departments.map(value => [value, value]), ['__unspecified__', 'Unspecified department']] },
    { key: 'priority', label: 'Priority', all: 'All priorities', options: priorities },
  ];
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
    {fields.map(field => <div key={field.key} className="min-w-0 flex-1">
      <span id={`assignment-filter-${field.key}`} className="mb-2 block text-sm font-medium text-foreground">{field.label}</span>
      <Select value={filters[field.key] || '__all__'} onValueChange={value => onChange({ ...filters, [field.key]: value === '__all__' ? '' : value })}>
        <SelectTrigger aria-labelledby={`assignment-filter-${field.key}`}><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="__all__">{field.all}</SelectItem>{field.options.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
    </div>)}
    <Button variant="outline" onClick={() => onChange({ status: '', department: '', priority: '' })}>Clear filters</Button>
  </div>;
}