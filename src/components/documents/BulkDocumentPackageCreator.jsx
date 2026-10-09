import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Search, Send, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { localDatePlusDays } from '@/components/signature/signatureRequestLabels';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { signatureRequestsKey, useSigningTenant } from '@/hooks/useSignatureRequests';
import {
  createSignatureRequestFromTemplate, listSignatureTemplates, newEsignRequestId, sendSigningLink,
} from '@/lib/esignClient';

const MAX_PATIENTS_PER_RUN = 50;

function patientName(patient) {
  return [patient?.first_name, patient?.last_name].filter(Boolean).join(' ').trim() || 'Patient';
}

/**
 * Generate one document from a template for each chosen patient and send it
 * to that patient (or their caregiver) for signature. Each patient is its own
 * request through the same broker, so chart access is decided per patient.
 */
export default function BulkDocumentPackageCreator() {
  const tenant = useSigningTenant();
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState('');
  const [signerSource, setSignerSource] = useState('patient');
  const [dueDate, setDueDate] = useState(localDatePlusDays(7));
  const [message, setMessage] = useState('');
  const [sendNow, setSendNow] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const runIdRef = useRef(null);

  const templatesQuery = useQuery({
    queryKey: signatureRequestsKey(tenant.agencyId, 'templates'),
    queryFn: () => listSignatureTemplates({ agencyId: tenant.agencyId }),
    enabled: !!tenant.agencyId && tenant.canRequest,
    retry: false,
  });
  const templates = templatesQuery.data?.templates ?? [];

  const patientsQuery = useScopedPatients({
    purpose: 'contact',
    agencyId: tenant.agencyId || undefined,
    sort: 'last_name',
    limit: 2000,
    enabled: !!tenant.agencyId && tenant.canRequest,
  });
  const patients = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = patientsQuery.data || [];
    return needle ? rows.filter((patient) => patientName(patient).toLowerCase().includes(needle)) : rows;
  }, [patientsQuery.data, search]);

  const reachable = (patient) => (signerSource === 'caregiver'
    ? !!patient.caregiver_email && !!patient.caregiver_name
    : !!patient.email);

  const toggle = (id, checked) => {
    runIdRef.current = null;
    setSelected((current) => (checked ? [...new Set([...current, id])].slice(0, MAX_PATIENTS_PER_RUN) : current.filter((entry) => entry !== id)));
  };

  const run = async () => {
    if (!templateId || !selected.length) return;
    runIdRef.current ||= newEsignRequestId('bulk');
    setRunning(true);
    setResults([]);
    const outcomes = [];
    for (const patientId of selected) {
      const patient = (patientsQuery.data || []).find((entry) => entry.id === patientId);
      const name = patientName(patient);
      try {
        const created = await createSignatureRequestFromTemplate({
          agency_id: tenant.agencyId,
          patient_id: patientId,
          template_id: templateId,
          signer_source: signerSource,
          due_date: dueDate,
          message: message.trim() || null,
          // Stable per patient within this run, so a retry returns the same request.
          client_request_id: `${runIdRef.current}-${patientId}`.slice(0, 200),
        });
        let sent = null;
        if (sendNow) {
          const pkg = created.request.packages?.[0];
          try {
            await sendSigningLink({ agencyId: tenant.agencyId, packageId: pkg.id, signerId: pkg.signer_id });
            sent = true;
          } catch (sendError) {
            sent = sendError.message;
          }
        }
        outcomes.push({ patientId, name, ok: true, sent });
      } catch (error) {
        outcomes.push({ patientId, name, ok: false, message: error.message });
      }
      setResults([...outcomes]);
    }
    await queryClient.invalidateQueries({ queryKey: signatureRequestsKey(tenant.agencyId) });
    setRunning(false);
  };

  if (!tenant.loading && (!tenant.agencyId || !tenant.canRequest)) {
    return (
      <Alert>
        <AlertDescription>
          Bulk signature requests can be sent by agency administrators, managers and clinicians with a verified agency membership.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Template and signer</CardTitle>
          <CardDescription>
            The template is filled in for each patient, filed to that patient’s chart, and sent for signature.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Document template</Label>
            <Select value={templateId} onValueChange={(value) => { runIdRef.current = null; setTemplateId(value); }}>
              <SelectTrigger aria-label="Document template">
                <SelectValue placeholder={templatesQuery.isLoading ? 'Loading templates…' : 'Choose a template'} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {templatesQuery.isSuccess && templates.length === 0 && (
              <p className="mt-1 text-xs text-slate-600">No document templates with text content exist yet.</p>
            )}
            {templatesQuery.isError && <p className="mt-1 text-xs text-red-700">{templatesQuery.error.message}</p>}
          </div>
          <div>
            <Label>Send to</Label>
            <Select value={signerSource} onValueChange={(value) => { runIdRef.current = null; setSignerSource(value); }}>
              <SelectTrigger aria-label="Signer"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="patient">The patient</SelectItem>
                <SelectItem value="caregiver">The patient’s caregiver</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="bulk-due-date">Sign by</Label>
            <Input id="bulk-due-date" type="date" value={dueDate} min={localDatePlusDays(1)} max={localDatePlusDays(89)}
              onChange={(event) => { runIdRef.current = null; setDueDate(event.target.value); }} />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Checkbox id="bulk-send-now" checked={sendNow} onCheckedChange={(value) => setSendNow(value === true)} />
            <Label htmlFor="bulk-send-now">Email signing links now</Label>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="bulk-message">Note to signers (optional)</Label>
            <Textarea id="bulk-message" value={message} maxLength={1000}
              onChange={(event) => { runIdRef.current = null; setMessage(event.target.value); }}
              placeholder="Shown on the signing page. Do not include clinical details." />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Patients ({selected.length} selected, up to {MAX_PATIENTS_PER_RUN})</CardTitle>
          <CardDescription>Patients without an email on file for the chosen signer cannot be selected.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patients" aria-label="Search patients" className="pl-9" />
          </div>
          {patientsQuery.isLoading && <p className="text-sm text-slate-600">Loading patients…</p>}
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {patients.map((patient) => {
              const ok = reachable(patient);
              return (
                <label key={patient.id} className={`flex items-center gap-2 rounded-md border p-2 text-sm ${ok ? 'border-slate-200' : 'border-slate-100 text-slate-400'}`}>
                  <Checkbox
                    checked={selected.includes(patient.id)}
                    disabled={!ok || running}
                    onCheckedChange={(value) => toggle(patient.id, value === true)}
                  />
                  <span>{patientName(patient)}</span>
                  {!ok && <span className="text-xs">(no {signerSource} email)</span>}
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={run} disabled={running || !templateId || !selected.length} className="min-h-[44px] gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          Create {selected.length || ''} request{selected.length === 1 ? '' : 's'}
        </Button>
      </div>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Results</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {results.map((result) => (
                <li key={result.patientId} className={`flex items-start gap-2 ${result.ok ? 'text-green-800' : 'text-red-700'}`}>
                  {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                  <span>
                    {result.name}: {result.ok
                      ? (result.sent === true ? 'request created and link emailed' : result.sent ? `request created; link not sent (${result.sent})` : 'request created')
                      : result.message}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
