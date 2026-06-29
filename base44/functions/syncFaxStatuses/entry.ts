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

    // Authorization: privileged status-sync job (service-role FaxLog reads/writes
    // + Telnyx API calls, no end user). Opt-in lockdown mirroring pollFaxStatuses
    // — a real scheduler runs unauthenticated and still passes while no secret is
    // configured; once INTERNAL_FN_SECRET is set it must present the header, and
    // a logged-in non-admin is always rejected.
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

    const { apiKey } = await resolveTelnyxCreds(base44);
    if (!apiKey) {
      console.warn('Telnyx credentials not configured. Skipping fax status sync.');
      return Response.json({ error: 'Telnyx credentials not configured' }, { status: 500 });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const pendingFaxes = await base44.asServiceRole.entities.FaxLog.filter({
      created_date: { '$gte': twentyFourHoursAgo }
    }, '-created_date', 200);

    const nonFinalFaxes = pendingFaxes.filter((f) =>
      f.telnyx_fax_id && ['queued', 'sending', 'sent'].includes(f.status)
    );

    console.log(`Found ${nonFinalFaxes.length} pending faxes to sync.`);

    let updatedCount = 0;

    for (const faxLog of nonFinalFaxes) {
      try {
        const telnyxResponse = await fetch(`https://api.telnyx.com/v2/faxes/${faxLog.telnyx_fax_id}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
        });

        if (!telnyxResponse.ok) {
          const errorText = await telnyxResponse.text();
          console.error(`Telnyx API error for fax ${faxLog.telnyx_fax_id}:`, errorText);
          continue;
        }

        const telnyxData = await telnyxResponse.json();

        const currentTelnyxStatus = telnyxData?.data?.status;
        const newStatus = mapFaxStatus(currentTelnyxStatus, faxLog.status);

        if (newStatus !== faxLog.status) {
          console.log(`Updating fax ${faxLog.id} from ${faxLog.status} to ${newStatus}`);
          const failureReason = telnyxData?.data?.failure_reason || 'Unknown failure';
          // When a missed webhook is reconciled to 'failed' here, the sender
          // previously got no notice at all. Notify once (guarded by the shared
          // final_failure_notified flag so the webhook can't also re-notify).
          const notifyFailure = newStatus === 'failed' && faxLog.sent_by && !faxLog.final_failure_notified;
          const update = {
            status: newStatus,
            failure_reason: newStatus === 'failed' ? failureReason : null,
            pages: telnyxData?.data?.page_count || faxLog.pages
          };
          if (notifyFailure) update.final_failure_notified = true;
          await base44.asServiceRole.entities.FaxLog.update(faxLog.id, update);

          if (notifyFailure) {
            const recipient = faxLog.to_name ? `${faxLog.to_name} (${faxLog.to_number})` : faxLog.to_number;
            await base44.asServiceRole.entities.Notification.create({
              user_email: faxLog.sent_by,
              type: 'fax_failed',
              title: '❌ Fax failed',
              message: `"${faxLog.document_name || 'Your document'}" to ${recipient} could not be delivered (${failureReason}).`,
              priority: 'high',
              metadata: { related_entity: 'FaxLog', related_entity_id: faxLog.id },
              is_read: false
            }).catch((err) => console.error(`Failed to send fax failure notification for ${faxLog.id}:`, err.message));
          }
          updatedCount++;
        }
      } catch (error) {
        console.error(`Error processing fax ${faxLog.id} (Telnyx fax id: ${faxLog.telnyx_fax_id}):`, error);
      }
    }

    console.log(`Fax status sync completed. Updated ${updatedCount} faxes.`);
    return Response.json({
      success: true,
      message: `Fax statuses synced. ${updatedCount} updated.`,
      checked: nonFinalFaxes.length,
      updated: updatedCount
    });

  } catch (error) {
    console.error('Fax status sync function error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function mapFaxStatus(currentStatus, fallbackStatus) {
  const statusMap = {
    queued: 'queued',
    'media.processed': 'sending',
    originated: 'sending',
    sending: 'sending',
    sent: 'sent',
    delivered: 'delivered',
    failed: 'failed',
    cancelled: 'failed',
    canceled: 'failed'
  };

  // Unknown Telnyx status: fall back to the current status (a no-op write).
  return statusMap[currentStatus] || fallbackStatus;
}