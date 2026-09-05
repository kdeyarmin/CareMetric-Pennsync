// Do not ask a recipient to use a signing workflow that is deliberately paused.
Deno.serve(() => Response.json(
  { error: 'Signature reminders are temporarily unavailable.', code: 'signature_reminder_unavailable' },
  { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
));
