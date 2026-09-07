import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

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
 * Creates a notification and sends it via appropriate channels based on user preferences
 * 
 * Request body:
 * {
 *   user_email: string (required),
 *   title: string (required),
 *   message: string (required),
 *   type: string (required - one of the notification types),
 *   priority: string (optional - low, medium, high, critical),
 *   action_url: string (optional),
 *   action_label: string (optional),
 *   metadata: object (optional)
 * }
 */

function getAppBaseUrl() {
  const fromEnv = String(Deno.env.get('APP_PUBLIC_URL') || Deno.env.get('APP_URL') || '').trim().replace(/\/+$/, '');
  if (fromEnv) {
    try { return new URL(fromEnv).origin; } catch { /* fall through */ }
  }
  return 'https://caremetricai.base44.app';
}

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TITLE_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 5_000;
const MAX_ACTION_LABEL_LENGTH = 200;
const MAX_ACTION_URL_LENGTH = 1_000;
const LOOKUP_LIMIT = 20;
const ACTIVE_AGENCY_STATUSES = new Set(['active', 'trial']);
const TENANT_ROLES = new Set([
  'agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care',
]);
const ALLOWED_TYPES = new Set([
  'report_ready', 'compliance_alert', 'critical_alert', 'patient_alert',
  'task_assigned', 'task_due_soon', 'new_referral', 'referral_urgent',
  'training_due', 'system_update', 'message_received', 'sms_failed',
  'sms_urgent', 'sms_received', 'fax_delivered', 'fax_failed', 'voicemail',
  'info', 'expiration_warning', 'credential_expiration',
  'admin_expiration_summary', 'care_plan_proposal', 'signature_request',
]);
const NON_ADMIN_TYPES = new Set([
  'system_update', 'info', 'message_received', 'task_assigned', 'task_due_soon',
]);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$')
    && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

function canonicalEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length > 2 && email.length <= 320 && email.includes('@') && !/\s/.test(email)
    ? email
    : null;
}

function boundedText(value, maximum) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000\u007f]/.test(value)
    ? value
    : null;
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => allowed.has(key));
}

function safeRelativeActionUrl(value) {
  if (value == null) return null;
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || value.length > MAX_ACTION_URL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw new PublicError(400, 'action_url must be a safe relative in-app path');
  return value;
}

function requireRows(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value;
}

async function parseBody(req) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const stated = req.headers.get('content-length');
  if (stated != null && (!/^\d+$/.test(stated) || Number(stated) > MAX_BODY_BYTES)) {
    throw new PublicError(413, 'Request body is too large');
  }
  const raw = await req.text().catch(() => { throw new PublicError(400, 'Invalid JSON body'); });
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body;
  try { body = JSON.parse(raw); } catch { throw new PublicError(400, 'Invalid JSON body'); }
  const allowed = new Set([
    'agency_id', 'user_email', 'title', 'message', 'type', 'priority',
    'action_url', 'action_label', 'metadata', 'patient_id',
  ]);
  if (!exactKeys(body, allowed)) throw new PublicError(400, 'Request contains unsupported fields');
  const recipientEmail = canonicalEmail(body.user_email);
  const title = boundedText(body.title, MAX_TITLE_LENGTH);
  const message = boundedText(body.message, MAX_MESSAGE_LENGTH);
  const type = typeof body.type === 'string' && ALLOWED_TYPES.has(body.type) ? body.type : null;
  if (!recipientEmail || !title || !message || !type) {
    throw new PublicError(400, 'Notification requires a valid user_email, title, message, and type');
  }
  const agencyId = body.agency_id == null ? null : exactIdentifier(body.agency_id);
  if (body.agency_id != null && !agencyId) throw new PublicError(400, 'agency_id is invalid');
  const patientId = body.patient_id == null ? null : exactIdentifier(body.patient_id);
  if (body.patient_id != null && !patientId) throw new PublicError(400, 'patient_id is invalid');
  const actionLabel = body.action_label == null
    ? null
    : boundedText(body.action_label, MAX_ACTION_LABEL_LENGTH);
  if (body.action_label != null && !actionLabel) throw new PublicError(400, 'action_label is invalid');
  if (body.metadata != null && (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata))) {
    throw new PublicError(400, 'metadata must be an object');
  }
  return {
    recipientEmail,
    title,
    message,
    type,
    priority: ALLOWED_PRIORITIES.has(body.priority) ? body.priority : 'medium',
    actionUrl: safeRelativeActionUrl(body.action_url),
    actionLabel,
    metadata: body.metadata ?? null,
    patientId,
    requestedAgencyId: agencyId,
  };
}

function protectedPlatformOwner(user) {
  const configured = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configured && user?.role === 'admin' && canonicalEmail(user?.email) === configured;
}

