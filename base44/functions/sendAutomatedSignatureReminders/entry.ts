// Automated reminders stay paused with the document-signing capability.
Deno.serve(() => Response.json(
  { error: 'Signature reminders are temporarily unavailable.', code: 'automated_signature_reminder_unavailable' },
  { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
));
