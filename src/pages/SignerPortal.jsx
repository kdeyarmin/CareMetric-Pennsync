import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Lock } from 'lucide-react';
import { publicCapabilityClient } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import LoadingState from '@/components/ui/LoadingState';
import SignerPackageViewer from '@/components/signer/SignerPackageViewer';
import { APP_NAME, PLATFORM_NAME } from '@/lib/brand';
import { usePublicCapabilityLease } from '@/lib/PublicCapabilityContext';
import { scrubPublicCapabilityParameter } from '@/lib/publicCapabilityUrl';

// A review URL lives sixty seconds; refresh it before it can lapse mid-load.
const REVIEW_URL_REFRESH_MS = 45 * 1000;

function initialToken() {
  if (typeof window === 'undefined') return '';
  return new URL(window.location.href).searchParams.get('token') || '';
}

function functionData(value) {
  return value && typeof value === 'object' && Object.hasOwn(value, 'data') ? value.data : value;
}

function publicError(error, fallback) {
  const data = error?.response?.data || error?.data;
  const message = typeof data?.error === 'string' && data.error.length <= 500 ? data.error : fallback;
  return { message, code: typeof data?.code === 'string' ? data.code : null, status: error?.response?.status ?? null };
}

function newRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `sign-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Public signing portal for an outside signer. The emailed link's bearer is
 * read once, scrubbed from the address bar before anything renders, and only
 * ever sent to the exact validate/submit pair fenced by this URL's capability
 * lease. The page receives that signer's own package and nothing else.
 */
export default function SignerPortal() {
  const lease = usePublicCapabilityLease();
  const [token] = useState(initialToken);
  const started = useRef(false);
  const [phase, setPhase] = useState('loading');
  const [failure, setFailure] = useState(null);
  const [pkg, setPkg] = useState(null);
  // The latest validation, read by the stable document loader below.
  const latest = useRef({ pkg: null, validatedAt: 0 });

  useLayoutEffect(() => {
    scrubPublicCapabilityParameter('token');
  }, []);

  const validate = useCallback(async () => {
    const result = await publicCapabilityClient.validateSignerToken(lease, { token });
    const data = functionData(result);
    if (!data?.valid) throw Object.assign(new Error('invalid'), { data });
    latest.current = { pkg: data, validatedAt: Date.now() };
    setPkg(data);
    return data;
  }, [lease, token]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setFailure({ message: 'This link is missing its access code. Please use the link from your email.' });
      setPhase('invalid');
      return;
    }
    validate()
      .then((data) => {
        const pending = (data.documents || []).filter((doc) => doc.status !== 'completed');
        setPhase(pending.length ? 'ready' : 'done');
      })
      .catch((error) => {
        setFailure(publicError(error, 'This signing link is not valid or has expired.'));
        setPhase('invalid');
      });
  }, [token, validate]);

  /** Fresh review URLs and nonces, used when the current ones may have lapsed. */
  const refresh = useCallback(async () => {
    try {
      return await validate();
    } catch (error) {
      setFailure(publicError(error, 'This signing link is no longer valid.'));
      setPhase('invalid');
      return null;
    }
  }, [validate]);

  const loadDocumentBytes = useCallback(async (documentId) => {
    let current = latest.current.pkg;
    let doc = current?.documents?.find((entry) => entry.id === documentId);
    if (!doc?.review_url || Date.now() - latest.current.validatedAt > REVIEW_URL_REFRESH_MS) {
      current = await refresh();
      doc = current?.documents?.find((entry) => entry.id === documentId);
    }
    if (!doc?.review_url) throw new Error('This document is not available for review');
    // A review URL is good for one read; the next look gets a fresh one.
    latest.current = {
      ...latest.current,
      pkg: { ...current, documents: current.documents.map((entry) => (entry.id === documentId ? { ...entry, review_url: null } : entry)) },
    };
    return {
      bytes: await publicCapabilityClient.fetchSignerReviewDocument(lease, doc.review_url),
      reviewNonce: doc.review_nonce,
    };
  }, [lease, refresh]);

  const submitSignature = useCallback(async ({ documentId, reviewNonce, typedName, file, clientRequestId }) => {
    try {
      const result = await publicCapabilityClient.submitSignerSignature(lease, {
        token,
        review_nonce: reviewNonce,
        document_id: documentId,
        signature_file: file,
        typed_name: typedName,
        agreement_version: pkg.agreement.version,
        client_request_id: clientRequestId || newRequestId(),
      });
      const data = functionData(result);
      if (!data?.success) throw Object.assign(new Error('failed'), { data });
      const markSigned = (current) => (current ? {
        ...current,
        documents: current.documents.map((doc) => (doc.id === documentId
          ? { ...doc, status: 'completed', signed_at: new Date().toISOString(), review_url: null }
          : doc)),
      } : current);
      latest.current = { ...latest.current, pkg: markSigned(latest.current.pkg) };
      setPkg(markSigned);
      if (data.all_signed) setPhase('done');
      return data;
    } catch (error) {
      const { message, code, status } = publicError(error, 'Your signature could not be recorded. Please try again.');
      throw Object.assign(new Error(message), { code, status });
    }
  }, [lease, pkg, token]);

  return (
    <>
      <title>{`Document signing | ${APP_NAME} by ${PLATFORM_NAME}`}</title>
      <main className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Secure document signing</h1>
              <p className="text-sm text-slate-600">
                {pkg?.agency_name ? `Requested by ${pkg.agency_name}` : `${APP_NAME} by ${PLATFORM_NAME}`}
              </p>
            </div>
            <span className="flex items-center gap-2 text-sm text-slate-600">
              <Lock className="h-4 w-4" aria-hidden="true" /> Private link
            </span>
          </div>
        </header>

        <div className="mx-auto max-w-4xl px-4 py-8">
          {phase === 'loading' && <LoadingState label="Opening your documents…" />}

          {phase === 'invalid' && (
            <Card className="border-red-200" role="alert">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-700">
                  <AlertCircle className="h-5 w-5" aria-hidden="true" /> This link can’t be used
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p>{failure?.message || 'This signing link is not valid or has expired.'}</p>
                <p className="text-xs text-slate-600">
                  Signing links expire and stop working once a newer link is sent. Ask the agency that
                  contacted you to send a new link.
                </p>
              </CardContent>
            </Card>
          )}

          {phase === 'done' && (
            <Card className="border-green-200" role="status">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> All documents signed
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p>
                  Thank you{pkg?.signer_name ? `, ${pkg.signer_name}` : ''}. Every document in this request has
                  been signed. The signed copy is sealed and kept with the agency’s records.
                </p>
                <p className="text-xs text-slate-600">For your security this link is now closed. You may close this window.</p>
              </CardContent>
            </Card>
          )}

          {phase === 'ready' && pkg && (
            <SignerPackageViewer
              packageData={pkg}
              onLoadDocument={loadDocumentBytes}
              onSubmitSignature={submitSignature}
            />
          )}

          <p className="mt-8 text-xs leading-relaxed text-slate-600">
            This page is reachable only through the private link sent to you. Do not forward it. Your signature,
            the time you signed, and a fingerprint of each document you reviewed are recorded so the signed copy
            can be verified later.
          </p>
        </div>
      </main>
    </>
  );
}
