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

    const now = new Date();

    // Get pending faxes that are actually DUE, earliest-scheduled first. The old
    // query fetched the newest 200 by '-scheduled_time' (furthest-future first)
    // and filtered due in code, so under a >200 backlog the most-overdue faxes
    // fell off the end and were never sent. Mirror processScheduledFaxes: filter
    // server-side on scheduled_time and sort ASCENDING so the page is the
    // most-overdue rows. (Belt-and-suspenders: still filter due in code.)
    const scheduledFaxes = await base44.asServiceRole.entities.ScheduledFax.filter({
      status: 'pending',
      scheduled_time: { "$lte": now.toISOString() }
    }, 'scheduled_time', 200);

    // Separate into due and priority groups
    const dueFaxes = scheduledFaxes.filter(fax =>
      new Date(fax.scheduled_time) <= now
    );

    if (dueFaxes.length === 0) {
      return Response.json({ 
        message: 'No faxes due for sending',
        pending: scheduledFaxes.length 
      });
    }

    // Sort by priority (urgent first, then high, normal, low)
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
    dueFaxes.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] || 2;
      const bPriority = priorityOrder[b.priority] || 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      // If same priority, sort by scheduled time (earliest first)
      return new Date(a.scheduled_time) - new Date(b.scheduled_time);
    });

    let sentCount = 0;
    let failedCount = 0;

    // NOTE: only ONE scheduled-fax processor should be enabled in the platform
    // scheduler (this OR processScheduledFaxes) — running both double-sends.

    // Process faxes in priority order
    for (const scheduledFax of dueFaxes) {
      // Claim with a token + RE-READ before sending. A bare status flip isn't
      // atomic, so two overlapping runs (or this + processScheduledFaxes, which
      // share the same 'pending' population) both flip and both send. The
      // claim-token + re-read lets the loser detect it lost and skip.
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
        // Send to all recipients via the batch sender, invoked with the service
        // role. The previous per-recipient base44.functions.invoke('sendFax')
        // ran user-scoped, but the scheduler has no end user — sendFax returned
        // 401, so sendResult.data.success was undefined and EVERY scheduled fax
        // was wrongly marked 'failed'. This mirrors the working
        // processScheduledFaxes sibling.
        const sendResult = await base44.asServiceRole.functions.invoke('sendBatchFax', {
          file_url: scheduledFax.document_url,
          to_numbers: scheduledFax.to_numbers,
          from_number: scheduledFax.from_number,
          document_name: scheduledFax.document_name,
          patient_id: scheduledFax.patient_id,
          cover_page_details: scheduledFax.cover_page_details,
          priority: scheduledFax.priority
        });

        const data = sendResult?.data || {};
        const recipientCount = scheduledFax.to_numbers?.length || 0;
        const successful = data.successful || 0;
        const failed = data.failed ?? (recipientCount - successful);
        sentCount += successful;
        failedCount += failed;

        // Only mark fully 'sent' when every recipient succeeded; otherwise
        // 'failed' so the partial failure is visible and recoverable.
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: failed > 0 ? 'failed' : 'sent'
        });

      } catch (error) {
        console.error(`Failed to process scheduled fax ${scheduledFax.id}:`, error);
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'failed'
        });
        failedCount++;
      }
    }

    return Response.json({
      success: true,
      processed: dueFaxes.length,
      sent: sentCount,
      failed: failedCount,
      priority_order: ['urgent', 'high', 'normal', 'low'],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Scheduled fax processing error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});