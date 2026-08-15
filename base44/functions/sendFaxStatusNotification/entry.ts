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
// Allow only absolute http(s)/mailto links in email buttons, then HTML-escape the
// whole attribute value. Rejects dangerous/unusable schemes (javascript:, data:,
// protocol-relative //host, app-relative paths that don't resolve in an inbox) so
// a user-controlled URL can never inject a scheme or break out of the attribute.
// Returns '' for a rejected URL, and the caller then renders no button.
function safeEmailHref(raw) {
  const url = String(raw ?? '').trim();
  const lower = url.toLowerCase();
  const ok = lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('mailto:');
  return ok ? escapeEmailHtml(url) : '';
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
    const href = safeEmailHref(s.button.href);
    if (href) {
      parts.push(`<div style="margin:6px 0 18px;"><a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:8px;background:${BRAND_EMAIL.navy};color:#ffffff;font-weight:700;font-size:15px;line-height:1;text-decoration:none;">${escapeEmailHtml(s.button.label || 'Open PennSync')}</a></div>`);
    }
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

// <<<BEGIN SHARED HELPER: resolveTelnyxCreds — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let record = null;
  let readError = null;
  try {
    const rows = await base44.asServiceRole.entities.IntegrationSecret
      .filter({ provider: 'telnyx' }, '-updated_date', 5000);
    const list = Array.isArray(rows) ? rows : [];
    // Deterministic row selection. This read used to be unsorted with no is_active
    // filter and took rows[0], and saveTelnyxSecret picks from the same unordered
    // query — so with two telnyx rows the admin could be writing one row while the
    // senders read the other, and re-entering the key could never fix it.
    record = list.find((r) => r && r.is_active === true && pick(r.api_key))
      || list.find((r) => r && pick(r.api_key))
      || list[0]
      || null;
  } catch (err) {
    // Do NOT collapse this into "not configured". A failed read (this invocation
    // path carries no service token, entity 404, 401/403, rate limit, platform
    // blip) is a completely different problem from an unconfigured integration,
    // and reporting them identically is what sent operators chasing a credential
    // they had already entered correctly.
    readError = (err && err.message) ? String(err.message) : 'IntegrationSecret read failed';
    // The catch used to be bare, so an unreadable credential row left no
    // server-side breadcrumb at all — the only signal was a misleading
    // "not configured" reply. Log it; unattended runs have nowhere else to say so.
    console.error('resolveTelnyxCreds: could not read the Telnyx IntegrationSecret row:', readError);
  }
  const rec = record || {};
  return {
    apiKey: pick(rec.api_key),
    publicKey: pick(rec.public_key),
    messagingProfileId: pick(rec.messaging_profile_id),
    voiceConnectionId: pick(rec.voice_connection_id),
    faxConnectionId: pick(rec.fax_connection_id),
    record,
    readError,
  };
}

// Build the caller-facing message for a missing Telnyx credential. Distinguishing
// "could not read" from "not stored" is the whole point: the first is not fixed by
// entering a key, and telling an admin to enter one is what caused two reverted
// env-fallback regressions.
function telnyxCredsMessage(creds, what) {
  const label = what || 'credentials';
  if (creds && creds.readError) {
    return `Could not read Telnyx ${label} — the stored-credential lookup failed (${creds.readError}). This is NOT a missing key, so re-entering it will not help. Retry; if it persists, this function is running without service-role access to IntegrationSecret.`;
  }
  return `Telnyx ${label} not configured — add the API key in Admin › Telnyx (it is stored on the IntegrationSecret row; TELNYX_* environment variables are not read).`;
}
// <<<END SHARED HELPER: resolveTelnyxCreds>>>


