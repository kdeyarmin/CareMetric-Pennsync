// The pending-signature notifier stays paused with the document-signing capability.
Deno.serve(() => Response.json(
  { error: 'Signature reminders are temporarily unavailable.', code: 'pending_signature_notification_unavailable' },
  { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
));
