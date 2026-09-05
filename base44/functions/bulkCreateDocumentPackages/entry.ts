// Bulk document-signing packages are unavailable while signing is quarantined.
Deno.serve(() => Response.json(
  {
    error: 'Bulk document-signing packages are temporarily unavailable.',
    code: 'bulk_document_packages_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
