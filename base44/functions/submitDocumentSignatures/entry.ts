// Internal signature submission is intentionally unavailable until read and
// write brokers share one exact tenant, document revision, and reviewed digest.
Deno.serve(() => Response.json(
  {
    error: 'Document review and signature submission are temporarily unavailable.',
    code: 'document_signature_submission_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
