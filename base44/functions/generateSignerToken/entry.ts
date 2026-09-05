// Do not mint bearer links for a portal that is deliberately unavailable.
Deno.serve(() => Response.json(
  {
    error: 'Signer link generation is temporarily unavailable.',
    code: 'signer_token_mint_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
