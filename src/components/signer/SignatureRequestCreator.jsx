import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Plus, Send, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import SignatureFieldEditor from '@/components/signature/SignatureFieldEditor';
import { creationFields } from '@/components/signature/signatureFieldPlacement';
import {
  DOCUMENT_TYPES, SIGNER_ROLES, localDatePlusDays, reminderSendAt, signerRoleLabel,
} from '@/components/signature/signatureRequestLabels';
import { createAuthorizedDocument, createDocumentRequestId } from '@/functions/createAuthorizedDocument';
import { useAuthorizedDocuments } from '@/hooks/useAuthorizedDocuments';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { signatureRequestsKey, useSigningTenant } from '@/hooks/useSignatureRequests';
import {
  createSignatureRequest, newEsignRequestId, scheduleSignatureReminder, sendSigningLink,
} from '@/lib/esignClient';

const SIGNABLE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ ()-]*$/;
let signerSequence = 0;
const blankSigner = () => ({ key: `signer-${(signerSequence += 1)}`, name: '', email: '', role: 'patient' });

function patientName(patient) {
  return [patient?.first_name, patient?.last_name].filter(Boolean).join(' ').trim() || 'Patient';
}

/**
 * Send one or more chart documents to one or more signers. The broker binds
 * each document to the exact bytes filed in the chart, records the creator's
 * agency membership on every row, and refuses a patient the caller cannot open.
 */
