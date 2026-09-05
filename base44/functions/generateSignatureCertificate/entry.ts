// Signature certificates are unavailable while document signing is quarantined.
Deno.serve(() => Response.json(
  {
    error: 'Signature certificates are temporarily unavailable.',
    code: 'signature_certificate_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
