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

export const SHARED_HELPERS = {
  // Generated from the frontend table (see above) — do not hand-edit consumers.
  areaCodeTimezone: areaCodeTimezoneSource(),
  urgentKeywords: urgentKeywordsSource(),

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

};
