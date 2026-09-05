// Public provider follow-up submission is intentionally unavailable until item
// authorization and a single-use claim can be enforced atomically.
Deno.serve(() => Response.json(
  {
    error: 'Online provider follow-up is temporarily unavailable.',
    code: 'provider_follow_up_submission_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
