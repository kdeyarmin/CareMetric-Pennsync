// Do not queue reminders for a signing workflow that is deliberately paused.
Deno.serve(() => Response.json(
  { error: 'Signature reminders are temporarily unavailable.', code: 'signature_reminder_schedule_unavailable' },
  { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
));
