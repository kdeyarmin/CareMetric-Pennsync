import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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
 * submitTimesheet — create or update a pay-period timesheet on behalf of the
 * authenticated caller and route it to the facility admin/manager for approval.
 *
 * Security: the employee identity (employee_email / created_by) comes from the
 * verified session, never the request body, so a user cannot file a timesheet
 * for someone else. Numbers are coerced and validated server-side, the chosen
 * approver is validated (admin or flagged manager, never self), and the row is
 * written with the service role because the Timesheet entity's RLS limits direct
 * writes to admins.
 *
 * PTO carryover: the employee's APPROVED, PAID time-off overlapping the pay
 * period is summed server-side into `auto_pto_hours` (authoritative) so approved
 * PTO automatically flows onto the payroll's Vacation column — the client cannot
 * inflate it.
 */

const VALID_SERVICE_TYPES = ['home_health', 'hospice'];
const SUBMIT_STATUSES = ['draft', 'submitted'];
// Paid PTO types that carry into the timesheet's vacation bucket (unpaid excluded).
const PAID_PTO_TYPES = ['vacation', 'sick', 'personal', 'bereavement', 'jury_duty', 'parental', 'other'];
const HOURS_PER_DAY = 8;
const NUMERIC_FIELDS = [
  'regular_points', 'emergency_visit_points', 'regular_hours', 'overtime_hours',
  'vacation_hours', 'holiday_hours', 'on_call_hours', 'on_call_visits', 'miles', 'reimbursement',
];
// Home-health visit types; total points = Σ (count of a type) × (its point value).
const VISIT_TYPE_KEYS = ['soc', 'roc', 'recert', 'routine', 'discharge'];
function computeVisitPoints(counts, config) {
  let total = 0;
  for (const k of VISIT_TYPE_KEYS) {
    const c = Number(counts?.[k]);
    const p = Number(config?.[`${k}_points`]);
    total += (Number.isFinite(c) ? c : 0) * (Number.isFinite(p) ? p : 0);
  }
  return Math.round(total * 100) / 100;
}

// Daily-entry fields summed into the period totals (mirrors DAILY_SUM_FIELDS on
// the frontend). Vacation/miles/emerg points/reimbursement stay period-level.
const DAILY_SUM_FIELDS = ['regular_hours', 'overtime_hours', 'holiday_hours', 'on_call_hours', 'on_call_visits'];
function normalizeDailyEntries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 62).map((e) => {
    const entry = { date: String(e?.date || '').slice(0, 10) };
    for (const f of DAILY_SUM_FIELDS) entry[f] = toNonNegativeNumber(e?.[f]);
    const vc = {};
    for (const k of VISIT_TYPE_KEYS) vc[k] = toNonNegativeNumber(e?.visit_counts?.[k]);
    entry.visit_counts = vc;
    return entry;
  });
}
function sumDailyEntries(entries) {
  const totals = {};
  for (const f of DAILY_SUM_FIELDS) totals[f] = 0;
  const visit_counts = {};
  for (const k of VISIT_TYPE_KEYS) visit_counts[k] = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    for (const f of DAILY_SUM_FIELDS) totals[f] += toNonNegativeNumber(e?.[f]);
    for (const k of VISIT_TYPE_KEYS) visit_counts[k] += toNonNegativeNumber(e?.visit_counts?.[k]);
  }
  for (const f of DAILY_SUM_FIELDS) totals[f] = Math.round(totals[f] * 100) / 100;
  for (const k of VISIT_TYPE_KEYS) visit_counts[k] = Math.round(visit_counts[k] * 100) / 100;
  return { totals, visit_counts };
}

