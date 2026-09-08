// Template-based signing documents are unavailable while signing is quarantined.
Deno.serve(() => Response.json(
  {
    error: 'Template-based signing documents are temporarily unavailable.',
    code: 'document_package_generation_unavailable',
  },
  {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  },
));
