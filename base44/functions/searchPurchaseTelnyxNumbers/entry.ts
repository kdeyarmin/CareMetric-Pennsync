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

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>


/**
 * searchPurchaseTelnyxNumbers — admin-only. Search Telnyx for available local
 * phone numbers and order one straight into the local pool (PhoneNumber), so an
 * admin never has to leave the app to provision a line.
 *
 * Body: { action: 'search'|'purchase'|'provision_fax', ... }
 *   - search        { area_code?, country?, limit?, purpose? }
 *   - purchase      { e164, label?, purpose?, set_as_outbound_fax? }
 *   - provision_fax { e164?, set_as_outbound_fax? }
 *
 * `purpose` selects what the number is for and how it is wired at order time:
 *   - 'voice_sms' (default) — a nurse line. Search filters SMS+voice-capable
 *     numbers; purchase attaches the messaging profile + voice connection.
 *   - 'fax' — the single blind OUTBOUND fax line. Search filters fax-capable
 *     numbers; purchase attaches the Programmable Fax connection instead, and
 *     (unless set_as_outbound_fax === false) stores the number as
 *     AgencySettings.outbound_fax_number_e164, the technical from sendFax /
 *     sendBatchFax transmit with. Recipients never reply to it: outbound faxes
 *     are presented under the OFFICE fax number (office_fax_number_e164, the
 *     physical office machine), so fax-backs go straight to the office and the
 *     app expects no inbound faxes.
 *
 * `provision_fax` provisions fax capacity on a number the account ALREADY owns:
 * it looks the number up in Telnyx, re-points its connection at the Programmable
 * Fax connection, and stores it as the outbound fax line. Use it when the fax
 * line was purchased outside the app (or bought in-app before fax support).
 *
 * The purchased Telnyx phone-number id is stored in the existing
 * PhoneNumber.twilio_phone_number_sid field (kept as a provider-neutral
 * identifier column to avoid a live-data migration). That is the id of the
 * /v2/phone_numbers RESOURCE, looked up after the order — never the
 * number-order line id (phone_numbers[].id in the order) or the order id, which
 * PATCH /v2/phone_numbers/{id} rejects. It is left blank when the resource does
 * not exist yet; nothing reads it back for an API call (provision_fax and the
 * assignment checks look the number up by E.164).
 *
 * A Telnyx number order is ASYNCHRONOUS ("Track fulfillment through the order's
 * status"): status is pending|success|failure, and requirements_met is false
 * when Telnyx still needs regulatory documents. A purchase whose order is not
 * settled is recorded, because the number is being bought either way, but it
 * is reported as pending: the 10DLC campaign enrollment is skipped (with a
 * warning to enroll once active), a fax line is not made the outbound fax line
 * (that would replace a working line with one that cannot send), and the
 * assignment paths refuse the number until Telnyx reports it active. A failed
 * order records nothing.
 */

const REQUEST_TIMEOUT_MS = 15000;

