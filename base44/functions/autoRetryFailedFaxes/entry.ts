import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: brandedEmail — generated, edit base44/_shared/backendHelpers.mjs>>>
const BRAND_EMAIL = {
  navy: '#213a76', navyDeep: '#1c2f5e', gold: '#c7901f',
  ink: '#111a2b', slate: '#334155', muted: '#5b6a7f', line: '#e4e9f1',
  wash: '#eef3fc', panel: '#f5f8fd',
  logo: 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png',
};
// Callout tones. 'info' is on-brand navy; success/warn/urgent reuse the manual
// theme's green/amber/red and are used ONLY for genuine status (never decoration).
const EMAIL_TONES = {
  info:    { bg: '#eef3fc', border: '#88a5e0', text: '#213a76' },
  success: { bg: '#effdf4', border: '#86efac', text: '#15803d' },
  warn:    { bg: '#fff8ec', border: '#fcd68a', text: '#b45309' },
  urgent:  { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' },
};
function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function emailParagraph(text) {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.62;color:${BRAND_EMAIL.slate};">${escapeEmailHtml(text)}</p>`;
}
function renderEmailSection(section) {
  const s = section || {};
  const parts = [];
  if (s.heading) {
    parts.push(`<h2 style="margin:20px 0 8px;font-size:16px;font-weight:800;color:${BRAND_EMAIL.ink};">${escapeEmailHtml(s.heading)}</h2>`);
  }
  for (const p of (Array.isArray(s.paragraphs) ? s.paragraphs : [])) parts.push(emailParagraph(p));
  if (s.pre) {
    parts.push(`<pre style="margin:4px 0 16px;padding:14px 16px;background:${BRAND_EMAIL.panel};border:1px solid ${BRAND_EMAIL.line};border-radius:10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12.5px;line-height:1.5;color:${BRAND_EMAIL.ink};white-space:pre-wrap;word-break:break-word;">${escapeEmailHtml(s.pre)}</pre>`);
  }
  if (Array.isArray(s.rows) && s.rows.length) {
    const rows = s.rows.map((r) =>
      `<tr><td style="padding:5px 0;font-size:13.5px;color:${BRAND_EMAIL.muted};vertical-align:top;white-space:nowrap;">${escapeEmailHtml(r[0])}</td>` +
      `<td style="padding:5px 0 5px 16px;font-size:14px;color:${BRAND_EMAIL.ink};font-weight:600;vertical-align:top;">${escapeEmailHtml(r[1])}</td></tr>`
    ).join('');
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;background:${BRAND_EMAIL.panel};border:1px solid ${BRAND_EMAIL.line};border-radius:10px;"><tr><td style="padding:8px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table></td></tr></table>`);
  }
  if (Array.isArray(s.bullets) && s.bullets.length) {
    const items = s.bullets.map((b) =>
      `<li style="margin:0 0 7px;font-size:14.5px;line-height:1.55;color:${BRAND_EMAIL.slate};">${escapeEmailHtml(b)}</li>`
    ).join('');
    parts.push(`<ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>`);
  }
  if (s.callout && s.callout.text) {
    const t = EMAIL_TONES[s.callout.tone] || EMAIL_TONES.info;
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;"><tr><td style="padding:13px 16px;background:${t.bg};border-left:4px solid ${t.border};border-radius:8px;font-size:14px;line-height:1.55;color:${t.text};font-weight:600;">${escapeEmailHtml(s.callout.text)}</td></tr></table>`);
  }
  if (s.button && s.button.href) {
    const href = String(s.button.href).replace(/"/g, '&quot;');
    parts.push(`<div style="margin:6px 0 18px;"><a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:8px;background:${BRAND_EMAIL.navy};color:#ffffff;font-weight:700;font-size:15px;line-height:1;text-decoration:none;">${escapeEmailHtml(s.button.label || 'Open PennSync')}</a></div>`);
  }
  if (s.note) {
    parts.push(`<p style="margin:0 0 14px;font-size:12.5px;line-height:1.55;color:${BRAND_EMAIL.muted};">${escapeEmailHtml(s.note)}</p>`);
  }
  return parts.join('');
}
/**
 * Build a branded PennSync email. Returns an HTML string for SendEmail's body.
 * opts: { preheader, eyebrow, tone('brand'|'urgent'), title, intro(string|string[]),
 *         sections[{ heading, paragraphs[], pre, rows[[k,v]], bullets[], callout{text,tone},
 *         button{href,label}, note }], signoffName, footerNote }
 */
function renderBrandedEmail(opts) {
  const o = opts || {};
  const rule = o.tone === 'urgent' ? '#dc2626' : BRAND_EMAIL.gold;
  const intro = Array.isArray(o.intro) ? o.intro : (o.intro ? [o.intro] : []);
  const sections = Array.isArray(o.sections) ? o.sections : [];
  const signoff = o.signoffName === null ? '' : (o.signoffName || 'The PennSync by CareMetric Team');
  const preheader = o.preheader ? escapeEmailHtml(o.preheader) : '';
  const eyebrow = o.eyebrow
    ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${BRAND_EMAIL.gold};">${escapeEmailHtml(o.eyebrow)}</p>`
    : '';
  const introHtml = intro.map(emailParagraph).join('');
  const sectionsHtml = sections.map(renderEmailSection).join('');
  const signoffHtml = signoff
    ? `<p style="margin:22px 0 2px;font-size:15px;line-height:1.6;color:${BRAND_EMAIL.slate};">Warm regards,<br /><strong style="color:${BRAND_EMAIL.navy};">${escapeEmailHtml(signoff)}</strong></p>`
    : '';
  const footerNote = o.footerNote
    ? `<p style="margin:0 0 8px;font-size:11.5px;line-height:1.5;color:${BRAND_EMAIL.muted};">${escapeEmailHtml(o.footerNote)}</p>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="color-scheme" content="light only" /><title>${escapeEmailHtml(o.title || 'PennSync by CareMetric')}</title></head>
<body style="margin:0;padding:0;background:${BRAND_EMAIL.wash};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND_EMAIL.wash};">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_EMAIL.wash};"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${BRAND_EMAIL.line};border-radius:16px;overflow:hidden;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="background:linear-gradient(180deg,#25407e 0%,${BRAND_EMAIL.navyDeep} 100%);padding:28px 28px 24px;text-align:center;">
    <img src="${BRAND_EMAIL.logo}" width="54" height="54" alt="PennSync" style="display:inline-block;width:54px;height:54px;border-radius:13px;border:0;" />
    <div style="margin-top:11px;font-size:23px;font-weight:800;letter-spacing:-.3px;color:#ffffff;">Penn<span style="color:${BRAND_EMAIL.gold};">Sync</span></div>
    <div style="margin-top:4px;font-size:10.5px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#b6c9ee;">by CareMetric</div>
    <div style="width:58px;height:4px;border-radius:3px;background:${rule};margin:14px auto 0;"></div>
  </td></tr>
  <tr><td style="padding:30px 32px 6px;">
    ${eyebrow}<h1 style="margin:0;font-size:22px;font-weight:800;color:${BRAND_EMAIL.navy};">${escapeEmailHtml(o.title || '')}</h1>
  </td></tr>
  <tr><td style="padding:14px 32px 4px;">${introHtml}${sectionsHtml}${signoffHtml}</td></tr>
  <tr><td style="padding:24px 32px 30px;text-align:center;">
    <div style="height:1px;background:${BRAND_EMAIL.line};margin-bottom:16px;"></div>
    <div style="font-size:13px;font-weight:800;color:${BRAND_EMAIL.navy};">Penn<span style="color:${BRAND_EMAIL.gold};">Sync</span> <span style="font-weight:600;color:${BRAND_EMAIL.muted};">by CareMetric</span></div>
    ${footerNote}<p style="margin:8px 0 0;font-size:11.5px;line-height:1.5;color:${BRAND_EMAIL.muted};">This is an automated message from PennSync by CareMetric — please do not reply to this email.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}
// <<<END SHARED HELPER: brandedEmail>>>

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
 * Re-dispatches failed faxes whose config-aware backoff window (set by the
 * status webhook) has elapsed. Called every few minutes by a scheduled
 * automation; enable ONE schedule. Honors the admin's FaxRetryConfig (max
 * retries / auto-retry switch) and claims each fax with a per-run token before
 * re-sending, so overlapping runs can't double-send the same document (the
 * Telnyx Fax API has no idempotency key). Sends a final-failure notice only when
 * retries are exhausted.
 */

// ---- fax retry policy (mirrors src/components/fax/faxRetry.js) ----
const PERMANENT_FAILURE_PATTERNS = [
  /invalid/i, /not a fax/i, /no fax machine/i, /incompatible/i, /unsupported/i,
  /rejected/i, /blocked/i, /do not call/i, /unallocated/i, /disconnected/i,
  /forbidden/i, /not in service/i, /no such number/i, /malformed/i,
];
function classifyFaxFailure(errorCode, errorMessage) {
  const s = `${errorCode ?? ''} ${errorMessage ?? ''}`.trim();
  if (!s) return 'transient';
  return PERMANENT_FAILURE_PATTERNS.some((re) => re.test(s)) ? 'permanent' : 'transient';
}
function faxRetryConfig(config) {
  const c = config || {};
  return {
    enabled: c.auto_retry_enabled !== false,
    maxRetries: Number.isFinite(c.max_retries) ? Math.max(0, c.max_retries) : 3,
    baseDelayMinutes: Number.isFinite(c.retry_delay_minutes) && c.retry_delay_minutes > 0 ? c.retry_delay_minutes : 15,
    notifyOnFinalFailure: c.notify_on_final_failure !== false,
    priorityMultiplier: c.priority_multiplier && typeof c.priority_multiplier === 'object' ? c.priority_multiplier : {},
  };
}
function nextRetryDelayMinutes(attempt, config, priority = 'normal', factor = 2, maxMinutes = 360) {
  const c = faxRetryConfig(config);
  const a = Math.max(0, Number(attempt) || 0);
  const mult = Number.isFinite(c.priorityMultiplier[priority]) ? c.priorityMultiplier[priority] : 1;
  const minutes = c.baseDelayMinutes * factor ** a * mult;
  return Math.max(1, Math.min(maxMinutes, Math.round(minutes)));
}
function isFaxRetryDue(fax, now, config) {
  const c = faxRetryConfig(config);
  if (!c.enabled) return false;
  if (!fax || fax.status !== 'failed') return false;
  if (!fax.next_retry_at) return false;
  if (!fax.document_url) return false;
  // >= so the budget is spent at retry_count === maxRetries (matches
  // planFaxRetry's `attempts >= maxRetries`); `>` allowed one extra send/charge.
  if ((Number(fax.retry_count) || 0) >= c.maxRetries) return false;
  const t = new Date(fax.next_retry_at).getTime();
  return Number.isFinite(t) && now >= t;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const runId = crypto.randomUUID();

    const cfgRows = await base44.asServiceRole.entities.FaxRetryConfig.list('-created_date', 1).catch(() => []);
    const cfg = cfgRows[0] || {};
    const c = faxRetryConfig(cfg);
    if (!c.enabled) {
      return Response.json({ success: true, retried: 0, skipped: 0, note: 'Auto-retry disabled in FaxRetryConfig.' });
    }

    // Get all faxes that are failed and have a scheduled next_retry_at
    const allFailed = await base44.asServiceRole.entities.FaxLog.filter(
      { status: 'failed' },
      '-updated_date',
      200
    );

    const now = new Date();
    let retriedCount = 0;
    let skippedCount = 0;

    const { apiKey, faxConnectionId } = await resolveTelnyxCreds(base44);
    // Resolve the office fax from-number the same way sendFax does: prefer the
    // in-app AgencySettings.office_fax_number_e164, else the TELNYX_FAX_NUMBER env.
    const settingsRows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
    const officeFax = (settingsRows[0]?.office_fax_number_e164 || '').toString().trim();
    const fromNumber = officeFax || Deno.env.get('TELNYX_FAX_NUMBER');
    // Include the same DLR webhook sendFax uses so the retried fax reports status.
    const functionsBaseUrl = (Deno.env.get('FUNCTIONS_BASE_URL') || '').trim().replace(/\/+$/, '');
    const webhookUrl = functionsBaseUrl ? `${functionsBaseUrl}/handleTelnyxStatusWebhook` : undefined;

    if (!apiKey || !faxConnectionId || !fromNumber) {
      return Response.json({ error: 'Telnyx credentials not configured' }, { status: 500 });
    }

    for (const fax of allFailed) {
      if (!isFaxRetryDue(fax, now.getTime(), cfg)) {
        skippedCount++;
        continue;
      }

      // Claim with a per-run token, then RE-READ to confirm we own it. Flipping
      // to 'queued' also removes it from a second run's failed-filter, so two
      // overlapping runs can't both re-send the same document.
      try {
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          status: 'queued', retry_claimed_by: runId, next_retry_at: null,
        });
      } catch {
        skippedCount++;
        continue;
      }
      const check = await base44.asServiceRole.entities.FaxLog.filter({ id: fax.id }, '-updated_date', 1).catch(() => []);
      if (!check[0] || check[0].retry_claimed_by !== runId) {
        skippedCount++;
        continue;
      }

      // Attempt the retry via Telnyx
      try {
        const retryPayload = {
          connection_id: faxConnectionId,
          from: fromNumber,
          to: fax.to_number,
          media_url: fax.document_url,
          quality: 'high'
        };
        if (webhookUrl) retryPayload.webhook_url = webhookUrl;
        const telnyxResp = await fetch('https://api.telnyx.com/v2/faxes', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(retryPayload)
        });

        if (telnyxResp.ok) {
          const telnyxData = await telnyxResp.json();
          // Reset status to queued with new Telnyx fax id — webhook will update from here
          await base44.asServiceRole.entities.FaxLog.update(fax.id, {
            status: 'queued',
            telnyx_fax_id: telnyxData?.data?.id,
            next_retry_at: null,
            failure_reason: null,
            retry_claimed_by: null,
          });
          retriedCount++;
          console.log(`Retry attempt ${fax.retry_count} dispatched for fax ${fax.id} → new fax id ${telnyxData?.data?.id}`);
        } else {
          const errText = await telnyxResp.text();
          console.error(`Telnyx error on retry for fax ${fax.id}:`, errText);
          // Telnyx rejected the re-send — a permanent rejection, so stop now.
          await base44.asServiceRole.entities.FaxLog.update(fax.id, { status: 'failed', retry_claimed_by: null }).catch(() => {});
          await handleRetryExhausted(base44, fax, `Telnyx rejected retry: ${errText}`, c.maxRetries, c.notifyOnFinalFailure);
        }
      } catch (err) {
        console.error(`Network error retrying fax ${fax.id}:`, err.message);
        // Transient: restore to failed and reschedule (within budget) using the
        // SAME config-aware, priority-scaled backoff as the webhook; otherwise
        // exhaust + notify.
        const attempts = Number(fax.retry_count) || 0;
        const within = attempts < c.maxRetries;
        const delayMin = nextRetryDelayMinutes(attempts, cfg, fax.priority || 'normal');
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          status: 'failed',
          retry_claimed_by: null,
          next_retry_at: within ? new Date(now.getTime() + delayMin * 60000).toISOString() : null,
        }).catch(() => {});
        if (!within) await handleRetryExhausted(base44, fax, err.message, c.maxRetries, c.notifyOnFinalFailure);
      }
    }

    return Response.json({
      success: true,
      retried: retriedCount,
      skipped: skippedCount,
      timestamp: now.toISOString()
    });

  } catch (error) {
    console.error('autoRetryFailedFaxes error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Mark fax as permanently failed and notify user (only called when all retries exhausted).
 */
async function handleRetryExhausted(base44, fax, reason, maxRetries = 3, notify = true) {
  if (fax.final_failure_notified || !notify) {
    await base44.asServiceRole.entities.FaxLog.update(fax.id, {
      next_retry_at: null, final_failure_notified: true, failure_reason: reason || fax.failure_reason,
    }).catch(() => {});
    return;
  }
  const MAX_RETRIES = maxRetries;

  await base44.asServiceRole.entities.FaxLog.update(fax.id, {
    next_retry_at: null,
    final_failure_notified: true,
    failure_reason: reason || fax.failure_reason
  });

  if (!fax.sent_by) return;

  const docName = fax.document_name || 'your document';
  const recipient = fax.to_name ? `${fax.to_name} (${fax.to_number})` : fax.to_number;

  // In-app notification
  try {
    await base44.asServiceRole.entities.Notification.create({
      user_email: fax.sent_by,
      title: '❌ Fax Failed — All Retries Exhausted',
      message: `"${docName}" to ${recipient} could not be delivered after ${MAX_RETRIES} attempts.`,
      type: 'fax_failed',
      priority: 'high',
      metadata: { related_entity: 'FaxLog', related_entity_id: fax.id },
      is_read: false,
      action_url: `/send-fax?fax_id=${fax.id}`
    });
  } catch (e) {
    console.error('Failed to create in-app notification:', e.message);
  }

  // Email notification
  try {
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: fax.sent_by,
      from_name: 'PennSync by CareMetric',
      subject: `Fax failed after ${MAX_RETRIES} attempts`,
      body: renderBrandedEmail({
        preheader: `Your fax to ${recipient} could not be delivered after ${MAX_RETRIES} attempts.`,
        eyebrow: 'Fax failed',
        tone: 'urgent',
        title: 'Your fax could not be delivered',
        intro: `Your fax could not be delivered after ${MAX_RETRIES} automatic retry attempts.`,
        sections: [
          {
            rows: [
              ['Document', docName],
              ['Recipient', recipient],
              ['Last error', fax.failure_reason || reason || 'Unknown'],
            ],
          },
          {
            note: 'Please verify the recipient fax number and resend manually from the Fax Center.',
          },
        ],
      }),
    });
  } catch (e) {
    console.error('Failed to send final failure email:', e.message);
  }
}