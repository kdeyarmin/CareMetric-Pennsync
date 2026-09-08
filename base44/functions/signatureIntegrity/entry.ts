// Signature-integrity reads and mutations are unavailable during quarantine.
Deno.serve(() => Response.json(
  {
    error: 'Signature integrity processing is temporarily unavailable.',
    code: 'signature_integrity_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
