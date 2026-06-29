import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: opt-in lockdown for this privileged scheduled job (mirrors
    // processTrainingRenewals / syncFaxStatuses). When INTERNAL_FN_SECRET is set,
    // require an admin OR the internal-secret header; the no-identity cron path is
    // allowed only while no secret is configured.
    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin';
    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    if (internalSecret) {
      if (!isAdmin && req.headers.get('x-internal-secret') !== internalSecret) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const now = new Date().toISOString();

    // Get scheduled faxes that are due
    const scheduledFaxes = await base44.asServiceRole.entities.ScheduledFax.filter({
      status: 'pending',
      scheduled_time: { "$lte": now }
    });

    console.log(`Found ${scheduledFaxes.length} scheduled faxes to process`);

    // NOTE: only ONE scheduled-fax processor should be enabled in the platform
    // scheduler (this OR processScheduledFaxesByPriority) — running both will
    // double-send. See docs.

    for (const scheduledFax of scheduledFaxes) {
      // Claim the row (pending -> processing) with a token BEFORE sending, then
      // RE-READ to confirm we own it. A bare status flip isn't atomic: two
      // overlapping runs (or this processor + processScheduledFaxesByPriority)
      // both read 'pending' and both flip it, double-sending the fax. The
      // claim-token + re-read makes the loser detect it lost and skip. (Mirrors
      // dispatchScheduledSms — Twilio fax has no client idempotency key.)
      const runId = crypto.randomUUID();
      try {
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'processing', claimed_by: runId, claimed_at: new Date().toISOString(),
        });
      } catch (claimErr) {
        console.error(`Could not claim scheduled fax ${scheduledFax.id}; skipping`, claimErr);
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.ScheduledFax
        .filter({ id: scheduledFax.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].claimed_by !== runId) {
        // Another run claimed it first — skip to avoid a duplicate send.
        continue;
      }
      try {
        // Use the batch send function for each scheduled fax
        const response = await base44.asServiceRole.functions.invoke('sendBatchFax', {
          file_url: scheduledFax.document_url,
          to_numbers: scheduledFax.to_numbers,
          from_number: scheduledFax.from_number,
          document_name: scheduledFax.document_name,
          patient_id: scheduledFax.patient_id,
          cover_page_details: scheduledFax.cover_page_details,
          priority: scheduledFax.priority
        });

        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'sent'
        });

        console.log(`Processed scheduled fax ${scheduledFax.id}`);
      } catch (error) {
        console.error(`Failed to process scheduled fax ${scheduledFax.id}:`, error);
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'failed'
        });
      }
    }

    return Response.json({
      success: true,
      processed: scheduledFaxes.length
    });

  } catch (error) {
    console.error('Process scheduled faxes error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});