function validateUser(user) {
  const id = exactIdentifier(user?.id);
  const email = canonicalEmail(user?.email);
  if (!id || !email || user?.is_active === false || user?.disabled === true || user?.is_service === true) {
    throw new PublicError(403, 'Forbidden');
  }
  return { id, email, role: user.role, isPlatformOwner: protectedPlatformOwner(user) };
}

async function loadExactUser(entities, email) {
  const rows = requireRows(
    await entities.User.filter({ email }, undefined, LOOKUP_LIMIT),
    'User.filter',
  );
  if (rows.length !== 1 || rows[0]?.email !== email) {
    throw new PublicError(rows.length === 0 ? 404 : 409, 'Notification recipient is unavailable');
  }
  return validateUser(rows[0]);
}

async function loadMemberships(entities, user) {
  const rows = requireRows(
    await entities.AgencyMembership.filter({ user_id: user.id, status: 'active' }, '-updated_date', LOOKUP_LIMIT),
    'AgencyMembership.filter',
  );
  if (rows.length >= LOOKUP_LIMIT) throw new PublicError(409, 'Tenant membership set is ambiguous');
  const seen = new Set();
  return rows.map((row) => {
    const id = exactIdentifier(row?.id);
    const agencyId = exactIdentifier(row?.agency_id);
    const membershipEmail = canonicalEmail(row?.user_email_normalized);
    if (
      !id || !agencyId || seen.has(agencyId)
      || row.membership_key !== `${agencyId}:${user.id}`
      || row.user_id !== user.id
      || membershipEmail !== user.email
      || row.user_email_normalized !== membershipEmail
      || !TENANT_ROLES.has(String(row.tenant_role || ''))
      || !Number.isSafeInteger(row.version) || row.version < 1
    ) throw new PublicError(409, 'Tenant membership set is ambiguous');
    seen.add(agencyId);
    return { id, agencyId, tenantRole: row.tenant_role, version: row.version };
  });
}

