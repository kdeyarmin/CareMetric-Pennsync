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


// Local calendar day count for date-only YYYY-MM-DD fields (mirrors
// sendPersonnelExpirationNotifications / remindPlanOverdueStaff).
function localDaysUntil(dateOnly, now = new Date()) {
  const raw = String(dateOnly || '').trim();
  let target;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    target = new Date(y, m - 1, d);
  } else {
    target = new Date(dateOnly);
  }
  if (Number.isNaN(target.getTime())) return null;
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Scheduled reminder task. Allow the platform's no-identity scheduler path
    // (per docs/SECURITY-RLS-CHECKLIST.md §4) but reject any authenticated
    // non-admin. The prior `!user` gate 403'd the scheduler, so credential
    // renewal reminders only ran when an admin triggered them manually.
    const user = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, user);
    if (authError) return authError;
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const runId = crypto.randomUUID();
    // Constrain to the relevant expiration window BEFORE the row cap, then sort
    // ascending. A plain ascending list would let a historical backlog of
    // already-expired credentials (which accumulates without bound over time)
    // fill the 5000-row cap and starve the upcoming renewals this job exists to
    // notify about. The window spans recently-expired (for the digest) through
    // the furthest reminder horizon (90 days out).
    const windowStart = new Date(today); windowStart.setDate(today.getDate() - 90);
    const windowEnd = new Date(today); windowEnd.setDate(today.getDate() + 90);
    const startStr = windowStart.toISOString().split('T')[0];
    const endStr = windowEnd.toISOString().split('T')[0];
    const credentials = await base44.asServiceRole.entities.PersonnelCredential.filter(
      { expiration_date: { $gte: startStr, $lte: endStr } },
      'expiration_date',
      5000
    );

    const notificationsSent = [];

    // Collect items per-admin so admins get a consolidated upcoming-expiration digest.
    const adminDigestItems = [];

    for (const cred of credentials) {
      if (!cred.expiration_date || cred.status === 'expired') continue;

      // Date-only expiration: compare on local calendar days, not UTC midnight,
      // matching sendPersonnelExpirationNotifications so the two crons agree.
      const daysUntilExpiry = localDaysUntil(cred.expiration_date, today);
      if (daysUntilExpiry === null) continue;

      // Anything expiring within 90 days (or already expired) goes into the admin digest.
      if (daysUntilExpiry <= 90) {
        let itemAgency = cred.agency_name || null;
        // Attribute legacy unscoped credentials via the owning User so they
        // land in the correct agency digest instead of fanning out to all.
        if (!itemAgency && cred.user_id) {
          const owners = await base44.asServiceRole.entities.User
            .filter({ email: cred.user_id }, undefined, 1).catch(() => []);
          itemAgency = owners?.[0]?.agency_name || null;
        }
        adminDigestItems.push({
          user_name: cred.user_name || cred.user_id,
          title: cred.title,
          item_type: cred.item_type,
          expiration_date: cred.expiration_date,
          daysUntilExpiry,
          agency_name: itemAgency,
        });
      }

      // Send renewal request at 90, 60, 30, 14, and 7 days before expiration.
      // Determine which tiers are newly crossed in ONE pass. Iterating and
      // updating per-offset previously read a stale local `remindersSent`, so a
      // credential first seen at <=7 days fired all four tiers at once (and the
      // per-iteration write overwrote the tracking, causing repeats every run).
      const reminderOffsets = [90, 60, 30, 14, 7];
      // Use a marker field dedicated to THIS job. The three credential-reminder
      // crons previously shared `reminder_offsets_sent` with different tier sets,
      // so whichever fired a shared tier first consumed it for the others (e.g.
      // sendExpirationNotifications marking tier 30 suppressed this renewal email).
      const remindersSent = cred.renewal_email_offsets_sent || [];
      // Only remind before expiration (digest still covers already-expired items).
      const dueOffsets = daysUntilExpiry >= 0
        ? reminderOffsets.filter(
          (offset) => daysUntilExpiry <= offset && !remindersSent.includes(offset)
        )
        : [];

      if (dueOffsets.length > 0) {
        const userRecord = await base44.asServiceRole.entities.User.filter({ email: cred.user_id }, undefined, 5000);

        if (userRecord && userRecord.length > 0) {
          const userName = userRecord[0].full_name || cred.user_id;

          // Claim offsets BEFORE send so overlapping runs don't double-email,
          // then re-read to confirm we still own the claim (mirrors
          // sendPersonnelExpirationNotifications). Prior code stamped offsets
          // only after SendEmail — concurrent runs could both send first.
          const claimedOffsets = [...remindersSent, ...dueOffsets];
          const claimToken = runId;
          try {
            await base44.asServiceRole.entities.PersonnelCredential.update(cred.id, {
              renewal_email_offsets_sent: claimedOffsets,
              renewal_email_claimed_by: claimToken,
              renewal_email_claimed_at: new Date().toISOString(),
              last_reminder_sent_at: new Date().toISOString(),
            });
          } catch {
            continue;
          }
          const claimCheck = await base44.asServiceRole.entities.PersonnelCredential
            .filter({ id: cred.id }, '-created_date', 1).catch(() => []);
          if (!claimCheck[0] || claimCheck[0].renewal_email_claimed_by !== claimToken) {
            continue;
          }

          // One consolidated email per run; the body already shows the real
          // days remaining. Per-credential try/catch so one failed send (bad
          // address, provider error) doesn't strand every later reminder.
          try {
            const [y, m, d] = String(cred.expiration_date).split('-').map(Number);
            const expLabel = Number.isFinite(y)
              ? new Date(y, m - 1, d).toLocaleDateString()
              : String(cred.expiration_date);
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: cred.user_id,
              from_name: 'PennSync by CareMetric',
              subject: `Credential renewal required: ${cred.title}`,
              body: renderBrandedEmail({
                preheader: `Your ${cred.title} is expiring soon and requires renewal.`,
                eyebrow: 'Credential renewal',
                title: `Hello ${userName},`,
                intro: `Your ${cred.title} is expiring soon and requires renewal.`,
                sections: [
                  {
                    rows: [
                      ['Credential', cred.title],
                      ['Issued by', cred.issuing_organization || 'N/A'],
                      ['Expiration date', expLabel],
                      ['Days remaining', String(daysUntilExpiry)],
                    ],
                  },
                  {
                    heading: 'What to do next',
                    bullets: [
                      'Open your Personnel File in the app.',
                      'Upload your renewed credential document.',
                      'Submit it for admin approval.',
                    ],
                  },
                  {
                    callout: { tone: 'warn', text: 'Failure to renew before expiration may affect your assignment eligibility.' },
                  },
                  {
                    note: 'If you need assistance, please contact your supervisor.',
                  },
                ],
              }),
            });

            notificationsSent.push({
              user_id: cred.user_id,
              credential: cred.title,
              days_until_expiry: daysUntilExpiry,
              offsets: dueOffsets
            });
          } catch (sendErr) {
            console.error('Failed to send renewal reminder for credential:', sendErr?.message || sendErr);
            // Roll back the claimed offsets so a later run can retry — otherwise
            // a transient SendEmail failure permanently suppresses this tier.
            await base44.asServiceRole.entities.PersonnelCredential.update(cred.id, {
              renewal_email_offsets_sent: remindersSent,
              renewal_email_claimed_by: '',
              last_reminder_sent_at: cred.last_reminder_sent_at || null,
            }).catch(() => {});
          }
        }
      }
    }

    // Send a consolidated 90-day expiration digest to admins — at most once per
    // calendar day PER AGENCY. Claim the day stamp on that agency's
    // AgencySettings row (by id) before sending so overlapping crons and
    // multi-tenant newest-row-wins cannot suppress or double-email the wrong tenant.
    let adminDigestSent = 0;
    if (adminDigestItems.length > 0) {
      const tryClaimDigest = async (settings, claimToken) => {
        if (!settings?.id) return false;
        if (settings.last_credential_digest_sent_on === todayIso) return false;
        try {
          await base44.asServiceRole.entities.AgencySettings.update(settings.id, {
            last_credential_digest_sent_on: todayIso,
            credential_digest_claimed_by: claimToken,
            credential_digest_claimed_at: new Date().toISOString(),
          });
          const claimCheck = await base44.asServiceRole.entities.AgencySettings
            .filter({ id: settings.id }, '-created_date', 1).catch(() => []);
          return !!(claimCheck[0] && claimCheck[0].credential_digest_claimed_by === claimToken);
        } catch {
          return false;
        }
      };

      const agencyKeys = [...new Set(
        adminDigestItems.map((i) => i.agency_name).filter(Boolean),
      )];
      const hasUnscoped = adminDigestItems.some((i) => !i.agency_name);
      const claimedAgencyKeys = new Set();
      let claimedUnscoped = false;

      for (const agencyName of agencyKeys) {
        const settings = await resolveAgencySettings(base44, agencyName);
        if (await tryClaimDigest(settings, `${runId}:${agencyName}`)) {
          claimedAgencyKeys.add(agencyName);
        }
      }
      if (hasUnscoped) {
        const fallback = await resolveAgencySettings(base44, null);
        if (fallback?.id && await tryClaimDigest(fallback, `${runId}:__unscoped__`)) {
          claimedUnscoped = true;
        } else if (!fallback?.id) {
          // No AgencySettings row yet — send unscoped once, then stub a stamp.
          claimedUnscoped = true;
          try {
            await base44.asServiceRole.entities.AgencySettings.create({
              last_credential_digest_sent_on: todayIso,
              credential_digest_claimed_by: `${runId}:__unscoped__`,
              credential_digest_claimed_at: new Date().toISOString(),
            });
          } catch (createErr) {
            console.error('Failed to create AgencySettings digest stamp:', createErr?.message || createErr);
          }
        }
      }

      if (claimedAgencyKeys.size > 0 || claimedUnscoped) {
        const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
        const admins = (Array.isArray(allUsers) ? allUsers : []).filter((u) =>
          u && u.email && (
            u.role === 'admin' ||
            u.account_type === 'agency_admin' ||
            u.account_type === 'super_admin'
          )
        );
        adminDigestItems.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

        for (const admin of admins) {
          let scoped;
          if (admin.account_type === 'super_admin') {
            scoped = adminDigestItems.filter((i) =>
              (i.agency_name && claimedAgencyKeys.has(i.agency_name))
              || (!i.agency_name && claimedUnscoped)
            );
          } else if (admin.agency_name && claimedAgencyKeys.has(admin.agency_name)) {
            // Agency admins only receive items attributed to their agency —
            // never unscoped/legacy rows (those go to super_admin only).
            scoped = adminDigestItems.filter((i) =>
              i.agency_name === admin.agency_name
            );
          } else {
            continue;
          }
          if (scoped.length === 0) continue;
          const digestBullets = scoped.map((i) => {
            const when = i.daysUntilExpiry < 0
              ? `expired ${Math.abs(i.daysUntilExpiry)} day(s) ago`
              : `${i.daysUntilExpiry} day(s) remaining`;
            const [y, m, d] = String(i.expiration_date).split('-').map(Number);
            const expLabel = Number.isFinite(y)
              ? new Date(y, m - 1, d).toLocaleDateString()
              : String(i.expiration_date);
            return `${i.user_name} — ${i.title} (${i.item_type}) — expires ${expLabel} (${when})`;
          });
          try {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: admin.email,
              from_name: 'PennSync by CareMetric',
              subject: `Personnel expiration digest — ${scoped.length} item(s) within 90 days`,
              body: renderBrandedEmail({
                preheader: `${scoped.length} personnel file item(s) are expired or expiring within 90 days.`,
                eyebrow: 'Compliance digest',
                title: 'Personnel expiration digest',
                intro: 'The following personnel file items are expired or expiring within the next 90 days.',
                sections: [
                  { bullets: digestBullets },
                  { note: 'Review these in the Personnel File → Credential Compliance report.' },
                ],
              }),
            });
            adminDigestSent++;
          } catch (digestErr) {
            console.error('Failed to send admin digest:', digestErr?.message || digestErr);
          }
        }
      }
    }

    return Response.json({
      success: true,
      notifications_sent: notificationsSent.length,
      admin_digests_sent: adminDigestSent,
      details: notificationsSent
    });
  } catch (error) {
    console.error('sendCredentialRenewalReminders failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});