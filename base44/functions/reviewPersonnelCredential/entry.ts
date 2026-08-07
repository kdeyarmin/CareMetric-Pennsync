import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>



// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>

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

/**
 * reviewPersonnelCredential — admin-gated approve/reject of a staff credential.
 *
 * PersonnelCredential rows are now writable only by admins at the RLS layer
 * (staff submissions go through submitPersonnelCredential, which pins
 * status=pending_approval). RLS cannot restrict a SINGLE field, so while staff
 * had row-level write access they could set status='approved' on their own
 * credential; the approval decision therefore lives here, behind a server-side
 * admin check, and stamps who approved and when.
 *
 * Input: { credential_id, action: 'approve' | 'reject', rejection_reason? }
 */

const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!isAdminLike(user)) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const { credential_id, action, rejection_reason } = await req.json();
    if (!credential_id || (action !== 'approve' && action !== 'reject')) {
      return Response.json({ error: "credential_id and action ('approve' | 'reject') are required" }, { status: 400 });
    }
    const reason = String(rejection_reason || '').trim();
    if (action === 'reject' && !reason) {
      return Response.json({ error: 'rejection_reason is required to reject a credential' }, { status: 400 });
    }

    const rows = await base44.asServiceRole.entities.PersonnelCredential.filter({ id: credential_id }, undefined, 5000);
    const credential = rows?.[0];
    if (!credential) {
      return Response.json({ error: 'Credential not found' }, { status: 404 });
    }
    if (credential.status !== 'pending_approval') {
      return Response.json({ error: `Only pending_approval credentials can be reviewed (current status: ${credential.status})` }, { status: 409 });
    }

    // Agency admins may only review credentials for staff in their own agency.
    // credential.user_id stores the employee's email in this schema.
    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      const owners = await base44.asServiceRole.entities.User
        .filter({ email: credential.user_id }, undefined, 5)
        .catch(() => []);
      const owner = owners?.[0];
      if (!user.agency_name || !owner || owner.agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden: credential owner is outside your agency.' }, { status: 403 });
      }
    }

    const nowIso = new Date().toISOString();
    let superseded = 0;

    if (action === 'approve') {
      // Approve the new credential FIRST. If this write fails we bail out
      // before touching anything else, so we never expire the employee's prior
      // valid credential and leave them with no approved replacement.
      await base44.asServiceRole.entities.PersonnelCredential.update(credential.id, {
        status: 'approved',
        approved_by: user.email,
        approved_at: nowIso,
        rejection_reason: null,
      });

      // Now supersede any previously approved copy of the same credential —
      // mark it expired so compliance reports don't count both.
      const oldCredentials = await base44.asServiceRole.entities.PersonnelCredential.filter({
        user_id: credential.user_id,
        title: credential.title,
        status: 'approved',
      }, undefined, 5000).catch(() => []);
      for (const old of oldCredentials) {
        if (old.id === credential.id) continue;
        await base44.asServiceRole.entities.PersonnelCredential.update(old.id, {
          status: 'expired',
          notes: `${old.notes || ''}\n[Superseded by renewal on ${nowIso.slice(0, 10)}]`.trim(),
        }).catch(() => {});
        superseded++;
      }
    } else {
      await base44.asServiceRole.entities.PersonnelCredential.update(credential.id, {
        status: 'rejected',
        rejection_reason: reason,
        approved_by: user.email,
        approved_at: nowIso,
      });
    }

    // Audit trail for the compliance decision.
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      action: action === 'approve' ? 'personnel_credential_approved' : 'personnel_credential_rejected',
      entity_type: 'PersonnelCredential',
      entity_id: credential.id,
      details: { credential_title: credential.title, credential_user: credential.user_id, superseded },
      status: 'success',
    }).catch(() => {});

    // Notify the employee. The decision stands even if the email fails — report
    // the gap instead of failing the review.
    let emailed = true;
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: credential.user_id,
        from_name: 'PennSync by CareMetric',
        subject: action === 'approve'
          ? `Credential approved — ${credential.title}`
          : `Credential needs revision — ${credential.title}`,
        body: renderBrandedEmail(action === 'approve'
          ? {
            preheader: `Your ${credential.title} credential has been approved.`,
            eyebrow: 'Credential approved',
            title: `Hello ${credential.user_name || credential.user_id},`,
            intro: 'Your credential submission has been approved.',
            sections: [
              {
                rows: [
                  ['Credential', credential.title],
                  ['Type', credential.item_type],
                  ['Expiration', fmtDate(credential.expiration_date)],
                  ['Approved by', user.full_name || user.email],
                ],
              },
              { paragraphs: ['Your personnel file has been updated. You can view your current credentials in the Personnel File section.'] },
            ],
          }
          : {
            preheader: `Your ${credential.title} submission needs revision.`,
            eyebrow: 'Action required',
            tone: 'urgent',
            title: `Hello ${credential.user_name || credential.user_id},`,
            intro: 'Your credential submission requires revision.',
            sections: [
              {
                rows: [
                  ['Credential', credential.title],
                  ['Type', credential.item_type],
                ],
              },
              { callout: { tone: 'warn', text: `Reason: ${reason}` } },
              { paragraphs: ['Please re-upload a corrected document in your Personnel File. If you have questions, please contact your supervisor.'] },
            ],
          }),
      });
    } catch (err) {
      console.error('reviewPersonnelCredential email failed:', err);
      emailed = false;
    }

    return Response.json({ success: true, action, credential_id: credential.id, superseded, emailed });
  } catch (error) {
    console.error('reviewPersonnelCredential error:', error);
    return Response.json({ error: 'Failed to review credential' }, { status: 500 });
  }
});
