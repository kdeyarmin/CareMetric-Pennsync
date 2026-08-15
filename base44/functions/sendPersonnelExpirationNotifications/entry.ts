import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


const reminderOffsets = [90, 60, 30, 14];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (mirrors processTrainingRenewals /
    // syncFaxStatuses). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    const today = new Date();
    const runId = crypto.randomUUID();
    // Constrain to the relevant expiration window BEFORE the row cap, then sort
    // ascending. A plain ascending list would let a historical backlog of
    // already-expired credentials (which accumulates without bound over time)
    // fill the 1000-row cap and starve the upcoming expirations this job exists
    // to notify about. The window spans recently-expired (so the status->expired
    // flip below still fires) through the furthest reminder horizon (90 days).
    const windowStart = new Date(today); windowStart.setDate(today.getDate() - 90);
    const windowEnd = new Date(today); windowEnd.setDate(today.getDate() + 90);
    const startStr = windowStart.toISOString().split('T')[0];
    const endStr = windowEnd.toISOString().split('T')[0];
    const items = await base44.asServiceRole.entities.PersonnelCredential.filter(
      { expiration_date: { $gte: startStr, $lte: endStr } },
      'expiration_date',
      1000
    );
    // 5000, not 400: a smaller cap drops the OLDEST accounts (typically the
    // agency owners/admins) off the newest-first page, so their staff's
    // credential reminders silently reach no admin. Matches submitIncidentReport.
    const users = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    let notificationsSent = 0;
    const notificationsToCreate = [];
    const updates = [];
    const emailPromises = [];

    for (const item of items) {
      if (!item.expiration_date || !item.user_id) continue;
      // Date-only expiration: compare on local calendar days, not UTC midnight.
      const expRaw = String(item.expiration_date).trim();
      let expiration;
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(expRaw)) {
        const [y, m, d] = expRaw.split('-').map(Number);
        expiration = new Date(y, m - 1, d);
      } else {
        expiration = new Date(item.expiration_date);
      }
      if (Number.isNaN(expiration.getTime())) continue;
      const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const daysUntilExpiration = Math.round((expiration.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24));
      const sentOffsets = Array.isArray(item.reminder_offsets_sent) ? item.reminder_offsets_sent : [];

      if (daysUntilExpiration < 0 && item.status !== 'expired') {
        updates.push(base44.asServiceRole.entities.PersonnelCredential.update(item.id, { status: 'expired' }));
      }

      // Fire AT or BELOW an unsent tier rather than on an exact-day match, so a
      // missed cron run (downtime/deploy/DST) doesn't skip a tier permanently;
      // per-record reminder_offsets_sent still prevents re-sending a fired tier.
      // Only remind before expiration (the status->expired update is above).
      const dueOffsets = daysUntilExpiration >= 0
        ? reminderOffsets.filter((o) => daysUntilExpiration <= o && !sentOffsets.includes(o))
        : [];
      if (dueOffsets.length === 0) continue;

      // Claim offsets BEFORE send so overlapping runs don't double-email, then
      // re-read to confirm we still own the claim. Prior code stamped offsets in
      // a bulk `updates` array before emails ran — if send failed, the tier was
      // still marked sent and the reminder was permanently lost; concurrent runs
      // could also both send before either stamp landed.
      const claimedOffsets = [...sentOffsets, ...dueOffsets];
      const claimToken = runId;
      try {
        await base44.asServiceRole.entities.PersonnelCredential.update(item.id, {
          reminder_offsets_sent: claimedOffsets,
          reminder_claimed_by: claimToken,
          reminder_claimed_at: new Date().toISOString(),
          last_reminder_sent_at: new Date().toISOString(),
        });
      } catch {
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.PersonnelCredential
        .filter({ id: item.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].reminder_claimed_by !== claimToken) {
        continue;
      }

      const employee = users.find((user) => user.email === item.user_id);
      // Only fan out to managers when the employee resolves to a known agency.
      // The prior `!employee?.agency_name` fallback matched EVERY agency_admin
      // across ALL tenants whenever the credential's user was deleted/renamed or
      // had no agency set — broadcasting the employee's name/credential to
      // unrelated agencies. Mirror sendTrainingCertificateEmail: no agency = no
      // manager fan-out.
      const agencyAdmins = employee?.agency_name
        ? users.filter((user) => user.account_type === 'agency_admin' && user.agency_name === employee.agency_name)
        : [];

      const expLabel = expiration.toLocaleDateString();

      notificationsToCreate.push({
        user_email: item.user_id,
        title: `${item.title} expires in ${daysUntilExpiration} days`,
        message: `Your ${item.item_type} "${item.title}" expires on ${expLabel}. Please upload a renewed copy to your personnel file.`,
        type: 'compliance_alert',
        priority: daysUntilExpiration <= 30 ? 'high' : 'medium',
        action_url: '/PersonnelFile',
        action_label: 'Open personnel file',
        metadata: { personnel_credential_id: item.id, days_until_expiration: daysUntilExpiration }
      });

      emailPromises.push(async () => {
        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: item.user_id,
            from_name: 'PennSync by CareMetric',
            subject: `Action needed: your ${item.title} expires in ${daysUntilExpiration} day(s)`,
            body: renderBrandedEmail({
              preheader: `Your ${item.title} expires in ${daysUntilExpiration} day(s).`,
              eyebrow: 'Credential expiration',
              title: `Hello ${employee?.full_name || 'there'},`,
              intro: `Your ${item.item_type} "${item.title}" is expiring soon and needs to be renewed.`,
              sections: [
                {
                  rows: [
                    ['Item', item.title],
                    ['Type', item.item_type],
                    ['Expiration date', expLabel],
                    ['Days remaining', String(daysUntilExpiration)],
                  ],
                },
                {
                  callout: { tone: 'warn', text: 'Please upload a renewed copy to your personnel file for approval before it expires.' },
                },
              ],
            }),
          });
        } catch (err) {
          console.error("Email failed:", err.message);
          // Roll back claimed offsets so a later run can retry this tier.
          await base44.asServiceRole.entities.PersonnelCredential.update(item.id, {
            reminder_offsets_sent: sentOffsets,
            reminder_claimed_by: '',
            last_reminder_sent_at: item.last_reminder_sent_at || null,
          }).catch(() => {});
        }
      });

      for (const manager of agencyAdmins) {
        notificationsToCreate.push({
          user_email: manager.email,
          title: `Employee personnel file item expires in ${daysUntilExpiration} days`,
          message: `${item.user_name || item.user_id} has a ${item.item_type} item (${item.title}) expiring on ${expLabel}.`,
          type: 'compliance_alert',
          priority: daysUntilExpiration <= 30 ? 'high' : 'medium',
          action_url: '/PersonnelFile',
          action_label: 'Review personnel file',
          metadata: { personnel_credential_id: item.id, employee_email: item.user_id, days_until_expiration: daysUntilExpiration }
        });

        emailPromises.push(() =>
          base44.asServiceRole.integrations.Core.SendEmail({
            to: manager.email,
            from_name: 'PennSync by CareMetric',
            subject: `Personnel file expiration reminder: ${item.user_name || item.user_id}`,
            body: renderBrandedEmail({
              preheader: `${item.user_name || item.user_id} has a personnel file item expiring soon.`,
              eyebrow: 'Compliance reminder',
              title: 'Personnel file expiration reminder',
              intro: `${item.user_name || item.user_id} has a personnel file item that is expiring soon.`,
              sections: [
                {
                  rows: [
                    ['Employee', item.user_name || item.user_id],
                    ['Item', item.title],
                    ['Type', item.item_type],
                    ['Expiration date', expLabel],
                  ],
                },
              ],
            }),
          }).catch(err => console.error("Manager email failed:", err.message))
        );
      }

      notificationsSent++;
    }

    if (notificationsToCreate.length > 0) {
      await base44.asServiceRole.entities.Notification.bulkCreate(notificationsToCreate);
    }

    // Process status->expired updates concurrently
    await Promise.all(updates);

    // Process emails in chunks to respect rate limits and save time
    for (let i = 0; i < emailPromises.length; i += 10) {
      const chunk = emailPromises.slice(i, i + 10);
      await Promise.all(chunk.map(fn => fn()));
    }

    return Response.json({ success: true, notifications_sent: notificationsSent });
  } catch (error) {
    console.error('sendPersonnelExpirationNotifications failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});