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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: smsRowCas — generated, edit base44/_shared/backendHelpers.mjs>>>
const successfulSmsCas = (value) => !!value
  && typeof value === 'object'
  && !Array.isArray(value)
  && value.success === true
  && value.updated === 1
  && value.has_more === false;
function observedSmsField(field, value) {
  return value == null
    ? { $or: [{ [field]: { $exists: false } }, { [field]: null }] }
    : { [field]: value };
}
// <<<END SHARED HELPER: smsRowCas>>>

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
 * copyInboundSmsMedia — copies a patient's MMS attachments into private
 * storage. The "Copy Inbound SMS Media" workflow runs it every 5 minutes.
 *
 * handleTelnyxStatusWebhook records each inbound attachment as 'pending' with
 * Telnyx's media URL instead of downloading it, because Telnyx retries a
 * messaging webhook not answered within about two seconds and a retried
 * delivery must not store the text twice. Telnyx's OpenAPI spec does not say
 * how long that URL lives, so this copies it within minutes. Per row:
 *   - only an inbound row flagged media_pending, carrying the agency the
 *     webhook stamped, is touched; the row is claimed with a run token by ONE
 *     compare-and-set over the claim state this run read (and updated_date),
 *     so of overlapping runs exactly one wins it and copies each attachment
 *     (a claim older than CLAIM_TTL_MS is taken over the same way: its run
 *     died); the result is written back only while that claim is still ours;
 *   - each pending item is fetched from its https URL (redirects followed by
 *     hand, each hop re-checked; never past SMS_MEDIA_MAX_BYTES), uploaded with
 *     UploadPrivateFile, and stored as its private file_uri — the provider URL
 *     is then removed from the row;
 *   - an item that fails is retried on later runs, and after MAX_ATTEMPTS or
 *     MAX_AGE_MS becomes 'unavailable' (its URL removed too), so the nurse sees
 *     that an attachment could not be retrieved instead of nothing.
 * Nothing is sent anywhere. URLs, bytes and message text are never logged.
 */

const BATCH_LIMIT = 25;
const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const MEDIA_FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

async function readBoundedBody(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const whole = new Uint8Array(await response.arrayBuffer());
    return whole.byteLength <= maxBytes ? whole : null;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Fetch one attachment: https only, every redirect hop re-checked, bounded. */
async function downloadSmsMedia(rawUrl) {
  let url = smsMediaFetchUrl(rawUrl);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel?.().catch(() => {});
        let next = null;
        try { next = location ? new URL(location, url).toString() : null; } catch { next = null; }
        url = smsMediaFetchUrl(next);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        return { ok: false, permanent: response.status === 404 || response.status === 410 };
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > SMS_MEDIA_MAX_BYTES) {
        await response.body?.cancel?.().catch(() => {});
        return { ok: false, permanent: true };
      }
      const bytes = await readBoundedBody(response, SMS_MEDIA_MAX_BYTES);
      if (!bytes) return { ok: false, permanent: true };
      if (bytes.byteLength === 0) return { ok: false, permanent: false };
      return { ok: true, bytes, contentType: response.headers.get('content-type') };
    } catch {
      return { ok: false, permanent: false };
    } finally {
      clearTimeout(timer);
    }
  }
  // Too many redirects, or a hop to an address that may not be fetched.
  return { ok: false, permanent: true };
}

/** Copy one pending item. Returns the stored item, or null when it failed. */
async function copySmsMediaItem(base44, rowId, index, item) {
  const fetched = await downloadSmsMedia(item?.external_url);
  if (!fetched.ok) return { stored: null, permanent: fetched.permanent };
  const contentType = smsMediaContentType(item?.content_type) || smsMediaContentType(fetched.contentType);
  if (!contentType) return { stored: null, permanent: true };
  let upload;
  try {
    upload = await base44.asServiceRole.integrations.Core.UploadPrivateFile({
      file: new File([fetched.bytes], smsMediaFileName(rowId, index, contentType), { type: contentType }),
    });
  } catch {
    return { stored: null, permanent: false };
  }
  const fileUri = upload?.file_uri;
  if (!isPrivateSmsFileUri(fileUri)) return { stored: null, permanent: false };
  return {
    stored: { status: 'stored', content_type: contentType, byte_size: fetched.bytes.byteLength, file_uri: fileUri },
    permanent: false,
  };
}