async function resolveScope(entities, caller, recipient, requestedAgencyId) {
  const callerMemberships = await loadMemberships(entities, caller);
  const recipientMemberships = await loadMemberships(entities, recipient);
  const callerAgencyIds = new Set(callerMemberships.map((row) => row.agencyId));
  let shared = recipientMemberships.filter((row) => callerAgencyIds.has(row.agencyId));
  if (requestedAgencyId) shared = shared.filter((row) => row.agencyId === requestedAgencyId);

  if (caller.isPlatformOwner && shared.length === 0) {
    shared = requestedAgencyId
      ? recipientMemberships.filter((row) => row.agencyId === requestedAgencyId)
      : recipientMemberships;
  }
  if (shared.length !== 1) throw new PublicError(403, 'Recipient is not in one exact authorized agency');
  const recipientMembership = shared[0];
  const callerMembership = callerMemberships.find((row) => row.agencyId === recipientMembership.agencyId) || null;
  if (!callerMembership && !caller.isPlatformOwner) throw new PublicError(403, 'Forbidden');

  const agencies = requireRows(
    await entities.Agency.filter({ id: recipientMembership.agencyId }, undefined, 10),
    'Agency.filter',
  );
  if (
    agencies.length !== 1
    || agencies[0]?.id !== recipientMembership.agencyId
    || !ACTIVE_AGENCY_STATUSES.has(String(agencies[0]?.status || ''))
  ) throw new PublicError(403, 'Agency is unavailable');

  return { agency: agencies[0], callerMembership, recipientMembership };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me().catch(() => null);
    if (!currentUser) throw new PublicError(401, 'Unauthorized');
    if (isDeactivatedUser(currentUser)) return DEACTIVATED_USER_RESPONSE();
    const caller = validateUser(currentUser);
    const input = await parseBody(req);
    const entities = base44.asServiceRole.entities;
    const recipient = await loadExactUser(entities, input.recipientEmail);
    const scope = await resolveScope(entities, caller, recipient, input.requestedAgencyId);
    const callerIsAdmin = caller.role === 'admin'
      || scope.callerMembership?.tenantRole === 'agency_admin'
      || scope.callerMembership?.tenantRole === 'manager';
    if (!callerIsAdmin && !NON_ADMIN_TYPES.has(input.type)) {
      throw new PublicError(403, 'Only authorized administrators can create this notification type');
    }
    if (!callerIsAdmin && recipient.email !== caller.email && recipient.role !== 'admin') {
      throw new PublicError(403, 'Non-admins may only notify themselves or an administrator');
    }

    // If this is a patient-related notification, verify the recipient has charted on this patient
    if (input.patientId && !['compliance_alert', 'report_ready', 'training_due'].includes(input.type)) {
      const chartedVisits = requireRows(await entities.Visit.filter({
        patient_id: input.patientId,
        agency_id: scope.recipientMembership.agencyId,
        created_by: recipient.email,
      }, undefined, LOOKUP_LIMIT), 'Visit.filter');

      if (chartedVisits.length === 0 || chartedVisits.some((row) =>
        row?.patient_id !== input.patientId || row?.agency_id !== scope.recipientMembership.agencyId
      )) throw new PublicError(403, 'Recipient is not authorized for this patient');
    }

    // Get user's notification preferences
    const preferences = requireRows(await entities.NotificationPreference.filter({
      user_email: recipient.email,
    }, '-updated_date', LOOKUP_LIMIT), 'NotificationPreference.filter');

    const userPrefs = preferences[0] || {
      email_notifications_enabled: true,
      in_app_notifications_enabled: true,
      push_notifications_enabled: false,
      // Default to instant delivery: shouldSendEmail requires digest_mode ===
      // 'instant', so omitting it here made the email_notifications_enabled:true
      // default unreachable — a user who never opened Notification Settings got
      // NO emails at all, including priority:'critical' patient alerts.
      digest_mode: 'instant',
      preferences: {}
    };

    // Check if notification type is enabled for in-app
    const typePrefs = userPrefs.preferences?.[input.type] || {
      email: true, 
      in_app: true, 
      push: false 
    };

    // Always create in-app notification if in_app is enabled
    if (userPrefs.in_app_notifications_enabled && typePrefs.in_app !== false) {
      await entities.Notification.create({
        agency_id: scope.recipientMembership.agencyId,
        recipient_user_id: recipient.id,
        recipient_membership_id: scope.recipientMembership.id,
        recipient_membership_version: scope.recipientMembership.version,
        authority_version: 1,
        version: 1,
        user_email: recipient.email,
        title: input.title,
        message: input.message,
        type: input.type,
        priority: input.priority,
        action_url: input.actionUrl,
        action_label: input.actionLabel,
        metadata: input.metadata,
        is_read: false,
        read_at: null,
        email_sent: false,
        push_sent: false,
        dismissed: false,
        dismissed_at: null,
      });
    }

    // Check if should send email
    const shouldSendEmail = userPrefs.email_notifications_enabled && 
                           typePrefs.email !== false &&
                           userPrefs.digest_mode === 'instant';

    if (shouldSendEmail) {
      // Check quiet hours. Quiet-hour start/end times are entered relative to the
      // agency's configured business timezone (Agency Settings), not an arbitrary
      // per-user IANA zone — Deno has no browser timezone for the recipient.
      // Evaluate the current HH:MM in that agency timezone (default America/New_York).
      const agencySettingsRow = await resolveAgencySettings(
        base44,
        scope.agency?.agency_code || scope.agency?.agency_name,
      );
      const tz = agencySettingsRow?.business_hours_timezone || agencySettingsRow?.duty_timezone || 'America/New_York';
      let currentTime;
      try {
        currentTime = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
        }).format(new Date());
      } catch {
        const now = new Date();
        currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      }
      
      let inQuietHours = false;
      if (userPrefs.quiet_hours?.enabled) {
        const start = userPrefs.quiet_hours.start_time;
        const end = userPrefs.quiet_hours.end_time;
        
        // Handle quiet hours across midnight
        if (start < end) {
          inQuietHours = currentTime >= start && currentTime <= end;
        } else {
          inQuietHours = currentTime >= start || currentTime <= end;
        }
      }

      // Send email if not in quiet hours or if critical priority
      if (!inQuietHours || input.priority === 'critical') {
        try {
          // Deep-link the in-app action_url (a relative path) into an absolute URL
          // so the email button actually works.
          const appBase = getAppBaseUrl();
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: recipient.email,
            from_name: 'PennSync by CareMetric',
            subject: `${input.title} · PennSync by CareMetric`,
            body: renderBrandedEmail({
              preheader: input.message,
              eyebrow: 'Notification',
              tone: input.priority === 'critical' ? 'urgent' : 'brand',
              title: input.title,
              intro: input.message,
              sections: [
                ...(input.actionUrl
                  ? [{ button: { href: `${appBase}${input.actionUrl}`, label: input.actionLabel || 'View in PennSync' } }]
                  : []),
              ],
              footerNote: 'You’re receiving this because email notifications are enabled for this alert type. Manage your preferences on the Notification Settings page in PennSync.',
            }),
          });
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
        }
      }
    }

    return Response.json({ 
      success: true, 
      message: 'Notification created',
      channels: {
        in_app: userPrefs.in_app_notifications_enabled && typePrefs.in_app !== false,
        email: shouldSendEmail,
        push: userPrefs.push_notifications_enabled && typePrefs.push !== false
      }
    });

  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creating notification:', error);
    return Response.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
});
