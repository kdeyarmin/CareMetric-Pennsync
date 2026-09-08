// Signed-document archival is unavailable while document signing is quarantined.
Deno.serve(() => Response.json(
  {
    error: 'Signed-document archival is temporarily unavailable.',
    code: 'signed_document_archival_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