export default function SignatureRequestCreator({ onCreated }) {
  const tenant = useSigningTenant();
  const queryClient = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [signers, setSigners] = useState([blankSigner()]);
  const [packageName, setPackageName] = useState('');
  const [documentType, setDocumentType] = useState('consent');
  const [dueDate, setDueDate] = useState(localDatePlusDays(7));
  const [message, setMessage] = useState('');
  const [autoReminders, setAutoReminders] = useState(true);
  const [reminderDays, setReminderDays] = useState(2);
  const [placements, setPlacements] = useState([]);
  const [sendNow, setSendNow] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const requestIdRef = useRef(null);

  const patientsQuery = useScopedPatients({
    purpose: 'contact',
    agencyId: tenant.agencyId || undefined,
    sort: 'last_name',
    limit: 2000,
    enabled: !!tenant.agencyId && tenant.canRequest,
  });
  const patients = patientsQuery.data || [];
  const patient = patients.find((entry) => entry.id === patientId) || null;

  const documentsQuery = useAuthorizedDocuments({
    agencyId: tenant.agencyId || undefined,
    patientId: patientId || null,
    purpose: 'library',
    enabled: !!tenant.agencyId && !!patientId,
  });
  const chartDocuments = useMemo(() => (documentsQuery.data || [])
    .filter((doc) => doc.patient_id === patientId && SIGNABLE_TYPES.has(String(doc.file_type || '').toLowerCase())),
  [documentsQuery.data, patientId]);

  const resetIdentity = () => { requestIdRef.current = null; };
  const change = (setter) => (value) => { resetIdentity(); setter(value); };

  const choosePatient = (id) => {
    resetIdentity();
    setPatientId(id);
    setSelectedDocuments([]);
    setResult(null);
  };

  const toggleDocument = (id, checked) => {
    resetIdentity();
    setSelectedDocuments((current) => (checked ? [...new Set([...current, id])] : current.filter((entry) => entry !== id)));
  };

  const updateSigner = (key, patch) => {
    resetIdentity();
    setSigners((current) => current.map((signer) => (signer.key === key ? { ...signer, ...patch } : signer)));
  };

  const addContact = (kind) => {
    if (!patient) return;
    const contact = kind === 'patient'
      ? { name: patientName(patient), email: patient.email || '', role: 'patient' }
      : { name: patient.caregiver_name || '', email: patient.caregiver_email || '', role: 'caregiver' };
    resetIdentity();
    setSigners((current) => {
      const empty = current.find((signer) => !signer.name && !signer.email);
      if (empty) return current.map((signer) => (signer.key === empty.key ? { ...signer, ...contact } : signer));
      return [...current, { ...blankSigner(), ...contact }];
    });
  };

  const upload = async (file) => {
    if (!file || !patientId || !tenant.agencyId) return;
    if (!SIGNABLE_TYPES.has(String(file.type || '').toLowerCase()) || !SAFE_FILE_NAME.test(file.name)) {
      toast.error('Upload a PDF, PNG or JPEG whose name uses letters, numbers, spaces, dots, dashes or parentheses');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await createAuthorizedDocument({
        file, agencyId: tenant.agencyId, patientId, purpose: 'patient_document', clientRequestId: createDocumentRequestId(),
      });
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      resetIdentity();
      setSelectedDocuments((current) => [...new Set([...current, uploaded.document.id])]);
      toast.success('Document filed to the chart');
    } catch {
      toast.error('The document could not be filed to the chart');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const roster = signers.map((signer) => ({ name: signer.name.trim(), email: signer.email.trim().toLowerCase(), role: signer.role }));
    const problem = !patientId ? 'Choose a patient.'
      : !selectedDocuments.length ? 'Choose at least one chart document.'
        : roster.some((signer) => signer.name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signer.email))
          ? 'Every signer needs a full name and a valid email address.'
          : new Set(roster.map((signer) => signer.email)).size !== roster.length
            ? 'Each signer needs a different email address.' : null;
    if (problem) {
      setError(problem);
      return;
    }
    requestIdRef.current ||= newEsignRequestId('request');
    setSubmitting(true);
    try {
      const created = await createSignatureRequest({
        agency_id: tenant.agencyId,
        patient_id: patientId,
        document_ids: selectedDocuments,
        signers: roster,
        package_name: packageName.trim() || chartDocuments.find((doc) => doc.id === selectedDocuments[0])?.title || 'Signature request',
        document_type: documentType,
        due_date: dueDate,
        message: message.trim() || null,
        signature_fields: creationFields(placements, signers.map((signer) => signer.key)),
        auto_reminders: autoReminders,
        reminder_days_before: reminderDays,
        client_request_id: requestIdRef.current,
      });
      const deliveries = [];
      // The automatic reminder is a scheduled rotation of the signer's link,
      // so it is booked once that link exists, through the same broker staff
      // use by hand (which re-checks chart access).
      const remindAt = autoReminders ? reminderSendAt(dueDate, reminderDays) : null;
      const firstDocumentId = created.request.documents?.[0]?.id;
      if (sendNow) {
        for (const pkg of created.request.packages || []) {
          try {
            await sendSigningLink({ agencyId: tenant.agencyId, packageId: pkg.id, signerId: pkg.signer_id });
            let reminder = null;
            if (remindAt && firstDocumentId) {
              reminder = await scheduleSignatureReminder({
                agencyId: tenant.agencyId, packageId: pkg.id, signerId: pkg.signer_id,
                documentId: firstDocumentId, sendAt: remindAt,
              }).then(() => remindAt, () => false);
            }
            deliveries.push({ name: pkg.signer_name, ok: true, reminder });
          } catch (sendError) {
            deliveries.push({ name: pkg.signer_name, ok: false, message: sendError.message });
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: signatureRequestsKey(tenant.agencyId) });
      setResult({ request: created.request, deliveries });
      requestIdRef.current = null;
      toast.success('Signature request created');
      onCreated?.(created.request);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!tenant.loading && (!tenant.agencyId || !tenant.canRequest)) {
    return (
      <Alert>
        <AlertDescription>
          Signature requests can be sent by agency administrators, managers and clinicians with a verified agency membership.
        </AlertDescription>
      </Alert>
    );
  }

  if (result) {
    return (
      <Card className="border-green-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-800">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Request created
          </CardTitle>
          <CardDescription>{result.request.package_name} · due {result.request.due_date}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {result.deliveries.length > 0 ? (
            <ul className="space-y-1">
              {result.deliveries.map((delivery) => (
                <li key={delivery.name} className={delivery.ok ? 'text-green-800' : 'text-red-700'}>
                  {delivery.ok ? `Signing link emailed to ${delivery.name}` : `${delivery.name}: ${delivery.message}`}
                  {delivery.reminder ? ` · reminder scheduled for ${new Date(delivery.reminder).toLocaleString()}` : ''}
                  {delivery.reminder === false ? ' · the reminder could not be scheduled; schedule it from the request' : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>No links were sent yet. Send them from the request in the All Signatures list.</p>
          )}
          <Button onClick={() => { setResult(null); setSelectedDocuments([]); setPlacements([]); setMessage(''); setPackageName(''); }}>
            Create another request
          </Button>
        </CardContent>
      </Card>
    );
  }

  const signerOptions = signers.map((signer, index) => ({
    key: signer.key,
    label: signer.name ? `${signer.name} (${signerRoleLabel(signer.role)})` : `Signer ${index + 1}`,
  }));

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Patient and documents</CardTitle>
          <CardDescription>Only documents filed to this patient’s chart can be sent for signature.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Patient</Label>
            <Select value={patientId} onValueChange={choosePatient}>
              <SelectTrigger aria-label="Patient"><SelectValue placeholder={patientsQuery.isLoading ? 'Loading patients…' : 'Choose a patient'} /></SelectTrigger>
              <SelectContent>
                {patients.map((entry) => <SelectItem key={entry.id} value={entry.id}>{patientName(entry)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {patientId && (
            <div className="space-y-2">
              <Label>Chart documents</Label>
              {documentsQuery.isFetching && <p className="text-sm text-slate-600">Loading documents…</p>}
              {!documentsQuery.isFetching && chartDocuments.length === 0 && (
                <p className="text-sm text-slate-600">No PDF or image documents are filed to this chart yet.</p>
              )}
              {chartDocuments.map((doc) => (
                <label key={doc.id} className="flex items-center gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <Checkbox checked={selectedDocuments.includes(doc.id)} onCheckedChange={(value) => toggleDocument(doc.id, value === true)} />
                  <span>{doc.title || doc.file_name}</span>
                </label>
              ))}
              <div>
                <Label htmlFor="esign-upload" className="inline-flex cursor-pointer items-center gap-2 text-sm text-navy-700">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                  File a new document to this chart
                </Label>
                <input
                  id="esign-upload"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signers</CardTitle>
          <CardDescription>Each signer gets their own private link by email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {patient && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => addContact('patient')} disabled={!patient.email}>
                Add patient{patient.email ? '' : ' (no email on file)'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => addContact('caregiver')} disabled={!patient.caregiver_email}>
                Add caregiver{patient.caregiver_email ? '' : ' (no email on file)'}
              </Button>
            </div>
          )}
          {signers.map((signer, index) => (
            <div key={signer.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_0.8fr_auto] sm:items-end">
              <div>
                <Label htmlFor={`${signer.key}-name`} className="text-xs">Full name</Label>
                <Input id={`${signer.key}-name`} value={signer.name} onChange={(event) => updateSigner(signer.key, { name: event.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${signer.key}-email`} className="text-xs">Email</Label>
                <Input id={`${signer.key}-email`} type="email" value={signer.email} onChange={(event) => updateSigner(signer.key, { email: event.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Role</Label>
                <Select value={signer.role} onValueChange={(value) => updateSigner(signer.key, { role: value })}>
                  <SelectTrigger aria-label={`Signer ${index + 1} role`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SIGNER_ROLES.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove signer ${index + 1}`}
                disabled={signers.length === 1}
                onClick={() => { resetIdentity(); setSigners((current) => current.filter((entry) => entry.key !== signer.key)); setPlacements((current) => current.filter((entry) => entry.signerKey !== signer.key)); }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1" disabled={signers.length >= 10}
            onClick={() => { resetIdentity(); setSigners((current) => [...current, blankSigner()]); }}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add signer
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="esign-package-name">Request name</Label>
            <Input id="esign-package-name" value={packageName} maxLength={200} placeholder="e.g. Admission consents" onChange={(event) => change(setPackageName)(event.target.value)} />
          </div>
          <div>
            <Label>Document type</Label>
            <Select value={documentType} onValueChange={change(setDocumentType)}>
              <SelectTrigger aria-label="Document type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="esign-due-date">Sign by</Label>
            <Input id="esign-due-date" type="date" value={dueDate} min={localDatePlusDays(1)} max={localDatePlusDays(89)} onChange={(event) => change(setDueDate)(event.target.value)} />
          </div>
          <div className="flex items-end gap-3">
            <div className="flex items-center gap-2 pb-2">
              <Checkbox id="esign-auto-reminders" checked={autoReminders} onCheckedChange={(value) => change(setAutoReminders)(value === true)} />
              <Label htmlFor="esign-auto-reminders">Remind signers</Label>
            </div>
            <div>
              <Label htmlFor="esign-reminder-days" className="text-xs">days before due</Label>
              <Input id="esign-reminder-days" type="number" min={1} max={14} value={reminderDays} disabled={!autoReminders}
                onChange={(event) => change(setReminderDays)(Math.max(1, Math.min(14, Number(event.target.value) || 1)))} className="w-20" />
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="esign-message">Note to signers (optional)</Label>
            <Textarea id="esign-message" value={message} maxLength={1000} onChange={(event) => change(setMessage)(event.target.value)}
              placeholder="Shown on the signing page. Do not include clinical details." />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signature boxes (optional)</CardTitle>
          <CardDescription>Applied to every selected document. You can preview and adjust them from the request before anyone signs.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignatureFieldEditor signers={signerOptions} placements={placements} onChange={change(setPlacements)} disabled={submitting} />
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Checkbox id="esign-send-now" checked={sendNow} onCheckedChange={(value) => setSendNow(value === true)} />
          <Label htmlFor="esign-send-now">Email signing links now</Label>
        </div>
        <Button type="submit" disabled={submitting || uploading} className="min-h-[44px] gap-2">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          Create signature request
        </Button>
      </div>
    </form>
  );
}
