/**
 * Canonical source for helpers that are INLINED into multiple Base44 Deno
 * functions (which can't import from each other or from src/). Each entry is the
 * exact text injected, verbatim, between the
 *   // <<<BEGIN SHARED HELPER: <name> ...>>>  /  // <<<END SHARED HELPER: <name>>>>
 * markers in every consuming function. Edit the helper HERE, then run
 *   npm run sync:shared-helpers        # rewrite all consumers
 *   npm run sync:shared-helpers -- --check   # CI gate: fail if any copy drifted
 *
 * This exists because several real bugs were drift between hand-maintained inline
 * copies (e.g. an area-code→timezone table that was Central in one file and fixed
 * in another). One canonical source + a parity check makes a fix land everywhere.
 */

import { AREA_CODE_TIMEZONE } from '../../src/components/voice/quietHours.js';
import { DEFAULT_URGENT_KEYWORDS } from '../../src/components/voice/urgentKeywords.js';
import { isAllowedDestination, PREMIUM_AREA_CODES } from '../../src/components/voice/costControls.js';

// The area-code -> timezone table's single source of truth is the FRONTEND
// quietHours.js (a 915-was-Central drift bug across the backend copies is exactly
// why this exists). Generate the inlined backend const from that live object so a
// fix to the frontend table auto-propagates to every backend SMS function.
function areaCodeTimezoneSource() {
  const lines = Object.entries(AREA_CODE_TIMEZONE)
    .map(([code, tz]) => `  ${code}: ${JSON.stringify(tz)},`)
    .join('\n');
  return `const AREA_CODE_TIMEZONE = {\n${lines}\n};`;
}

// Urgent-keyword list — single source of truth is the frontend urgentKeywords.js
// (the curly-apostrophe "can't breathe" miss was drift between the two copies).
function urgentKeywordsSource() {
  const items = DEFAULT_URGENT_KEYWORDS.map((k) => JSON.stringify(k)).join(', ');
  return `const DEFAULT_URGENT_KEYWORDS = [${items}];`;
}

// Cost-control destination gate — single source of truth is the frontend
// costControls.js (a missing malformed-+1 guard was drift across the five backend
// copies). The function body is taken verbatim from the live frontend function via
// toString(), so a frontend fix auto-propagates to every backend send function.
function isAllowedDestinationSource() {
  const codes = [...PREMIUM_AREA_CODES].map((c) => JSON.stringify(c)).join(', ');
  return `// Cost-control destination gate. Single source of truth is the frontend
// src/components/voice/costControls.js — this copy is generated from it verbatim.
const PREMIUM_AREA_CODES = new Set([${codes}]);
${isAllowedDestination.toString()}`;
}

