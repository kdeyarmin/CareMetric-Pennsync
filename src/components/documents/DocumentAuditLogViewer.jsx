import { useMemo, useState } from 'react';
import { RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import LoadingState from '@/components/ui/LoadingState';
import { useSignatureAuditEvents } from '@/hooks/useSignatureRequests';

const ACTOR_LABELS = {
  external_signer: 'Signer',
  authenticated_user: 'Staff',
  scheduler: 'Scheduler',
  system: 'System',
};

/**
 * The agency's e-signature audit trail: append-only events recorded by the
 * signing brokers. Available to agency administrators and managers; the
 * broker refuses anyone else.
 */
export default function DocumentAuditLogViewer() {
  const [search, setSearch] = useState('');
  const query = useSignatureAuditEvents({ limit: 500 });
  const events = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return query.events;
    return query.events.filter((event) => [event.label, event.document_title, event.signer_name, event.package_name]
      .some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [query.events, search]);

  if (!query.tenant.loading && !query.tenant.agencyId) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex items-center gap-3 p-4 text-sm text-amber-900">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          The signature audit trail appears once an agency membership has been verified for your account.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>E-signature audit trail</CardTitle>
        <div className="flex gap-2">
          <div className="relative sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter events" aria-label="Filter audit events" className="pl-9" />
          </div>
          <Button variant="outline" size="icon" onClick={() => query.refetch()} aria-label="Refresh audit trail">
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading && <LoadingState label="Loading audit trail…" />}
        {query.isError && <p className="text-sm text-amber-900" role="alert">{query.error?.message || 'The audit trail could not be loaded.'}</p>}
        {query.isSuccess && events.length === 0 && <p className="text-sm text-slate-600">No signature activity recorded yet.</p>}
        {events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-600">
                <tr>
                  <th scope="col" className="py-2 pr-3">When</th>
                  <th scope="col" className="py-2 pr-3">Event</th>
                  <th scope="col" className="py-2 pr-3">By</th>
                  <th scope="col" className="py-2 pr-3">Request</th>
                  <th scope="col" className="py-2">Document / signer</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{event.occurred_at ? new Date(event.occurred_at).toLocaleString() : ''}</td>
                    <td className="py-2 pr-3 text-slate-900">
                      {event.label}
                      {event.sealed_sha256 && <span className="block break-all text-xs text-slate-500">SHA-256 {event.sealed_sha256}</span>}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{ACTOR_LABELS[event.actor_type] || event.actor_type || ''}</td>
                    <td className="py-2 pr-3 text-slate-700">{event.package_name || ''}</td>
                    <td className="py-2 text-slate-700">{[event.document_title, event.signer_name].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
