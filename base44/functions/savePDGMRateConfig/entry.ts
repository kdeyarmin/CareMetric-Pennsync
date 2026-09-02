// PDGM rate configuration writes are paused. Base44's current caller/Agency
// membership fields are not a proven immutable tenant authority, and no rate
// configuration can make the legacy factorized estimator an official CMS HHGS
// 432-group grouper. Return before auth, body parsing, or service-role writes.
Deno.serve(() => Response.json({
  error: 'PDGM rate configuration is unavailable',
  configWritesAvailable: false,
  paymentAvailable: false,
  message: 'No PDGM rate set can be saved or marked official until a tenant-bound protected writer and verified CMS grouper are implemented.',
  actionRequired: [
    'Use the official EMR/CMS-approved grouper for billing and reimbursement decisions.',
    'Implement a server-owned immutable tenant authority before enabling PDGM rate configuration.',
  ],
}, { status: 409 }));