// <<<BEGIN SHARED HELPER: resolveAgencySettings — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveAgencySettings(base44, agencyName) {
  let settings = [];
  const key = String(agencyName || '').trim();
  if (key) {
    settings = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: key }, '-created_date', 1)
      .catch(() => []);
    if (!settings?.length) {
      settings = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: key }, '-created_date', 1)
        .catch(() => []);
    }
  }
  if (!settings?.length) {
    // Fail closed when the agency hint missed (or no hint but multiple tenant
    // rows exist). Newest-row-wins would silently apply another agency's fax
    // line / dial allowlist / wage index / quiet-hour timezone.
    if (key) return null;
    const newest = await base44.asServiceRole.entities.AgencySettings
      .list('-created_date', 5)
      .catch(() => []);
    if ((newest || []).length > 1) return null;
    settings = (newest || []).slice(0, 1);
  }
  return settings?.[0] || null;
}
// <<<END SHARED HELPER: resolveAgencySettings>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }

    const { data } = await req.json();
    if (!data?.id) {
      return Response.json({ error: 'FaxLog id is required' }, { status: 400 });
    }

    // Never trust the posted body for status/recipient/document — re-fetch the
    // canonical FaxLog and notify from its fields only.
    const fax = await base44.asServiceRole.entities.FaxLog.get(data.id).catch(() => null);
    if (!fax) {
      return Response.json({ error: 'Fax not found' }, { status: 404 });
    }

    // Only the sender or an admin may drive the sender's delivery/failure notice
    // (and consume its one-shot idempotency markers). Agency-scoped admins are
    // limited to their own agency's faxes — a bare isAdminLike() check let an
    // agency_admin of another tenant read this fax's recipient/document/failure
    // detail and suppress the real sender's notification.
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    const isOwner = fax.sent_by === user.email;
    if (!isOwner && !isPlatformAdmin && !isAgencyScopedAdmin) {
      return Response.json({ error: 'Forbidden: not the fax sender' }, { status: 403 });
    }
    if (isAgencyScopedAdmin && !isOwner) {
      if (!user.agency_name || !fax.sent_by) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      const senders = await base44.asServiceRole.entities.User
        .filter({ email: fax.sent_by }, undefined, 5)
        .catch(() => []);
      if (!senders?.[0] || senders[0].agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const status = String(fax.status || '').toLowerCase();
    if (!['delivered', 'failed'].includes(status)) {
      return Response.json({ skipped: true, reason: 'Status not delivered or failed' });
    }

    const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `fax-status-${Date.now()}`;
    if (status === 'delivered') {
      if (fax.delivery_confirmation_sent) {
        return Response.json({ skipped: true, reason: 'delivery already notified' });
      }
      try {
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          delivery_confirmation_sent: true,
          delivery_notify_claimed_by: claimToken,
        });
      } catch {
        return Response.json({ skipped: true, reason: 'could not claim delivery notify' });
      }
      const claimCheck = await base44.asServiceRole.entities.FaxLog
        .filter({ id: fax.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].delivery_notify_claimed_by !== claimToken) {
        return Response.json({ skipped: true, reason: 'delivery notify claimed by concurrent run' });
      }
    } else {
      if (fax.final_failure_notified) {
        return Response.json({ skipped: true, reason: 'failure already notified' });
      }
      try {
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          final_failure_notified: true,
          failure_notify_claimed_by: claimToken,
        });
      } catch {
        return Response.json({ skipped: true, reason: 'could not claim failure notify' });
      }
      const claimCheck = await base44.asServiceRole.entities.FaxLog
        .filter({ id: fax.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].failure_notify_claimed_by !== claimToken) {
        return Response.json({ skipped: true, reason: 'failure notify claimed by concurrent run' });
      }
    }

    const recipientFax = fax.to_number || fax.recipient_fax_number || 'Unknown';
    const documentName = fax.document_name || fax.to_name || 'Untitled Document';
    const timestamp = new Date().toLocaleString();

    const delivered = status === 'delivered';
    const subject = `Fax ${delivered ? 'delivered' : 'failed'}: ${documentName}`;
    const emailBody = renderBrandedEmail({
      preheader: `Your fax to ${recipientFax} was ${status}.`,
      eyebrow: delivered ? 'Fax delivered' : 'Fax failed',
      tone: delivered ? 'brand' : 'urgent',
      title: `Your fax was ${status}`,
      sections: [
        {
          callout: delivered
            ? { tone: 'success', text: `Your fax "${documentName}" was delivered successfully.` }
            : { tone: 'urgent', text: `Your fax "${documentName}" could not be delivered.` },
        },
        {
          rows: [
            ['Document', documentName],
            ['Recipient', recipientFax],
            ['Time', timestamp],
            ['Status', status.charAt(0).toUpperCase() + status.slice(1)],
            ...(fax.error_message || fax.failure_reason
              ? [['Error', fax.error_message || fax.failure_reason]]
              : []),
            ...(fax.telnyx_fax_id ? [['Tracking ID', fax.telnyx_fax_id]] : []),
          ],
        },
        {
          note: 'Sign in to your dashboard to view more details.',
        },
      ],
    });

    const smsMessage = `Fax ${delivered ? 'delivered' : 'failed'}: ${documentName} to ${recipientFax}`;
    const notifyEmail = user.email;
    const notifyPhone = user.phone || user.personal_cell_e164;

    const notifications = [];
    let anySent = false;

    if (notifyEmail) {
      try {
        await base44.integrations.Core.SendEmail({
          to: notifyEmail,
          subject: subject,
          body: emailBody,
          from_name: 'PennSync by CareMetric',
        });
        notifications.push({ type: 'email', status: 'sent' });
        anySent = true;
      } catch (emailError) {
        console.error('Email notification failed:', emailError);
        notifications.push({ type: 'email', status: 'failed', error: emailError.message });
      }
    }

    // SMS only with explicit SmsConsent opted_in (TCPA parity with sendSms).
    if (notifyPhone) {
      try {
        const phone = String(notifyPhone).trim();
        const consents = await base44.asServiceRole.entities.SmsConsent
          .filter({ phone_e164: phone }, '-captured_at', 1)
          .catch(() => []);
        if (consents[0]?.consent_status === 'opted_in') {
          const telnyxCreds = await resolveTelnyxCreds(base44);
          const { apiKey, messagingProfileId } = telnyxCreds;
          const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
          const fromNumber = (agencySettings?.main_office_number_e164 || '').toString().trim() || null;

          if (apiKey && fromNumber) {
            const payload = { from: fromNumber, to: phone, text: smsMessage };
            if (messagingProfileId) payload.messaging_profile_id = messagingProfileId;
            const response = await fetch('https://api.telnyx.com/v2/messages', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            });

            if (response.ok) {
              notifications.push({ type: 'sms', status: 'sent' });
              anySent = true;
            } else {
              const error = await response.text();
              notifications.push({ type: 'sms', status: 'failed', error });
            }
          }
        } else {
          notifications.push({ type: 'sms', status: 'skipped', reason: 'consent not opted_in' });
        }
      } catch (smsError) {
        console.error('SMS notification failed:', smsError);
        notifications.push({ type: 'sms', status: 'failed', error: smsError.message });
      }
    }

    try {
      await base44.asServiceRole.entities.Notification.create({
        user_email: fax.sent_by || user.email,
        type: status === 'failed' ? 'fax_failed' : 'fax_delivered',
        title: subject,
        message: `Fax to ${recipientFax} has been ${status}`,
        metadata: { related_entity: 'FaxLog', related_entity_id: fax.id },
        is_read: false,
      });
      anySent = true;
    } catch (logError) {
      console.error('Failed to log notification:', logError);
    }

    if (!anySent) {
      if (status === 'delivered') {
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          delivery_confirmation_sent: false,
          delivery_notify_claimed_by: '',
        }).catch(() => {});
      } else {
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          final_failure_notified: false,
          failure_notify_claimed_by: '',
        }).catch(() => {});
      }
    }

    return Response.json({
      success: true,
      notifications: notifications,
      faxId: fax.id,
      recipientFax: recipientFax,
      faxStatus: status,
    });
  } catch (error) {
    console.error('Notification service error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
