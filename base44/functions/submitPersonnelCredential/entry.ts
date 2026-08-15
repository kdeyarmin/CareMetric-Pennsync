import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


/**
 * submitPersonnelCredential — staff self-service create/update of their OWN
 * credential, always landing in status 'pending_approval'.
 *
 * PersonnelCredential's write RLS is admin-only: while staff had row-level
 * write access, nothing stopped a direct SDK call from setting
 * status='approved' on their own credential (RLS cannot restrict a single
 * field). All staff submissions come through here instead, where the writable
 * fields are whitelisted and the status is pinned server-side; approval
 * decisions live in the admin-gated reviewPersonnelCredential.
 *
 * Input: {
 *   credential_id?,        // update an existing own credential (edit/resubmission)
 *   renews_credential_id?, // renewal flow: stamp a bookkeeping note on the old own credential
 *   credential: { item_type, title, expiration_date, issuing_organization?,
 *                 credential_number?, issued_date?, uploaded_file_url?,
 *                 uploaded_file_name?, notes? }
 * }
 */

const ITEM_TYPES = new Set(['license', 'certification', 'insurance']);
// Staff-writable fields. Everything else — status, approved_by/at,
// rejection_reason, reminder bookkeeping — is server-controlled.
const SELF_SERVICE_FIELDS = [
  'item_type', 'title', 'issuing_organization', 'credential_number',
  'issued_date', 'expiration_date', 'uploaded_file_url', 'uploaded_file_name', 'notes',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { credential_id, renews_credential_id, credential } = await req.json();
    const input = credential && typeof credential === 'object' ? credential : {};

    const fields = {};
    for (const key of SELF_SERVICE_FIELDS) {
      if (input[key] !== undefined) fields[key] = input[key];
    }
    if (!fields.title || !fields.expiration_date || !ITEM_TYPES.has(fields.item_type)) {
      return Response.json({ error: 'credential.title, credential.item_type (license|certification|insurance) and credential.expiration_date are required' }, { status: 400 });
    }

    const svc = base44.asServiceRole.entities.PersonnelCredential;
    // Ownership for a service-role-fetched credential. The record is read with
    // RLS bypassed, so a bare isAdminLike() check would let an agency_admin of
    // one tenant edit another tenant's credential (knocking an approved license
    // back to pending, rewriting its expiration/file). Platform admins
    // (super_admin, or role:admin with no agency_name) keep cross-agency reach;
    // an agency-scoped admin may only touch a credential in their own agency,
    // and fails closed without an agency_name.
    const isSuperAdmin = user.account_type === 'super_admin';
    // A user who is BOTH account_type agency_admin AND role admin with no
    // agency_name must NOT be promoted to platform-wide via the bare-role:admin
    // path — an agency_admin without an agency_name fails closed by design.
    const isPlatformAdmin = isSuperAdmin
      || (user.role === 'admin' && user.account_type !== 'agency_admin' && !String(user.agency_name || '').trim());
    const isAgencyScopedAdmin = !isPlatformAdmin
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    const ownsRecord = (rec) => {
      if (!rec) return false;
      if (rec.user_id === user.email) return true;
      if (isPlatformAdmin) return true;
      if (isAgencyScopedAdmin) {
        const agency = String(user.agency_name || '').trim();
        return !!agency && String(rec.agency_name || '').trim() === agency;
      }
      return false;
    };

    // Every self-service write (re)enters the approval pipeline.
    const payload = {
      ...fields,
      user_id: user.email,
      user_name: user.full_name || user.email,
      agency_name: user.agency_name || undefined,
      status: 'pending_approval',
      approved_by: null,
      approved_at: null,
      rejection_reason: null,
    };

    let saved;
    if (credential_id) {
      const rows = await svc.filter({ id: credential_id });
      const existing = rows?.[0];
      if (!existing) {
        return Response.json({ error: 'Credential not found' }, { status: 404 });
      }
      if (!ownsRecord(existing)) {
        return Response.json({ error: 'Forbidden: you can only update your own credentials' }, { status: 403 });
      }
      // Keep the original owner on an admin edit; reminder bookkeeping fields
      // are simply not touched, so they carry over.
      payload.user_id = existing.user_id;
      payload.user_name = existing.user_name || payload.user_name;
      payload.agency_name = existing.agency_name || payload.agency_name;
      saved = await svc.update(credential_id, payload);
    } else {
      saved = await svc.create({ ...payload, reminder_offsets_sent: [] });
    }

    // Renewal flow: stamp the old credential so reviewers can see a renewal is
    // in flight. Status of the old credential is untouched — it stays approved
    // until reviewPersonnelCredential supersedes it.
    if (renews_credential_id && renews_credential_id !== credential_id) {
      const oldRows = await svc.filter({ id: renews_credential_id }).catch(() => []);
      const old = oldRows?.[0];
      if (old && ownsRecord(old)) {
        await svc.update(old.id, {
          notes: `${old.notes || ''}\n[Renewal submitted on ${new Date().toISOString().slice(0, 10)}]`.trim(),
        }).catch(() => {});
      }

      // Renewals need a human decision — let the admins know one is waiting.
      // Scope to the employee's agency (plus super_admins); unscoped fan-out
      // emailed staff names/credential titles to every tenant's admins.
      try {
        const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
        const agency = payload.agency_name || user.agency_name;
        let admins = (Array.isArray(allUsers) ? allUsers : []).filter((u) =>
          u && u.email && (
            u.role === 'admin' ||
            u.account_type === 'agency_admin' ||
            u.account_type === 'super_admin'
          )
        );
        if (agency) {
          admins = admins.filter((u) =>
            u.account_type === 'super_admin' || u.agency_name === agency
          );
        } else {
          admins = admins.filter((u) => u.account_type === 'super_admin');
        }
        await Promise.all(admins.map((admin) =>
          base44.asServiceRole.integrations.Core.SendEmail({
            to: admin.email,
            from_name: 'PennSync by CareMetric',
            subject: `Credential renewal submitted — ${fields.title}`,
            body: renderBrandedEmail({
              preheader: `${payload.user_name} submitted a credential renewal for approval.`,
              eyebrow: 'Approval needed',
              title: 'Credential renewal submitted',
              intro: 'A credential renewal has been submitted and is waiting for review.',
              sections: [
                {
                  rows: [
                    ['Employee', payload.user_name],
                    ['Credential', fields.title],
                    ['Type', fields.item_type],
                    ['New expiration', fields.expiration_date],
                  ],
                },
                { paragraphs: ['Review it under Pending Credential Approvals in the admin console.'] },
              ],
            }),
          })
        ));
      } catch (err) {
        console.error('submitPersonnelCredential admin notification failed:', err);
      }
    }

    return Response.json({ success: true, credential_id: saved?.id || credential_id, status: 'pending_approval' });
  } catch (error) {
    console.error('submitPersonnelCredential error:', error);
    return Response.json({ error: 'Failed to submit credential' }, { status: 500 });
  }
});
