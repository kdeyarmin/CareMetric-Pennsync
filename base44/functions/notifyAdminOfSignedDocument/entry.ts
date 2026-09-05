// The DocumentSignature-update trigger must not read or email signing data.
Deno.serve(() => Response.json(
  {
    error: 'Signed-document notifications are temporarily unavailable.',
    code: 'signed_document_notification_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
