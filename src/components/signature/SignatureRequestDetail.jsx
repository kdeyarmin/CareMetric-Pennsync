import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  Award, BellRing, CheckCircle2, Download, Eye, FileSignature, Loader2, Mail, Move, ShieldCheck, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import DocumentPreviewDialog from '@/components/signature/DocumentPreviewDialog';
import SignatureFieldEditor from '@/components/signature/SignatureFieldEditor';
import { updateFields } from '@/components/signature/signatureFieldPlacement';
import {
  LINK_STATUS, isOpenRequest, signerRoleLabel,
} from '@/components/signature/signatureRequestLabels';
import { getAuthorizedDocument } from '@/functions/getAuthorizedDocument';
import { signatureRequestsKey } from '@/hooks/useSignatureRequests';
import { downloadAuthorityBoundBlob } from '@/lib/downloadBlob';
import {
  archiveSignedDocument,
  base64ToBytes,
  cancelSignatureRequest,
  downloadSignatureCertificate,
  getSignatureRequest,
  previewSignatureDocument,
  resendCompletionNotice,
  scheduleSignatureReminder,
  sealSignedDocument,
  sendSignatureReminder,
  sendSigningLink,
  updateSignatureFields,
  verifySignatureIntegrity,
} from '@/lib/esignClient';
import { createPageUrl } from '@/utils';

