import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DocumentBytesViewer from '@/components/signature/DocumentBytesViewer';
import SignaturePadCanvas from '@/components/signature/SignaturePadCanvas';
import { signatureFileFromDataUrl } from '@/lib/signatureFile';

function newRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `sign-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * One document for an outside signer: the exact bytes the review grant was
 * issued for, the consent text, a typed name and a drawn or typed signature.
 * The submit button stays disabled until the document has been displayed and
 * consent is given; the server re-checks every one of those facts.
 */
export default function SignerDocumentSigner({
  document,
  signerName,
  agreement,
  onLoadDocument,
  onSubmitSignature,
  onDone,
  onCancel,
}) {
  const [review, setReview] = useState({ status: 'loading', bytes: null, nonce: null, error: null });
  const [typedName, setTypedName] = useState(signerName || '');
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(null);

  const load = useCallback(() => {
    setReview({ status: 'loading', bytes: null, nonce: null, error: null });
    onLoadDocument(document.id)
      .then(({ bytes, reviewNonce }) => setReview({ status: 'ready', bytes, nonce: reviewNonce, error: null }))
      .catch((loadError) => setReview({
        status: 'error', bytes: null, nonce: null,
        error: loadError?.message || 'The document could not be opened.',
      }));
  }, [document.id, onLoadDocument]);

  useEffect(() => { load(); }, [load]);

  const canSubmit = review.status === 'ready' && consent && typedName.trim().length >= 2 && !!signature && !submitting;

  const submit = async () => {
    setError(null);
    let file;
    try {
      file = signatureFileFromDataUrl(signature);
    } catch (fileError) {
      setError(fileError.message);
      return;
    }
    setSubmitting(true);
    requestIdRef.current ||= newRequestId();
    try {
      await onSubmitSignature({
        documentId: document.id,
        reviewNonce: review.nonce,
        typedName: typedName.trim(),
        file,
        clientRequestId: requestIdRef.current,
      });
      onDone();
    } catch (submitError) {
      setError(submitError?.message || 'Your signature could not be recorded. Please try again.');
      // A lapsed review grant needs the document shown again with a fresh one.
      if (submitError?.status === 401 || submitError?.status === 409) {
        requestIdRef.current = null;
        load();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onCancel} className="gap-2">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to all documents
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{document.name}</CardTitle>
        </CardHeader>
        <CardContent>
          {review.status === 'loading' && (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-600" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Opening the document…
            </div>
          )}
          {review.status === 'error' && (
            <div className="space-y-3" role="alert">
              <p className="text-sm text-red-700">{review.error}</p>
              <Button variant="outline" onClick={load} className="gap-2">
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
              </Button>
            </div>
          )}
          {review.status === 'ready' && <DocumentBytesViewer bytes={review.bytes} title={document.name} />}
        </CardContent>
      </Card>

      {review.status === 'ready' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign this document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {agreement?.text && (
              <div className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {agreement.text}
              </div>
            )}
            <div className="flex items-start gap-2">
              <Checkbox id={`consent-${document.id}`} checked={consent} onCheckedChange={(value) => setConsent(value === true)} />
              <Label htmlFor={`consent-${document.id}`} className="text-sm leading-snug">
                I have reviewed this document and I agree to sign it electronically under the terms above.
              </Label>
            </div>
            <div>
              <Label htmlFor={`typed-name-${document.id}`} className="text-sm">Your full name</Label>
              <Input
                id={`typed-name-${document.id}`}
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                autoComplete="name"
                className="mt-2"
              />
              <p className="mt-1 text-xs text-slate-600">It must match the name the request was sent to.</p>
            </div>
            <SignaturePadCanvas onSignatureCapture={setSignature} disabled={submitting} />
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button onClick={submit} disabled={!canSubmit} className="min-h-[44px] w-full">
              {submitting ? 'Recording your signature…' : 'Sign document'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
