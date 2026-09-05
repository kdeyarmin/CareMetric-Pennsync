// Public signing validation is intentionally unavailable until the response can
// omit raw storage URLs and bind one immutable reviewed artifact to the token.
Deno.serve(() => Response.json(
  {
    error: 'Secure document review and signing are temporarily unavailable.',
    code: 'signer_validation_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
