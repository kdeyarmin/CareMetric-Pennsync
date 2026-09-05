// Public signature submission is intentionally unavailable until the server can
// require a token-bound review nonce, immutable byte digest, and signature artifact.
Deno.serve(() => Response.json(
  {
    error: 'Secure document review and signing are temporarily unavailable.',
    code: 'signer_submission_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
