import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function EmptyState({ 
  title = "No data found", 
  description = "There is currently no data to display in this section.",
  icon: Icon = Inbox,
  action = null,
  className
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-xl border border-dashed border-slate-300 bg-gradient-to-b from-white to-slate-50/60", className)}>
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-navy-50 to-navy-100 ring-1 ring-inset ring-navy-200/60">
        <Icon className="h-8 w-8 text-navy-500" strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 tracking-tight mb-1">{title}</h3>
      <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
        {description}
      </p>
      {action && (
        <div>{action}</div>
      )}
    </div>
  );
}