export const SHARED_HELPERS = {
  // Generated from the frontend table (see above) — do not hand-edit consumers.
  areaCodeTimezone: areaCodeTimezoneSource(),
  urgentKeywords: urgentKeywordsSource(),
  isAllowedDestination: isAllowedDestinationSource(),

  // SSRF guard used by every function that fetches or hands a user-supplied URL to
  // a provider integration. Keep in step with src/components/utils/security.
  isSafeFetchUrl: `// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
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
  const m = host.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}`,

  // Admin-tier predicate. Mirrors src/lib/superAdmin.js isAdminLike — every admin
  // surface accepts facility admin (role 'admin') and agency_admin/super_admin.
  // Admin status is determined solely by role/account_type; there is no
  // owner-email override (the SUPER_ADMIN_EMAIL secret was retired — use
  // ensureSuperAdmin / account_type promotion instead). Keep in step with
  // superAdmin.js.
  isAdminLike: `const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);`,

  // Offboarding sets is_active:false but deliberately leaves role/account_type
  // intact (history and audit joins key off them), and the Base44 platform does
  // not reject entity-API calls from a deactivated session. So an offboarded
  // user holding a live session still satisfies every ordinary auth check. Any
  // function that acts on PHI or writes data must refuse them explicitly.
  //
  // The test is `=== false`, NOT `!== true`: signup and onboarding functions run
  // for users whose is_active has not been set yet, and `!== true` would lock
  // them out of their own account creation.
  requireActiveUser: `const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);`,

  // agency_admin without agency_name must not fall through agency-scoped gates
  // that are written as `!== super_admin && agency_name` (empty name ⇒ platform-wide).
  // Call immediately after auth/admin checks: if (resp) return resp;
  // Bare role:admin without agency_name remains platform-wide by design.
  requireAgencyAdminAgency: `function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}`,

  // Shared scheduler/internal auth for privileged cron-style functions. Base44
  // function URLs are plain HTTP endpoints, so these jobs must require either an
  // admin session or the configured shared secret header.
  schedulerAuth: `const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
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
}`,

  // Branded transactional-email builder. Produces the PennSync (navy + gold) HTML
  // shell every outgoing email uses so the logo, wordmark, colors, and footer never
  // drift across functions (the from_name 'PennSync by CareMetric' is set at each
  // call site). Callers pass STRUCTURED content — title, intro, sections — and ALL
  // interpolated text is HTML-escaped inside, so raw names / document titles are
  // safe to pass without escaping. Mirrors the visual language of the gold-standard
  // buildWelcomeEmail in createUserWithTempPassword.
  brandedEmail: `const BRAND_EMAIL = {
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
  return \`<p style="margin:0 0 14px;font-size:15px;line-height:1.62;color:\${BRAND_EMAIL.slate};">\${escapeEmailHtml(text)}</p>\`;
}
function renderEmailSection(section) {
  const s = section || {};
  const parts = [];
  if (s.heading) {
    parts.push(\`<h2 style="margin:20px 0 8px;font-size:16px;font-weight:800;color:\${BRAND_EMAIL.ink};">\${escapeEmailHtml(s.heading)}</h2>\`);
  }
  for (const p of (Array.isArray(s.paragraphs) ? s.paragraphs : [])) parts.push(emailParagraph(p));
  if (s.pre) {
    parts.push(\`<pre style="margin:4px 0 16px;padding:14px 16px;background:\${BRAND_EMAIL.panel};border:1px solid \${BRAND_EMAIL.line};border-radius:10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12.5px;line-height:1.5;color:\${BRAND_EMAIL.ink};white-space:pre-wrap;word-break:break-word;">\${escapeEmailHtml(s.pre)}</pre>\`);
  }
  if (Array.isArray(s.rows) && s.rows.length) {
    const rows = s.rows.map((r) =>
      \`<tr><td style="padding:5px 0;font-size:13.5px;color:\${BRAND_EMAIL.muted};vertical-align:top;white-space:nowrap;">\${escapeEmailHtml(r[0])}</td>\` +
      \`<td style="padding:5px 0 5px 16px;font-size:14px;color:\${BRAND_EMAIL.ink};font-weight:600;vertical-align:top;">\${escapeEmailHtml(r[1])}</td></tr>\`
    ).join('');
    parts.push(\`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;background:\${BRAND_EMAIL.panel};border:1px solid \${BRAND_EMAIL.line};border-radius:10px;"><tr><td style="padding:8px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">\${rows}</table></td></tr></table>\`);
  }
  if (Array.isArray(s.bullets) && s.bullets.length) {
    const items = s.bullets.map((b) =>
      \`<li style="margin:0 0 7px;font-size:14.5px;line-height:1.55;color:\${BRAND_EMAIL.slate};">\${escapeEmailHtml(b)}</li>\`
    ).join('');
    parts.push(\`<ul style="margin:0 0 16px;padding-left:20px;">\${items}</ul>\`);
  }
  if (s.callout && s.callout.text) {
    const t = EMAIL_TONES[s.callout.tone] || EMAIL_TONES.info;
    parts.push(\`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;"><tr><td style="padding:13px 16px;background:\${t.bg};border-left:4px solid \${t.border};border-radius:8px;font-size:14px;line-height:1.55;color:\${t.text};font-weight:600;">\${escapeEmailHtml(s.callout.text)}</td></tr></table>\`);
  }
  if (s.button && s.button.href) {
    const href = safeEmailHref(s.button.href);
    if (href) {
      parts.push(\`<div style="margin:6px 0 18px;"><a href="\${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:8px;background:\${BRAND_EMAIL.navy};color:#ffffff;font-weight:700;font-size:15px;line-height:1;text-decoration:none;">\${escapeEmailHtml(s.button.label || 'Open PennSync')}</a></div>\`);
    }
  }
  if (s.note) {
    parts.push(\`<p style="margin:0 0 14px;font-size:12.5px;line-height:1.55;color:\${BRAND_EMAIL.muted};">\${escapeEmailHtml(s.note)}</p>\`);
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
    ? \`<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:\${BRAND_EMAIL.gold};">\${escapeEmailHtml(o.eyebrow)}</p>\`
    : '';
  const introHtml = intro.map(emailParagraph).join('');
  const sectionsHtml = sections.map(renderEmailSection).join('');
  const signoffHtml = signoff
    ? \`<p style="margin:22px 0 2px;font-size:15px;line-height:1.6;color:\${BRAND_EMAIL.slate};">Warm regards,<br /><strong style="color:\${BRAND_EMAIL.navy};">\${escapeEmailHtml(signoff)}</strong></p>\`
    : '';
  const footerNote = o.footerNote
    ? \`<p style="margin:0 0 8px;font-size:11.5px;line-height:1.5;color:\${BRAND_EMAIL.muted};">\${escapeEmailHtml(o.footerNote)}</p>\`
    : '';
  return \`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="color-scheme" content="light only" /><title>\${escapeEmailHtml(o.title || 'PennSync by CareMetric')}</title></head>
<body style="margin:0;padding:0;background:\${BRAND_EMAIL.wash};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:\${BRAND_EMAIL.wash};">\${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:\${BRAND_EMAIL.wash};"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid \${BRAND_EMAIL.line};border-radius:16px;overflow:hidden;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="background:linear-gradient(180deg,#25407e 0%,\${BRAND_EMAIL.navyDeep} 100%);padding:28px 28px 24px;text-align:center;">
    <img src="\${BRAND_EMAIL.logo}" width="54" height="54" alt="PennSync" style="display:inline-block;width:54px;height:54px;border-radius:13px;border:0;" />
    <div style="margin-top:11px;font-size:23px;font-weight:800;letter-spacing:-.3px;color:#ffffff;">Penn<span style="color:\${BRAND_EMAIL.gold};">Sync</span></div>
    <div style="margin-top:4px;font-size:10.5px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#b6c9ee;">by CareMetric</div>
    <div style="width:58px;height:4px;border-radius:3px;background:\${rule};margin:14px auto 0;"></div>
  </td></tr>
  <tr><td style="padding:30px 32px 6px;">
    \${eyebrow}<h1 style="margin:0;font-size:22px;font-weight:800;color:\${BRAND_EMAIL.navy};">\${escapeEmailHtml(o.title || '')}</h1>
  </td></tr>
  <tr><td style="padding:14px 32px 4px;">\${introHtml}\${sectionsHtml}\${signoffHtml}</td></tr>
  <tr><td style="padding:24px 32px 30px;text-align:center;">
    <div style="height:1px;background:\${BRAND_EMAIL.line};margin-bottom:16px;"></div>
    <div style="font-size:13px;font-weight:800;color:\${BRAND_EMAIL.navy};">Penn<span style="color:\${BRAND_EMAIL.gold};">Sync</span> <span style="font-weight:600;color:\${BRAND_EMAIL.muted};">by CareMetric</span></div>
    \${footerNote}<p style="margin:8px 0 0;font-size:11.5px;line-height:1.5;color:\${BRAND_EMAIL.muted};">This is an automated message from PennSync by CareMetric — please do not reply to this email.</p>
  </td></tr>
</table></td></tr></table>
</body></html>\`;
}`,

  // Date-only age formatter for backend AI/context prompts. Mirrors src/lib/dateLocal.
  // Base44 functions cannot import from src, so keep this generated into consumers.
  formatAge: `function parseLocalDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/.exec(String(value).trim());
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const d = new Date(y, mo, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function calculateAge(dob, now = new Date()) {
  const birth = parseLocalDate(dob);
  const today = parseLocalDate(now);
  if (!birth || !today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
function formatAge(dob, now = new Date(), fallback = 'Unknown') {
  const age = calculateAge(dob, now);
  return age == null ? fallback : age;
}`,

  // Telnyx credential resolution — inlined into every function that sends fax/SMS/
  // voice or verifies an inbound webhook. This is the single most-copied helper in
  // the app and, until now, the only Telnyx-critical one NOT generated from here.
  //
  // ────────────────────────────────────────────────────────────────────────────
  // READ THIS BEFORE ADDING A `Deno.env.get('TELNYX_...')` FALLBACK.
  // Credentials come from the in-app IntegrationSecret row ONLY. The TELNYX_*
  // dashboard-env path is retired, and this is the THIRD time it has been added
  // back (2026-07-22, then 2026-08-05 by the Base44 builder bot in f7448eb/6740ccc).
  // It keeps coming back because a failed credential READ used to be reported as
  // "credentials not configured" — so an operator with a perfectly good key was
  // told to add the key, and the obvious next move was to set an env var.
  // The `readError` field below is what ends that loop: a read failure now says so.
  // Env vars would not have fixed those incidents; they would have masked them.
  // If the env path is ever genuinely wanted, it must change HERE (so all copies
  // move together) plus getTelnyxSecretStatus, discoverTelnyxResources, and both
  // guardrails — src/lib/telnyxConfig.spec.js and the parity drift guard in
  // base44/functionTests. A fallback in only some copies makes the admin UI and
  // the senders disagree about whether Telnyx is configured, which is worse than
  // either answer alone.
  // ────────────────────────────────────────────────────────────────────────────
  resolveTelnyxCreds: `async function resolveTelnyxCreds(base44) {
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
    return \`Could not read Telnyx \${label} — the stored-credential lookup failed (\${creds.readError}). This is NOT a missing key, so re-entering it will not help. Retry; if it persists, this function is running without service-role access to IntegrationSecret.\`;
  }
  return \`Telnyx \${label} not configured — add the API key in Admin › Telnyx (it is stored on the IntegrationSecret row; TELNYX_* environment variables are not read).\`;
}`,

  // Resolve AgencySettings for a caller's (or patient's) agency. Multi-tenant
  // deployments have one row per agency; newest-row-wins silently applies another
  // tenant's fax line / dial allowlist / wage index / quiet-hour timezone.
  // Prefer agency_code, then office_name; fall back to newest only for
  // single-tenant / missing agency (matches sendSms getAgencyConfig).
  resolveAgencySettings: `async function resolveAgencySettings(base44, agencyName) {
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
}`,

  // Resolve FaxRetryConfig for a sender/caller agency. Newest-row-wins would
  // apply Agency A's retry budget/disable flag to Agency B's failed faxes.
  resolveFaxRetryConfig: `async function resolveFaxRetryConfig(base44, agencyName) {
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
}`,

  // Did a sendBatchFax call reject the whole batch before dispatching anything?
  // Used by both scheduled-fax processors to decide requeue vs. terminal-fail.
  // sendBatchFax answers with { successful, failed, ... } once it has actually
  // attempted recipients, and with { error } (and no accounting) when it bailed
  // out first — so the absence of a numeric `successful` is the reliable
  // "nothing was transmitted" signal. Getting this wrong in either direction is
  // costly: treat a real send as never-dispatched and PHI is re-faxed with no
  // idempotency key; treat a never-dispatched batch as failed and the queued
  // document is destroyed, because the crons only read status 'pending'.
  batchNeverDispatched: `function batchNeverDispatched(payload, status) {
  const d = payload || {};
  if (!d.error || typeof d.successful === 'number') return false;
  // Requeue only what a later run could actually send. A 5xx is infrastructure
  // — unreadable credentials, a platform blip — and clears on its own. A 4xx is
  // bad input for THIS row (disallowed file_url, unusable recipient numbers) and
  // would fail identically on every future tick; there is no UI listing
  // ScheduledFax rows, so an unsendable row must reach a terminal status rather
  // than retry forever with nobody watching. An unknown status requeues, because
  // a stuck 'pending' row is recoverable and a destroyed PHI document is not.
  const code = Number(status);
  return !Number.isFinite(code) || code >= 500;
}`,

};
