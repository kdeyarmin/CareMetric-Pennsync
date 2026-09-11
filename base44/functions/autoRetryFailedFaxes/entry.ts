import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: outboundDeliveryGate — generated, edit base44/_shared/backendHelpers.mjs>>>
const OUTBOUND_DELIVERY_RELEASE_ENV = 'OUTBOUND_DELIVERY_RELEASE';
const OUTBOUND_DELIVERY_RELEASE_VALUE = 'enabled-v1';
function outboundDeliveryReleased() {
  return Deno.env.get(OUTBOUND_DELIVERY_RELEASE_ENV)
    === OUTBOUND_DELIVERY_RELEASE_VALUE;
}
function outboundDeliveryPausedResponse(channel = 'outbound') {
  return Response.json({
    error: 'Outbound delivery is disabled in this environment.',
    code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
    channel,
    retryable: false,
  }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
// <<<END SHARED HELPER: outboundDeliveryGate>>>

// <<<BEGIN SHARED HELPER: faxWorkflowDeliveryGate — generated, edit base44/_shared/backendHelpers.mjs>>>
function faxWorkflowDeliveryReleased() {
  return outboundDeliveryReleased()
    || Deno.env.get('OUTBOUND_FAX_WORKFLOW_RELEASE') === 'enabled-v1';
}
// <<<END SHARED HELPER: faxWorkflowDeliveryGate>>>

// Deploying source must not make a provider-facing retry worker runnable. The
// native workflow owns the schedule, while this exact reviewed revision still
// requires an explicit runtime release before the SDK is constructed.
const AUTO_RETRY_FAILED_FAXES_ENABLED =
  String(Deno.env.get('WORKFLOW_RELEASE_AUTO_RETRY_FAILED_FAXES') || '').trim() === 'enabled-v1';

const AUTO_RETRY_SCAN_PAGE_SIZE = 200;
const AUTO_RETRY_SCAN_LIMIT = 1_000;
const AUTO_RETRY_DEFER_MAX_ATTEMPTS = 12;
const AUTO_RETRY_DEFER_BASE_MINUTES = 15;
const AUTO_RETRY_DEFER_MAX_MINUTES = 360;

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
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

async function createFaxInternalCapability(action, resourceId, claimId) {
  const secret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (secret.length < 32) throw new Error('Internal fax capability signing is unavailable');
  const issuedAt = Date.now();
  const capability = {
    version: 1,
    action,
    resource_id: resourceId,
    claim_id: claimId,
    issued_at: issuedAt,
    expires_at: issuedAt + 300_000,
    nonce: crypto.randomUUID(),
  };
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const payload = JSON.stringify([
    capability.version, capability.action, capability.resource_id, capability.claim_id,
    capability.issued_at, capability.expires_at, capability.nonce,
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(payload),
  ));
  return {
    ...capability,
    mac: Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}



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
  } catch {
    // Do NOT collapse this into "not configured". A failed read (this invocation
    // path carries no service token, entity 404, 401/403, rate limit, platform
    // blip) is a completely different problem from an unconfigured integration,
    // and reporting them identically is what sent operators chasing a credential
    // they had already entered correctly.
    readError = 'credential_store_unavailable';
    // The catch used to be bare, so an unreadable credential row left no
    // server-side breadcrumb at all — the only signal was a misleading
    // "not configured" reply. Log it; unattended runs have nowhere else to say so.
    console.error('resolveTelnyxCreds: Telnyx credential lookup failed');
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
    return `Could not read Telnyx ${label} — the credential store is temporarily unavailable. This is NOT a missing-key result, so re-entering it will not help. Retry and check the function's credential-store access if it persists.`;
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

function autoPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function autoExactId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value.trim() === value && !value.startsWith('$')
    && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function autoValidInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function autoRequireRows(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value;
}

function autoSuccessfulCas(value) {
  return autoPlainObject(value) && value.success === true && value.updated === 1 && value.has_more === false;
}

async function loadDueAutomaticRetryRows(entities, dueBefore) {
  const rows = [];
  let afterId = null;
  while (rows.length < AUTO_RETRY_SCAN_LIMIT) {
    const query = {
      status: 'failed',
      next_retry_at: { $lte: dueBefore, $ne: null },
      ...(afterId ? { id: { $gt: afterId } } : {}),
    };
    const pageSize = Math.min(AUTO_RETRY_SCAN_PAGE_SIZE, AUTO_RETRY_SCAN_LIMIT - rows.length);
    const page = autoRequireRows(
      await entities.FaxLog.filter(query, 'id', pageSize),
      'FaxLog.filter',
    );
    if (page.length > pageSize) throw new Error('Fax retry scan exceeded its bound');
    if (page.length === 0) break;
    let lastId = afterId;
    for (const row of page) {
      const id = autoExactId(row?.id);
      if (!id || (lastId && id <= lastId) || row.status !== 'failed'
        || !autoValidInstant(row.next_retry_at) || row.next_retry_at > dueBefore) {
        throw new Error('FaxLog.filter returned an invalid retry scan cursor');
      }
      rows.push(row);
      lastId = id;
    }
    afterId = lastId;
    if (page.length < pageSize) break;
  }
  rows.sort((left, right) => {
    const timeDelta = Date.parse(left?.next_retry_at) - Date.parse(right?.next_retry_at);
    return (Number.isFinite(timeDelta) && timeDelta !== 0)
      ? timeDelta
      : String(left?.id || '').localeCompare(String(right?.id || ''));
  });
  return rows;
}

function automaticRetryBackoff(row, nowMs = Date.now()) {
  const current = Number.isSafeInteger(row?.automatic_retry_queue_attempts)
    && row.automatic_retry_queue_attempts >= 0
    ? Math.min(row.automatic_retry_queue_attempts, AUTO_RETRY_DEFER_MAX_ATTEMPTS)
    : 0;
  const attempts = Math.min(current + 1, AUTO_RETRY_DEFER_MAX_ATTEMPTS);
  const minutes = Math.min(
    AUTO_RETRY_DEFER_MAX_MINUTES,
    AUTO_RETRY_DEFER_BASE_MINUTES * (2 ** Math.min(attempts - 1, 5)),
  );
  return {
    attempts,
    exhausted: attempts >= AUTO_RETRY_DEFER_MAX_ATTEMPTS,
    nextRetryAt: attempts >= AUTO_RETRY_DEFER_MAX_ATTEMPTS
      ? null
      : new Date(nowMs + minutes * 60_000).toISOString(),
  };
}

function automaticRetryQueueCasFilter(row) {
  if (!autoExactId(row?.id) || row?.status !== 'failed'
    || !autoValidInstant(row?.next_retry_at) || !autoValidInstant(row?.updated_date)) return null;
  return {
    id: row.id,
    status: 'failed',
    next_retry_at: row.next_retry_at,
    updated_date: row.updated_date,
  };
}

async function quarantineAutomaticRetry(entities, row, code, nowMs = Date.now()) {
  const filter = automaticRetryQueueCasFilter(row);
  if (!filter) return false;
  const result = await entities.FaxLog.updateMany(filter, { $set: {
    next_retry_at: null,
    automatic_retry_last_error_code: code,
    automatic_retry_quarantined_at: new Date(nowMs).toISOString(),
  } });
  return autoSuccessfulCas(result);
}

async function deferAutomaticRetry(entities, row, code, nowMs = Date.now()) {
  const filter = automaticRetryQueueCasFilter(row);
  if (!filter) return null;
  const backoff = automaticRetryBackoff(row, nowMs);
  const result = await entities.FaxLog.updateMany(filter, { $set: {
    next_retry_at: backoff.nextRetryAt,
    automatic_retry_queue_attempts: backoff.attempts,
    automatic_retry_last_error_code: backoff.exhausted ? `${code}_retry_exhausted` : code,
    automatic_retry_quarantined_at: backoff.exhausted
      ? new Date(nowMs).toISOString()
      : null,
  } });
  return autoSuccessfulCas(result) ? (backoff.exhausted ? 'quarantined' : 'deferred') : null;
}

function automaticRetryHasConflictingClaim(row) {
  return row?.retry_claimed_by != null || row?.retry_claimed_at != null
    || row?.retry_claimed_by_user_id != null || row?.failure_notify_claimed_by != null
    || row?.failure_notify_claimed_at != null;
}

function strictAutomaticRetryCandidate(row, now) {
  return !!row
    && !!autoExactId(row.id)
    && !!autoExactId(row.agency_id)
    && !!autoExactId(row.referral_id)
    && !!autoExactId(row.document_id)
    && !!autoExactId(row.document_binding_id)
    && row.document_binding_version === 2
    && /^[a-f0-9]{64}$/.test(String(row.document_content_sha256 || ''))
    && !!autoExactId(row.sent_by_user_id)
    && !!autoExactId(row.sent_by_membership_id)
    && typeof row.sent_by === 'string'
    && row.sent_by === row.sent_by.trim().toLowerCase()
    && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.sent_by)
    && /^\+\d{8,15}$/.test(String(row.to_number || ''))
    && Number.isSafeInteger(row.sent_by_membership_version)
    && row.sent_by_membership_version >= 1
    && row.status === 'failed'
    && row.provider_submission_state === 'accepted'
    && row.provider_terminal_status === 'failed'
    && !!autoExactId(row.provider_submission_attempt_id)
    && !!autoExactId(row.telnyx_fax_id)
    && row.provider === 'telnyx'
    && !!autoExactId(row.integration_secret_id)
    && autoValidInstant(row.integration_secret_updated_at)
    && !!autoExactId(row.fax_connection_id)
    && !!autoExactId(row.sender_telecom_binding_id)
    && Number.isSafeInteger(row.sender_telecom_binding_version)
    && row.sender_telecom_binding_version >= 1
    && !!autoExactId(row.sender_provider_number_id)
    && !!autoExactId(row.sender_settings_id)
    && autoValidInstant(row.sender_settings_updated_at)
    && autoValidInstant(row.provider_accepted_at)
    && autoValidInstant(row.provider_terminal_at)
    && autoValidInstant(row.next_retry_at)
    && Date.parse(row.next_retry_at) <= now
    && autoValidInstant(row.updated_date)
    && Number.isSafeInteger(row.retry_count)
    && row.retry_count >= 0
    && Number.isSafeInteger(row.retry_generation)
    && row.retry_generation >= 0
    && row.retry_count === row.retry_generation + 1
    && row.retry_claimed_by == null
    && row.retry_claimed_at == null
    && row.retry_claimed_by_user_id == null
    && row.failure_notify_claimed_by == null
    && row.failure_notify_claimed_at == null
    && row.document_url == null;
}

async function loadAutomaticRetryPolicy(entities, fax) {
  const agencyRows = autoRequireRows(
    await entities.Agency.filter({ id: fax.agency_id }, undefined, 10),
    'Agency.filter',
  );
  if (agencyRows.length !== 1 || agencyRows[0]?.id !== fax.agency_id
    || !['active', 'trial'].includes(String(agencyRows[0]?.status || ''))
    || !autoExactId(agencyRows[0]?.agency_code)) return null;
  const sameCode = autoRequireRows(
    await entities.Agency.filter({ agency_code: agencyRows[0].agency_code }, undefined, 10),
    'Agency.filter',
  );
  if (sameCode.length !== 1 || sameCode[0]?.id !== fax.agency_id) return null;
  const exact = autoRequireRows(
    await entities.FaxRetryConfig.filter({ agency_id: fax.agency_id }, undefined, 10),
    'FaxRetryConfig.filter',
  );
  if (exact.length > 1 || exact.some((row) => row?.agency_id !== fax.agency_id)) return null;
  let config = exact[0] || null;
  if (!config) {
    const legacy = autoRequireRows(
      await entities.FaxRetryConfig.filter({ agency_name: agencyRows[0].agency_code }, undefined, 10),
      'FaxRetryConfig.filter',
    );
    if (legacy.length > 1 || legacy.some((row) => row?.agency_name !== agencyRows[0].agency_code
      || (row.agency_id != null && row.agency_id !== fax.agency_id))) return null;
    config = legacy[0] || null;
  }
  if (!config || config.is_active === false) return null;
  if ((config.max_retries != null && (!Number.isSafeInteger(Number(config.max_retries))
    || Number(config.max_retries) < 0 || Number(config.max_retries) > 10))
    || (config.retry_delay_minutes != null && (!Number.isFinite(Number(config.retry_delay_minutes))
      || Number(config.retry_delay_minutes) <= 0 || Number(config.retry_delay_minutes) > 360))) return null;
  const policy = faxRetryConfig(config);
  if (!policy.enabled || fax.retry_count > policy.maxRetries
    || fax.retry_generation >= policy.maxRetries) return null;
  return { config, policy };
}

async function claimAutomaticRetry(entities, fax) {
  const claimId = crypto.randomUUID();
  const claimedAt = new Date().toISOString();
  const result = await entities.FaxLog.updateMany({
    id: fax.id,
    agency_id: fax.agency_id,
    referral_id: fax.referral_id,
    document_id: fax.document_id,
    document_binding_id: fax.document_binding_id,
    document_binding_version: fax.document_binding_version,
    document_content_sha256: fax.document_content_sha256,
    sent_by_user_id: fax.sent_by_user_id,
    sent_by_membership_id: fax.sent_by_membership_id,
    sent_by_membership_version: fax.sent_by_membership_version,
    to_number: fax.to_number,
    status: 'failed',
    provider_submission_state: 'accepted',
    provider_submission_attempt_id: fax.provider_submission_attempt_id,
    provider_accepted_at: fax.provider_accepted_at,
    provider_terminal_status: 'failed',
    provider_terminal_at: fax.provider_terminal_at,
    telnyx_fax_id: fax.telnyx_fax_id,
    provider: 'telnyx',
    integration_secret_id: fax.integration_secret_id,
    integration_secret_updated_at: fax.integration_secret_updated_at,
    fax_connection_id: fax.fax_connection_id,
    sender_telecom_binding_id: fax.sender_telecom_binding_id,
    sender_telecom_binding_version: fax.sender_telecom_binding_version,
    sender_provider_number_id: fax.sender_provider_number_id,
    sender_settings_id: fax.sender_settings_id,
    sender_settings_updated_at: fax.sender_settings_updated_at,
    retry_count: fax.retry_count,
    retry_generation: fax.retry_generation,
    next_retry_at: fax.next_retry_at,
    updated_date: fax.updated_date,
  }, { $set: {
    status: 'retrying',
    retry_claimed_by: claimId,
    retry_submission_state: 'ready',
    retry_claimed_at: claimedAt,
    retry_claimed_by_user_id: fax.sent_by_user_id,
    next_retry_at: null,
    automatic_retry_queue_attempts: 0,
    automatic_retry_last_error_code: null,
    automatic_retry_quarantined_at: null,
  } });
  if (!autoSuccessfulCas(result)) {
    if (result?.success === true && result.updated === 0 && result.has_more === false) return null;
    throw new Error('Automatic retry claim was not acknowledged');
  }
  const rows = autoRequireRows(
    await entities.FaxLog.filter({ id: fax.id }, undefined, 10),
    'FaxLog.filter',
  );
  if (rows.length !== 1 || rows[0]?.id !== fax.id || rows[0]?.status !== 'retrying'
    || rows[0]?.retry_claimed_by !== claimId || rows[0]?.retry_claimed_at !== claimedAt
    || rows[0]?.retry_claimed_by_user_id !== fax.sent_by_user_id
    || rows[0]?.agency_id !== fax.agency_id || rows[0]?.referral_id !== fax.referral_id
    || rows[0]?.document_id !== fax.document_id || rows[0]?.to_number !== fax.to_number
    || rows[0]?.document_binding_id !== fax.document_binding_id
    || rows[0]?.document_binding_version !== fax.document_binding_version
    || rows[0]?.document_content_sha256 !== fax.document_content_sha256
    || rows[0]?.sent_by_membership_id !== fax.sent_by_membership_id
    || rows[0]?.sent_by_membership_version !== fax.sent_by_membership_version
    || rows[0]?.provider_submission_attempt_id !== fax.provider_submission_attempt_id
    || rows[0]?.telnyx_fax_id !== fax.telnyx_fax_id
    || !autoValidInstant(rows[0]?.updated_date)) throw new Error('Automatic retry claim readback is invalid');
  return { row: rows[0], claimId, claimedAt };
}

async function settleAutomaticRetry(entities, claim, fax, changes) {
  const rows = await entities.FaxLog.filter({ id: fax.id }, undefined, 10);
  const current = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!current || current.id !== fax.id || !autoValidInstant(current.updated_date)
    || Object.entries(claim.row).some(([key, value]) => (
      !['updated_date', 'retry_submission_state'].includes(key)
      && JSON.stringify(current[key]) !== JSON.stringify(value)
    ))) return false;
  const result = await entities.FaxLog.updateMany({
    id: fax.id,
    status: 'retrying',
    retry_claimed_by: claim.claimId,
    retry_claimed_at: claim.claimedAt,
    retry_claimed_by_user_id: fax.sent_by_user_id,
    updated_date: current.updated_date,
  }, { $set: {
    ...changes,
    retry_claimed_by: null,
    retry_claimed_at: null,
    retry_claimed_by_user_id: null,
  } });
  return autoSuccessfulCas(result);
}

Deno.serve(async (req) => {
  try {
    if (!faxWorkflowDeliveryReleased()) return outboundDeliveryPausedResponse('fax');
    if (!AUTO_RETRY_FAILED_FAXES_ENABLED) {
      return Response.json(
        { error: 'Automatic failed-fax retry workflow is not released' },
        { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
      );
    }
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    const entities = base44.asServiceRole.entities;
    const now = Date.now();
    const rows = await loadDueAutomaticRetryRows(entities, new Date(now).toISOString());
    let retried = 0;
    let rejected = 0;
    let reconciliation = 0;
    let skipped = 0;
    let quarantined = 0;
    let deferred = 0;
    let policyErrors = 0;
    let queueErrors = 0;

    for (const fax of rows) {
      if (!strictAutomaticRetryCandidate(fax, now)) {
        const conflictingClaim = automaticRetryHasConflictingClaim(fax);
        const disposition = conflictingClaim
          ? await deferAutomaticRetry(entities, fax, 'retry_claim_conflict', now).catch(() => null)
          : await quarantineAutomaticRetry(
            entities,
            fax,
            'legacy_or_invalid_retry_provenance',
            now,
          ).then((applied) => applied ? 'quarantined' : null).catch(() => null);
        if (disposition === 'deferred') deferred++;
        else if (disposition === 'quarantined') quarantined++;
        else queueErrors++;
        continue;
      }
      let loadedPolicy = null;
      try {
        loadedPolicy = await loadAutomaticRetryPolicy(entities, fax);
      } catch {
        policyErrors++;
        const disposition = await deferAutomaticRetry(
          entities,
          fax,
          'retry_policy_read_failed',
          now,
        ).catch(() => null);
        if (disposition === 'deferred') deferred++;
        else if (disposition === 'quarantined') quarantined++;
        else queueErrors++;
        continue;
      }
      if (!loadedPolicy) {
        if (await quarantineAutomaticRetry(
          entities,
          fax,
          'retry_policy_unavailable',
          now,
        ).catch(() => false)) quarantined++;
        else queueErrors++;
        continue;
      }
      let claim;
      try {
        claim = await claimAutomaticRetry(entities, fax);
      } catch {
        queueErrors++;
        await deferAutomaticRetry(entities, fax, 'retry_claim_unverified', now).catch(() => null);
        continue;
      }
      if (!claim) {
        skipped++;
        continue;
      }
      try {
        const capability = await createFaxInternalCapability('dispatch_retry', fax.id, claim.claimId);
        const response = await base44.asServiceRole.functions.invoke('sendBatchFax', {
          action: 'dispatch_retry',
          fax_log_id: fax.id,
          retry_claim_id: claim.claimId,
          capability,
        });
        const data = autoPlainObject(response?.data) ? response.data : response;
        const nextGeneration = fax.retry_generation + 1;
        if (!autoPlainObject(data) || data.success !== true || data.total !== 1
          || data.retry_source_fax_log_id !== fax.id
          || data.retry_generation !== nextGeneration
          || ![data.accepted, data.failed, data.unknown]
            .every((value) => Number.isSafeInteger(value) && value >= 0)
          || data.accepted + data.failed + data.unknown !== 1) {
          // The invocation crossed an asynchronous boundary. Leave the exact
          // claim in place; pollFaxStatuses reconciles it from the durable child
          // FaxLog and never assumes an interrupted request was not submitted.
          reconciliation++;
          continue;
        }
        if (data.requires_reconciliation === true || Number(data.unknown) > 0) {
          const settled = await settleAutomaticRetry(entities, claim, fax, {
            status: 'retried',
            retry_count: nextGeneration,
            retry_generation: nextGeneration,
            next_retry_at: null,
            failure_reason: 'Automatic retry submission requires provider reconciliation',
          });
          reconciliation++;
          if (!settled) queueErrors++;
          continue;
        }
        if (Number(data.accepted) === 1) {
          const settled = await settleAutomaticRetry(entities, claim, fax, {
            status: 'retried',
            retry_count: nextGeneration,
            retry_generation: nextGeneration,
            next_retry_at: null,
            failure_reason: `Automatic retry attempt #${nextGeneration} accepted by provider`,
          });
          if (settled) retried++;
          else queueErrors++;
          continue;
        }
        if (Number(data.failed) === 1) {
          const withinBudget = nextGeneration < loadedPolicy.policy.maxRetries;
          const delay = nextRetryDelayMinutes(
            nextGeneration,
            loadedPolicy.config,
            fax.priority || 'normal',
          );
          const settled = await settleAutomaticRetry(entities, claim, fax, {
            status: 'failed',
            retry_count: withinBudget ? nextGeneration + 1 : nextGeneration,
            retry_generation: nextGeneration,
            next_retry_at: withinBudget ? new Date(Date.now() + delay * 60_000).toISOString() : null,
            ...(!withinBudget ? {
              // The poller's recoverable notification outbox owns final notices.
              // Leave the marker false when notification is enabled; never mark
              // a notice sent before its dedupe-keyed Notification is durable.
              final_failure_notified: fax.final_failure_notified === true || !loadedPolicy.policy.notifyOnFinalFailure,
              // Preserve an earlier uncertain publication; never reopen its fence.
              failure_notify_publication_state: fax.failure_notify_publication_state === 'started' ? 'started' : 'ready',
              failure_notify_claimed_by: null,
              failure_notify_claimed_at: null,
            } : {}),
            failure_reason: 'Fax provider rejected the automatic retry before acceptance',
          });
          if (settled) {
            rejected++;
          } else queueErrors++;
          continue;
        }
        reconciliation++;
      } catch {
        // Do not release or retry here. The child broker creates and verifies a
        // FaxLog before contacting Telnyx, so an invocation failure may represent
        // a submitted fax. The status poller safely reconciles stale claims.
        reconciliation++;
      }
    }

    const degraded = queueErrors > 0 || policyErrors > 0 || reconciliation > 0;
    return Response.json({
      success: !degraded,
      queue_errors: queueErrors,
      retried,
      provider_rejected: rejected,
      requires_reconciliation: reconciliation,
      skipped,
      quarantined,
      deferred,
      policy_errors: policyErrors,
      scanned: rows.length,
      scan_limit_reached: rows.length === AUTO_RETRY_SCAN_LIMIT,
      timestamp: new Date().toISOString(),
    }, { status: degraded ? 503 : 200, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch {
    console.error('autoRetryFailedFaxes failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
