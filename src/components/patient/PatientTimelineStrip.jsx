import { Link } from 'react-router';
import { Clock, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buildPatientTimeline } from '@/components/patient/patientTimeline';

/**
 * Thin UI consumer for the pure patient timeline normalizer (P2-05).
 * Callers pass list data already in scope; missing lists default to [].
 */
export default function PatientTimelineStrip({
  patientId,
  visits = [],
  documents = [],
  incidents = [],
  tasks = [],
  messages = [],
  referrals = [],
  limit = 12,
}) {
  const events = buildPatientTimeline({
    patientId,
    visits,
    documents,
    incidents,
    tasks,
    messages,
    referrals,
  }).slice(0, limit);

  if (!events.length) return null;

  const typeTone = {
    visit: 'bg-navy-100 text-navy-800',
    document: 'bg-slate-100 text-slate-700',
    incident: 'bg-amber-100 text-amber-800',
    task: 'bg-blue-100 text-blue-800',
    message: 'bg-emerald-100 text-emerald-800',
    referral: 'bg-purple-100 text-purple-800',
  };

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-navy-600" />
          <CardTitle className="text-base text-slate-900">Patient timeline</CardTitle>
          <Badge variant="outline" className="ml-auto">{events.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.map((event) => (
          <Link
            key={event.id}
            to={event.route}
            className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 transition hover:border-navy-200 hover:bg-navy-50"
          >
            <Badge className={`mt-0.5 shrink-0 text-xs ${typeTone[event.type] || 'bg-slate-100 text-slate-700'}`}>
              {event.label}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{event.title}</p>
              <p className="text-xs text-slate-500">
                {event.occurred_at ? new Date(event.occurred_at).toLocaleString() : ''}
                {event.status ? ` · ${String(event.status).replace(/_/g, ' ')}` : ''}
              </p>
            </div>
            <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
