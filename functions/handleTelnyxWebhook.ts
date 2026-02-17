import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Webhook - authenticate via service role after setting token
    const body = await req.json();

    console.log('[handleTelnyxWebhook] Received event:', JSON.stringify(body).substring(0, 500));

    const eventData = body?.data;
    const eventType = eventData?.event_type || body?.event_type;
    const payload = eventData?.payload || body?.payload || body;

    if (!eventType) {
      console.log('[handleTelnyxWebhook] No event_type found');
      return Response.json({ received: true });
    }

    const faxId = payload?.fax_id || payload?.id;
    const status = payload?.status;

    console.log(`[handleTelnyxWebhook] Event: ${eventType}, Fax ID: ${faxId}, Status: ${status}`);

    // Map Telnyx events to our status
    const STATUS_MAP = {
      'fax.queued': 'queued',
      'fax.sending': 'sending',
      'fax.sent': 'sent',
      'fax.delivered': 'delivered',
      'fax.failed': 'failed',
      'fax.media.processed': null // informational only
    };

    const mappedStatus = STATUS_MAP[eventType];
    if (!mappedStatus) {
      console.log(`[handleTelnyxWebhook] Unhandled event type: ${eventType}`);
      return Response.json({ received: true, skipped: true });
    }

    // Find FaxHistory record by telnyx_fax_id
    if (!faxId) {
      console.warn('[handleTelnyxWebhook] No fax ID in payload');
      return Response.json({ received: true, error: 'no_fax_id' });
    }

    const faxRecords = await base44.asServiceRole.entities.FaxHistory.filter(
      { telnyx_fax_id: faxId },
      '-created_date',
      1
    );

    if (!faxRecords || faxRecords.length === 0) {
      console.warn(`[handleTelnyxWebhook] No FaxHistory record found for telnyx_fax_id: ${faxId}`);
      return Response.json({ received: true, error: 'record_not_found' });
    }

    const fax = faxRecords[0];

    // Don't downgrade status (e.g., don't go from delivered back to sent)
    const STATUS_PRIORITY = { queued: 0, sending: 1, sent: 2, delivered: 3, failed: 3 };
    const currentPriority = STATUS_PRIORITY[fax.status] || 0;
    const newPriority = STATUS_PRIORITY[mappedStatus] || 0;

    if (newPriority < currentPriority) {
      console.log(`[handleTelnyxWebhook] Skipping status downgrade: ${fax.status} → ${mappedStatus}`);
      return Response.json({ received: true, skipped: 'status_downgrade' });
    }

    // Build update data
    const updateData = { status: mappedStatus };

    if (mappedStatus === 'delivered') {
      updateData.sent_at = updateData.sent_at || new Date().toISOString();
    }

    if (mappedStatus === 'failed') {
      updateData.error_message = payload?.failure_reason || payload?.error || 'Fax transmission failed';
    }

    // Update page count if available
    if (payload?.page_count) {
      updateData.page_count = payload.page_count;
    }

    await base44.asServiceRole.entities.FaxHistory.update(fax.id, updateData);
    console.log(`[handleTelnyxWebhook] Updated FaxHistory ${fax.id}: ${fax.status} → ${mappedStatus}`);

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
        console.warn('[handleTelnyxWebhook] Notification failed:', e.message);
      }
    }

    // Trigger OCR processing on delivery
    if (mappedStatus === 'delivered' && fax.document_urls?.length > 0) {
      try {
        await base44.asServiceRole.functions.invoke('processFaxOCR', {
          fax_log_id: fax.id,
          document_url: fax.document_urls[0]
        });
      } catch (e) {
        console.warn('[handleTelnyxWebhook] OCR trigger failed:', e.message);
      }
    }

    // Log system activity
    try {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: fax.user_email || 'system',
        user_name: 'Telnyx Webhook',
        action: `fax_status_${mappedStatus}`,
        details: {
          telnyx_fax_id: faxId,
          fax_history_id: fax.id,
          event_type: eventType,
          page_count: payload?.page_count
        },
        page: 'FaxQueue',
        entity_type: 'FaxHistory',
        entity_id: fax.id
      });
    } catch (e) {
      console.warn('[handleTelnyxWebhook] Activity log failed:', e.message);
    }

    return Response.json({ received: true, status: mappedStatus, fax_history_id: fax.id });

  } catch (error) {
    console.error('[handleTelnyxWebhook] Error:', error.message, error.stack);
    // Always return 200 for webhooks to prevent retries
    return Response.json({ received: true, error: error.message });
  }
});