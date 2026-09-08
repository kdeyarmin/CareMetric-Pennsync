// The DocumentSignature-update trigger must not mutate packages or send email.
Deno.serve(() => Response.json(
  {
    error: 'Document-signing completion processing is temporarily unavailable.',
    code: 'document_signing_completion_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