function formatInstant(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

const CHECK_LABELS = {
  sealed_document_binding: 'Sealed copy is filed to the chart',
  sealed_document_bytes: 'Sealed copy matches its SHA-256',
  source_document_bytes: 'Original document matches what signers reviewed',
  signature_images: 'Every signature image matches its digest',
  sealing_audit_event: 'Sealing is recorded in the audit trail',
};

/**
 * Everything staff can do with one signature request. Each button is one call
 * to a broker that re-checks the caller's membership and chart access.
 */
export default function SignatureRequestDetail({ request, agencyId }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [scheduleFor, setScheduleFor] = useState(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [placementFor, setPlacementFor] = useState(null);
  const [placements, setPlacements] = useState([]);
  const open = isOpenRequest(request);

  const detailQuery = useQuery({
    queryKey: signatureRequestsKey(agencyId, 'detail', request.request_key),
    queryFn: () => getSignatureRequest({ agencyId, requestKey: request.request_key }),
    retry: false,
    staleTime: 0,
  });
  const events = detailQuery.data?.events ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: signatureRequestsKey(agencyId) });

  const run = async (key, action, success) => {
    setBusy(key);
    try {
      const result = await action();
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      await refresh();
      return result;
    } catch (error) {
      toast.error(error?.message || 'That action could not be completed');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const sendLink = (pkg) => run(`link-${pkg.id}`, () => (pkg.link
    ? sendSignatureReminder({ agencyId, packageId: pkg.id, signerId: pkg.signer_id })
    : sendSigningLink({ agencyId, packageId: pkg.id, signerId: pkg.signer_id })),
  pkg.link ? `A new link was emailed to ${pkg.signer_name}; the previous link no longer works` : `Signing link emailed to ${pkg.signer_name}`);

  const schedule = () => {
    const pkg = scheduleFor;
    const sendAt = new Date(scheduleAt);
    if (!pkg || Number.isNaN(sendAt.getTime())) {
      toast.error('Choose when to send the reminder');
      return;
    }
    const documentId = request.documents.find((doc) => doc.status !== 'completed')?.id || request.documents[0]?.id;
    run(`schedule-${pkg.id}`, () => scheduleSignatureReminder({
      agencyId, packageId: pkg.id, signerId: pkg.signer_id, documentId, sendAt: sendAt.toISOString(),
    }), 'Reminder scheduled').then((result) => { if (result) setScheduleFor(null); });
  };

  const showPreview = (doc) => run(`preview-${doc.id}`, async () => {
    const result = await previewSignatureDocument({ agencyId, documentSignatureId: doc.id });
    setPreview({ title: doc.title, description: 'Preview with every signature collected so far. Pending signers show as outlined boxes.', bytes: base64ToBytes(result.pdf_base64) });
    return result;
  });

  const certificate = (doc) => run(`certificate-${doc.id}`, async () => {
    const result = await downloadSignatureCertificate({ agencyId, documentSignatureId: doc.id });
    downloadAuthorityBoundBlob(new Blob([base64ToBytes(result.pdf_base64)], { type: 'application/pdf' }), result.file_name);
    return result;
  }, 'Signature certificate downloaded');

  const downloadSigned = (doc) => run(`download-${doc.id}`, async () => {
    const archive = await archiveSignedDocument({ agencyId, documentSignatureId: doc.id });
    const access = await getAuthorizedDocument({ agencyId, documentId: archive.signed_document_id, purpose: 'download' });
    const link = document.createElement('a');
    link.href = access.delivery.download_url;
    link.download = archive.file_name || 'Signed document.pdf';
    link.rel = 'noopener noreferrer';
    link.click();
    return archive;
  });

  const seal = (doc) => run(`seal-${doc.id}`, () => sealSignedDocument({ agencyId, documentSignatureId: doc.id }),
    'Signed PDF sealed and filed to the chart');

  const verify = (doc) => run(`verify-${doc.id}`, async () => {
    const result = await verifySignatureIntegrity({ agencyId, documentSignatureId: doc.id });
    setIntegrity({ title: doc.title, ...result });
    return result;
  });

  const resend = (doc) => run(`notice-${doc.id}`, () => resendCompletionNotice({ agencyId, documentSignatureId: doc.id }),
    (result) => (result.emailed ? 'Completion notice emailed to the requester' : 'Completion notice recorded'));

  const savePlacement = () => {
    const doc = placementFor;
    run(`fields-${doc.id}`, () => updateSignatureFields({ agencyId, documentSignatureId: doc.id }, updateFields(placements)),
      'Signature boxes saved').then((result) => { if (result) setPlacementFor(null); });
  };

  const cancel = () => run('cancel', () => cancelSignatureRequest({
    agencyId, requestKey: request.request_key, reason: cancelReason.trim(),
  }), (result) => `Request canceled; ${result.revoked_links} signing link(s) revoked`).then((result) => {
    if (result) setCancelOpen(false);
  });

  const signerOptions = (request.packages || []).map((pkg) => ({ key: pkg.signer_id, label: `${pkg.signer_name} (${signerRoleLabel(pkg.signer_role)})` }));

  return (
    <div className="space-y-5 border-t border-slate-200 pt-4">
      {request.message && (
        <p className="whitespace-pre-line rounded-md bg-slate-50 p-3 text-sm text-slate-700">{request.message}</p>
      )}

      <section aria-label="Signers" className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-900">Signers</h4>
        {(request.packages || []).map((pkg) => {
          const done = pkg.status === 'completed' || request.documents.every((doc) => doc.signers.find((signer) => signer.signer_id === pkg.signer_id)?.status === 'completed');
          return (
            <div key={pkg.id} className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <p className="font-medium text-slate-900">
                  {pkg.signer_name} <span className="font-normal text-slate-600">· {signerRoleLabel(pkg.signer_role)}</span>
                </p>
                <p className="text-slate-600">{pkg.signer_email}</p>
                <p className="text-xs text-slate-600">
                  {done ? 'Signed every document' : pkg.link ? `${LINK_STATUS[pkg.link.status] || pkg.link.status}${pkg.link.sent_at ? ` ${formatInstant(pkg.link.sent_at)}` : ''}${pkg.link.expires_at ? ` · expires ${formatInstant(pkg.link.expires_at)}` : ''}${pkg.link.opened_count ? ` · opened ${pkg.link.opened_count}×` : ''}` : 'No link sent yet'}
                  {pkg.reminders?.pending ? ` · ${pkg.reminders.pending} reminder(s) scheduled` : ''}
                </p>
              </div>
              {open && !done && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1" disabled={!!busy} onClick={() => sendLink(pkg)}>
                    {busy === `link-${pkg.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                    {pkg.link ? 'Send new link' : 'Email signing link'}
                  </Button>
                  {pkg.link && (
                    <Button size="sm" variant="ghost" className="gap-1" disabled={!!busy} onClick={() => { setScheduleFor(pkg); setScheduleAt(''); }}>
                      <BellRing className="h-4 w-4" aria-hidden="true" /> Schedule reminder
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section aria-label="Documents" className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-900">Documents</h4>
        {request.documents.map((doc) => {
          const anySigned = doc.signers.some((signer) => signer.status === 'completed');
          return (
            <div key={doc.id} className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-slate-900">{doc.title}</p>
                <div className="flex flex-wrap gap-1">
                  {doc.signers.map((signer) => (
                    <Badge key={signer.signer_id} className={signer.status === 'completed' ? 'bg-green-100 text-green-900' : 'bg-slate-100 text-slate-800'}>
                      {signer.name}: {signer.status === 'completed' ? `signed${signer.capture_method === 'in_person' ? ' in person' : ''}` : 'pending'}
                    </Badge>
                  ))}
                </div>
              </div>
              {doc.status === 'completed' && doc.signature_hash && (
                <p className="break-all text-xs text-slate-600">
                  Sealed {formatInstant(doc.finalized_at)} · SHA-256 {doc.signature_hash}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1" disabled={!!busy} onClick={() => showPreview(doc)}>
                  <Eye className="h-4 w-4" aria-hidden="true" /> Preview
                </Button>
                {open && doc.status !== 'completed' && !doc.sealing_pending && (
                  <Button size="sm" variant="outline" className="gap-1" asChild>
                    <Link to={`${createPageUrl('SignDocument')}?document=${encodeURIComponent(doc.id)}`}>
                      <FileSignature className="h-4 w-4" aria-hidden="true" /> Sign in person
                    </Link>
                  </Button>
                )}
                {open && request.can_manage && !anySigned && doc.status !== 'completed' && (
                  <Button size="sm" variant="ghost" className="gap-1" disabled={!!busy} onClick={() => { setPlacementFor(doc); setPlacements([]); }}>
                    <Move className="h-4 w-4" aria-hidden="true" /> Place signature boxes
                  </Button>
                )}
                {doc.sealing_pending && (
                  <Button size="sm" className="gap-1" disabled={!!busy} onClick={() => seal(doc)}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Seal now
                  </Button>
                )}
                {doc.status === 'completed' && (
                  <>
                    <Button size="sm" className="gap-1" disabled={!!busy} onClick={() => downloadSigned(doc)}>
                      <Download className="h-4 w-4" aria-hidden="true" /> Signed PDF
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" disabled={!!busy} onClick={() => certificate(doc)}>
                      <Award className="h-4 w-4" aria-hidden="true" /> Certificate
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" disabled={!!busy} onClick={() => verify(doc)}>
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verify integrity
                    </Button>
                    {request.can_manage && (
                      <Button size="sm" variant="ghost" className="gap-1" disabled={!!busy} onClick={() => resend(doc)}>
                        <Mail className="h-4 w-4" aria-hidden="true" /> Resend completion notice
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section aria-label="Activity" className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-900">Activity</h4>
        {detailQuery.isLoading && <p className="text-sm text-slate-600">Loading activity…</p>}
        {detailQuery.isError && <p className="text-sm text-amber-800">Activity could not be loaded.</p>}
        {events.length > 0 && (
          <ol className="space-y-1 text-sm">
            {events.slice(0, 30).map((event) => (
              <li key={event.id} className="flex flex-col sm:flex-row sm:gap-3">
                <span className="w-44 shrink-0 text-xs text-slate-600">{formatInstant(event.occurred_at)}</span>
                <span className="text-slate-800">
                  {event.label}
                  {event.signer_name ? ` · ${event.signer_name}` : ''}
                  {event.document_title ? ` · ${event.document_title}` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {open && request.can_manage && (
        <div className="flex justify-end">
          <Button variant="outline" className="gap-1 text-red-700" disabled={!!busy} onClick={() => setCancelOpen(true)}>
            <XCircle className="h-4 w-4" aria-hidden="true" /> Cancel request
          </Button>
        </div>
      )}

      <DocumentPreviewDialog preview={preview} onClose={() => setPreview(null)} />

      <Dialog open={!!integrity} onOpenChange={(value) => { if (!value) setIntegrity(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{integrity?.intact ? 'Integrity verified' : 'Integrity check failed'}</DialogTitle>
            <DialogDescription>{integrity?.title}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {(integrity?.checks || []).map((check) => (
              <li key={check.name} className={check.ok ? 'text-green-800' : 'text-red-700'}>
                {check.ok ? '✓' : '✗'} {CHECK_LABELS[check.name] || check.name}
              </li>
            ))}
          </ul>
          {integrity?.signature_hash && <p className="break-all text-xs text-slate-600">SHA-256 {integrity.signature_hash}</p>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!scheduleFor} onOpenChange={(value) => { if (!value) setScheduleFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule a reminder</DialogTitle>
            <DialogDescription>
              {scheduleFor?.signer_name} will be emailed a fresh link at this time unless they have already signed.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="esign-reminder-at">Send at</Label>
          <Input id="esign-reminder-at" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleFor(null)}>Close</Button>
            <Button onClick={schedule} disabled={!!busy || !scheduleAt}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!placementFor} onOpenChange={(value) => { if (!value) setPlacementFor(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Place signature boxes</DialogTitle>
            <DialogDescription>
              {placementFor?.title}. Saving replaces the current placement. Use Preview to check it before sending links.
            </DialogDescription>
          </DialogHeader>
          <SignatureFieldEditor signers={signerOptions} placements={placements} onChange={setPlacements} disabled={!!busy} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlacementFor(null)}>Close</Button>
            <Button onClick={savePlacement} disabled={!!busy}>Save placement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this signature request?</DialogTitle>
            <DialogDescription>
              Every signing link stops working and scheduled reminders are canceled. Documents already sealed stay in the chart.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="esign-cancel-reason">Reason (optional)</Label>
          <Textarea id="esign-cancel-reason" value={cancelReason} maxLength={500} onChange={(event) => setCancelReason(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep request</Button>
            <Button variant="destructive" onClick={cancel} disabled={!!busy}>Cancel request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