function parseISODate(value) {
  if (!value) return null;
  const datePart = String(value).slice(0, 10);
  const parts = datePart.split('-').map(Number);
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

function intersectionBusinessDays(aStart, aEnd, bStart, bEnd) {
  const as = parseISODate(aStart);
  const ae = parseISODate(aEnd);
  const bs = parseISODate(bStart);
  const be = parseISODate(bEnd);
  if (!as || !ae || !bs || !be) return 0;
  const start = as > bs ? as : bs;
  const end = ae < be ? ae : be;
  if (end < start) return 0;
  return businessDaysBetween(toISODate(start), toISODate(end));
}

/** Sum approved, paid PTO hours that fall inside the pay period. */
function computePtoHours(requests, periodStart, periodEnd) {
  let totalDays = 0;
  for (const r of Array.isArray(requests) ? requests : []) {
    if (!r || r.status !== 'approved') continue;
    if (!PAID_PTO_TYPES.includes(r.request_type)) continue;
    let days = intersectionBusinessDays(r.start_date, r.end_date, periodStart, periodEnd);
    if (days <= 0) continue;
    const start = parseISODate(r.start_date);
    const end = parseISODate(r.end_date);
    const ps = parseISODate(periodStart);
    const pe = parseISODate(periodEnd);
    const fullyInside = start && end && ps && pe && start >= ps && end <= pe;
    if (r.half_day && fullyInside) days = Math.max(0.5, days - 0.5);
    totalDays += days;
  }
  return Math.round(totalDays * HOURS_PER_DAY * 100) / 100;
}

function toNonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : Math.round(n * 100) / 100;
}

