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

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


/**
 * getCommsDashboard — admin-only aggregation for the Communications Dashboard.
 *
 * Reads recent SmsMessage / CallLog / FaxLog rows via asServiceRole, computes a
 * compact, PHI-free summary (the same shape as the src/components/admin/
 * commsDashboard.js `summarizeComms` util — kept in sync, inlined here because a
 * single-file Deno deploy can't import from src/), plus a short recent-failures
 * list and per-number outbound activity.
 *
 * Never returns message bodies or any PHI — only counts, statuses, numbers,
 * failure reasons, and timestamps.
 */

const isAdminLike = (u) =>
  !!u &&
  (u.role === 'admin' ||
    u.account_type === 'agency_admin' ||
    u.account_type === 'super_admin');

const round = (n) => Math.round(n);
const MISSED_CALL_STATUSES = new Set(['failed', 'no_answer', 'busy', 'canceled', 'cancelled']);

function rate(delivered, outbound) {
  if (!outbound || outbound <= 0) return 0;
  return round((delivered / outbound) * 100);
}

function localDayKey(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lastSevenDayKeys(now) {
  const keys = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    keys.push(localDayKey(d));
  }
  return keys;
}

function summarize(messages, calls, faxes, now) {
  const msgs = Array.isArray(messages) ? messages : [];
  const callRows = Array.isArray(calls) ? calls : [];
  const faxRows = Array.isArray(faxes) ? faxes : [];

  const smsOutbound = msgs.filter((m) => m.direction === 'outbound');
  const smsInbound = msgs.filter((m) => m.direction === 'inbound');
  const smsDelivered = msgs.filter((m) => m.status === 'delivered');
  const smsFailed = msgs.filter((m) => m.status === 'failed');
  const sms = {
    total: msgs.length,
    inbound: smsInbound.length,
    outbound: smsOutbound.length,
    delivered: smsDelivered.length,
    failed: smsFailed.length,
    delivery_rate: rate(smsDelivered.length, smsOutbound.length),
  };

  const callsInbound = callRows.filter((c) => c.direction === 'inbound');
  const callsOutbound = callRows.filter((c) => c.direction === 'outbound');
  const callsCompleted = callRows.filter((c) => c.status === 'completed');
  const callsFailed = callRows.filter((c) => c.status === 'failed');
  const callsMissed = callRows.filter(
    (c) =>
      c.direction === 'inbound' &&
      (c.has_voicemail === true || MISSED_CALL_STATUSES.has(c.status)),
  );
  const voicemailBacklog = callRows.filter((c) => c.has_voicemail === true);
  const durations = callRows
    .map((c) => Number(c.duration_seconds))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgDuration = durations.length
    ? round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const callsSummary = {
    total: callRows.length,
    inbound: callsInbound.length,
    outbound: callsOutbound.length,
    completed: callsCompleted.length,
    failed: callsFailed.length,
    missed: callsMissed.length,
    voicemail_backlog: voicemailBacklog.length,
    avg_duration_secs: avgDuration,
  };

  const faxDelivered = faxRows.filter((f) => f.status === 'delivered');
  const faxFailed = faxRows.filter((f) => f.status === 'failed');
  const fax = {
    total: faxRows.length,
    delivered: faxDelivered.length,
    failed: faxFailed.length,
    delivery_rate: rate(faxDelivered.length, faxRows.length),
  };

  const dayKeys = lastSevenDayKeys(now);
  const dayIndex = {};
  for (const k of dayKeys) dayIndex[k] = { date: k, sms: 0, calls: 0, faxes: 0 };
  const bump = (rows, field) => {
    for (const r of rows) {
      const key = localDayKey(r.created_date);
      if (key && dayIndex[key]) dayIndex[key][field] += 1;
    }
  };
  bump(msgs, 'sms');
  bump(callRows, 'calls');
  bump(faxRows, 'faxes');
  const daily = dayKeys.map((k) => dayIndex[k]);

  return { sms, calls: callsSummary, fax, daily };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }
    // (TypeScript annotations stripped below for plain-JS Deno compliance.)

    // Pull recent rows (newest first), then restrict to the last ~30 days.
    const [messages, calls, faxes, users] = await Promise.all([
      base44.asServiceRole.entities.SmsMessage.list('-created_date', 1000).catch(() => []),
      base44.asServiceRole.entities.CallLog.list('-created_date', 1000).catch(() => []),
      base44.asServiceRole.entities.FaxLog.list('-created_date', 1000).catch(() => []),
      base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []),
    ]);

    // Agency-scoped admins (agency_admin, or role:admin with an agency) only
    // see comms from staff in their agency (parity with getDashboardData).
    // Platform-wide: super_admin, or role:admin without agency_name.
    let agencyEmails = null;
    const isAgencyScoped = user.account_type !== 'super_admin'
      && user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (isAgencyScoped) {
      agencyEmails = new Set(
        (users || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
    }
    const inAgency = (row) => {
      if (!agencyEmails) return true;
      const owner = row.nurse_email || row.sent_by || row.created_by || row.host_email;
      return owner && agencyEmails.has(owner);
    };

    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).getTime();
    const inWindow = (row) => {
      const t = new Date(row.created_date).getTime();
      return Number.isFinite(t) ? t >= cutoff : true;
    };
    const recentMessages = (messages || []).filter(inWindow).filter(inAgency);
    const recentCalls = (calls || []).filter(inWindow).filter(inAgency);
    const recentFaxes = (faxes || []).filter(inWindow).filter(inAgency);

    const summary = summarize(recentMessages, recentCalls, recentFaxes, now);

    // Map work numbers -> user full names (digits-only, last 10 for matching).
    const last10 = (v) => String(v || '').replace(/[^\d]/g, '').slice(-10);
    const nameByNumber = {};
    const nameByEmail = {};
    for (const u of users || []) {
      if (u.email) nameByEmail[u.email] = u.full_name || u.email;
      const key = last10(u.work_phone_number);
      if (key.length === 10) nameByNumber[key] = u.full_name || u.email || '';
    }

    // ---- Recent failures (no message bodies) ----
    const failures = [];
    for (const m of recentMessages) {
      if (m.status === 'failed') {
        failures.push({
          type: 'sms',
          to: m.to_number || '',
          reason: m.failure_reason || 'Unknown',
          created_date: m.created_date,
        });
      }
    }
    for (const c of recentCalls) {
      if (c.status === 'failed') {
        failures.push({
          type: 'call',
          to: c.to_number || '',
          reason: 'Call failed',
          created_date: c.created_date,
        });
      }
    }
    for (const f of recentFaxes) {
      if (f.status === 'failed') {
        failures.push({
          type: 'fax',
          to: f.to_number || '',
          reason: f.failure_reason || 'Unknown',
          created_date: f.created_date,
        });
      }
    }
    failures.sort(
      (a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime(),
    );
    const failuresCapped = failures.slice(0, 25);

    // ---- Per-number outbound activity ----
    const perNumberMap = {};
    const ensure = (num) => {
      if (!perNumberMap[num]) perNumberMap[num] = { number: num, sms: 0, calls: 0 };
      return perNumberMap[num];
    };
    for (const m of recentMessages) {
      if (m.direction === 'outbound' && m.from_number) ensure(m.from_number).sms += 1;
    }
    for (const c of recentCalls) {
      if (c.direction === 'outbound' && c.from_number) ensure(c.from_number).calls += 1;
    }
    const per_number = Object.values(perNumberMap)
      .map((row) => ({
        ...row,
        user_full_name: nameByNumber[last10(row.number)] || '',
      }))
      .sort((a, b) => b.sms + b.calls - (a.sms + a.calls))
      .slice(0, 20);

    return Response.json({
      success: true,
      summary,
      failures: failuresCapped,
      per_number,
      generated_at: now.toISOString(),
    });
  } catch (error) {
    console.error('getCommsDashboard error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});