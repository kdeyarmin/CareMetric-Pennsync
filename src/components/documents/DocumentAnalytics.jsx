import { CheckCircle2, Clock, FileSignature, Timer, TriangleAlert, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import LoadingState from '@/components/ui/LoadingState';
import StatCard from '@/components/ui/stat-card';
import { useSignatureSummary } from '@/hooks/useSignatureRequests';

/**
 * E-signature activity for the requests the caller may see (the broker
 * scopes them to the agency or to the caller's own charts).
 */
export default function DocumentAnalytics() {
  const query = useSignatureSummary();
  const summary = query.summary;

  if (!query.tenant.loading && !query.tenant.agencyId) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-slate-600">
          Signature analytics appear once an agency membership has been verified for your account.
        </CardContent>
      </Card>
    );
  }
  if (query.isLoading) return <LoadingState label="Loading signature activity…" />;
  if (query.isError || !summary) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-4 text-sm text-amber-900" role="alert">
          {query.error?.message || 'Signature activity could not be loaded.'}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={FileSignature} label="Open requests" value={summary.open} description={`${summary.partially_signed} partially signed`} />
        <StatCard icon={CheckCircle2} label="Completed (30 days)" value={summary.completed_last_30_days} description={`${summary.completed} completed in total`} tone="emerald" />
        <StatCard
          icon={Timer}
          label="Average time to complete"
          value={summary.average_hours_to_complete == null ? '—' : `${summary.average_hours_to_complete} h`}
          description="From request to sealed copy"
        />
        <StatCard icon={Clock} label="Due within 3 days" value={summary.due_within_3_days} tone="amber" />
        <StatCard icon={TriangleAlert} label="Expired" value={summary.expired} tone="rose" />
        <StatCard icon={XCircle} label="Canceled" value={summary.cancelled} tone="slate" />
      </div>
      <p className="text-xs text-slate-600">
        Completion rate {summary.completion_rate == null ? '—' : `${summary.completion_rate}%`} across {summary.total} request{summary.total === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
