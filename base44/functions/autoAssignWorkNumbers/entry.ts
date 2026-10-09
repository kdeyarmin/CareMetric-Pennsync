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
 * autoAssignWorkNumbers — protected-owner-only bulk provisioning. Gives every
 * user who doesn't yet have a personal voice/SMS work number the next available
 * number from the pool, so an admin never has to assign them one at a time.
 *
 * Each user gets their OWN number for voice + SMS (the masking source of truth is
 * User.work_phone_number). Fax is intentionally NOT per-user — everyone faxes
 * from the single shared office fax number (see sendFax), so there's nothing to
 * provision here for fax.
 *
 * Body (all optional): {
 *   emails?: string[]        // limit to these users; default = all users missing a work number
 * }
 *
 * Mirrors the assign semantics of managePhoneNumberPool: marks the pool number
 * 'assigned', sets User.work_phone_number, defaults the user to off duty (so they
 * aren't bridged before they toggle on), and records the Telnyx number id.
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

const isBlank = (v) => v == null || String(v).trim() === '';

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

// Each pool number is checked with Telnyx (read-only) before it is handed out.
// A number that is not active or is wired to another connection/profile is
// SKIPPED and reported, and the run moves on to the next number. Checks are
// bounded per run; once a check cannot be made at all (Telnyx unreachable, no
// credentials) the rest of the run proceeds unchecked with one warning, rather
// than waiting out a timeout per number.
const MAX_LINE_CHECKS_PER_RUN = 25;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false
      || !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Only the protected platform owner can provision work numbers' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const onlyEmails = Array.isArray(body.emails)
      ? body.emails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
      : null;

    // Available pool numbers (FIFO by creation), and the set already in use so we
    // never hand out a number that's actually assigned on a User.
    const pool = await base44.asServiceRole.entities.PhoneNumber.filter({ status: 'available' }, 'created_date', 500).catch(() => []);
    const allUsers = await base44.asServiceRole.entities.User.list('full_name', 2000).catch(() => []);
    const inUse = new Set(
      allUsers.map((u) => normalizeE164(u.work_phone_number)).filter(Boolean),
    );
    // The office fax, outbound fax, and main office lines are reserved: they
    // can sit in the pool (e.g. bought in-app), but handing one to a nurse
    // would break fax transmission/masking or office call routing. Treat them
    // as in-use.
    const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
    for (const reserved of [
      agencySettings?.office_fax_number_e164,
      agencySettings?.outbound_fax_number_e164,
      agencySettings?.main_office_number_e164,
    ]) {
      const norm = normalizeE164(reserved);
      if (norm) inUse.add(norm);
    }

    // Candidate users: those missing a work number (optionally limited to `emails`).
    const candidates = allUsers.filter((u) => {
      if (!isBlank(u.work_phone_number)) return false;
      if (onlyEmails && !onlyEmails.includes(String(u.email || '').trim().toLowerCase())) return false;
      return true;
    });

    const assigned = [];
    const skippedNumbers = [];
    const warnings = new Set();
    const creds = candidates.length > 0 ? await resolveTelnyxCreds(base44) : null;
    let verifying = true;
    let lineChecksLeft = MAX_LINE_CHECKS_PER_RUN;
    let checkBudgetReached = false;
    let poolIdx = 0;
    for (const target of candidates) {
      // Re-read the user before assigning — a concurrent run (or a parallel
      // managePhoneNumberPool assign) may have filled work_phone_number already.
      // Only skip when the re-read succeeds AND shows a number; an empty filter
      // result must not starve every candidate (some stores ignore id filters).
      const freshUser = await base44.asServiceRole.entities.User
        .filter({ id: target.id }, undefined, 1).catch(() => []);
      if (freshUser[0] && !isBlank(freshUser[0].work_phone_number)) continue;

      // Find the next pool number that isn't already in use on a User.
      let chosen = null;
      while (poolIdx < pool.length) {
        const cand = pool[poolIdx];
        if (cand.status !== 'available') { poolIdx += 1; continue; }
        const e164 = normalizeE164(cand.e164);
        if (!e164 || inUse.has(e164)) { poolIdx += 1; continue; }
        if (!verifying) { poolIdx += 1; chosen = { row: cand, e164, telnyxNumberId: null }; break; }
        if (lineChecksLeft <= 0) { checkBudgetReached = true; break; }
        lineChecksLeft -= 1;
        poolIdx += 1;
        const check = await verifyTelnyxWorkLine(creds, e164, { campaignId: agencySettings?.a2p_campaign_id });
        if (check.problems.length > 0) {
          skippedNumbers.push({ e164, problems: check.problems });
          continue;
        }
        for (const warning of check.warnings) warnings.add(warning);
        if (!check.checked) {
          verifying = false;
          warnings.add('The remaining numbers in this run were assigned without a Telnyx check.');
        }
        chosen = { row: cand, e164, telnyxNumberId: check.telnyxNumberId };
        break;
      }
      if (!chosen) break; // pool exhausted (or this run's Telnyx check budget is spent)

      // Claim the pool row BEFORE writing the user so two concurrent bulk
      // assigns cannot hand the same E.164 to two nurses. Re-read to confirm
      // we still own the claim (loser sees the winner's assigned_to_email).
      try {
        const claim = await base44.asServiceRole.entities.PhoneNumber.updateMany({
          id: chosen.row.id, e164: chosen.row.e164, status: 'available',
        }, { $set: { status: 'assigned', assigned_to_email: target.email } });
        if (claim?.success !== true || claim.updated !== 1 || claim.has_more !== false) continue;
      } catch (err) {
        console.error('pool claim failed:', err?.message);
        continue;
      }
      const claimRows = await base44.asServiceRole.entities.PhoneNumber
        .filter({ id: chosen.row.id }, undefined, 1).catch(() => []);
      const claimed = claimRows.find((r) => r.id === chosen.row.id) || claimRows[0];
      if (!claimed || claimed.assigned_to_email !== target.email) {
        continue;
      }

      const update = {
        work_phone_number: chosen.e164,
        // The resource id Telnyx just reported beats a stored one, which can be
        // a number-ORDER id from an older purchase or blank if bought pending.
        twilio_phone_number_sid: chosen.telnyxNumberId || chosen.row.twilio_phone_number_sid || '',
      };
      if (target.duty_status === undefined || target.duty_status === null) update.duty_status = 'off_duty';
      const ok = await assignUserFromClaimedNumber(base44, chosen.row.id, target.id, target.email, update)
        .then(() => true).catch((err) => { console.error('work number assignment failed:', err?.message); return false; });
      if (!ok) {
        // The shared writer reconciles definite failures and retains unknown
        // writes; never release a newer claim or an unconfirmed assignment here.
        continue;
      }

      inUse.add(chosen.e164);
      assigned.push({ email: target.email, e164: chosen.e164 });
    }

    const poolRemaining = Math.max(0, pool.length - poolIdx);
    const unassignedRemaining = candidates.length - assigned.length;

    if (assigned.length > 0) {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: 'work_numbers_bulk_assigned',
        details: { count: assigned.length, timestamp: new Date().toISOString() },
        status: 'success',
      }).catch(() => {});
    }

    if (checkBudgetReached) {
      warnings.add(`Stopped after ${MAX_LINE_CHECKS_PER_RUN} Telnyx line checks this run — run Auto-assign again to continue.`);
    }
    let message = unassignedRemaining > 0
      ? `Assigned ${assigned.length}. ${unassignedRemaining} user(s) still need a number — add more to the pool.`
      : `Assigned ${assigned.length} work number(s).`;
    if (skippedNumbers.length > 0) {
      message += ` Skipped ${skippedNumbers.length} pool number(s) Telnyx reports as not ready (inactive, or on another voice connection or messaging profile).`;
    }

    return Response.json({
      success: true,
      assigned,
      assigned_count: assigned.length,
      users_still_unassigned: unassignedRemaining,
      pool_available_remaining: poolRemaining,
      skipped_numbers: skippedNumbers,
      warnings: [...warnings],
      message,
    });
  } catch (error) {
    console.error('autoAssignWorkNumbers error:', error?.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
