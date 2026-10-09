import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Loader2, Pen } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LoadingState from '@/components/ui/LoadingState';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DocumentBytesViewer from '@/components/signature/DocumentBytesViewer';
import SignaturePadCanvas from '@/components/signature/SignaturePadCanvas';
import { signerRoleLabel } from '@/components/signature/signatureRequestLabels';
import { signatureRequestsKey, useSignatureRequests } from '@/hooks/useSignatureRequests';
import {
  base64ToBytes, getSignatureAgreement, newEsignRequestId, previewSignatureDocument, signInPerson, signatureFileFromDataUrl,
} from '@/lib/esignClient';
import { createPageUrl } from '@/utils';

/**
 * In-person signing on a staff device: the signer reviews the document with
 * the clinician, reads the consent text, and signs here. The clinician must
 * confirm the signer's identity; the broker records who collected it.
 */
export default function SignDocument() {
  const [searchParams, setSearchParams] = useSearchParams();
  const documentId = searchParams.get('document') || '';
  const queryClient = useQueryClient();
  const requestsQuery = useSignatureRequests({ status: 'open' });
  const { tenant } = requestsQuery;

  const openDocuments = useMemo(() => requestsQuery.requests.flatMap((request) => request.documents
    .filter((doc) => doc.status !== 'completed' && !doc.sealing_pending && ['pending', 'partial'].includes(doc.workflow_status))
    .map((doc) => ({ ...doc, request }))), [requestsQuery.requests]);
  const current = openDocuments.find((doc) => doc.id === documentId) || null;
  const pendingSigners = (current?.signers || []).filter((signer) => signer.status !== 'completed');

  const [signerId, setSignerId] = useState('');
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [signature, setSignature] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const requestIdRef = useRef(null);

  useEffect(() => {
    setSignerId('');
    setIdentityConfirmed(false);
    setConsent(false);
    setTypedName('');
    setSignature(null);
    setError(null);
    setDone(null);
    requestIdRef.current = null;
  }, [documentId]);

  const signer = pendingSigners.find((entry) => entry.signer_id === signerId) || null;
  const chooseSigner = (id) => {
    setSignerId(id);
    setTypedName(pendingSigners.find((entry) => entry.signer_id === id)?.name || '');
    requestIdRef.current = null;
  };

  const agreementQuery = useQuery({
    queryKey: signatureRequestsKey(tenant.agencyId, 'agreement'),
    queryFn: () => getSignatureAgreement({ agencyId: tenant.agencyId }),
    enabled: !!tenant.agencyId && !!current,
    retry: false,
  });
  const previewQuery = useQuery({
    queryKey: signatureRequestsKey(tenant.agencyId, 'preview', documentId),
    queryFn: async () => base64ToBytes((await previewSignatureDocument({ agencyId: tenant.agencyId, documentSignatureId: documentId })).pdf_base64),
    enabled: !!tenant.agencyId && !!current,
    retry: false,
    staleTime: 0,
  });

  const agreement = agreementQuery.data?.agreement;
  const canSubmit = !!signer && identityConfirmed && consent && typedName.trim().length >= 2 && !!signature && !!agreement && !submitting;

  const submit = async () => {
    setError(null);
    let file;
    try {
      file = signatureFileFromDataUrl(signature);
    } catch (fileError) {
      setError(fileError.message);
      return;
    }
    requestIdRef.current ||= newEsignRequestId('in-person');
    setSubmitting(true);
    try {
      const result = await signInPerson({
        agencyId: tenant.agencyId,
        documentSignatureId: current.id,
        signerId: signer.signer_id,
        typedName: typedName.trim(),
        agreementVersion: agreement.version,
        file,
        clientRequestId: requestIdRef.current,
      });
      setDone({ name: signer.name, completed: result.document_completed === true });
      toast.success(`Signature recorded for ${signer.name}`);
      await queryClient.invalidateQueries({ queryKey: signatureRequestsKey(tenant.agencyId) });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Pen}
        eyebrow="Documentation"
        title="Sign Document"
        description="Collect a signature in person on this device"
        favoritePage="SignDocument"
      />

      {!tenant.loading && !tenant.canRequest && (
        <Alert>
          <AlertDescription>
            In-person signatures can be collected by agency administrators, managers and clinicians with a verified agency membership.
          </AlertDescription>
        </Alert>
      )}

      {tenant.canRequest && requestsQuery.isLoading && <LoadingState label="Loading open signature requests…" />}
      {requestsQuery.isError && (
        <Alert variant="destructive"><AlertDescription>{requestsQuery.error?.message}</AlertDescription></Alert>
      )}

      {tenant.canRequest && requestsQuery.isSuccess && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Document</CardTitle>
              <CardDescription>Choose an open request document for a patient whose chart you can open.</CardDescription>
            </CardHeader>
            <CardContent>
              {openDocuments.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No documents are waiting for signature. Create a request from the{' '}
                  <Link className="text-navy-700 underline" to={`${createPageUrl('DocumentHub')}?tab=signatures&view=create`}>Document Hub</Link>.
                </p>
              ) : (
                <Select value={current ? current.id : ''} onValueChange={(value) => setSearchParams({ document: value })}>
                  <SelectTrigger aria-label="Document to sign"><SelectValue placeholder="Choose a document" /></SelectTrigger>
                  <SelectContent>
                    {openDocuments.map((doc) => (
                      <SelectItem key={doc.id} value={doc.id}>{`${doc.request.patient_name} — ${doc.title}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {current && done && (
            <Card className="border-green-200">
              <CardContent className="space-y-3 pt-6 text-sm">
                <p className="flex items-center gap-2 font-medium text-green-800">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Signature recorded for {done.name}.
                </p>
                <p className="text-slate-700">
                  {done.completed
                    ? 'Every required signer has signed. The sealed PDF has been filed to the patient’s chart.'
                    : 'Other signers still need to sign this document.'}
                </p>
                <Button asChild variant="outline">
                  <Link to={`${createPageUrl('DocumentHub')}?tab=signatures`}>Back to signature requests</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {current && !done && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{current.title}</CardTitle>
                  <CardDescription>{current.request.patient_name} · review this document with the signer</CardDescription>
                </CardHeader>
                <CardContent>
                  {previewQuery.isLoading && (
                    <p className="flex items-center gap-2 text-sm text-slate-600" role="status">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Preparing the document…
                    </p>
                  )}
                  {previewQuery.isError && <p className="text-sm text-red-700">{previewQuery.error?.message}</p>}
                  {previewQuery.data && <DocumentBytesViewer bytes={previewQuery.data} title={current.title} />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Signer</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Select value={signerId} onValueChange={chooseSigner}>
                    <SelectTrigger aria-label="Signer"><SelectValue placeholder="Who is signing?" /></SelectTrigger>
                    <SelectContent>
                      {pendingSigners.map((entry) => (
                        <SelectItem key={entry.signer_id} value={entry.signer_id}>{`${entry.name} (${signerRoleLabel(entry.role)})`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {signer && (
                    <>
                      <div className="flex items-start gap-2">
                        <Checkbox id="esign-identity" checked={identityConfirmed} onCheckedChange={(value) => setIdentityConfirmed(value === true)} />
                        <Label htmlFor="esign-identity" className="text-sm leading-snug">
                          I confirmed in person that the person signing is {signer.name}.
                        </Label>
                      </div>
                      {agreementQuery.isError && <p className="text-sm text-red-700">{agreementQuery.error?.message}</p>}
                      {agreement && (
                        <div className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          {agreement.text}
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <Checkbox id="esign-consent" checked={consent} onCheckedChange={(value) => setConsent(value === true)} />
                        <Label htmlFor="esign-consent" className="text-sm leading-snug">
                          The signer has reviewed the document and agrees to sign it electronically under the terms above.
                        </Label>
                      </div>
                      <div>
                        <Label htmlFor="esign-typed-name">Signer’s full name</Label>
                        <Input id="esign-typed-name" value={typedName} onChange={(event) => setTypedName(event.target.value)} className="mt-2" />
                      </div>
                      <SignaturePadCanvas onSignatureCapture={setSignature} disabled={submitting} />
                      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                      <Button onClick={submit} disabled={!canSubmit} className="min-h-[44px] w-full">
                        {submitting ? 'Recording signature…' : 'Record signature'}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </PageContainer>
  );
}
