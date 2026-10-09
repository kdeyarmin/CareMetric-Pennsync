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

/**
 * managePhoneNumberPool — admin-only CRUD + assignment for the Telnyx number
 * pool (the PhoneNumber entity). One backend entry point keeps the pool inventory
 * and the actual masking mapping (User.work_phone_number) consistent, with the
 * same uniqueness rules as provisionNurseWorkNumber.
 *
 * Body: { action, ... }
 *   - 'add'     { e164, label?, twilio_phone_number_sid? } → add a number to the pool
 *   - 'remove'  { id }                                    → delete an AVAILABLE number
 *   - 'assign'  { id, target_user_email, personal_cell_e164? } → give a nurse this work number
 *   - 'release' { id }                                    → unassign (clears the nurse's work number)
 *
 * 'assign' first checks the line with Telnyx, read-only (verifyTelnyxWorkLine):
 * a number Telnyx reports as not active, or on another voice connection or
 * messaging profile than the saved credentials, is refused with the reasons; a
 * check that could not be made only adds a warning to the answer.
 *
 * The number itself is not PHI; the personal cell is masked to last-4 in audit.
 */

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

// <<<BEGIN SHARED HELPER: assignUserFromClaimedNumber — generated, edit base44/_shared/backendHelpers.mjs>>>
async function assignUserFromClaimedNumber(base44, poolId, targetId, targetEmail, patch) {
  const entities = base44.asServiceRole.entities;
  const claims = await entities.PhoneNumber.filter({ id: poolId }, undefined, 2);
  const claim = Array.isArray(claims) && claims.length === 1 ? claims[0] : null;
  if (!claim || claim.id !== poolId || claim.status !== 'assigned' || claim.assigned_to_email !== targetEmail
    || claim.e164 !== patch.work_phone_number || typeof claim.updated_date !== 'string') {
    throw new Error('Work-number claim requires reconciliation');
  }
  try {
    return await entities.User.update(targetId, patch);
  } catch {
    let users;
    try { users = await entities.User.filter({ id: targetId }, undefined, 2); }
    catch { throw new Error('Work-number assignment requires reconciliation'); }
    if (!Array.isArray(users) || users.length !== 1 || users[0]?.id !== targetId) {
      throw new Error('Work-number assignment requires reconciliation');
    }
    if (Object.entries(patch).every(([key, value]) => users[0][key] === value)) return users[0];
    if (users[0].work_phone_number !== patch.work_phone_number) {
      await entities.PhoneNumber.updateMany({ id: poolId, e164: claim.e164, status: 'assigned',
        assigned_to_email: targetEmail, updated_date: claim.updated_date },
      { $set: { status: 'available', assigned_to_email: '' } });
    }
    throw new Error('Work-number assignment was not confirmed');
  }
}
// <<<END SHARED HELPER: assignUserFromClaimedNumber>>>

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false
      || !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Only the protected platform owner can manage the number pool.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const audit = (action2, entityId) =>
      base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: action2, entity_type: 'PhoneNumber', entity_id: entityId,
        status: 'success',
      }).catch((err) => console.error('audit failed:', err));

    if (action === 'add') {
      const e164 = normalizeE164(body.e164);
      if (!e164) return Response.json({ error: 'Enter a valid phone number.' }, { status: 400 });
      const existing = await base44.asServiceRole.entities.PhoneNumber.filter({ e164 }, undefined, 2);
      if (existing.length > 0) {
        return Response.json({ error: `${e164} is already in the pool.` }, { status: 409 });
      }
      // Reflect reality: if a nurse already holds this number, mark it assigned.
      const holders = await base44.asServiceRole.entities.User.filter({ work_phone_number: e164 }, undefined, 2);
      if (!Array.isArray(holders) || holders.length > 1) return Response.json({ error: 'Number ownership is ambiguous.' }, { status: 409 });
      const holder = holders[0];
      const row = await createPhoneInventoryOnce(base44.asServiceRole.entities, {
        e164,
        label: typeof body.label === 'string' ? body.label.trim() : '',
        twilio_phone_number_sid: body.twilio_phone_number_sid || '',
        status: holder ? 'assigned' : 'available',
        assigned_to_email: holder ? holder.email : '',
      });
      await audit('phone_number_added', row.id);
      return Response.json({ success: true, id: row.id, e164, status: row.status });
    }

    if (action === 'remove') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'Missing number id.' }, { status: 400 });
      const rows = await base44.asServiceRole.entities.PhoneNumber.filter({ id }, undefined, 5000).catch(() => []);
      const row = rows[0];
      if (!row) return Response.json({ error: 'Number not found.' }, { status: 404 });
      if (row.status === 'reserved') return Response.json({ error: 'Reserved office/fax inventory cannot be removed.' }, { status: 409 });
      if (row.status === 'assigned') {
        return Response.json({ error: 'Release this number from its nurse before removing it.' }, { status: 409 });
      }
      const removed = await base44.asServiceRole.entities.PhoneNumber.deleteMany({ id, e164: row.e164, status: 'available' });
      if (removed?.success !== true || removed.deleted !== 1) {
        return Response.json({ error: 'Number inventory changed; removal was not confirmed.' }, { status: 409 });
      }
      await audit('phone_number_removed', row.id);
      return Response.json({ success: true });
    }

    if (action === 'assign') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'Missing number id.' }, { status: 400 });
      const targetEmail = String(body.target_user_email || '').trim();
      if (!targetEmail) return Response.json({ error: 'Choose a nurse to assign.' }, { status: 400 });

      const rows = await base44.asServiceRole.entities.PhoneNumber.filter({ id }, undefined, 5000).catch(() => []);
      const row = rows[0];
      if (!row) return Response.json({ error: 'Number not found.' }, { status: 404 });
      if (row.status === 'reserved') return Response.json({ error: 'Reserved office/fax inventory cannot be assigned.' }, { status: 409 });
      if (row.status !== 'available') return Response.json({ error: 'Release the current assignment before assigning this number.' }, { status: 409 });
      const e164 = normalizeE164(row.e164);
      if (!e164) return Response.json({ error: 'Pool number is malformed.' }, { status: 400 });

      // The office fax, outbound fax, and main office lines are reserved:
      // handing one to a nurse would break fax transmission/masking or office
      // call routing.
      const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
      const reserved = [
        normalizeE164(agencySettings?.office_fax_number_e164),
        normalizeE164(agencySettings?.outbound_fax_number_e164),
        normalizeE164(agencySettings?.main_office_number_e164),
      ].filter(Boolean);
      if (reserved.includes(e164)) {
        return Response.json({ error: `${e164} is a reserved office/fax line — it can't be a personal work number.` }, { status: 409 });
      }

      const cellNum = body.personal_cell_e164 ? normalizeE164(body.personal_cell_e164) : null;
      if (body.personal_cell_e164 && !cellNum) {
        return Response.json({ error: 'Invalid personal cell number.' }, { status: 400 });
      }

      const targets = await base44.asServiceRole.entities.User.filter({ email: targetEmail }, undefined, 5000).catch(() => []);
      const target = targets[0];
      if (!target) return Response.json({ error: 'Target nurse not found.' }, { status: 404 });

      // Work numbers must be unique across nurses.
      const holders = await base44.asServiceRole.entities.User.filter({ work_phone_number: e164 }, undefined, 5000).catch(() => []);
      const conflict = holders.find((u) => u.email !== targetEmail);
      if (conflict) {
        return Response.json({ error: `${e164} is already assigned to ${conflict.email}.` }, { status: 409 });
      }

      // Read-only Telnyx check before the claim (see provisionNurseWorkNumber):
      // a number that is not active or is wired to another connection/profile
      // is refused with the reasons; a check that could not be made only warns.
      const lineCheck = await verifyTelnyxWorkLine(await resolveTelnyxCreds(base44), e164,
        { campaignId: agencySettings?.a2p_campaign_id });
      if (lineCheck.problems.length > 0) {
        return Response.json({
          error: `${e164} is not ready to be a nurse line: ${lineCheck.problems.join(' ')}`,
          code: 'work_line_not_ready',
          problems: lineCheck.problems,
          warnings: lineCheck.warnings,
        }, { status: 409 });
      }

      const claim = await base44.asServiceRole.entities.PhoneNumber.updateMany({
        id, e164: row.e164, status: 'available',
      }, { $set: { status: 'assigned', assigned_to_email: targetEmail } });
      if (claim?.success !== true || claim.updated !== 1 || claim.has_more !== false) {
        return Response.json({ error: 'Number inventory changed; retry assignment.' }, { status: 409 });
      }
      // Update the nurse only after winning the inventory claim.
      const update = { work_phone_number: e164 };
      if (cellNum) update.personal_cell_e164 = cellNum;
      // Prefer the resource id Telnyx just reported over a stored one, which can
      // be a number-ORDER id from an older purchase or blank if bought pending.
      if (lineCheck.telnyxNumberId) update.twilio_phone_number_sid = lineCheck.telnyxNumberId;
      else if (row.twilio_phone_number_sid) update.twilio_phone_number_sid = row.twilio_phone_number_sid;
      if (target.duty_status === undefined || target.duty_status === null) update.duty_status = 'off_duty';
      await assignUserFromClaimedNumber(base44, id, target.id, targetEmail, update);

      // Free any OTHER pool entry this nurse used to hold, so one nurse maps to
      // one pool number.
      const priorRows = await base44.asServiceRole.entities.PhoneNumber.filter({ assigned_to_email: targetEmail }, undefined, 5000).catch(() => []);
      for (const pr of priorRows) {
        if (pr.status === 'reserved') continue;
        if (pr.id !== id) {
          await base44.asServiceRole.entities.PhoneNumber.updateMany({ id: pr.id, status: 'assigned', assigned_to_email: targetEmail },
            { $set: { status: 'available', assigned_to_email: '' } }).catch(() => {});
        }
      }
      await audit('phone_number_assigned', row.id);
      return Response.json({
        success: true, e164, target_user_email: targetEmail,
        line_verified: lineCheck.checked === true, warnings: lineCheck.warnings,
      });
    }

    if (action === 'release') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'Missing number id.' }, { status: 400 });
      const rows = await base44.asServiceRole.entities.PhoneNumber.filter({ id }, undefined, 5000).catch(() => []);
      const row = rows[0];
      if (!row) return Response.json({ error: 'Number not found.' }, { status: 404 });
      if (row.status === 'reserved') return Response.json({ error: 'Reserved office/fax inventory cannot be released.' }, { status: 409 });
      const e164 = normalizeE164(row.e164) || row.e164;

      // Clear the nurse's work number only if it still matches this pool number.
      if (row.assigned_to_email) {
        const targets = await base44.asServiceRole.entities.User.filter({ email: row.assigned_to_email }, undefined, 5000).catch(() => []);
        const target = targets[0];
        if (target && normalizeE164(target.work_phone_number) === e164) {
          await base44.asServiceRole.entities.User.update(target.id, { work_phone_number: '' }).catch(() => {});
        }
      }
      const released = await base44.asServiceRole.entities.PhoneNumber.updateMany({
        id, e164: row.e164, status: row.status,
        ...(row.assigned_to_email == null ? { $or: [{ assigned_to_email: null }, { assigned_to_email: { $exists: false } }] }
          : { assigned_to_email: row.assigned_to_email }),
      }, { $set: { status: 'available', assigned_to_email: '' } });
      if (released?.success !== true || released.updated !== 1 || released.has_more !== false) {
        return Response.json({ error: 'Number inventory changed; release was not confirmed.' }, { status: 409 });
      }
      await audit('phone_number_released', row.id);
      return Response.json({ success: true, e164 });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('managePhoneNumberPool error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
