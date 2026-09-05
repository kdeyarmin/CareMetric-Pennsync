// The entity trigger must not mint or email a bearer link while signing is paused.
Deno.serve(() => Response.json(
  {
    error: 'Signer link delivery is temporarily unavailable.',
    code: 'signer_link_delivery_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