function normalizeE164(raw) {
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

// <<<BEGIN SHARED HELPER: telnyxWorkLine — generated, edit base44/_shared/backendHelpers.mjs>>>
const TELNYX_NUMBER_LOOKUP_TIMEOUT_MS = 8000;
async function lookupTelnyxNumber(apiKey, e164) {
  const target = String(e164 || '');
  const digits = target.slice(1);
  if (!apiKey || target[0] !== '+' || !/^[0-9]{8,15}$/.test(digits)) return { ok: false, reason: 'invalid_request', status: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELNYX_NUMBER_LOOKUP_TIMEOUT_MS);
  try {
    const resp = await fetch('https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=' + digits, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, reason: 'http_' + resp.status, status: resp.status, body };
    if (!body || !Array.isArray(body.data)) return { ok: false, reason: 'malformed_response', status: resp.status };
    const matches = body.data.filter((row) => row && row.phone_number === target);
    if (matches.length > 1) return { ok: false, reason: 'ambiguous_response', status: resp.status };
    return { ok: true, status: resp.status, number: matches[0] || null };
  } catch {
    return { ok: false, reason: 'unreachable', status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// Decide whether a looked-up number is a working nurse line for these
// credentials. A PROBLEM is a line that would not carry the nurse's calls or
// texts, so it must not be handed out silently; a WARNING is something that
// could not be checked, which never blocks an assignment.
function assessTelnyxWorkLine(lookup, creds, e164) {
  const problems = [];
  const warnings = [];
  const result = (checked, number) => ({
    checked, problems, warnings,
    telnyxNumberId: number && typeof number.id === 'string' && number.id ? number.id : null,
    telnyxStatus: number && typeof number.status === 'string' ? number.status : null,
  });
  if (!lookup || lookup.ok !== true) {
    warnings.push(e164 + ' could not be checked with Telnyx (' + ((lookup && lookup.reason) || 'no response')
      + '), so its voice connection and messaging profile were not confirmed.');
    return result(false, null);
  }
  const number = lookup.number;
  if (!number) {
    problems.push(e164 + ' is not in your Telnyx account yet (or its number order has not completed).');
    return result(true, null);
  }
  const status = typeof number.status === 'string' ? number.status : 'unknown';
  if (status !== 'active') {
    problems.push(e164 + ' is "' + status + '" in Telnyx, not active, so it cannot carry calls or texts yet.');
  }
  const voice = creds && creds.voiceConnectionId;
  if (!voice) {
    warnings.push('No Voice connection id is saved in Telnyx Credentials, so ' + e164 + "'s call routing was not checked.");
  } else if (String(number.connection_id || '') !== voice) {
    problems.push(e164 + ' is on Telnyx connection "' + String(number.connection_id || 'none')
      + '", not the configured Voice connection "' + voice + '", so its calls will not reach PennSync.');
  }
  const profile = creds && creds.messagingProfileId;
  // A number on NO messaging profile cannot send a text at all: Telnyx refuses
  // the send as "not on a messaging profile". Said in those words, because
  // "profile none, not X" reads like a mismatch the admin can ignore.
  const noProfile = !number.messaging_profile_id;
  if (noProfile && profile) {
    problems.push(e164 + " is not on any messaging profile, so every text from it fails (Telnyx: 'not on a messaging profile')."
      + ' Add it to the configured Messaging Profile "' + profile + '" in Telnyx first.');
  } else if (noProfile) {
    warnings.push(e164 + " is not on any messaging profile, so every text from it will fail (Telnyx: 'not on a messaging profile'),"
      + ' and no Messaging Profile id is saved in Telnyx Credentials.');
  } else if (!profile) {
    warnings.push('No Messaging Profile id is saved in Telnyx Credentials, so ' + e164 + "'s texting was not checked.");
  } else if (number.messaging_profile_id === 'UNAVAILABLE') {
    warnings.push('Telnyx could not report ' + e164 + "'s messaging profile right now, so its texting was not checked.");
  } else if (String(number.messaging_profile_id || '') !== profile) {
    problems.push(e164 + ' is on messaging profile "' + String(number.messaging_profile_id || 'none')
      + '", not the configured Messaging Profile "' + profile + '", so its texts will not reach PennSync.');
  }
  return result(true, number);
}

// Is this US number on a 10DLC campaign (GET /v2/10dlc/phone_number_campaigns/
// {phoneNumber}; the spec answers a bare PhoneNumberCampaign with campaignId,
// tcrCampaignId, telnyxCampaignId and assignmentStatus)? Only ever WARNINGS:
// an unregistered number still carries calls, its texts are just likely to be
// carrier-filtered. Read-only; enrolment stays an explicit admin action.
async function telnyx10dlcWarnings(apiKey, e164, savedCampaignId) {
  const saved = String(savedCampaignId || '').trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELNYX_NUMBER_LOOKUP_TIMEOUT_MS);
  try {
    const resp = await fetch('https://api.telnyx.com/v2/10dlc/phone_number_campaigns/' + encodeURIComponent(e164), {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (resp.status === 404) {
      return [e164 + ' is not on any A2P 10DLC campaign' + (saved ? ' (the saved campaign is ' + saved + ')' : '')
        + ', so US carriers may filter its texts. Enroll it in the Telnyx portal.'];
    }
    const body = await resp.json().catch(() => null);
    const row = body && typeof body === 'object' && body.data && typeof body.data === 'object' ? body.data : body;
    if (!resp.ok || !row || typeof row !== 'object' || typeof row.campaignId !== 'string') {
      return [e164 + "'s A2P 10DLC campaign could not be checked (HTTP " + resp.status + ').'];
    }
    const ids = [row.campaignId, row.tcrCampaignId, row.telnyxCampaignId].filter((id) => typeof id === 'string' && id);
    if (saved && !ids.includes(saved)) {
      return [e164 + ' is on A2P 10DLC campaign ' + (row.tcrCampaignId || row.campaignId) + ', not the saved campaign '
        + saved + ', so its texts may be filtered under the wrong registration.'];
    }
    if (row.assignmentStatus && row.assignmentStatus !== 'ASSIGNED') {
      // PENDING_ASSIGNMENT is normal for a few days after enrolment: a warning, never a refusal.
      return [e164 + "'s A2P 10DLC assignment to campaign " + (row.tcrCampaignId || row.campaignId) + ' is '
        + row.assignmentStatus + ', so US carriers may filter its texts until it is ASSIGNED.'];
    }
    return [];
  } catch {
    return [e164 + "'s A2P 10DLC campaign could not be checked (Telnyx did not answer)."];
  } finally {
    clearTimeout(timer);
  }
}

// options.campaignId is the agency's saved A2P campaign (AgencySettings.a2p_campaign_id).
async function verifyTelnyxWorkLine(creds, e164, options = {}) {
  if (!creds || !creds.apiKey) {
    const why = creds && creds.readError ? 'the Telnyx credential store could not be read' : 'no Telnyx API key is configured';
    return { checked: false, problems: [], telnyxNumberId: null, telnyxStatus: null,
      warnings: [e164 + ' was not checked with Telnyx because ' + why + '.'] };
  }
  const lookup = await lookupTelnyxNumber(creds.apiKey, e164);
  const result = assessTelnyxWorkLine(lookup, creds, e164);
  // 10DLC registers US local long codes: only a +1, non-toll-free line that is
  // otherwise good is worth the extra read (toll-free has its own verification).
  const type = lookup.ok && lookup.number ? String(lookup.number.phone_number_type || '') : '';
  const tollFree = type === 'toll_free' || type === 'tollfree'
    || ['800', '833', '844', '855', '866', '877', '888'].includes(e164.slice(2, 5));
  if (result.checked && result.problems.length === 0 && e164.slice(0, 2) === '+1' && !tollFree) {
    result.warnings.push(...await telnyx10dlcWarnings(creds.apiKey, e164, options && options.campaignId));
  }
  return result;
}
// <<<END SHARED HELPER: telnyxWorkLine>>>


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

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

// Where a Telnyx number order stands for the one number this function orders.
// 'complete' needs BOTH the order and its line for this number to say success
// and no requirement left unmet; an order that does not report a status is not
// assumed complete. 'failed' is a definitive provider answer (nothing bought).
function numberOrderState(order, e164) {
  const lines = Array.isArray(order?.phone_numbers) ? order.phone_numbers : [];
  const line = lines.find((entry) => entry && entry.phone_number === e164) || null;
  const statuses = [order?.status, line?.status].filter((value) => typeof value === 'string' && value);
  const requirementsMet = !(order?.requirements_met === false || line?.requirements_met === false);
  const orderId = typeof order?.id === 'string' && order.id ? order.id : null;
  let state = 'pending';
  if (statuses.includes('failure')) state = 'failed';
  else if (statuses.length > 0 && statuses.every((value) => value === 'success') && requirementsMet) state = 'complete';
  return { state, orderId, requirementsMet, orderStatus: typeof order?.status === 'string' ? order.status : null };
}

// Most US local orders settle within seconds, so a pending order is re-read a
// bounded number of times (GET /v2/number_orders/{id}) before it is reported
// pending. Unmet requirements need documents, not time, so they are not polled.
const NUMBER_ORDER_SETTLE_DELAYS_MS = [750, 1500];

// Bounded, documented search-result details the admin UI can show. Every value
// is a short plain string from the provider; anything else is dropped.
function availableNumberDetails(raw) {
  const e164 = normalizeE164(raw?.phone_number);
  if (!e164) return null;
  const short = (value) => (typeof value === 'string' && value.trim() && value.length <= 120 ? value.trim() : null);
  const money = (value) => (typeof value === 'string' && /^\d{1,7}(\.\d{1,6})?$/.test(value.trim()) ? value.trim() : null);
  const regions = Array.isArray(raw?.region_information) ? raw.region_information : [];
  const region = (type) => short(regions.find((entry) => entry?.region_type === type)?.region_name);
  const cost = raw?.cost_information && typeof raw.cost_information === 'object' ? raw.cost_information : {};
  const features = Array.isArray(raw?.features)
    ? [...new Set(raw.features.map((feature) => short(feature?.name)).filter(Boolean))].slice(0, 12)
    : [];
  return {
    e164,
    locality: region('location'),
    rate_center: region('rate_center'),
    region: region('state'),
    monthly_cost: money(cost.monthly_cost),
    upfront_cost: money(cost.upfront_cost),
    currency: typeof cost.currency === 'string' && /^[A-Z]{3}$/.test(cost.currency) ? cost.currency : null,
    features,
    // Telnyx marks a result that is NOT an exact match for the search (e.g. a
    // neighbouring area code). Surfaced so the admin is not surprised by it.
    best_effort: raw?.best_effort === true,
  };
}

// Store `e164` as the outbound fax line on the caller's agency settings row
// (not newest-row-wins — multi-tenant must not overwrite another agency's line).
async function setOutboundFaxNumber(base44, e164, agencyName) {
  const row = await resolveAgencySettings(base44, agencyName);
  if (row?.id) {
    await base44.asServiceRole.entities.AgencySettings.update(row.id, { outbound_fax_number_e164: e164 });
  } else {
    const createPayload = { outbound_fax_number_e164: e164 };
    if (agencyName) createPayload.agency_code = agencyName;
    await base44.asServiceRole.entities.AgencySettings.create(createPayload);
  }
}

// <<<BEGIN SHARED HELPER: phoneInventoryCreation — generated, edit base44/_shared/backendHelpers.mjs>>>
async function createPhoneInventoryOnce(entities, input, prepare = null) {
  const key = String(input.e164 || '').replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(key)) throw new Error('Invalid phone inventory identity');
  const credentials = await entities.IntegrationSecret.filter({ provider: 'telnyx' }, undefined, 2);
  if (!Array.isArray(credentials) || credentials.length !== 1 || !credentials[0]?.id
    || credentials[0].provider !== 'telnyx' || credentials[0].is_active !== true
    || !credentials[0].updated_date) throw new Error('Phone inventory coordinator is unavailable');
  const anchor = credentials[0];
  const previous = anchor.phone_inventory_creation_claims;
  if (previous != null && (typeof previous !== 'object' || Array.isArray(previous))) throw new Error('Invalid inventory coordinator');
  const claims = previous || {};
  if (Object.hasOwn(claims, key) || Object.keys(claims).length >= 500) throw new Error('Phone inventory creation requires reconciliation');
  const token = crypto.randomUUID();
  const result = await entities.IntegrationSecret.updateMany({ id: anchor.id, provider: 'telnyx',
    is_active: true, updated_date: anchor.updated_date,
    ...(previous == null ? { $or: [{ phone_inventory_creation_claims: null },
      { phone_inventory_creation_claims: { $exists: false } }] } : { phone_inventory_creation_claims: previous }),
  }, { $set: { phone_inventory_creation_claims: { ...claims, [key]: token } } });
  if (result?.success !== true || result.updated !== 1 || result.has_more !== false) throw new Error('Phone inventory creation changed concurrently');
  const release = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rows = await entities.IntegrationSecret.filter({ id: anchor.id }, undefined, 2);
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].phone_inventory_creation_claims?.[key] !== token) return;
      const remaining = { ...rows[0].phone_inventory_creation_claims };
      delete remaining[key];
      const released = await entities.IntegrationSecret.updateMany({ id: anchor.id,
        updated_date: rows[0].updated_date, phone_inventory_creation_claims: rows[0].phone_inventory_creation_claims,
      }, { $set: { phone_inventory_creation_claims: remaining } });
      if (released?.success === true && released.updated === 1 && released.has_more === false) return;
    }
  };
  let createStarted = false;
  try {
    const owners = await entities.IntegrationSecret.filter({ id: anchor.id }, undefined, 2);
    if (!Array.isArray(owners) || owners.length !== 1 || owners[0].phone_inventory_creation_claims?.[key] !== token) {
      throw new Error('Phone inventory reservation was not confirmed');
    }
    const existing = await entities.PhoneNumber.filter({ e164: input.e164 }, undefined, 2);
    if (!Array.isArray(existing) || existing.length !== 0) throw new Error('Phone number is already recorded');
    createStarted = true;
    if (prepare) {
      try { input = { ...input, ...await prepare() }; }
      catch (error) { if (error?.inventoryCreationRejected === true) createStarted = false; throw error; }
    }
    try { await entities.PhoneNumber.create({ ...input, creation_claim_token: token }); } catch { /* Exact readback reconciles a lost acknowledgement. */ }
    const rows = await entities.PhoneNumber.filter({ e164: input.e164 }, undefined, 2);
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.id || rows[0].creation_claim_token !== token
      || Object.entries(input).some(([field, value]) => rows[0][field] !== value)) {
      throw new Error('Phone inventory creation requires reconciliation');
    }
    await release().catch(() => {});
    return rows[0];
  } catch (error) {
    // A missing/unknown create acknowledgement must never open a second create.
    if (!createStarted) await release().catch(() => {});
    throw error;
  }
}
// <<<END SHARED HELPER: phoneInventoryCreation>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    // Searches expose account inventory and purchases incur charges. The
    // protected built-in admin role plus configured owner email is the only
    // current authority; self-editable profile fields grant nothing.
    if (user.disabled === true || user.is_service === true || user.is_verified === false
      || !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Only the protected platform owner can manage numbers.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const purpose = body.purpose === 'fax' ? 'fax' : 'voice_sms';

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey, messagingProfileId, voiceConnectionId, faxConnectionId } = telnyxCreds;
    if (!apiKey) {
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, "API credentials") }, { status: 500 });
    }

    const authHeaders = { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' };

    const audit = (auditAction, entityId) =>
      base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: auditAction, entity_type: 'PhoneNumber', entity_id: entityId,
        status: 'success',
      }).catch(() => {});

    // Point an already-owned Telnyx number at the Programmable Fax connection
    // and (optionally) store it as the outbound fax line. Shared by the
    // 'provision_fax' action and a fax-purpose purchase of a number that's
    // already in the pool.
    async function provisionExistingFax(e164, { setAsOutboundFax }) {
      // Resolve the Telnyx phone-number id by looking the number up in the
      // account (authoritative — the locally stored id can be a number-ORDER id
      // from an old purchase, which the phone_numbers PATCH would reject).
      const poolRows = await base44.asServiceRole.entities.PhoneNumber.filter({ e164 }, undefined, 10);
      if (!Array.isArray(poolRows) || poolRows.length > 1 || poolRows.some((row) => row.e164 !== e164)) {
        return Response.json({ error: 'Fax inventory is ambiguous.' }, { status: 409 });
      }
      if (poolRows.some((row) => !['available', 'reserved'].includes(row.status) || row.assigned_to_email)) {
        return Response.json({ error: 'Release the nurse assignment before reserving this number for fax.' }, { status: 409 });
      }
      const holders = await base44.asServiceRole.entities.User.filter({ work_phone_number: e164 }, undefined, 2);
      if (!Array.isArray(holders) || holders.length !== 0) {
        return Response.json({ error: 'This number is assigned to a work-number user.' }, { status: 409 });
      }
      // The shared lookup sends the digits Telnyx's filter accepts; the old
      // inline copy URL-encoded the '+', which the filter answers with no rows.
      const lookup = await lookupTelnyxNumber(apiKey, e164);
      if (!lookup.ok) {
        const firstErr = Array.isArray(lookup.body?.errors) ? lookup.body.errors[0] : null;
        return Response.json({ error: 'Could not look the number up in Telnyx.', status: lookup.status, details: firstErr || lookup.reason }, { status: 502 });
      }
      const numberId = typeof lookup.number?.id === 'string' && lookup.number.id ? lookup.number.id : null;
      if (!numberId) {
        return Response.json({ error: `${e164} isn't in your Telnyx account. Purchase it first, then provision fax on it.` }, { status: 404 });
      }

      // Reserve inventory before changing provider routing. Assignment endpoints
      // conditionally claim only available rows, so a concurrent nurse claim wins
      // or this reservation wins; neither can overwrite the other.
      let poolRow = poolRows[0];
      if (poolRow) {
        const reserved = await base44.asServiceRole.entities.PhoneNumber.updateMany({
          id: poolRow.id, e164, status: poolRow.status,
          ...(poolRow.assigned_to_email == null ? { $or: [{ assigned_to_email: null }, { assigned_to_email: { $exists: false } }] }
            : { assigned_to_email: poolRow.assigned_to_email }),
        }, { $set: { status: 'reserved', assigned_to_email: '', twilio_phone_number_sid: numberId } });
        if (reserved?.success !== true || reserved.updated !== 1 || reserved.has_more !== false) {
          return Response.json({ error: 'Fax inventory changed; retry provisioning.' }, { status: 409 });
        }
      } else {
        poolRow = await createPhoneInventoryOnce(base44.asServiceRole.entities, {
          e164, status: 'reserved', label: 'Outbound fax line', twilio_phone_number_sid: numberId,
          notes: 'Existing Telnyx number reserved for dedicated fax use.',
        });
      }
      const confirmed = await base44.asServiceRole.entities.PhoneNumber.filter({ e164 }, undefined, 10);
      if (!Array.isArray(confirmed) || confirmed.length !== 1 || confirmed[0].id !== poolRow?.id
        || confirmed[0].e164 !== e164 || confirmed[0].status !== 'reserved' || confirmed[0].assigned_to_email) {
        return Response.json({ error: 'Fax reservation requires reconciliation.' }, { status: 409 });
      }
      const patch = await fetchJson(`${TELNYX_API_BASE}/phone_numbers/${encodeURIComponent(numberId)}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: faxConnectionId }),
      }).catch((err) => ({ ok: false, status: 0, data: { message: String(err?.message || err) } }));
      if (!patch.ok) {
        // A confirmed provider rejection cannot have changed routing. Restore
        // only our exact revision; an uncertain result or newer owner stays reserved.
        if ([400, 401, 403, 404, 405, 422, 429].includes(patch.status)
          && (!poolRows[0] || poolRows[0].status === 'available')) {
          await base44.asServiceRole.entities.PhoneNumber.updateMany({
            id: confirmed[0].id, e164, status: 'reserved', updated_date: confirmed[0].updated_date,
            ...(confirmed[0].assigned_to_email == null ? { $or: [{ assigned_to_email: null }, { assigned_to_email: { $exists: false } }] }
              : { assigned_to_email: confirmed[0].assigned_to_email }),
          }, { $set: { status: 'available', assigned_to_email: '' } });
        }
        const firstErr = Array.isArray(patch.data?.errors) ? patch.data.errors[0] : null;
        return Response.json({ error: 'Telnyx rejected the fax-connection update.', status: patch.status, details: firstErr || patch.data }, { status: 502 });
      }

      if (setAsOutboundFax) await setOutboundFaxNumber(base44, e164, user?.agency_name);
      await audit('fax_capacity_provisioned', poolRow.id);
      return Response.json({ success: true, e164, telnyx_number_id: numberId, fax_connection_id: faxConnectionId, outbound_fax_set: setAsOutboundFax });
    }

    if (action === 'search') {
      const country = String(body.country || 'US').toUpperCase();
      const areaCode = body.area_code ? String(body.area_code).replace(/[^\d]/g, '') : '';
      const limit = Math.min(Number(body.limit) || 20, 50);
      // Telnyx available-numbers search: filter on country + features + (optional)
      // national destination code (US area code). Feature set follows `purpose`:
      // fax lines need fax capability; nurse lines need SMS + voice.
      //
      // `filter` is a deepObject (explode) parameter whose `features` member is
      // an ARRAY. OpenAPI leaves an array inside a deepObject unspecified, and
      // the spec's own explicitly documented array filters use the repeated
      // bracket form ("Use repeated `filter[status][]` parameters"), so each
      // feature is sent as `filter[features][]=<name>`. filter[best_effort] is
      // deliberately left at Telnyx's default: its default is undocumented, and
      // a best-effort (non-exact) result is instead flagged per number below so
      // the admin can see it is outside the requested area code.
      const qs = new URLSearchParams();
      qs.set('filter[country_code]', country);
      qs.set('filter[phone_number_type]', 'local');
      if (purpose === 'fax') {
        qs.append('filter[features][]', 'fax');
      } else {
        qs.append('filter[features][]', 'sms');
        qs.append('filter[features][]', 'voice');
      }
      qs.set('filter[limit]', String(limit));
      if (areaCode) qs.set('filter[national_destination_code]', areaCode);
      const url = `${TELNYX_API_BASE}/available_phone_numbers?${qs.toString()}`;
      const res = await fetchJson(url, { method: 'GET', headers: authHeaders })
        .catch((err) => ({ ok: false, status: 0, data: { message: String(err?.message || err) } }));
      if (!res.ok) {
        return Response.json({ error: 'Telnyx number search failed.', status: res.status, details: res.data }, { status: 502 });
      }
      const list = Array.isArray(res.data?.data) ? res.data.data : [];
      const numbers = list.map(availableNumberDetails).filter(Boolean);
      return Response.json({ success: true, count: numbers.length, numbers, purpose });
    }

    if (action === 'purchase') {
      const e164 = normalizeE164(body.e164);
      if (!e164) return Response.json({ error: 'Enter a valid number to purchase.' }, { status: 400 });
      const setAsOutboundFax = purpose === 'fax' && body.set_as_outbound_fax !== false;
      if (purpose === 'fax' && !faxConnectionId) {
        return Response.json({ error: 'Add your Telnyx fax connection id first (Telnyx Credentials → Advanced) so the number can be wired for fax.' }, { status: 400 });
      }

      // Don't double-buy: if it's already in the pool, just report it — but a
      // fax-purpose "purchase" of an owned number still provisions fax on it,
      // so the admin's intent (make this my fax line) is honored either way.
      const existing = await base44.asServiceRole.entities.PhoneNumber.filter({ e164 }, undefined, 10);
      if (!Array.isArray(existing) || existing.length > 1 || existing.some((row) => row.e164 !== e164)) {
        return Response.json({ error: 'Number inventory is ambiguous.' }, { status: 409 });
      }
      if (existing.length > 0) {
        if (purpose === 'fax') return await provisionExistingFax(e164, { setAsOutboundFax });
        return Response.json({ success: true, already_in_pool: true, e164 });
      }

      // Create a Telnyx number order. Attach the connection matching the
      // purpose so the number is immediately usable: messaging profile + voice
      // connection for a nurse line, the Programmable Fax connection for the
      // office fax line.
      const orderBody = { phone_numbers: [{ phone_number: e164 }] };
      // A nurse line with no voice/messaging connection still ORDERS fine, but
      // it can't route calls/texts until wired. We allow the purchase (admins
      // may intentionally buy first, wire later) but return a warning so the UI
      // can tell them what's still needed rather than leaving a silent dud.
      const warnings = [];
      if (purpose === 'fax') {
        orderBody.connection_id = faxConnectionId;
      } else {
        if (messagingProfileId) orderBody.messaging_profile_id = messagingProfileId;
        else warnings.push('No Messaging Profile is set, so this number can\'t send texts yet — add the Messaging Profile ID in Telnyx Credentials.');
        if (voiceConnectionId) orderBody.connection_id = voiceConnectionId;
        else warnings.push('No Voice (Call Control) connection is set, so this number can\'t route calls yet — add the Voice connection ID in Telnyx Credentials.');
      }
      let telnyxNumberId = null;
      let order = { state: 'pending', orderId: null, requirementsMet: true, orderStatus: null };
      // The /v2/phone_numbers resource status, when the resource could be read.
      let numberStatus = null;
      const row = await createPhoneInventoryOnce(base44.asServiceRole.entities, { e164 }, async () => {
        const res = await fetchJson(`${TELNYX_API_BASE}/number_orders`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(orderBody),
        }).catch((err) => ({ ok: false, status: 0, data: { message: String(err?.message || err) } }));

        if (!res.ok) {
          const firstErr = Array.isArray(res.data?.errors) ? res.data.errors[0] : null;
          const error = new Error('Telnyx number purchase failed.');
          error.inventoryCreationRejected = [400, 401, 403, 404, 422, 429].includes(res.status);
          error.publicResponse = Response.json({ error: error.message, status: res.status, details: firstErr || res.data }, { status: 502 });
          throw error;
        }

        order = numberOrderState(res.data?.data, e164);
        for (const delay of NUMBER_ORDER_SETTLE_DELAYS_MS) {
          if (order.state !== 'pending' || !order.requirementsMet || !order.orderId) break;
          await new Promise((resolve) => setTimeout(resolve, delay));
          const reread = await fetchJson(`${TELNYX_API_BASE}/number_orders/${encodeURIComponent(order.orderId)}`, {
            method: 'GET', headers: authHeaders,
          }).catch(() => null);
          if (reread?.ok && reread.data?.data && typeof reread.data.data === 'object') {
            order = { ...numberOrderState(reread.data.data, e164), orderId: order.orderId };
          }
        }
        if (order.state === 'failed') {
          // A definitive provider answer: nothing was bought, so nothing is recorded.
          const error = new Error('Telnyx could not fulfil the number order.');
          error.inventoryCreationRejected = true;
          error.publicResponse = Response.json({
            error: `Telnyx could not fulfil the order for ${e164}, so nothing was purchased. Search again and pick another number.`,
            telnyx_order_id: order.orderId,
          }, { status: 502 });
          throw error;
        }

        // Resolve the phone-number RESOURCE id. The order's phone_numbers[].id is
        // a number-order line id and the order id is an order; neither is the id
        // PATCH /v2/phone_numbers/{id} takes. While the order is pending the
        // resource may not exist yet, which is not an error.
        const lookup = await lookupTelnyxNumber(apiKey, e164);
        if (lookup.ok && lookup.number) {
          telnyxNumberId = typeof lookup.number.id === 'string' && lookup.number.id ? lookup.number.id : null;
          numberStatus = typeof lookup.number.status === 'string' ? lookup.number.status : null;
        } else if (!lookup.ok) {
          warnings.push(`Purchased, but its Telnyx phone-number id could not be read (${lookup.reason}). It is left blank; the app looks the number up by its digits when it needs it.`);
        }
        const active = order.state === 'complete' && (numberStatus === null || numberStatus === 'active');
        const baseNote = purpose === 'fax'
          ? 'Purchased in-app via Telnyx numbers API (fax line — attached to the Programmable Fax connection)'
          : 'Purchased in-app via Telnyx numbers API';
        return {
          e164,
          label: typeof body.label === 'string' && body.label.trim()
            ? body.label.trim()
            : (purpose === 'fax' ? 'Outbound fax line' : ''),
          status: purpose === 'fax' ? 'reserved' : 'available',
          twilio_phone_number_sid: telnyxNumberId || '',
          notes: active ? baseNote
            : `${baseNote}. Not active at purchase (Telnyx order ${order.orderId || 'id unknown'}: ${numberStatus || order.orderStatus || 'status unknown'}${order.requirementsMet ? '' : ', requirements not met'}); it cannot be assigned until Telnyx activates it.`,
        };
      });
      const pending = !(order.state === 'complete' && (numberStatus === null || numberStatus === 'active'));
      if (pending) {
        warnings.push(order.requirementsMet
          ? `Telnyx is still activating ${e164} (order ${order.orderId || 'id unknown'}, status ${numberStatus || order.orderStatus || 'unknown'}). It is in the pool, but it can't be assigned until Telnyx reports it active — retry the assignment in a few minutes.`
          : `Telnyx needs regulatory requirements before it activates ${e164} (order ${order.orderId || 'id unknown'}) — complete them in the Telnyx portal. It can't be assigned until Telnyx reports it active.`);
      }

      // Never point the agency's outbound fax line at a number that cannot send
      // yet: that would replace a working line with a dead one.
      const outboundFaxSet = setAsOutboundFax && !pending;
      if (outboundFaxSet) await setOutboundFaxNumber(base44, e164, user?.agency_name);
      else if (setAsOutboundFax) {
        warnings.push(`${e164} was NOT made the outbound fax line yet, so faxes keep sending from the current line. Once Telnyx shows it Active, use "Provision fax" on it to switch.`);
      }

      // Auto-enroll a new SMS-capable line in the agency's approved A2P 10DLC
      // campaign (AgencySettings.a2p_campaign_id) so its texts are carrier-
      // registered from day one — an unregistered US 10DLC number is heavily
      // filtered. Fax lines don't text, so they skip this. A number Telnyx has
      // not activated is not enrolled yet. A failure here is a WARNING, not a
      // failed purchase: the number is owned either way and can be enrolled
      // manually in the Telnyx portal.
      let campaignAssigned = false;
      if (purpose !== 'fax') {
        const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
        const campaignId = String(agencySettings?.a2p_campaign_id || '').trim();
        if (!campaignId) {
          warnings.push('No A2P 10DLC campaign id is saved in Agency Settings, so this number was NOT campaign-registered — US carriers may filter its texts until you register it.');
        } else if (pending) {
          warnings.push(`${e164} was NOT enrolled in A2P campaign ${campaignId} yet because Telnyx has not activated it — enroll it in the Telnyx portal once it shows Active, or its texts may be carrier-filtered.`);
        } else {
          const assign = await fetchJson(`${TELNYX_API_BASE}/10dlc/phone_number_campaigns`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: e164, campaignId }),
          }).catch((err) => ({ ok: false, status: 0, data: { message: String(err?.message || err) } }));
          if (assign.ok) {
            campaignAssigned = true;
          } else {
            const firstErr = Array.isArray(assign.data?.errors) ? assign.data.errors[0] : null;
            warnings.push(`Purchased, but enrolling it in A2P campaign ${campaignId} failed (${firstErr?.detail || firstErr?.title || `HTTP ${assign.status}`}) — enroll it in the Telnyx portal or its texts may be carrier-filtered.`);
          }
        }
      }

      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: 'phone_number_purchased', entity_type: 'PhoneNumber', entity_id: row.id,
        details: { purpose, set_as_outbound_fax: outboundFaxSet, campaign_assigned: campaignAssigned, order_pending: pending }, status: 'success',
      }).catch(() => {});
      return Response.json({
        success: true, e164, id: row.id, telnyx_number_id: telnyxNumberId, telnyx_order_id: order.orderId,
        order_status: pending ? 'pending' : 'complete', telnyx_number_status: numberStatus, purpose,
        outbound_fax_set: outboundFaxSet, campaign_assigned: campaignAssigned, warnings,
      });
    }

    if (action === 'provision_fax') {
      // Default to the currently configured office fax number so "make my fax
      // line actually work" is a one-click action.
      let e164 = normalizeE164(body.e164);
      if (!e164 && !body.e164) {
        const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
        e164 = normalizeE164(agencySettings?.office_fax_number_e164);
      }
      if (!e164) return Response.json({ error: 'Enter a valid fax number to provision.' }, { status: 400 });
      if (!faxConnectionId) {
        return Response.json({ error: 'Add your Telnyx fax connection id first (Telnyx Credentials → Advanced) so the number can be wired for fax.' }, { status: 400 });
      }
      return await provisionExistingFax(e164, { setAsOutboundFax: body.set_as_outbound_fax !== false });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    if (error?.publicResponse instanceof Response) return error.publicResponse;
    console.error('searchPurchaseTelnyxNumbers error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
