import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Send } from 'lucide-react';
import { publicCapabilityClient } from '@/api/base44Client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LoadingState from '@/components/ui/LoadingState';
import { Textarea } from '@/components/ui/textarea';
import { APP_NAME, PLATFORM_NAME } from '@/lib/brand';
import { usePublicCapabilityLease } from '@/lib/PublicCapabilityContext';
import { scrubPublicCapabilityParameter } from '@/lib/publicCapabilityUrl';

function initialToken() {
  if (typeof window === 'undefined') return '';
  return new URL(window.location.href).searchParams.get('token') || '';
}

function functionData(value) {
  return value && typeof value === 'object' && Object.hasOwn(value, 'data')
    ? value.data
    : value;
}

function publicErrorMessage(error, fallback) {
  const candidate = error?.response?.data?.error || error?.data?.error;
  return typeof candidate === 'string' && candidate.length <= 500 ? candidate : fallback;
}

/**
 * Public, single-use provider response portal. Its only data seam is the exact
 * validate/submit function pair fenced by the current URL capability lease.
 * The browser never receives a Base44 entity client or a generic invoke method.
 */
export default function ProviderFollowUpPortal() {
  const lease = usePublicCapabilityLease();
  const [token] = useState(initialToken);
  const validationStarted = useRef(false);
  const [phase, setPhase] = useState('loading');
  const [message, setMessage] = useState('');
  const [request, setRequest] = useState(null);
  const [answers, setAnswers] = useState({});
  const [completedBy, setCompletedBy] = useState('');
  const [credential, setCredential] = useState('');
  const [submittedNow, setSubmittedNow] = useState(false);

  useLayoutEffect(() => {
    scrubPublicCapabilityParameter('token');
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (validationStarted.current) return undefined;
    validationStarted.current = true;
    if (!token) {
      setMessage('This link is missing its access token.');
      setPhase('invalid');
      return undefined;
    }
    publicCapabilityClient.validateFollowUpToken(lease, { token })
      .then((result) => {
        if (cancelled) return;
        const data = functionData(result);
        if (!data?.valid) {
          setMessage(data?.error || 'This link is not valid.');
          setPhase('invalid');
          return;
        }
        setRequest(data);
        if (data.already_submitted || data.request_status === 'received' || data.request_status === 'resolved') {
          setPhase('done');
        } else {
          setPhase('ready');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(publicErrorMessage(
          error,
          'Unable to open this request. Please try again or contact the agency.',
        ));
        setPhase('invalid');
      });
    return () => {
      cancelled = true;
    };
  }, [lease, token]);

  const openItems = (request?.items || []).filter((item) => item.item_status === 'open');
  const answeredCount = openItems.filter((item) => (answers[item.item_id] || '').trim()).length;

  const submit = async () => {
    setMessage('');
    const responses = openItems
      .map((item) => ({
        item_id: item.item_id,
        response_text: (answers[item.item_id] || '').trim(),
      }))
      .filter((response) => response.response_text);
    if (responses.length === 0) {
      setMessage('Please answer at least one item before submitting.');
      return;
    }
    setPhase('submitting');
    try {
      const result = await publicCapabilityClient.submitFollowUpResponse(lease, {
        token,
        responses,
        completed_by: completedBy,
        credential,
      });
      const data = functionData(result);
      if (!data?.success) throw Object.assign(new Error('Submission failed'), { data });
      setRequest((current) => ({ ...current, already_submitted: true, request_status: 'received' }));
      setSubmittedNow(true);
      setPhase('done');
    } catch (error) {
      setMessage(publicErrorMessage(
        error,
        'Submission failed. Please try again or return the paper form using the agency contact information.',
      ));
      setPhase('ready');
    }
  };

  return (
    <>
      <title>{`Referral information request | ${APP_NAME} by ${PLATFORM_NAME}`}</title>
      <main className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-navy-800">
            <ClipboardCheck className="w-7 h-7" aria-hidden="true" />
            <h1 className="text-xl font-bold">Home Health Referral — Information Request</h1>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Secure response portal. Your answers go directly to the home health agency.
          </p>
        </div>

        {phase === 'loading' && (
          <Card>
            <CardContent className="p-10 text-center">
              <LoadingState label="Opening your request…" className="py-0" />
            </CardContent>
          </Card>
        )}

        {phase === 'invalid' && (
          <Card className="border-2 border-red-300" role="alert">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" aria-hidden="true" />
              <p className="text-slate-800 font-semibold mb-1">This link can&apos;t be opened</p>
              <p className="text-sm text-slate-600">{message}</p>
            </CardContent>
          </Card>
        )}

        {phase === 'done' && (
          <Card className="border-2 border-green-300 bg-green-50" role="status">
            <CardContent className="p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" aria-hidden="true" />
              <p className="text-green-900 font-semibold mb-1">
                {submittedNow ? 'Thank you — responses sent' : 'This request was already completed'}
              </p>
              <p className="text-sm text-green-800">
                The agency can now review the response. Contact the agency directly if a correction is needed.
              </p>
            </CardContent>
          </Card>
        )}

        {(phase === 'ready' || phase === 'submitting') && request && (
          <>
            <Card>
              <CardContent className="p-4 text-sm text-slate-700">
                <p>
                  <span className="font-semibold">Patient:</span> {request.patient_name || '—'}
                  {request.patient_dob ? ` · DOB ${request.patient_dob}` : ''}
                  {request.referral_date ? ` · Referral ${request.referral_date}` : ''}
                </p>
                {request.provider_name && (
                  <p className="mt-1">
                    <span className="font-semibold">Provider:</span> {request.provider_name}
                  </p>
                )}
                <p className="mt-2 text-slate-600">
                  Please answer the requested items below. Only this request and the minimum patient identifiers
                  needed to identify it are available through this link.
                </p>
              </CardContent>
            </Card>

            {openItems.length === 0 && (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="p-6 text-center text-sm text-green-900">
                  <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" aria-hidden="true" />
                  Every item on this request has already been answered. Contact the agency directly with corrections.
                </CardContent>
              </Card>
            )}

            {openItems.map((item) => (
              <Card key={item.item_id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">#{item.number}</Badge>
                    {item.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-slate-800">{item.question}</p>
                  {item.hint && <p className="text-xs text-slate-500">{item.hint}</p>}
                  {(item.why || item.citation) && (
                    <p className="text-xs text-slate-500">
                      <span className="font-semibold">Why it&apos;s needed:</span>{' '}
                      {item.why}{item.citation ? ` (${item.citation})` : ''}
                    </p>
                  )}
                  {item.response_type === 'document' && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                      Describe the document or paste the relevant content here. Use the agency&apos;s approved return
                      method if the document itself must be sent.
                    </p>
                  )}
                  <Label htmlFor={`provider-response-${item.item_id}`} className="sr-only">
                    Response for {item.title || `item ${item.number}`}
                  </Label>
                  <Textarea
                    id={`provider-response-${item.item_id}`}
                    value={answers[item.item_id] || ''}
                    onChange={(event) => setAnswers((current) => ({
                      ...current,
                      [item.item_id]: event.target.value,
                    }))}
                    placeholder="Type your response…"
                    rows={3}
                    maxLength={4000}
                    disabled={phase === 'submitting'}
                  />
                </CardContent>
              </Card>
            ))}

            {openItems.length > 0 && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="pf-name" className="text-xs">Completed by (name)</Label>
                      <Input
                        id="pf-name"
                        value={completedBy}
                        onChange={(event) => setCompletedBy(event.target.value)}
                        placeholder="Jane Smith"
                        maxLength={200}
                        disabled={phase === 'submitting'}
                      />
                    </div>
                    <div>
                      <Label htmlFor="pf-cred" className="text-xs">Credential or role</Label>
                      <Input
                        id="pf-cred"
                        value={credential}
                        onChange={(event) => setCredential(event.target.value)}
                        placeholder="MD, DO, RN, office staff…"
                        maxLength={50}
                        disabled={phase === 'submitting'}
                      />
                    </div>
                  </div>
                  {message && (
                    <Alert className="bg-red-50 border-red-300" role="alert">
                      <AlertTriangle className="w-4 h-4 text-red-600" aria-hidden="true" />
                      <AlertDescription className="text-sm text-red-800">{message}</AlertDescription>
                    </Alert>
                  )}
                  <Button
                    type="button"
                    className="w-full bg-navy-600 hover:bg-navy-700 min-h-[44px]"
                    onClick={submit}
                    disabled={phase === 'submitting'}
                  >
                    <Send className="w-4 h-4 mr-2" aria-hidden="true" />
                    {phase === 'submitting'
                      ? 'Sending…'
                      : `Send ${answeredCount || ''} response${answeredCount === 1 ? '' : 's'} to the agency`}
                  </Button>
                  <p className="text-xs text-slate-500 text-center">
                    This link is single-use. Responses cannot be changed here after submission.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
      </main>
    </>
  );
}
