// Public provider follow-up validation is intentionally unavailable until tokens
// carry an immutable item snapshot and exact single-use lifecycle provenance.
Deno.serve(() => Response.json(
  {
    error: 'Online provider follow-up is temporarily unavailable.',
    code: 'provider_follow_up_validation_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
