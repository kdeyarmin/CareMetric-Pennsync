// Existing reminder rows must not dispatch while document signing is unavailable.
Deno.serve(() => Response.json(
  { error: 'Signature reminders are temporarily unavailable.', code: 'signature_reminder_dispatch_unavailable' },
  { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
));
