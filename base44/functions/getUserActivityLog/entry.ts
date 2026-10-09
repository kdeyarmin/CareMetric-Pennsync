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
// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

/**
 * getUserActivityLog — the administrator's read of staff activity.
 *
 * Restored by the owner's 2026-10-08 decision. Two modes:
 *
 *   { mode: 'user', target_user_email, limit? }  (the default)
 *     ONE staff member's call log, texts (metadata only) and activity trail.
 *   { mode: 'report', days? }
 *     The activity trail for the caller's whole scope, plus the member list,
 *     for the User Activity Report and its Activity Log tab.
 *   { mode: 'phone', days? }
 *     Texting and calling metadata for the same scope, for the Phone & SMS
 *     Analytics panel: masked numbers, no bodies, consent status per scoped
 *     consent key under an opaque per-response label, and whether each member
 *     has a work number and a bridge cell (booleans, never the numbers).
 *
 * Who may ask, decided from protected sources only:
 *   - the built-in admin (Base44 role 'admin', which callers cannot set) reads
 *     platform-wide;
 *   - a service-owned agency administrator (one active AgencyMembership with
 *     tenant_role agency_admin, via withTrustedClaims) reads only the members
 *     of that agency: a target must hold an active membership there, and the
 *     report covers only rows whose user_email is such a member's;
 *   - everyone else is refused. The self-editable agency-name and
 *     account-type profile fields are never read as authority.
 *
 * Privacy: phone numbers are masked to the last four digits (a nurse's private
 * cell can be a real call endpoint), SMS bodies are never returned (only a
 * length), and activity `details` pass through a filter that keeps scalar
 * operational fields and drops identifying ones (patient ids and names,
 * endpoints, free text), matching how the trail is meant to be written.
 */

const USER_MODE_DEFAULT_LIMIT = 100;
const USER_MODE_MAX_LIMIT = 500;
const REPORT_ROW_LIMIT = 5000;
const MEMBER_SCAN_LIMIT = 5000;

function maskLast4(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/[^\d]/g, '');
  if (d.length < 4) return '••••';
  return `(•••) •••-${d.slice(-4)}`;
}

// Keys that identify a patient, a person or an endpoint, or carry free text.
// Mirrors the forbidden list in userActivityPhiMinimizationContract.test.js.
const IDENTIFYING_DETAIL_KEY = /(patient|mrn|name|email|phone|e164|number|cell|msisdn|displayed|thread|body|message|reason|note|query|filter|url|pdf|document|before|after|changes|address|dob|birth|ssn)/i;

