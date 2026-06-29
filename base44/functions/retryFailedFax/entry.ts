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

/**
 * Retry a failed fax transmission
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fax_log_id } = await req.json();

    if (!fax_log_id) {
      return Response.json({ error: 'fax_log_id required' }, { status: 400 });
    }

    // Fetch the original fax log
    const faxLogs = await base44.entities.FaxLog.filter({ id: fax_log_id });
    if (faxLogs.length === 0) {
      return Response.json({ error: 'FaxLog not found' }, { status: 404 });
    }

    const originalFax = faxLogs[0];

    // Ownership: only the original sender (or an admin) may resend a PHI fax.
    if (originalFax.sent_by && originalFax.sent_by !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const maxRetries = 3;

    // Check retry limit
    if (originalFax.retry_count >= maxRetries) {
      return Response.json({
        error: `Maximum retries (${maxRetries}) exceeded`,
        success: false
      }, { status: 400 });
    }

    // Get Telnyx credentials (env, then in-app IntegrationSecret)
    const { apiKey, faxConnectionId } = await resolveTelnyxCreds(base44);
    // Resolve the office fax from-number the same way sendFax does: prefer the
    // in-app AgencySettings.office_fax_number_e164, else the TELNYX_FAX_NUMBER env.
    const settingsRows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
    const officeFax = (settingsRows[0]?.office_fax_number_e164 || '').toString().trim();
    const fromNumber = officeFax || Deno.env.get('TELNYX_FAX_NUMBER');

    if (!apiKey || !faxConnectionId || !fromNumber) {
      return Response.json({
        error: 'Telnyx credentials not configured',
        success: false
      }, { status: 500 });
    }

    // Claim the fax for retry BEFORE sending so two concurrent retries (e.g. a
    // double-click, or a manual retry racing the cron) can't both fax the PHI and
    // double-charge. Flip failed -> retrying with a token, then re-read; if we
    // don't own the claim, another retry is already in flight. (Telnyx's Fax API
    // has no client idempotency key, so this claim is the double-send guard.)
    const runId = crypto.randomUUID();
    try {
      await base44.entities.FaxLog.update(fax_log_id, {
        status: 'retrying',
        retry_claimed_by: runId,
        retry_claimed_at: new Date().toISOString(),
      });
    } catch {
      return Response.json({ error: 'Could not claim fax for retry', success: false }, { status: 409 });
    }
    const claimCheck = await base44.entities.FaxLog.filter({ id: fax_log_id }, '-created_date', 1).catch(() => []);
    if (!claimCheck[0] || claimCheck[0].retry_claimed_by !== runId) {
      return Response.json({ error: 'A retry for this fax is already in progress', success: false }, { status: 409 });
    }

    // Release the claim back to a retriable 'failed' state if the send doesn't go
    // through, so a transient error doesn't strand the fax in 'retrying'.
    const releaseClaim = () => base44.entities.FaxLog.update(fax_log_id, {
      status: 'failed',
      retry_claimed_by: null,
    }).catch(() => {});

    const telnyxUrl = `https://api.telnyx.com/v2/faxes`;
    // Include the same DLR webhook sendFax uses so the retried fax reports status.
    const functionsBaseUrl = (Deno.env.get('FUNCTIONS_BASE_URL') || '').trim().replace(/\/+$/, '');
    const retryPayload = {
      connection_id: faxConnectionId,
      from: fromNumber,
      to: originalFax.to_number,
      media_url: originalFax.document_url,
      quality: 'high',
    };
    if (functionsBaseUrl) retryPayload.webhook_url = `${functionsBaseUrl}/handleTelnyxStatusWebhook`;

    // Re-send the fax
    let telnyxResponse;
    try {
      telnyxResponse = await fetch(telnyxUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(retryPayload)
      });
    } catch (sendErr) {
      await releaseClaim();
      throw sendErr;
    }

    if (!telnyxResponse.ok) {
      const errorData = await telnyxResponse.text();
      console.error('Telnyx error:', errorData);
      await releaseClaim();
      return Response.json({
        error: 'Failed to send fax via Telnyx',
        success: false
      }, { status: telnyxResponse.status });
    }

    // Bookkeeping AFTER a successful Telnyx send. If any of these steps throws
    // (json parse, FaxLog.create, the final update), we must NOT fall through to
    // the outer catch and leave the original stranded in 'retrying' with a live
    // claim — that orphans an already-sent fax and blocks future retries. The
    // fax was accepted, so we also must NOT releaseClaim() back to 'failed'
    // (that would re-send and double-fax). Settle the original to 'retried'.
    let faxData;
    let newFaxLog = null;
    try {
      faxData = await telnyxResponse.json();

      // Create new FaxLog record for retry
      newFaxLog = await base44.entities.FaxLog.create({
        from_number: originalFax.from_number,
        to_number: originalFax.to_number,
        to_name: originalFax.to_name,
        document_url: originalFax.document_url,
        document_name: originalFax.document_name + ' (Retry)',
        status: 'queued',
        telnyx_fax_id: faxData?.data?.id,
        pages: originalFax.pages,
        cover_page_details: originalFax.cover_page_details,
        patient_id: originalFax.patient_id,
        sent_by: user.email,
        priority: originalFax.priority,
        retry_count: (originalFax.retry_count || 0) + 1,
        estimated_cost: originalFax.estimated_cost
      });

      // Update original fax to mark it as retried (clears the transient claim).
      await base44.entities.FaxLog.update(fax_log_id, {
        status: 'retried',
        retry_claimed_by: null,
        failure_reason: `Retry attempt #${(originalFax.retry_count || 0) + 1} initiated`
      });
    } catch (postErr) {
      console.error('retryFailedFax post-send bookkeeping failed:', postErr);
      // Settle the claim so the already-sent fax isn't orphaned in 'retrying'.
      await base44.entities.FaxLog.update(fax_log_id, {
        status: 'retried',
        retry_claimed_by: null,
        failure_reason: 'Retry was sent to Telnyx, but follow-up logging failed.'
      }).catch(() => {});
      return Response.json({
        success: true,
        fax_id: faxData?.data?.id,
        twilio_fax_id: faxData?.data?.id, // deprecated alias, kept for back-compat
        warning: 'Fax retry was sent, but recording the new log entry failed.'
      });
    }

    return Response.json({
      success: true,
      new_fax_log_id: newFaxLog.id,
      fax_id: faxData?.data?.id,
      twilio_fax_id: faxData?.data?.id, // deprecated alias, kept for back-compat
      retry_count: (originalFax.retry_count || 0) + 1,
      message: `Fax retry #${(originalFax.retry_count || 0) + 1} queued for ${originalFax.to_number}`
    });
  } catch (error) {
    console.error('Retry fax error:', error);
    return Response.json({
      error: 'Failed to retry fax',
      success: false
    }, { status: 500 });
  }
});