// Biweekly pay-period schedule: two weeks Sunday→Saturday, anchored to the known
// cycle Sun 2026-06-14 → Sat 2026-06-27. Kept in step with the frontend's
// payPeriodSchedule.js so submitted periods always match the payroll calendar.
const PAY_ANCHOR_START = '2026-06-14';
function utcMs(iso) {
  const d = parseISODate(iso);
  return d ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) : NaN;
}
function addDays(iso, n) {
  const d = parseISODate(iso);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function isAlignedPayPeriod(start, end) {
  const s = parseISODate(start);
  const e = parseISODate(end);
  if (!s || !e) return false;
  const diff = Math.round((utcMs(start) - utcMs(PAY_ANCHOR_START)) / 86400000);
  if (diff % 14 !== 0) return false;
  return end === addDays(start, 13) && s.getDay() === 0;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const body = (await req.json()) || {};
    const {
      timesheet_id = '',
      pay_period_start,
      pay_period_end,
      notes = '',
      manager_email = '',
      status = 'submitted',
    } = body;

    // Company/service line and points-eligibility are ADMIN-controlled via the
    // employee's payroll profile — not chosen by the employee. Resolve them
    // server-side (profile preferred, then the user record). Home-health field
    // staff earn points; office staff and all hospice staff are hourly.
    let profile = null;
    try {
      const profiles = await base44.asServiceRole.entities.EmployeePayrollProfile.filter({ employee_email: user.email }, undefined, 5000);
      profile = (profiles || []).find((p) => p && p.active !== false) || (profiles || [])[0] || null;
    } catch (_profileError) {
      profile = null;
    }
    const service_type = (profile?.service_type || user.service_type) === 'hospice' ? 'hospice' : 'home_health';
    const earns_points = service_type === 'home_health' && profile?.earns_points === true;

    if (!VALID_SERVICE_TYPES.includes(service_type)) {
      return Response.json({ error: 'Invalid service type.' }, { status: 400 });
    }
    if (!SUBMIT_STATUSES.includes(status)) {
      return Response.json({ error: 'Timesheets can only be saved as a draft or submitted.' }, { status: 400 });
    }

    const start = parseISODate(pay_period_start);
    const end = parseISODate(pay_period_end);
    if (!start || !end) {
      return Response.json({ error: 'A valid pay period is required.' }, { status: 400 });
    }
    if (end < start) {
      return Response.json({ error: 'The pay period end cannot be before the start.' }, { status: 400 });
    }
    if (!isAlignedPayPeriod(pay_period_start, pay_period_end)) {
      return Response.json(
        { error: 'Pay period must be a scheduled two-week period (Sunday through Saturday).' },
        { status: 400 }
      );
    }

    // Coerce the numeric buckets server-side (non-negative, 2dp).
    const numbers = {};
    for (const f of NUMERIC_FIELDS) numbers[f] = toNonNegativeNumber(body[f]);

    // Daily vs bulk entry. In daily mode the hour/visit buckets are the SUM of
    // the per-day rows (authoritative), not the client-submitted period totals.
    const entry_mode = body.entry_mode === 'daily' ? 'daily' : 'bulk';
    const daily_entries = entry_mode === 'daily' ? normalizeDailyEntries(body.daily_entries) : [];
    let dailyVisitCounts = null;
    if (entry_mode === 'daily') {
      const rolled = sumDailyEntries(daily_entries);
      for (const f of DAILY_SUM_FIELDS) numbers[f] = rolled.totals[f];
      dailyVisitCounts = rolled.visit_counts;
    }

    // Home-health points are computed from the nurse's visit counts by type times
    // the facility's configured per-type point values — server-authoritative, so
    // the client cannot set points directly. Hospice has no points.
    const visit_counts = {};
    let computedPoints = 0;
    if (earns_points) {
      const rawCounts = dailyVisitCounts
        || (body.visit_counts && typeof body.visit_counts === 'object' ? body.visit_counts : {});
      for (const k of VISIT_TYPE_KEYS) visit_counts[k] = toNonNegativeNumber(rawCounts[k]);
      try {
        // Prefer the caller's agency point schedule — never newest-row across tenants.
        const agency = String(user.agency_name || '').trim();
        let configs = [];
        if (agency) {
          configs = await base44.asServiceRole.entities.VisitPointConfig
            .filter({ agency_name: agency }, '-updated_date', 10)
            .catch(() => []);
        }
        if (!configs?.length) {
          // Adopt a single unscoped legacy row (pre-agency_name deployments)
          // so nurses with an agency don't silently compute 0 points.
          const newest = await base44.asServiceRole.entities.VisitPointConfig
            .list('-updated_date', 5).catch(() => []);
          const legacy = (newest || []).filter((r) => !String(r?.agency_name || '').trim());
          if (legacy.length === 1) configs = legacy;
          else if (!agency && (newest || []).length <= 1) configs = newest || [];
        }
        const cfg = (configs || []).find((c) => c && c.active !== false) || (configs || [])[0] || {};
        computedPoints = computeVisitPoints(visit_counts, cfg);
      } catch (_cfgError) {
        computedPoints = 0; // No configured point values yet → 0 points.
      }
    }
    numbers.regular_points = computedPoints;

    // Authoritative PTO carryover from the employee's approved, paid time off.
    let auto_pto_hours = 0;
    try {
      const approved = await base44.asServiceRole.entities.TimeOffRequest.filter({
        employee_email: user.email,
        status: 'approved',
      }, undefined, 5000);
      auto_pto_hours = computePtoHours(approved, pay_period_start, pay_period_end);
    } catch (_ptoError) {
      auto_pto_hours = 0; // Never block submission on the PTO lookup.
    }

    // Standing phone reimbursement from the employee's payroll profile (loaded
    // above) — an expense reimbursement (not pay/wages) applied automatically each
    // pay period. Server-authoritative: the client cannot set it. Only applied
    // when the profile is active (the "Applied" toggle in Payroll Setup); an
    // inactive profile still resolves service line / points but adds no reimbursement.
    const phone_reimbursement =
      profile && profile.active !== false ? toNonNegativeNumber(profile.phone_reimbursement) : 0;

    // Validate the chosen approver (admin or flagged manager, never the caller).
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
        return Response.json({ error: 'The selected approver is not authorized to approve timesheets.' }, { status: 400 });
      }
      // Callers with an agency may only nominate approvers in the same agency
      // (empty manager agency → deny — prevents cross-tenant PHI notify).
      const callerAgency = String(user.agency_name || '').trim();
      if (callerAgency && user.account_type !== 'super_admin') {
        if (!mgr.agency_name || mgr.agency_name !== callerAgency) {
          return Response.json({ error: 'The selected approver is outside your agency.' }, { status: 403 });
        }
      }
      resolvedManagerEmail = mgr.email;
      resolvedManagerName = mgr.full_name || mgr.email;
    }

    const record = {
      employee_email: user.email,
      employee_name: user.full_name || user.email,
      service_type,
      pay_period_start,
      pay_period_end,
      ...numbers,
      visit_counts,
      entry_mode,
      daily_entries,
      auto_pto_hours,
      phone_reimbursement,
      notes: String(notes || '').slice(0, 2000),
      manager_email: resolvedManagerEmail,
      manager_name: resolvedManagerName,
      status,
      submitted_at: status === 'submitted' ? new Date().toISOString() : undefined,
    };

    // Clearing a prior review when a sheet is edited/resubmitted — set to empty
    // (not undefined, which JSON-omits and would leave the stale values in place).
    const clearedReview = { reviewed_by: '', reviewer_name: '', reviewed_at: '', review_notes: '' };

    // One timesheet per (employee, service line, pay period): the caller's other
    // sheets covering the SAME period+service line. Prevents a duplicate row from
    // being double-counted in payroll.
    const siblingsForPeriod = async (excludeId) => {
      const matches = await base44.asServiceRole.entities.Timesheet
        .filter({
          employee_email: user.email,
          service_type,
          pay_period_start,
          pay_period_end,
        }, undefined, 5000)
        .catch(() => []);
      return (matches || []).filter((m) => m && m.id !== excludeId);
    };

    let saved;
    if (timesheet_id) {
      // Editing an existing timesheet: it must belong to the caller and not be
      // already approved (approved payroll is locked). Ownership + status are
      // enforced here because the entity is service-role-written.
      const existing = await base44.asServiceRole.entities.Timesheet.get(timesheet_id).catch(() => null);
      if (!existing) {
        return Response.json({ error: 'Timesheet not found.' }, { status: 404 });
      }
      if (existing.employee_email !== user.email && existing.created_by !== user.email) {
        return Response.json({ error: 'You can only edit your own timesheet.' }, { status: 403 });
      }
      if (existing.status === 'approved') {
        return Response.json({ error: 'This timesheet has already been approved and can no longer be edited.' }, { status: 409 });
      }
      // Don't let an edit move this sheet onto a period+service line that already
      // has ANOTHER timesheet for this employee — that would create a duplicate
      // (both could be approved and double-counted on the payroll export).
      const siblings = await siblingsForPeriod(timesheet_id);
      if (siblings.length > 0) {
        const msg = siblings.some((s) => s.status === 'approved')
          ? 'You already have an approved timesheet for this pay period.'
          : 'You already have a timesheet for this pay period — edit that one instead.';
        return Response.json({ error: msg }, { status: 409 });
      }
      saved = await base44.asServiceRole.entities.Timesheet.update(timesheet_id, { ...record, ...clearedReview });
    } else {
      // New submission: reuse the caller's existing (non-approved) sheet for this
      // period+service line instead of creating a duplicate.
      const siblings = await siblingsForPeriod(null);
      if (siblings.some((s) => s.status === 'approved')) {
        return Response.json(
          { error: 'You already have an approved timesheet for this pay period. Ask your approver to reopen it to make changes.' },
          { status: 409 }
        );
      }
      const reusable = siblings[0];
      saved = reusable
        ? await base44.asServiceRole.entities.Timesheet.update(reusable.id, { ...record, ...clearedReview })
        : await base44.asServiceRole.entities.Timesheet.create(record);
      if (!reusable) {
        // The empty-siblings check above is not atomic: two concurrent first
        // submissions can both observe no siblings and both create a row, and
        // the payroll export would then total BOTH once approved. Reconcile
        // after the create — every racer deterministically keeps the same
        // winner (earliest created, id as tiebreaker) and deletes its own
        // loser row, so at most one sheet survives per period + service line.
        const dupes = await siblingsForPeriod(saved.id);
        if (dupes.length > 0) {
          const winner = [saved, ...dupes].sort(
            (a, b) =>
              String(a.created_date || '').localeCompare(String(b.created_date || '')) ||
              String(a.id).localeCompare(String(b.id))
          )[0];
          if (winner.id !== saved.id) {
            await base44.asServiceRole.entities.Timesheet.delete(saved.id).catch(() => {});
            saved = await base44.asServiceRole.entities.Timesheet
              .update(winner.id, { ...record, ...clearedReview })
              .catch(() => winner);
          }
        }
      }
    }

    // Notify the approver(s) only when actually submitted (not for drafts).
    if (status === 'submitted') {
      try {
        let recipients = [];
        if (resolvedManagerEmail) {
          recipients = [{ email: resolvedManagerEmail }];
        } else {
          const users = await base44.asServiceRole.entities.User.list('-created_date', 5000);
          // Scope admin fallback to the submitter's agency — unscoped list
          // notified every tenant's agency_admins of timesheet submissions.
          recipients = users.filter(
            (u) => u.email && (u.role === 'admin' || u.account_type === 'super_admin' || u.account_type === 'agency_admin')
          );
          if (user.agency_name) {
            recipients = recipients.filter((u) =>
              u.account_type === 'super_admin' || u.agency_name === user.agency_name);
          } else {
            recipients = recipients.filter((u) => u.account_type === 'super_admin');
          }
        }
        const employeeName = user.full_name || user.email;
        const prettyService = service_type === 'hospice' ? 'Hospice' : 'Home Health';
        const period = `${pay_period_start} → ${pay_period_end}`;
        await Promise.all(
          recipients.map((r) =>
            base44.asServiceRole.entities.Notification.create({
              user_email: r.email,
              title: 'Timesheet submitted for approval',
              message: `${employeeName} submitted a ${prettyService} timesheet for ${period}.`,
              type: 'info',
              priority: 'medium',
              action_url: '/Timesheets',
              action_label: 'Review timesheet',
              metadata: { timesheet_id: saved.id, employee_email: user.email },
            })
          )
        );
        const timesheetBody = renderBrandedEmail({
          preheader: `${employeeName} submitted a timesheet for your review.`,
          eyebrow: 'Timesheet approval',
          title: `New timesheet from ${employeeName}`,
          intro: `${employeeName} submitted a ${prettyService} timesheet for the pay period ${period} and needs your review.`,
          sections: [
            {
              rows: [
                ['Service line', prettyService],
                ['Pay period', period],
                ['Regular hours', String(numbers.regular_hours)],
                ...(numbers.overtime_hours ? [['Overtime', String(numbers.overtime_hours)]] : []),
                ...(auto_pto_hours ? [['Approved PTO carried in', `${auto_pto_hours} hrs`]] : []),
                ...(service_type === 'home_health' && numbers.regular_points ? [['Regular points', String(numbers.regular_points)]] : []),
              ],
            },
            { note: 'Review and approve it in PennSync under Timesheets → Approvals.' },
          ],
        });
        await Promise.all(
          recipients.map((r) =>
            base44.asServiceRole.integrations.Core.SendEmail({
              to: r.email,
              from_name: 'PennSync by CareMetric',
              subject: `Timesheet from ${employeeName} — ${period}`,
              body: timesheetBody,
            }).catch(() => null)
          )
        );
      } catch (_notifyError) {
        // Notifications/emails are best-effort; the dashboard remains the source of truth.
      }
    }

    return Response.json({ success: true, timesheet: saved });
  } catch (error) {
    console.error('submitTimesheet failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
