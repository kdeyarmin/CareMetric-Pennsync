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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


/**
 * submitTimeOffRequest — create a time-off request on behalf of the
 * authenticated caller.
 *
 * Security: the requester's identity (employee_email / created_by) is taken
 * from the verified session, never the request body, so a user cannot file a
 * request for someone else. Dates, type, and the chosen approver are validated
 * server-side, and the row is written with the service role because the
 * TimeOffRequest entity's RLS limits direct writes to admins.
 */

const VALID_TYPES = ['vacation', 'sick', 'personal', 'bereavement', 'jury_duty', 'parental', 'unpaid', 'other'];

function parseISODate(value) {
  if (!value) return null;
  const datePart = String(value).slice(0, 10);
  const parts = datePart.split('-').map(Number);
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  // Reject overflow dates like 2026-02-31 that JS would silently roll forward.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function businessDaysBetween(start, end) {
  const s = parseISODate(start);
  const e = parseISODate(end);
  if (!s || !e || e < s) return 0;
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function totalRequestedDays(start, end, halfDay) {
  const business = businessDaysBetween(start, end);
  if (business === 0) return 0;
  return halfDay ? Math.max(0.5, business - 0.5) : business;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      request_type = 'vacation',
      start_date,
      end_date,
      half_day = false,
      reason = '',
      coverage = '',
      manager_email = '',
    } = body || {};

    if (!VALID_TYPES.includes(request_type)) {
      return Response.json({ error: 'Invalid request type.' }, { status: 400 });
    }

    const start = parseISODate(start_date);
    const end = parseISODate(end_date);
    if (!start || !end) {
      return Response.json({ error: 'Valid start and end dates are required.' }, { status: 400 });
    }
    if (end < start) {
      return Response.json({ error: 'The end date cannot be before the start date.' }, { status: 400 });
    }

    const total = totalRequestedDays(start_date, end_date, !!half_day);
    if (total <= 0) {
      return Response.json({ error: 'The selected range contains no working days.' }, { status: 400 });
    }

    // Validate the chosen approver: must be an admin or a flagged manager, and
    // can never be the requester themselves (that would enable self-approval).
    let resolvedManagerEmail = '';
    let resolvedManagerName = '';
    if (manager_email) {
      if (manager_email === user.email) {
        return Response.json({ error: 'You cannot assign yourself as your own approver.' }, { status: 400 });
      }
      const matches = await base44.asServiceRole.entities.User.filter({ email: manager_email }, undefined, 5000);
      const mgr = matches && matches[0];
      const mgrIsAdmin = mgr && (mgr.role === 'admin' || mgr.account_type === 'super_admin' || mgr.account_type === 'agency_admin');
      if (!mgr || !(mgrIsAdmin || mgr.is_manager === true)) {
        return Response.json({ error: 'The selected approver is not authorized to approve time off.' }, { status: 400 });
      }
      const callerAgency = String(user.agency_name || '').trim();
      if (callerAgency && user.account_type !== 'super_admin') {
        if (!mgr.agency_name || mgr.agency_name !== callerAgency) {
          return Response.json({ error: 'The selected approver is outside your agency.' }, { status: 403 });
        }
      }
      resolvedManagerEmail = mgr.email;
      resolvedManagerName = mgr.full_name || mgr.email;
    }

    const created = await base44.asServiceRole.entities.TimeOffRequest.create({
      employee_email: user.email,
      employee_name: user.full_name || user.email,
      manager_email: resolvedManagerEmail,
      manager_name: resolvedManagerName,
      request_type,
      start_date,
      end_date,
      half_day: !!half_day,
      total_days: total,
      reason: String(reason || '').slice(0, 2000),
      coverage: String(coverage || '').slice(0, 2000),
      status: 'pending',
    });

    // Notify the approver(s) — a designated manager directly, otherwise admins
    // so unassigned requests still surface. Best-effort: never fail the request.
    try {
      let recipients = [];
      if (resolvedManagerEmail) {
        recipients = [{ email: resolvedManagerEmail }];
      } else {
        const users = await base44.asServiceRole.entities.User.list('-created_date', 5000);
        // Scope admin fallback to the requester's agency — unscoped list
        // notified every tenant's agency_admins of time-off requests.
        recipients = users.filter((u) => u.email && (u.role === 'admin' || u.account_type === 'super_admin' || u.account_type === 'agency_admin'));
        if (user.agency_name) {
          recipients = recipients.filter((u) =>
            u.account_type === 'super_admin' || u.agency_name === user.agency_name);
        } else {
          recipients = recipients.filter((u) => u.account_type === 'super_admin');
        }
      }
      const requesterName = user.full_name || user.email;
      const prettyType = request_type.replace(/_/g, ' ');
      const summary = `${total} day(s) of ${prettyType} (${start_date} → ${end_date})`;
      await Promise.all(
        recipients.map((r) =>
          base44.asServiceRole.entities.Notification.create({
            user_email: r.email,
            title: 'New time-off request',
            message: `${requesterName} requested ${summary}.`,
            type: 'info',
            priority: 'medium',
            action_url: '/TimeOff',
            action_label: 'Review request',
            metadata: { time_off_request_id: created.id, employee_email: user.email },
          })
        )
      );
      // Email the approver(s) in addition to the in-app notification.
      const timeOffBody = renderBrandedEmail({
        preheader: `${requesterName} has requested time off and needs your review.`,
        eyebrow: 'Time-off request',
        title: `New time-off request from ${requesterName}`,
        intro: `${requesterName} has requested time off and needs your review.`,
        sections: [
          {
            rows: [
              ['Type', prettyType],
              ['Dates', `${start_date} → ${end_date}`],
              ['Business days', String(total)],
              ...(reason ? [['Reason', reason]] : []),
              ...(coverage ? [['Coverage', coverage]] : []),
            ],
          },
          { note: 'Review it in PennSync under Time Off → Approvals.' },
        ],
      });
      await Promise.all(
        recipients.map((r) =>
          base44.asServiceRole.integrations.Core.SendEmail({
            to: r.email,
            from_name: 'PennSync by CareMetric',
            subject: `Time-off request from ${requesterName}`,
            body: timeOffBody,
          }).catch(() => null)
        )
      );
    } catch (_notifyError) {
      // Notifications/emails are best-effort; the dashboard remains the source of truth.
    }

    return Response.json({ success: true, request: created });
  } catch (error) {
    console.error('submitTimeOffRequest failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});