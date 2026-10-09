import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: smsMedia — generated, edit base44/_shared/backendHelpers.mjs>>>
// Generated verbatim from src/components/messaging/smsMedia.js.
const SMS_MEDIA_LIMIT = 10;
const SMS_MEDIA_MAX_BYTES = 5242880;
const SMS_MEDIA_CONTENT_TYPE = /^(?:image\/(?:jpeg|jpg|png|gif|webp|heic|heif|bmp)|audio\/(?:amr|mpeg|mp3|mp4|aac|ogg|wav|x-wav|3gpp)|video\/(?:mp4|3gpp|3gpp2|quicktime|mpeg|webm)|application\/pdf|text\/(?:plain|vcard|x-vcard|calendar|directory))$/;
const SMS_MEDIA_LAYOUT_TYPE = /^application\/smil$/;
function smsMediaContentType(value) {
  if (typeof value !== "string") return null;
  const type = value.split(";")[0].trim().toLowerCase();
  return SMS_MEDIA_CONTENT_TYPE.test(type) ? type : null;
}
function smsMediaFetchUrl(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost"
    || /^[\d.]+$/.test(host) || host.startsWith("[") || host.includes(":")) return null;
  return url.toString();
}
function inboundSmsMediaPlaceholders(rawMedia) {
  const items = Array.isArray(rawMedia) ? rawMedia : [];
  const placeholders = [];
  for (const item of items) {
    if (placeholders.length >= SMS_MEDIA_LIMIT) break;
    const declared = typeof item?.content_type === "string" ? item.content_type.split(";")[0].trim().toLowerCase() : "";
    if (SMS_MEDIA_LAYOUT_TYPE.test(declared)) continue;
    const contentType = smsMediaContentType(declared);
    const size = Number.isSafeInteger(item?.size) && item.size >= 0 ? item.size : null;
    const url = smsMediaFetchUrl(item?.url);
    if (!contentType || !url || (size != null && size > SMS_MEDIA_MAX_BYTES)) {
      placeholders.push({ status: "unavailable", content_type: contentType, byte_size: size });
    } else {
      placeholders.push({ status: "pending", content_type: contentType, byte_size: size, external_url: url, attempts: 0 });
    }
  }
  return placeholders;
}
function isPrivateSmsFileUri(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096
    && ![...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
    && (value.startsWith("private/") || value.startsWith("private://")
      || /^mp\/private\/[a-f0-9]{24}\/[^?#]+$/.test(value));
}
function smsMediaFileName(rowId, index, contentType) {
  const subtype = String(contentType || "").split("/")[1] || "bin";
  const extension = subtype.replace(/^x-/, "").replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const id = String(rowId || "message").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "message";
  return `mms-${id}-${Number(index) || 0}.${extension}`;
}
// <<<END SHARED HELPER: smsMedia>>>

/**
 * getSmsMediaUrl — a 60-second link to one MMS attachment the caller may read.
 *
 * An inbound attachment is copied into PRIVATE storage by copyInboundSmsMedia,
 * so the thread can show it only through a short-lived signed URL, and minting
 * one is a service-role act. This broker mints it for exactly the person the
 * text belongs to and nobody else:
 *   - the caller is the authenticated session (the body names only the message
 *     and the attachment's index, nothing about who is asking);
 *   - the row is theirs: its nurse_email or sent_by is the caller's address —
 *     the same rows SmsMessage's read rule shows them;
 *   - they still hold an active membership in the agency the row was stamped
 *     with (a person who left the agency keeps no reach to its patients'
 *     pictures through an old thread);
 *   - the attachment was copied ('stored', a private file URI).
 * Anything else is a 404, so a guessed id cannot probe another person's rows.
 * The built-in admin's wider SmsMessage read is deliberately NOT extended here.
 */

const exactId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !value.startsWith('$');
const normalizeMediaEmail = (value) => String(value || '').trim().toLowerCase();
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const SIGNED_URL_SECONDS = 60;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (!user?.id || !user?.email) return json({ error: 'Unauthorized' }, 401);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true) return json({ error: 'Forbidden' }, 403);
    const email = normalizeMediaEmail(user.email);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => key !== 'message_id' && key !== 'index')
      || !exactId(body.message_id) || !Number.isSafeInteger(body.index)
      || body.index < 0 || body.index >= SMS_MEDIA_LIMIT) {
      return json({ error: 'message_id and index are required.' }, 400);
    }

    const notFound = () => json({ error: 'Attachment not found' }, 404);
    const entities = base44.asServiceRole.entities;
    const rows = await entities.SmsMessage.filter({ id: body.message_id }, undefined, 2);
    const row = Array.isArray(rows) && rows.length === 1 && rows[0]?.id === body.message_id ? rows[0] : null;
    if (!row || (normalizeMediaEmail(row.nurse_email) !== email && normalizeMediaEmail(row.sent_by) !== email)
      || !exactId(row.agency_id)) return notFound();

    const memberships = await entities.AgencyMembership.filter(
      { agency_id: row.agency_id, user_email_normalized: email, status: 'active' }, undefined, 2,
    );
    const member = Array.isArray(memberships) && memberships.some((membership) => membership?.agency_id === row.agency_id
      && normalizeMediaEmail(membership?.user_email_normalized) === email && membership?.status === 'active');
    if (!member) return notFound();

    const item = Array.isArray(row.media) ? row.media[body.index] : null;
    if (!item || item.status !== 'stored' || !isPrivateSmsFileUri(item.file_uri)) return notFound();

    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: item.file_uri, expires_in: SIGNED_URL_SECONDS,
    });
    let url;
    try { url = new URL(signed?.signed_url); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || url.username || url.password) {
      return json({ error: 'The attachment cannot be opened right now.' }, 503);
    }
    return json({
      success: true,
      url: url.toString(),
      content_type: smsMediaContentType(item.content_type),
      expires_in: SIGNED_URL_SECONDS,
    });
  } catch {
    // Errors can echo a file URI; never log them.
    console.error('getSmsMediaUrl failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
