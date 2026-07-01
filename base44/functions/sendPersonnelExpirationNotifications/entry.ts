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

const reminderOffsets = [90, 60, 30, 14];

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

    const today = new Date();
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
    const users = await base44.asServiceRole.entities.User.list('-created_date', 400);
    let notificationsSent = 0;
    const notificationsToCreate = [];
    const updates = [];
    const emailPromises = [];

    for (const item of items) {
      if (!item.expiration_date || !item.user_id) continue;
      const expiration = new Date(`${item.expiration_date}T00:00:00Z`);
      const daysUntilExpiration = Math.ceil((expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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

      const employee = users.find((user) => user.email === item.user_id);
      const agencyAdmins = users.filter((user) => user.account_type === 'agency_admin' && (!employee?.agency_name || user.agency_name === employee.agency_name));

      notificationsToCreate.push({
        user_email: item.user_id,
        title: `${item.title} expires in ${daysUntilExpiration} days`,
        message: `Your ${item.item_type} "${item.title}" expires on ${new Date(item.expiration_date).toLocaleDateString()}. Please upload a renewed copy to your personnel file.`,
        type: 'compliance_alert',
        priority: daysUntilExpiration <= 30 ? 'high' : 'medium',
        action_url: '/PersonnelFile',
        action_label: 'Open personnel file',
        metadata: { personnel_credential_id: item.id, days_until_expiration: daysUntilExpiration }
      });

      emailPromises.push(() =>
        base44.asServiceRole.integrations.Core.SendEmail({
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
                  ['Expiration date', new Date(item.expiration_date).toLocaleDateString()],
                  ['Days remaining', String(daysUntilExpiration)],
                ],
              },
              {
                callout: { tone: 'warn', text: 'Please upload a renewed copy to your personnel file for approval before it expires.' },
              },
            ],
          }),
        }).catch(err => console.error("Email failed:", err.message))
      );

      for (const manager of agencyAdmins) {
        notificationsToCreate.push({
          user_email: manager.email,
          title: `Employee personnel file item expires in ${daysUntilExpiration} days`,
          message: `${item.user_name || item.user_id} has a ${item.item_type} item (${item.title}) expiring on ${new Date(item.expiration_date).toLocaleDateString()}.`,
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
                    ['Expiration date', new Date(item.expiration_date).toLocaleDateString()],
                  ],
                },
              ],
            }),
          }).catch(err => console.error("Manager email failed:", err.message))
        );
      }

      updates.push(
        base44.asServiceRole.entities.PersonnelCredential.update(item.id, {
          reminder_offsets_sent: [...sentOffsets, ...dueOffsets],
          last_reminder_sent_at: new Date().toISOString()
        })
      );
      notificationsSent++;
    }

    if (notificationsToCreate.length > 0) {
      await base44.asServiceRole.entities.Notification.bulkCreate(notificationsToCreate);
    }
    
    // Process updates concurrently
    await Promise.all(updates);

    // Process emails in chunks to respect rate limits and save time
    for (let i = 0; i < emailPromises.length; i += 10) {
      const chunk = emailPromises.slice(i, i + 10);
      await Promise.all(chunk.map(fn => fn()));
    }

    return Response.json({ success: true, notifications_sent: notificationsSent });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});