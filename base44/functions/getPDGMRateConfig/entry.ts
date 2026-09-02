// Browser-facing PDGM rate reads are paused for the same reason as writes: the
// hosted tenant/membership claims are not yet an immutable authorization
// boundary. Return no configuration before auth, request parsing, or service
// access so a caller can neither enumerate nor inherit another tenant's rates.
Deno.serve(() => Response.json({
  error: 'PDGM rate configuration is unavailable',
  configReadsAvailable: false,
  config: null,
  paymentAvailable: false,
  message: 'PDGM reference-rate access remains paused pending a tenant-bound protected broker and verified CMS grouper.',
}, { status: 409 }));