/** Keep scalar, non-identifying detail fields; mask any number-ish string. */
function safeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const out = {};
  for (const [key, value] of Object.entries(details).slice(0, 50)) {
    if (IDENTIFYING_DETAIL_KEY.test(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string' && value.length <= 120) {
      out[key] = /\d{4,}/.test(value) && /phone|cell|number/i.test(key) ? maskLast4(value) : value;
    } else if (Array.isArray(value) && value.length <= 20 && value.every((item) => typeof item === 'string' && item.length <= 64)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

function activityRow(a) {
  return {
    id: a.id,
    created_date: a.created_date,
    user_email: a.user_email || null,
    user_name: a.user_name || null,
    action: a.action,
    entity_type: a.entity_type || null,
    entity_id: a.entity_id || null,
    status: a.status || null,
    page: a.page || null,
    device_type: a.device_type || null,
    details: safeDetails(a.details),
  };
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

/** The caller's read scope, or null when they may not read activity at all. */
function activityScope(user) {
  if (user.role === 'admin') return { platform: true, agencyId: null };
  const agencyId = String(user.agency_id || '');
  if (user.role === 'user' && user.account_type === 'agency_admin' && claimIdentifier(agencyId)) {
    return { platform: false, agencyId };
  }
  return null;
}

/** Active members of one agency, joined to their display names. */
async function agencyMembers(base44, agencyId, { coverage = false } = {}) {
  const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
    { agency_id: agencyId, status: 'active' }, undefined, MEMBER_SCAN_LIMIT + 1,
  );
  if (!Array.isArray(rows) || rows.length > MEMBER_SCAN_LIMIT) {
    throw new Error('MEMBER_SCAN_INCOMPLETE');
  }
  const members = rows.filter((row) => row?.agency_id === agencyId && row?.status === 'active'
    && claimEmail(row?.user_email_normalized));
  const ids = [...new Set(members.map((row) => row.user_id).filter(claimIdentifier))];
  const users = ids.length
    ? await base44.asServiceRole.entities.User.filter({ id: { $in: ids } }, undefined, ids.length + 1).catch(() => [])
    : [];
  const byId = new Map((Array.isArray(users) ? users : []).map((row) => [row.id, row]));
  return members.map((row) => ({
    id: row.user_id,
    email: row.user_email_normalized,
    full_name: byId.get(row.user_id)?.full_name || null,
    role: row.tenant_role,
    ...(coverage ? telecomCoverage(byId.get(row.user_id)) : {}),
  }));
}

/** Whether a profile is provisioned for calling: booleans only, never the numbers. */
function telecomCoverage(profile) {
  const dialable = (raw) => String(raw || '').replace(/[^\d]/g, '').length >= 10;
  return {
    has_work_number: dialable(profile?.work_phone_number),
    has_personal_cell: dialable(profile?.personal_cell_e164),
  };
}

const PHONE_ROW_LIMIT = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

function withinCutoff(row, cutoff, field = 'created_date') {
  if (cutoff === null) return true;
  const at = Date.parse(row?.[field] || row?.created_date || '');
  return Number.isFinite(at) && at >= cutoff;
}

function smsMetadata(m) {
  return {
    id: m.id,
    created_date: m.created_date,
    direction: m.direction,
    status: m.status,
    nurse_email: normalizeEmail(m.nurse_email) || null,
    from_masked: maskLast4(m.from_number),
    to_masked: maskLast4(m.to_number),
    body_length: m.body ? String(m.body).length : 0,
    patient_linked: !!m.patient_id,
  };
}

function callMetadata(c) {
  return {
    id: c.id,
    created_date: c.created_date,
    direction: c.direction,
    call_mode: c.call_mode,
    status: c.status,
    nurse_email: normalizeEmail(c.nurse_email) || null,
    duration_seconds: c.duration_seconds ?? null,
    disposition: c.disposition || null,
    has_voicemail: !!c.has_voicemail,
    from_masked: maskLast4(c.from_number),
    to_masked: maskLast4(c.to_number),
    displayed_masked: maskLast4(c.displayed_number),
  };
}

/**
 * Consent ledger rows with the scoped key (which embeds the phone number)
 * replaced by an opaque label that is only stable within this response, so
 * the panel can still take the latest status per key.
 */
function consentMetadata(rows) {
  const labels = new Map();
  return rows.map((row) => {
    const digits = String(row?.phone_e164 || '').replace(/[^\d]/g, '').slice(-10);
    const key = typeof row?.consent_key === 'string' && row.consent_key ? row.consent_key : `legacy:${digits}`;
    if (!labels.has(key)) labels.set(key, `k${labels.size + 1}`);
    return {
      consent_key: labels.get(key),
      consent_status: row?.consent_status === 'opted_in' || row?.consent_status === 'opted_out'
        ? row.consent_status
        : 'unknown',
      captured_at: row?.captured_at || null,
      created_date: row?.created_date || null,
    };
  });
}

/** Merge two row lists by id, keeping the first occurrence. */
function mergeById(...lists) {
  const seen = new Map();
  for (const list of lists) {
    for (const row of Array.isArray(list) ? list : []) {
      if (row?.id && !seen.has(row.id)) seen.set(row.id, row);
    }
  }
  return [...seen.values()].sort((a, b) => String(b?.created_date || '').localeCompare(String(a?.created_date || '')));
}

async function phoneReport(base44, scope, cutoff) {
  const entities = base44.asServiceRole.entities;
  let sms;
  let calls;
  let consents;
  let members;
  if (scope.platform) {
    [sms, calls, consents, members] = await Promise.all([
      entities.SmsMessage.list('-created_date', PHONE_ROW_LIMIT + 1),
      entities.CallLog.list('-created_date', PHONE_ROW_LIMIT + 1),
      entities.SmsConsent.list('-captured_at', PHONE_ROW_LIMIT + 1),
      entities.User.list(undefined, MEMBER_SCAN_LIMIT + 1),
    ]);
    if (!Array.isArray(members) || members.length > MEMBER_SCAN_LIMIT) throw new Error('MEMBER_SCAN_INCOMPLETE');
    members = members
      .filter((row) => claimEmail(normalizeEmail(row?.email)) && row?.is_service !== true)
      .map((row) => ({ id: row.id, email: normalizeEmail(row.email), full_name: row.full_name || null, role: null, ...telecomCoverage(row) }));
  } else {
    const agencyId = scope.agencyId;
    members = await agencyMembers(base44, agencyId, { coverage: true });
    const emails = members.map((member) => member.email);
    const memberEmails = new Set(emails);
    const byMember = (query) => (emails.length ? query : Promise.resolve([]));
    const [stampedSms, memberSms, memberCalls, agencyConsents] = await Promise.all([
      entities.SmsMessage.filter({ agency_id: agencyId }, '-created_date', PHONE_ROW_LIMIT + 1),
      byMember(entities.SmsMessage.filter({ nurse_email: { $in: emails } }, '-created_date', PHONE_ROW_LIMIT + 1)),
      byMember(entities.CallLog.filter({ nurse_email: { $in: emails } }, '-created_date', PHONE_ROW_LIMIT + 1)),
      entities.SmsConsent.filter({ agency_id: agencyId }, '-captured_at', PHONE_ROW_LIMIT + 1),
    ]);
    // A text stamped with an agency belongs to that agency only (a member of
    // two agencies texts from each one's line); an unstamped legacy row is
    // attributed by its member's address, as the per-user view does.
    sms = mergeById(stampedSms, memberSms).filter((row) => (row?.agency_id
      ? row.agency_id === agencyId
      : memberEmails.has(normalizeEmail(row?.nurse_email))));
    calls = (Array.isArray(memberCalls) ? memberCalls : [])
      .filter((row) => memberEmails.has(normalizeEmail(row?.nurse_email)));
    consents = (Array.isArray(agencyConsents) ? agencyConsents : [])
      .filter((row) => row?.agency_id === agencyId);
  }
  sms = Array.isArray(sms) ? sms : [];
  calls = Array.isArray(calls) ? calls : [];
  consents = Array.isArray(consents) ? consents : [];
  const truncated = sms.length > PHONE_ROW_LIMIT || calls.length > PHONE_ROW_LIMIT || consents.length > PHONE_ROW_LIMIT;
  return {
    truncated,
    texts: sms.slice(0, PHONE_ROW_LIMIT).filter((row) => withinCutoff(row, cutoff)).map(smsMetadata),
    calls: calls.slice(0, PHONE_ROW_LIMIT).filter((row) => withinCutoff(row, cutoff)).map(callMetadata),
    // The whole ledger (bounded) so the latest status per key is right; the
    // panel counts in-window changes from captured_at.
    consents: consentMetadata(consents.slice(0, PHONE_ROW_LIMIT)),
    members: members.map((member) => ({
      email: member.email,
      full_name: member.full_name,
      has_work_number: member.has_work_number === true,
      has_personal_cell: member.has_personal_cell === true,
    })),
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const scope = activityScope(user);
    if (!scope) {
      return Response.json({ error: 'Administrator access required.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === 'report' || body?.mode === 'phone' ? body.mode : 'user';

    if (mode === 'phone') {
      const days = body?.days == null || body.days === 'all' ? null : Number(body.days);
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
        return Response.json({ error: 'days must be a whole number between 1 and 3650, or omitted.' }, { status: 400 });
      }
      const cutoff = days === null ? null : Date.now() - days * DAY_MS;
      const report = await phoneReport(base44, scope, cutoff);
      return Response.json({
        success: true,
        scope: scope.platform ? 'platform' : 'agency',
        row_limit: PHONE_ROW_LIMIT,
        ...report,
        generated_at: new Date().toISOString(),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (mode === 'report') {
      const days = body?.days == null || body.days === 'all' ? null : Number(body.days);
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
        return Response.json({ error: 'days must be a whole number between 1 and 3650, or omitted.' }, { status: 400 });
      }
      const cutoff = days === null ? null : Date.now() - days * 24 * 60 * 60 * 1000;

      let rows;
      let members;
      if (scope.platform) {
        rows = await base44.asServiceRole.entities.UserActivity.list('-created_date', REPORT_ROW_LIMIT + 1);
        members = null;
      } else {
        members = await agencyMembers(base44, scope.agencyId);
        const emails = members.map((member) => member.email);
        rows = emails.length
          ? await base44.asServiceRole.entities.UserActivity.filter(
            { user_email: { $in: emails } }, '-created_date', REPORT_ROW_LIMIT + 1,
          )
          : [];
        // Defence in depth: keep only rows the store says belong to a member.
        const memberEmails = new Set(emails);
        rows = (Array.isArray(rows) ? rows : []).filter((row) => memberEmails.has(normalizeEmail(row?.user_email)));
      }
      rows = Array.isArray(rows) ? rows : [];
      const truncated = rows.length > REPORT_ROW_LIMIT;
      const activity = rows.slice(0, REPORT_ROW_LIMIT)
        .filter((row) => cutoff === null || Date.parse(row?.created_date || '') >= cutoff)
        .map(activityRow);
      if (!members) {
        const seen = new Map();
        for (const row of activity) {
          const email = normalizeEmail(row.user_email);
          if (email && !seen.has(email)) {
            seen.set(email, { id: email, email, full_name: row.user_name || null, role: null });
          }
        }
        members = [...seen.values()];
      }
      return Response.json({
        success: true,
        scope: scope.platform ? 'platform' : 'agency',
        truncated,
        row_limit: REPORT_ROW_LIMIT,
        members,
        activity,
        generated_at: new Date().toISOString(),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const targetEmail = normalizeEmail(body?.target_user_email);
    if (!targetEmail) return Response.json({ error: 'target_user_email is required.' }, { status: 400 });
    const requestedLimit = Number(body?.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, USER_MODE_MAX_LIMIT)
      : USER_MODE_DEFAULT_LIMIT;

    if (!scope.platform) {
      // The target must be an active member of the caller's own agency.
      const memberships = await base44.asServiceRole.entities.AgencyMembership.filter(
        { agency_id: scope.agencyId, user_email_normalized: targetEmail, status: 'active' }, undefined, 2,
      );
      const membership = Array.isArray(memberships) && memberships.length === 1 ? memberships[0] : null;
      if (!membership || membership.agency_id !== scope.agencyId
        || membership.user_email_normalized !== targetEmail || membership.status !== 'active') {
        return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
      }
    }

    const targets = await base44.asServiceRole.entities.User.filter({ email: targetEmail }, undefined, 2).catch(() => []);
    const target = Array.isArray(targets) && targets.length === 1 ? targets[0] : null;
    if (!target) return Response.json({ error: 'User not found.' }, { status: 404 });

    const [callRows, smsRows, activityRows] = await Promise.all([
      base44.asServiceRole.entities.CallLog.filter({ nurse_email: targetEmail }, '-created_date', limit).catch(() => []),
      base44.asServiceRole.entities.SmsMessage.filter({ nurse_email: targetEmail }, '-created_date', limit).catch(() => []),
      base44.asServiceRole.entities.UserActivity.filter({ user_email: targetEmail }, '-created_date', limit).catch(() => []),
    ]);

    const calls = (Array.isArray(callRows) ? callRows : []).map((c) => ({
      id: c.id,
      created_date: c.created_date,
      direction: c.direction,
      call_mode: c.call_mode,
      status: c.status,
      duration_seconds: c.duration_seconds ?? null,
      disposition: c.disposition || null,
      has_voicemail: !!c.has_voicemail,
      from_masked: maskLast4(c.from_number),
      to_masked: maskLast4(c.to_number),
      displayed_masked: maskLast4(c.displayed_number),
    }));

    const texts = (Array.isArray(smsRows) ? smsRows : []).map((m) => ({
      id: m.id,
      created_date: m.created_date,
      direction: m.direction,
      status: m.status,
      from_masked: maskLast4(m.from_number),
      to_masked: maskLast4(m.to_number),
      body_length: m.body ? String(m.body).length : 0,
    }));

    const activity = (Array.isArray(activityRows) ? activityRows : []).map(activityRow);

    return Response.json({
      success: true,
      user: {
        email: target.email,
        full_name: target.full_name || null,
        role: target.role || null,
        duty_status: target.duty_status || null,
        work_phone_masked: maskLast4(target.work_phone_number),
        personal_cell_masked: maskLast4(target.personal_cell_e164),
      },
      counts: { calls: calls.length, texts: texts.length, activity: activity.length },
      calls,
      texts,
      activity,
      generated_at: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Errors can echo row content; never log them.
    console.error('getUserActivityLog failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
