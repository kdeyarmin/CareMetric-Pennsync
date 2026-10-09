import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import LoadingState from '@/components/ui/LoadingState';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SignatureRequestDetail from '@/components/signature/SignatureRequestDetail';
import { REQUEST_STATUS, requestStatusLabel } from '@/components/signature/signatureRequestLabels';
import { useSignatureRequests } from '@/hooks/useSignatureRequests';
import { formatLocalDate } from '@/lib/dateLocal';

/**
 * Signature requests the caller may see: the whole agency for an
 * agency_admin or manager, otherwise only charts the caller created or is
 * assigned to. The broker decides that; the list renders what it returns.
 */
export default function DocumentSignatures() {
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const query = useSignatureRequests({ status });
  const { tenant } = query;

  const requests = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return query.requests;
    return query.requests.filter((request) => [request.package_name, request.patient_name, request.created_by_email]
      .some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [query.requests, search]);

  if (!tenant.loading && !tenant.agencyId) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex items-center gap-3 p-4 text-sm text-amber-900">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          Signature requests appear once an agency membership has been verified for your account.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={status} onValueChange={setStatus}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search patient or request"
              aria-label="Search signature requests"
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => query.refetch()} aria-label="Refresh signature requests">
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {query.isLoading && <LoadingState label="Loading signature requests…" />}
      {query.isError && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-900" role="alert">
            {query.error?.message || 'Signature requests could not be loaded.'}
          </CardContent>
        </Card>
      )}
      {query.isSuccess && requests.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-600">
            {status === 'open' ? 'No signature requests are waiting.' : 'No signature requests match.'}
          </CardContent>
        </Card>
      )}
      {query.truncated && (
        <p className="text-xs text-slate-600">Showing the most recent requests. Narrow the search to find older ones.</p>
      )}

      <div className="space-y-3">
        {requests.map((request) => {
          const isExpanded = expanded === request.request_key;
          const tone = REQUEST_STATUS[request.status]?.className || 'bg-slate-100 text-slate-800';
          return (
            <Card key={request.request_key}>
              <CardContent className="space-y-3 p-4">
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 text-left"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : request.request_key)}
                >
                  <div className="flex items-start gap-2">
                    {isExpanded
                      ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                      : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />}
                    <div>
                      <p className="font-semibold text-slate-900">{request.package_name}</p>
                      <p className="text-sm text-slate-600">
                        {request.patient_name}
                        {request.due_date ? ` · due ${formatLocalDate(request.due_date) || request.due_date}` : ''}
                        {` · ${request.counts.signers_signed} of ${request.counts.signers_total} signatures`}
                        {request.counts.documents > 1 ? ` · ${request.counts.documents} documents` : ''}
                      </p>
                      <p className="text-xs text-slate-600">
                        {request.created_by_me ? 'Sent by you' : `Sent by ${request.created_by_email || 'a colleague'}`}
                        {request.created_at ? ` · ${new Date(request.created_at).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                  </div>
                  <Badge className={tone}>{requestStatusLabel(request.status)}</Badge>
                </button>
                {isExpanded && <SignatureRequestDetail request={request} agencyId={tenant.agencyId} />}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
