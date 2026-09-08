// PDF signature stamping is unavailable while document signing is quarantined.
Deno.serve(() => Response.json(
  {
    error: 'PDF signature stamping is temporarily unavailable.',
    code: 'signature_pdf_stamping_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
