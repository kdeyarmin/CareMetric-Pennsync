import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const apiKey = Deno.env.get("TELNYX_API_KEY");
    if (!apiKey) {
      return Response.json({ error: 'TELNYX_API_KEY not configured' }, { status: 500 });
    }

    // Fetch non-final faxes from last 24 hours
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const nonFinalStatuses = ['queued', 'sending', 'sent'];

    let checkedCount = 0;
    let updatedCount = 0;

    for (const status of nonFinalStatuses) {
      const faxes = await base44.asServiceRole.entities.FaxHistory.filter(
        { status },
        '-created_date',
        50
      );

      for (const fax of faxes) {
        // Skip old records beyond 24 hours
        if (new Date(fax.created_date) < new Date(cutoffDate)) continue;
        if (!fax.telnyx_fax_id) continue;

        checkedCount++;

        try {
          const telnyxRes = await fetch(`https://api.telnyx.com/v2/faxes/${fax.telnyx_fax_id}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });

          if (!telnyxRes.ok) {
            console.warn(`[syncFaxStatuses] Telnyx API error for ${fax.telnyx_fax_id}:`, telnyxRes.status);
            continue;
          }

          const telnyxData = await telnyxRes.json();
          const faxData = telnyxData?.data;

          if (!faxData) continue;

          const telnyxStatus = faxData.status;
          let mappedStatus = fax.status;

          if (telnyxStatus === 'delivered') mappedStatus = 'delivered';
          else if (telnyxStatus === 'failed') mappedStatus = 'failed';
          else if (telnyxStatus === 'sent') mappedStatus = 'sent';
          else if (telnyxStatus === 'sending') mappedStatus = 'sending';

          if (mappedStatus !== fax.status) {
            const updateData = { status: mappedStatus };

            if (faxData.page_count) {
              updateData.page_count = faxData.page_count;
            }
            if (mappedStatus === 'failed') {
              updateData.error_message = faxData.failure_reason || 'Failed (detected by sync)';
            }
            if (mappedStatus === 'delivered' && !fax.sent_at) {
              updateData.sent_at = new Date().toISOString();
            }

            await base44.asServiceRole.entities.FaxHistory.update(fax.id, updateData);
            updatedCount++;
            console.log(`[syncFaxStatuses] Updated ${fax.id}: ${fax.status} → ${mappedStatus}`);

            // Send notification for final statuses
            if (mappedStatus === 'delivered' || mappedStatus === 'failed') {
              try {
                await base44.asServiceRole.functions.invoke('sendFaxNotification', {
                  user_email: fax.user_email,
                  fax_history_id: fax.id,
                  status: mappedStatus,
                  recipient_name: fax.recipient_name || '',
                  recipient_fax_number: fax.recipient_fax_number
                });
              } catch (e) {
                console.warn('[syncFaxStatuses] Notification failed:', e.message);
              }
            }
          }
        } catch (e) {
          console.error(`[syncFaxStatuses] Error checking fax ${fax.id}:`, e.message);
        }
      }
    }

    console.log(`[syncFaxStatuses] Checked: ${checkedCount}, Updated: ${updatedCount}`);

    return Response.json({
      success: true,
      checked: checkedCount,
      updated: updatedCount
    });

  } catch (error) {
    console.error('[syncFaxStatuses] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});