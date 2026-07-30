import { Link } from 'react-router';
import { ClipboardList, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buildCoreWorkQueues } from '@/components/dashboard/coreWorkQueues';

/**
 * Thin UI consumer for the pure role work-queue summarizer.
 * Callers pass whatever list data is already in scope; missing lists default to [].
 */
export default function CoreWorkQueuesStrip({
  role = 'nurse',
  referrals = [],
  incidents = [],
  credentials = [],
  tasks = [],
  notes = [],
}) {
  const queues = buildCoreWorkQueues({ role, referrals, incidents, credentials, tasks, notes });
  if (!queues.length) return null;

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-navy-600" />
          <CardTitle className="text-base text-slate-900">Work queues</CardTitle>
          <Badge variant="outline" className="ml-auto">{queues.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {queues.map((queue) => (
          <Link
            key={queue.id}
            to={queue.route}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 transition hover:border-navy-200 hover:bg-navy-50 hover:text-navy-800"
          >
            <span className="font-medium">{queue.label}</span>
            <Badge className={queue.priority === 'high' ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'}>
              {queue.count}
            </Badge>
            <ArrowRight className="h-3.5 w-3.5 opacity-60" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
