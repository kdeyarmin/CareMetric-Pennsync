import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Resolve Telnyx credentials: prefer env vars, then the in-app IntegrationSecret
 * row with provider 'telnyx'. Mirrors the SMS/voice handlers so fax functions work
 * for agencies that store credentials in-app rather than in the dashboard env.
 */
async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let apiKey = pick(Deno.env.get('TELNYX_API_KEY'));
  let publicKey = pick(Deno.env.get('TELNYX_PUBLIC_KEY'));
  let messagingProfileId = pick(Deno.env.get('TELNYX_MESSAGING_PROFILE_ID'));
  let voiceConnectionId = pick(Deno.env.get('TELNYX_VOICE_CONNECTION_ID')) || pick(Deno.env.get('TELNYX_CONNECTION_ID'));
  let faxConnectionId = pick(Deno.env.get('TELNYX_FAX_CONNECTION_ID'));
  try {
    const rows = await base44.asServiceRole.entities.IntegrationSecret.filter({ provider: 'telnyx' });
    const rec = rows?.[0] || {};
    if (!apiKey) apiKey = pick(rec.api_key);
    if (!publicKey) publicKey = pick(rec.public_key);
    if (!messagingProfileId) messagingProfileId = pick(rec.messaging_profile_id);
    if (!voiceConnectionId) voiceConnectionId = pick(rec.voice_connection_id);
    if (!faxConnectionId) faxConnectionId = pick(rec.fax_connection_id);
  } catch { /* ignore */ }
  return { apiKey, publicKey, messagingProfileId, voiceConnectionId, faxConnectionId };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged status-poll job (service-role FaxLog reads/writes
    // + Twilio calls, no end user). Opt-in lockdown like checkExpiredInvitations
    // (see §4); mirrors the admin-gated syncTwilioFaxStatuses.
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

    // Only poll faxes from the last 48 hours that are still pending
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    
    const pendingFaxes = await base44.asServiceRole.entities.FaxLog.filter(
      { status: { $in: ['queued', 'sending'] } },
      '-created_date',
      20  // Small batch to avoid CPU limit
    );

    // Filter to only recent faxes and those with a Telnyx ID
    const faxesToCheck = pendingFaxes.filter(f => f.telnyx_fax_id && f.created_date > cutoff);

    if (faxesToCheck.length === 0) {
      return Response.json({ success: true, checked: 0, updated: 0 });
    }

    const { apiKey } = await resolveTelnyxCreds(base44);

    if (!apiKey) {
      return Response.json({ error: 'Telnyx credentials not configured' }, { status: 400 });
    }

    let updated = 0;

    // Process all faxes in parallel instead of sequentially
    await Promise.all(faxesToCheck.map(async (fax) => {
      try {
        const response = await fetch(
          `https://api.telnyx.com/v2/faxes/${fax.telnyx_fax_id}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );

        if (!response.ok) return;

        const faxData = await response.json();
        const newStatus = mapFaxStatus(faxData?.data?.status);

        // Unknown Telnyx status: skip rather than coercing to the non-terminal
        // 'queued', which would keep re-polling this fax forever.
        if (!newStatus) return;

        if (newStatus !== fax.status) {
          // Share the webhook's idempotency markers (delivery_confirmation_sent /
          // final_failure_notified) so the poller and handleTelnyxStatusWebhook
          // can't both notify the sender for the same terminal transition.
          const update = { status: newStatus, telnyx_fax_id: faxData?.data?.id };
          let notifyType = null;
          if (newStatus === 'delivered' && fax.sent_by && !fax.delivery_confirmation_sent) {
            update.delivery_confirmation_sent = true;
            notifyType = 'fax_delivered';
          } else if (newStatus === 'failed' && fax.sent_by && !fax.final_failure_notified) {
            update.final_failure_notified = true;
            notifyType = 'fax_failed';
          }
          // 'sent' is a non-terminal progress state, not delivery — don't notify the
          // sender it was 'fax_delivered'. The delivered/failed branches above own the
          // sender notification when a terminal state is reached.

          await base44.asServiceRole.entities.FaxLog.update(fax.id, update);

          if (notifyType) {
            await base44.asServiceRole.entities.Notification.create({
              user_email: fax.sent_by,
              type: notifyType,
              title: notifyType === 'fax_failed' ? 'Fax Failed' : 'Fax Status Update',
              message: getNotificationMessage(newStatus, fax),
              metadata: { related_entity: 'FaxLog', related_entity_id: fax.id },
              is_read: false
            }).catch(err => console.error(`Failed to create notification for fax ${fax.id}:`, err.message));
          }

          updated++;
        }
      } catch (error) {
        console.error(`Error checking fax ${fax.id}:`, error.message);
      }
    }));

    return Response.json({ success: true, checked: faxesToCheck.length, updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function mapFaxStatus(telnyxStatus) {
  const statusMap = {
    'queued': 'queued',
    'media.processed': 'sending',
    'originated': 'sending',
    'sending': 'sending',
    'sent': 'sent',
    'delivered': 'delivered',
    'failed': 'failed',
    'cancelled': 'failed',
    'canceled': 'failed'
  };
  return statusMap[telnyxStatus] || null;
}

function getNotificationMessage(status, fax) {
  const docName = fax.document_name || 'Document';
  const recipient = fax.to_name || fax.to_number;
  switch (status) {
    case 'sent': return `Fax "${docName}" sent to ${recipient}`;
    case 'delivered': return `Fax "${docName}" delivered to ${recipient}`;
    case 'failed': return `Fax "${docName}" failed to ${recipient}. Reason: ${fax.failure_reason || 'Unknown'}`;
    default: return `Fax status updated to ${status}`;
  }
}