const exactRowId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !value.startsWith('$');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    // Authorization: privileged cron job (service-role reads/writes, no end
    // user). Only admins or the configured scheduler secret may invoke it.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    const entities = base44.asServiceRole.entities;
    const runId = crypto.randomUUID();
    const now = Date.now();
    const result = { scanned: 0, copied: 0, unavailable: 0, still_pending: 0, skipped: 0 };

    let rows;
    try {
      rows = await entities.SmsMessage.filter({ direction: 'inbound', media_pending: true }, 'created_date', BATCH_LIMIT);
    } catch {
      return Response.json({ success: false, error: 'SMS store unavailable', ...result }, { status: 503 });
    }
    rows = Array.isArray(rows) ? rows : [];
    result.scanned = rows.length;

    for (const row of rows) {
      if (!row || !exactRowId(row.id) || row.direction !== 'inbound' || row.media_pending !== true
        || !Array.isArray(row.media) || !exactRowId(row.agency_id)) {
        result.skipped++;
        continue;
      }
      const claimedAtMs = Date.parse(row.media_claimed_at || '');
      if (row.media_claimed_by && Number.isFinite(claimedAtMs) && now - claimedAtMs < CLAIM_TTL_MS) {
        result.skipped++;
        continue;
      }
      // One compare-and-set over the claim state as listed: it lands only while
      // nobody has claimed (or re-claimed) the row since, so two overlapping
      // runs can never both upload the same attachment. Update-then-read-back
      // let each run read back its own token in turn and both proceed.
      if (typeof row.updated_date !== 'string' || !row.updated_date) {
        result.skipped++;
        continue;
      }
      const claimedAt = new Date().toISOString();
      const claim = await entities.SmsMessage.updateMany({
        id: row.id,
        direction: 'inbound',
        media_pending: true,
        updated_date: row.updated_date,
        $and: [
          observedSmsField('media_claimed_by', row.media_claimed_by),
          observedSmsField('media_claimed_at', row.media_claimed_at),
        ],
      }, { $set: { media_claimed_by: runId, media_claimed_at: claimedAt } }).catch(() => null);
      if (!successfulSmsCas(claim)) {
        result.skipped++;
        continue;
      }
      const check = await entities.SmsMessage.filter({ id: row.id }, undefined, 2).catch(() => []);
      const claimed = Array.isArray(check) && check.length === 1 ? check[0] : null;
      if (!claimed || claimed.id !== row.id || claimed.media_claimed_by !== runId
        || claimed.media_claimed_at !== claimedAt
        || claimed.media_pending !== true || !Array.isArray(claimed.media)) {
        result.skipped++;
        continue;
      }

      const createdMs = Date.parse(claimed.created_date || '');
      const tooOld = !Number.isFinite(createdMs) || now - createdMs > MAX_AGE_MS;
      const media = [];
      for (const [index, item] of claimed.media.slice(0, SMS_MEDIA_LIMIT).entries()) {
        if (item?.status !== 'pending') {
          media.push(item);
          continue;
        }
        const copied = tooOld ? { stored: null, permanent: true } : await copySmsMediaItem(base44, claimed.id, index, item);
        if (copied.stored) {
          media.push(copied.stored);
          result.copied++;
          continue;
        }
        const attempts = (Number(item.attempts) || 0) + 1;
        if (copied.permanent || attempts >= MAX_ATTEMPTS) {
          // Given up: the provider URL goes with it.
          media.push({ status: 'unavailable', content_type: item.content_type ?? null, byte_size: item.byte_size ?? null });
          result.unavailable++;
        } else {
          media.push({ ...item, attempts });
          result.still_pending++;
        }
      }
      // Written back only while the claim is still this run's: a run slow
      // enough for its claim to be taken over must not overwrite the newer
      // run's result (its copies are then simply not recorded).
      const written = await entities.SmsMessage.updateMany(
        { id: claimed.id, media_claimed_by: runId, media_claimed_at: claimedAt },
        { $set: {
          media,
          media_pending: media.some((item) => item?.status === 'pending'),
          media_claimed_by: null,
          media_claimed_at: null,
        } },
      ).catch(() => null);
      if (!successfulSmsCas(written)) console.error('copyInboundSmsMedia: row update failed');
    }

    return Response.json({ success: true, ...result, checked_at: new Date(now).toISOString() });
  } catch {
    // Errors can carry a media URL; never log them.
    console.error('copyInboundSmsMedia failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
