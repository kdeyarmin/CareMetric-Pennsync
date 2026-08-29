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

// <<<BEGIN SHARED HELPER: resolveFaxRetryConfig — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveFaxRetryConfig(base44, agencyName) {
  const key = String(agencyName || '').trim();
  if (key) {
    const rows = await base44.asServiceRole.entities.FaxRetryConfig
      .filter({ agency_name: key }, '-created_date', 1)
      .catch(() => []);
    if (rows?.[0]) return rows[0];
  }
  const newest = await base44.asServiceRole.entities.FaxRetryConfig
    .list('-created_date', 5)
    .catch(() => []);
  const legacy = (newest || []).filter((r) => !String(r?.agency_name || '').trim());
  // Prefer a single unscoped legacy row when the agency-specific row is missing.
  if (legacy.length === 1) return legacy[0];
  if (key) return null;
  if ((newest || []).length > 1) return null;
  return newest?.[0] || null;
}
// <<<END SHARED HELPER: resolveFaxRetryConfig>>>


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

// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. The allowlist is hardcoded (always-on, fail-closed)
// rather than env-configured; add a host here if file storage ever moves.
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}
// <<<END SHARED HELPER: isSafeFetchUrl>>>

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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: isAllowedDestination — generated, edit base44/_shared/backendHelpers.mjs>>>
// Cost-control destination gate. Single source of truth is the frontend
// src/components/voice/costControls.js — this copy is generated from it verbatim.
const PREMIUM_AREA_CODES = new Set(["900", "976"]);
function isAllowedDestination(e164, settings = {}) {
  const s = settings || {};
  const e = String(e164 || "").trim();
  const isNanp = /^\+1\d{10}$/.test(e);

  if (isNanp) {
    const areaCode = e.slice(2, 5);
    if (PREMIUM_AREA_CODES.has(areaCode)) return { allowed: false, reason: "premium_number_blocked" };
    const blocked = Array.isArray(s.blocked_area_codes) ? s.blocked_area_codes.map((a) => String(a).replace(/[^\d]/g, "")) : [];
    if (blocked.includes(areaCode)) return { allowed: false, reason: "blocked_area_code" };
    return { allowed: true, reason: "allowed" };
  }

  // A +1-prefixed number that isn't exactly 10 NANP digits is malformed, not
  // international — never let the international toggle dial/text a broken US number.
  if (/^\+1/.test(e)) return { allowed: false, reason: "invalid_destination" };

  // Not a +1 NANP number → treat as international.
  if (!/^\+\d{8,15}$/.test(e)) return { allowed: false, reason: "invalid_destination" };
  if (s.allow_international === true) return { allowed: true, reason: "international_allowed" };
  return { allowed: false, reason: "international_blocked" };
}
// <<<END SHARED HELPER: isAllowedDestination>>>


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
// Strict E.164 normalization for the OFFICE FAX `from` number (null when it
// can't normalize). The admin-entered office fax may carry formatting
// ("(724) 465-0441"); Telnyx requires E.164 on `from`, so an unnormalizable
// value must fail loudly rather than fail every send at the provider. Mirrors
// sendFax.
function normalizeFromE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  // Already-+ international is decided FIRST and never falls through to the NANP
  // branches. A 10-digit international number ("+49 89 123456") was otherwise
  // rewritten as an unrelated "+1..." US subscriber, which also slipped past the
  // +1-only international cost control. Mirrors src/components/voice/phoneUtils.js.
  if (String(raw).trim().startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// Fax caller-id display name shown to the receiving machine (Telnyx
// from_display_name allows only letters, numbers, spaces and -_~!.+): presents
// the OFFICE fax number so recipients dial the office machine back, not the
// blind outbound line. Mirrors sendFax.
function officeFaxDisplayName(officeE164) {
  const d = String(officeE164 || '').replace(/[^\d]/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  return `Office Fax ${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

const PERMANENT_FAILURE_PATTERNS = [
  /invalid/i, /not a fax/i, /no fax machine/i, /incompatible/i, /unsupported/i,
  /rejected/i, /blocked/i, /do not call/i, /unallocated/i, /disconnected/i,
  /forbidden/i, /not in service/i, /no such number/i, /malformed/i,
];
// Transient signals win over a coincidental permanent word ("rejected - line
// busy" is retryable). Checked first. Mirrors src/components/fax/faxRetry.js.
const TRANSIENT_FAILURE_PATTERNS = [
  /busy/i, /no.?answer/i, /temporar/i, /timeout/i, /timed out/i,
  /try again/i, /congestion/i, /\b(429|500|502|503|504)\b/,
];
function classifyFaxFailure(errorCode, errorMessage) {
  const s = `${errorCode ?? ''} ${errorMessage ?? ''}`.trim();
  if (!s) return 'transient';
  if (TRANSIENT_FAILURE_PATTERNS.some((re) => re.test(s))) return 'transient';
  return PERMANENT_FAILURE_PATTERNS.some((re) => re.test(s)) ? 'permanent' : 'transient';
}
function numberOrNull(value) {
  // Number(null)/Number("") are both 0, which makes an unset entity field
  // indistinguishable from an explicit zero. Mirrors src/components/fax/faxRetry.js.
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function faxRetryConfig(config) {
  const c = config || {};
  // Coerce first: entity fields can arrive as numeric strings ("5") from a JSON/form
  // round-trip, and Number.isFinite("5") is false — which would silently drop the
  // admin's configured value in favor of the default. Mirrors src/components/fax/faxRetry.js.
  // An unset max_retries must mean "use the default", not 0 retries — see
  // numberOrNull above and src/components/fax/faxRetry.js.
  const maxRetriesNum = numberOrNull(c.max_retries);
  const baseDelayNum = numberOrNull(c.retry_delay_minutes);
  return {
    enabled: c.auto_retry_enabled !== false,
    maxRetries: maxRetriesNum === null ? 3 : Math.max(0, maxRetriesNum),
    baseDelayMinutes: baseDelayNum !== null && baseDelayNum > 0 ? baseDelayNum : 15,
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
  // Use > so a scheduled retry with retry_count === maxRetries is still sent
  // (the last allowed attempt). planFaxRetry refuses to schedule past that.
  // Mirrors src/components/fax/faxRetry.js.
  if ((Number(fax.retry_count) || 0) > c.maxRetries) return false;
  const t = new Date(fax.next_retry_at).getTime();
  return Number.isFinite(t) && now >= t;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (mirrors pollFaxStatuses /
    // processScheduledFaxes). This reads FaxLog PHI and dispatches billable
    // Telnyx fax sends under the service role. Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    const runId = crypto.randomUUID();

    // Get all faxes that are failed and have a scheduled next_retry_at
    const allFailed = await base44.asServiceRole.entities.FaxLog.filter(
      { status: 'failed' },
      '-updated_date',
      200
    );

    const now = new Date();
    let retriedCount = 0;
    let skippedCount = 0;

    // Per-sender agency retry policy (cached). Global newest-row would apply
    // Agency A's disable/budget to Agency B's failed faxes.
    const agencyCfgCache = new Map();
    const resolveCfgForSender = async (sentBy) => {
      let agencyName = '';
      if (sentBy) {
        const [sender] = await base44.asServiceRole.entities.User
          .filter({ email: sentBy }, undefined, 1).catch(() => []);
        agencyName = sender?.agency_name || '';
      }
      const cacheKey = agencyName || '__default__';
      if (agencyCfgCache.has(cacheKey)) return agencyCfgCache.get(cacheKey);
      const cfg = (await resolveFaxRetryConfig(base44, agencyName)) || {};
      agencyCfgCache.set(cacheKey, cfg);
      return cfg;
    };

    // Filter to faxes that are actually due for retry before resolving
    // credentials — if nothing is due, there's no need to check Telnyx config
    // (which may legitimately be absent on agencies that don't use fax).
    const dueFaxes = [];
    for (const fax of allFailed) {
      const cfg = await resolveCfgForSender(fax.sent_by);
      const c = faxRetryConfig(cfg);
      if (!c.enabled) {
        skippedCount++;
        continue;
      }
      if (isFaxRetryDue(fax, now.getTime(), cfg)) dueFaxes.push({ fax, cfg, c });
      else skippedCount++;
    }
    if (dueFaxes.length === 0) {
      return Response.json({
        success: true,
        retried: 0,
        skipped: skippedCount || allFailed.length,
        timestamp: now.toISOString()
      });
    }

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey, faxConnectionId } = telnyxCreds;
    // Include the same DLR webhook sendFax uses so the retried fax reports status.
    // Derive the functions base from this request's own URL — every backend
    // function (including handleTelnyxStatusWebhook) is served from the same
    // base, so the status-webhook peer is one path segment over. Replaces the
    // retired FUNCTIONS_BASE_URL secret; non-https (local dev) derives nothing.
    const functionsBaseUrl = (() => {
      try {
        const u = new URL(req.url);
        return u.protocol === 'https:' ? (u.origin + u.pathname).replace(/\/+$/, '').replace(/\/[^/]+$/, '') : '';
      } catch { return ''; }
    })();
    const webhookUrl = functionsBaseUrl ? `${functionsBaseUrl}/handleTelnyxStatusWebhook` : undefined;

    if (!apiKey || !faxConnectionId) {
      // Use the shared credential message so a failed READ ("could not read the
      // stored credential") is not reported as "not configured" — telling an
      // operator to re-enter a key they already stored is what caused two
      // reverted env-fallback regressions.
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, 'API key / fax connection ID') }, { status: 500 });
    }

    // Per-sender agency fax lines (cached). Newest-row-wins would transmit
    // Agency A's PHI on Agency B's outbound line in multi-tenant deployments.
    const agencyFaxCache = new Map();
    const resolveFaxFromForSender = async (sentBy) => {
      let agencyName = '';
      if (sentBy) {
        const [sender] = await base44.asServiceRole.entities.User
          .filter({ email: sentBy }, undefined, 1).catch(() => []);
        agencyName = sender?.agency_name || '';
      }
      const cacheKey = agencyName || '__default__';
      if (agencyFaxCache.has(cacheKey)) return agencyFaxCache.get(cacheKey);
      const settings = await resolveAgencySettings(base44, agencyName);
      const officeFaxRaw = (settings?.office_fax_number_e164 || '').toString().trim();
      const outboundFaxRaw = (settings?.outbound_fax_number_e164 || '').toString().trim();
      const officeFax = normalizeFromE164(officeFaxRaw);
      const outboundFax = normalizeFromE164(outboundFaxRaw);
      const resolved = {
        fromNumber: outboundFax || officeFax,
        faxFromDisplayName: officeFaxDisplayName(officeFax),
        officeFaxRaw,
        outboundFaxRaw,
        outboundFax,
        settings,
      };
      agencyFaxCache.set(cacheKey, resolved);
      return resolved;
    };

    for (const { fax, cfg, c } of dueFaxes) {
      // SSRF guard: re-validate the STORED document URL before handing it back
      // to Telnyx as media_url — a tampered or legacy row must not aim the fax
      // provider at an arbitrary/internal host. Clearing next_retry_at stops
      // future runs from re-processing the row (isFaxRetryDue requires it).
      if (!isSafeFetchUrl(fax.document_url)) {
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          next_retry_at: null,
          failure_reason: 'Invalid or disallowed stored document URL',
        }).catch(() => {});
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
        const faxLine = await resolveFaxFromForSender(fax.sent_by);
        if (faxLine.outboundFaxRaw && !faxLine.outboundFax) {
          await base44.asServiceRole.entities.FaxLog.update(fax.id, {
            status: 'failed',
            next_retry_at: null,
            failure_reason: `Outbound fax number "${faxLine.outboundFaxRaw}" is not a valid phone number`,
            retry_claimed_by: null,
          }).catch(() => {});
          skippedCount++;
          continue;
        }
        if (!faxLine.fromNumber) {
          await base44.asServiceRole.entities.FaxLog.update(fax.id, {
            status: 'failed',
            next_retry_at: null,
            failure_reason: 'No outbound fax number configured for sender agency',
            retry_claimed_by: null,
          }).catch(() => {});
          skippedCount++;
          continue;
        }
        // Re-gate the STORED destination through the same cost-control allowlist
        // sendFax applies. FaxLog write RLS is owner + service-role, so a sender
        // could edit their row's to_number to a premium/international number
        // (and set status:failed, next_retry_at:now) and have this cron dispatch
        // the PHI document anywhere on the agency's Telnyx account; a policy
        // change made after the original send (e.g. international disabled) is
        // likewise re-applied here. A blocked destination is terminal.
        const destAllowed = isAllowedDestination(fax.to_number, faxLine.settings);
        if (!destAllowed.allowed) {
          await base44.asServiceRole.entities.FaxLog.update(fax.id, {
            status: 'failed',
            next_retry_at: null,
            failure_reason: `Destination blocked at retry time: ${destAllowed.reason}`,
            retry_claimed_by: null,
          }).catch(() => {});
          skippedCount++;
          continue;
        }
        const retryPayload = {
          connection_id: faxConnectionId,
          from: faxLine.fromNumber,
          to: fax.to_number,
          media_url: fax.document_url,
          quality: 'high'
        };
        // Mask the blind line: present the office fax number as the caller-id name.
        if (faxLine.faxFromDisplayName) retryPayload.from_display_name = faxLine.faxFromDisplayName;
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
          console.log(`Fax retry attempt ${fax.retry_count} dispatched successfully`);
        } else {
          const errText = await telnyxResp.text();
          console.error('Telnyx error on fax retry:', errText);
          // Classify the provider rejection instead of treating every non-OK
          // response as permanent. A 401/403/429/5xx (or a transient-pattern
          // body) is infrastructure — an outage, a rate limit, a temporarily bad
          // key — that clears on its own; terminal-failing here destroyed up to a
          // full batch of queued PHI faxes on their FIRST retry during any Telnyx
          // blip and emailed every sender a false "could not be delivered" notice.
          // Reschedule within budget, consuming one attempt (same accounting as
          // the network-error catch below), and reserve handleRetryExhausted for
          // a genuinely permanent 4xx rejection or an exhausted budget.
          const status = telnyxResp.status;
          const transient = classifyFaxFailure(String(status), errText) === 'transient'
            || status === 401 || status === 403 || status === 429 || status >= 500;
          if (transient) {
            const attempts = Number(fax.retry_count) || 0;
            const nextCount = attempts + 1;
            // Mirror the webhook's planFaxRetry budget EXACTLY: it schedules while
            // the CURRENT retry_count is < maxRetries (willRetry = attempts <
            // maxRetries), producing a retry_count up to and INCLUDING maxRetries —
            // which isFaxRetryDue still honors (it drops only retry_count >
            // maxRetries). Gating on `nextCount < maxRetries` exhausted one attempt
            // early, so the same fax got fewer retries here than via the webhook.
            const within = attempts < c.maxRetries;
            const delayMin = nextRetryDelayMinutes(attempts, cfg, fax.priority || 'normal');
            await base44.asServiceRole.entities.FaxLog.update(fax.id, {
              status: 'failed',
              retry_claimed_by: null,
              retry_count: nextCount,
              next_retry_at: within ? new Date(now.getTime() + delayMin * 60000).toISOString() : null,
            }).catch(() => {});
            if (!within) await handleRetryExhausted(base44, { ...fax, retry_count: nextCount }, `Telnyx rejected retry: ${errText}`, c.maxRetries, c.notifyOnFinalFailure);
          } else {
            await base44.asServiceRole.entities.FaxLog.update(fax.id, { status: 'failed', retry_claimed_by: null }).catch(() => {});
            await handleRetryExhausted(base44, fax, `Telnyx rejected retry: ${errText}`, c.maxRetries, c.notifyOnFinalFailure);
          }
        }
      } catch (err) {
        console.error('Network error retrying fax:', err.message);
        // Transient: the dispatch itself failed, so NOTHING was sent to Telnyx and
        // no status webhook will ever fire to advance retry_count for this attempt.
        // Consume a retry attempt HERE — otherwise a persistently-unreachable Telnyx
        // leaves retry_count at 0, `within` permanently true, and the flat backoff
        // re-queues this fax at the base interval forever, never reaching
        // handleRetryExhausted. Reschedule (within budget) using the SAME
        // config-aware, priority-scaled backoff as the webhook; otherwise exhaust +
        // notify. Boundary mirrors the webhook's planFaxRetry (willRetry = current
        // retry_count < maxRetries), which schedules a retry_count up to and
        // INCLUDING maxRetries; isFaxRetryDue honors those (it drops only
        // retry_count > maxRetries), so the last allowed send is not stranded.
        const attempts = Number(fax.retry_count) || 0;
        const nextCount = attempts + 1;
        const within = attempts < c.maxRetries;
        const delayMin = nextRetryDelayMinutes(attempts, cfg, fax.priority || 'normal');
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          status: 'failed',
          retry_claimed_by: null,
          retry_count: nextCount,
          next_retry_at: within ? new Date(now.getTime() + delayMin * 60000).toISOString() : null,
        }).catch(() => {});
        if (!within) await handleRetryExhausted(base44, { ...fax, retry_count: nextCount }, err.message, c.maxRetries, c.notifyOnFinalFailure);
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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
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
      // Route paths come from the page name (SendFax); the hyphenated form matches
      // no route or redirect and dropped the notification's button on PageNotFound.
      action_url: `/SendFax?fax_id=${fax.id}`
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