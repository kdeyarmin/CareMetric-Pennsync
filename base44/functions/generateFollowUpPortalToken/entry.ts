// Do not mint bearer links for a portal that is deliberately unavailable.
Deno.serve(() => Response.json(
  {
    error: 'Provider follow-up link generation is temporarily unavailable.',
    code: 'provider_follow_up_token_mint_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
