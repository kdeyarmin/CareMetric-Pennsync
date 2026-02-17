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

    const now = new Date();

    // Fetch scheduled faxes that are due
    const scheduledFaxes = await base44.asServiceRole.entities.FaxHistory.filter(
      { status: 'scheduled' },
      'scheduled_send_at',
      50
    );

    let processedCount = 0;
    let failedCount = 0;

    for (const fax of scheduledFaxes) {
      if (!fax.scheduled_send_at) continue;

      const scheduledTime = new Date(fax.scheduled_send_at);
      if (scheduledTime > now) continue; // Not due yet

      if (!fax.document_urls || fax.document_urls.length === 0) {
        await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
          status: 'failed',
          error_message: 'No documents attached to scheduled fax'
        });
        failedCount++;
        continue;
      }

      try {
        // Format number
        let formattedNumber = fax.recipient_fax_number.replace(/[^\d+]/g, '');
        if (!formattedNumber.startsWith('+')) {
          if (formattedNumber.length === 10) formattedNumber = '+1' + formattedNumber;
          else if (formattedNumber.length === 11 && formattedNumber.startsWith('1')) formattedNumber = '+' + formattedNumber;
          else formattedNumber = '+' + formattedNumber;
        }

        await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
          status: 'sending'
        });

        const telnyxResponse = await fetch('https://api.telnyx.com/v2/faxes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            to: formattedNumber,
            from: '+18445550100',
            media_url: fax.document_urls[0],
            quality: 'high',
            monochrome: false
          })
        });

        const telnyxData = await telnyxResponse.json();

        if (telnyxResponse.ok) {
          await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
            status: 'sent',
            telnyx_fax_id: telnyxData?.data?.id,
            sent_at: new Date().toISOString()
          });

          // Send notification
          try {
            await base44.asServiceRole.functions.invoke('sendFaxNotification', {
              user_email: fax.user_email,
              fax_history_id: fax.id,
              status: 'sent',
              recipient_name: fax.recipient_name || '',
              recipient_fax_number: fax.recipient_fax_number
            });
          } catch (e) {
            console.warn('[processScheduledFaxes] Notification failed:', e.message);
          }

          processedCount++;
        } else {
          const errMsg = telnyxData?.errors?.[0]?.detail || 'Scheduled send failed';
          await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
            status: 'failed',
            error_message: errMsg
          });
          failedCount++;
        }
      } catch (err) {
        console.error(`[processScheduledFaxes] Error for fax ${fax.id}:`, err.message);
        await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
          status: 'failed',
          error_message: err.message
        });
        failedCount++;
      }
    }

    console.log(`[processScheduledFaxes] Processed: ${processedCount}, Failed: ${failedCount}, Total checked: ${scheduledFaxes.length}`);

    return Response.json({
      success: true,
      total_checked: scheduledFaxes.length,
      processed: processedCount,
      failed: failedCount
    });

  } catch (error) {
    console.error('[processScheduledFaxes] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});