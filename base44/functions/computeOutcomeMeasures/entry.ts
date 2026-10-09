import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

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
// <<<BEGIN SHARED HELPER: outcomeDispatchProof — generated, edit base44/_shared/backendHelpers.mjs>>>
const OUTCOME_DISPATCH_PROOF_VERSION = 'outcome-dispatch-v1';
const OUTCOME_DISPATCH_PROOF_MAX_AGE_MS = 15 * 60 * 1000;
const OUTCOME_DISPATCH_PROOF_MAX_FUTURE_SKEW_MS = 60 * 1000;
function outcomeDispatchProofMessage(payload, proof) {
  return JSON.stringify([
    OUTCOME_DISPATCH_PROOF_VERSION,
    payload.agency_id,
    payload.period_type,
    payload.period_start,
    payload.period_end,
    payload.benchmark ?? null,
    payload.idempotency_key,
    proof.issued_at,
    proof.nonce,
  ]);
}
async function outcomeDispatchHmacHex(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
}
async function createOutcomeDispatchProof(secret, payload) {
  const proof = {
    version: OUTCOME_DISPATCH_PROOF_VERSION,
    issued_at: new Date().toISOString(),
    nonce: crypto.randomUUID(),
  };
  return {
    ...proof,
    signature: await outcomeDispatchHmacHex(
      secret,
      outcomeDispatchProofMessage(payload, proof),
    ),
  };
}
async function verifyOutcomeDispatchProof(secret, payload, proof, nowMs = Date.now()) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return false;
  const keys = Object.keys(proof).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['issued_at', 'nonce', 'signature', 'version'])) {
    return false;
  }
  if (proof.version !== OUTCOME_DISPATCH_PROOF_VERSION) return false;
  if (typeof proof.issued_at !== 'string' || typeof proof.nonce !== 'string' ||
      typeof proof.signature !== 'string') return false;
  const issuedAtMs = Date.parse(proof.issued_at);
  if (!Number.isFinite(issuedAtMs) || new Date(issuedAtMs).toISOString() !== proof.issued_at ||
      issuedAtMs > nowMs + OUTCOME_DISPATCH_PROOF_MAX_FUTURE_SKEW_MS ||
      nowMs - issuedAtMs > OUTCOME_DISPATCH_PROOF_MAX_AGE_MS ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(proof.nonce) ||
      !/^[0-9a-f]{64}$/.test(proof.signature)) return false;
  const expected = await outcomeDispatchHmacHex(
    secret,
    outcomeDispatchProofMessage(payload, proof),
  );
  return timingSafeEqualStr(proof.signature, expected);
}
// <<<END SHARED HELPER: outcomeDispatchProof>>>

/**
 * computeOutcomeMeasures — on-demand outcome recompute for ONE agency.
 *
 * Released by the owner on 2026-10-08 ("turn everything on"). This name used
 * to be the unscoped legacy worker; the computation itself now lives in
 * computeOutcomeMeasuresV2, which accepts only the server-held secret or a
 * short-lived capability signed by it. This endpoint is the browser-facing
 * door to that worker for the Outcome Measures section:
 *
 *   - authentication first, then the caller's authority for the NAMED agency
 *     from service-owned rows: the built-in administrator, or exactly one
 *     active AgencyMembership there whose tenant_role is agency_admin or
 *     manager (the same roles getPublishedOutcomeMeasures admits). Profile
 *     fields such as agency_id or account_type never authorize;
 *   - the agency must exist and be active or on trial;
 *   - only then is a one-agency, one-window capability signed with
 *     INTERNAL_FN_SECRET and the worker invoked. The capability covers the
 *     agency, the window and the idempotency key, so it cannot be replayed for
 *     another tenant or window.
 *
 * The idempotency key is per agency-day and window, so pressing Recompute
 * twice in a day replays the same publication instead of recomputing, and the
 * next day's request publishes fresh numbers.
 *
 * Body: { agency_id, period_type, period_start, period_end }
 */

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const MAX_BODY_BYTES = 2_000;
const MAX_WINDOW_DAYS = 400;
const OUTCOME_COMPUTE_ROLES = new Set(['agency_admin', 'manager']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const PERIOD_TYPES = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']);
const RESULT_FIELDS = [
  'success', 'agency_id', 'period_type', 'period_start', 'period_end',
  'idempotent_replay', 'outcome_computation_run_id', 'outcome_computation_attempt_id',
  'publication_status', 'publication_mode', 'skip_reasons',
];

class PublicError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    this.body = { error: message, ...extra };
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, {
  status,
  headers: { ...NO_STORE_HEADERS, ...headers },
});

function plainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

async function parseRequest(req: Request) {
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      throw new PublicError(413, 'Request body is too large');
    }
    body = JSON.parse(raw);
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  const allowed = new Set(['agency_id', 'period_type', 'period_start', 'period_end']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new PublicError(400, 'Request body contains unsupported fields');
  }
  const agencyId = claimIdentifier(body.agency_id) ? body.agency_id : null;
  const periodType = typeof body.period_type === 'string' && PERIOD_TYPES.has(body.period_type)
    ? body.period_type
    : null;
  const periodStart = exactDate(body.period_start);
  const periodEnd = exactDate(body.period_end);
  if (!agencyId) throw new PublicError(400, 'agency_id is required');
  if (!periodType) throw new PublicError(400, 'period_type is invalid');
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    throw new PublicError(400, 'period_start and period_end must be valid ordered YYYY-MM-DD dates');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (periodEnd > today) throw new PublicError(400, 'period_end cannot be in the future');
  const spanDays = (Date.parse(`${periodEnd}T00:00:00.000Z`) - Date.parse(`${periodStart}T00:00:00.000Z`)) / 86_400_000;
  if (spanDays > MAX_WINDOW_DAYS) throw new PublicError(400, `The window may span at most ${MAX_WINDOW_DAYS} days`);
  return { agencyId, periodType, periodStart, periodEnd, today };
}

async function authorizeAgency(entities: Record<string, any>, user: Record<string, any>, agencyId: string) {
  if (user.role === 'admin') return 'built_in_admin';
  const normalizedEmail = normalizeClaimEmail(user.email);
  if (!claimIdentifier(user.id) || !claimEmail(normalizedEmail)) throw new PublicError(403, 'Forbidden');
  const rows = await entities.AgencyMembership.filter({ user_id: user.id }, undefined, 101);
  if (!Array.isArray(rows) || rows.length > 100
    || rows.some((row) => !canonicalClaimMembership(row, user.id, normalizedEmail))
    || new Set(rows.map((row) => row.agency_id)).size !== rows.length) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  const selected = rows.filter((row) => row.agency_id === agencyId && row.status === 'active');
  if (selected.length !== 1) throw new PublicError(403, 'No active membership for agency');
  if (!OUTCOME_COMPUTE_ROLES.has(selected[0].tenant_role)) {
    throw new PublicError(403, 'Only an agency administrator or manager can recompute outcome measures');
  }
  return selected[0].tenant_role;
}

async function requireEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rows = await entities.Agency.filter({ id: agencyId }, undefined, 2);
  if (!Array.isArray(rows) || rows.length > 1 || rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query is ambiguous');
  }
  if (rows.length === 0 || !ENABLED_AGENCY_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
}

function workerPayload(value: unknown) {
  if (!plainObject(value)) return {};
  return plainObject(value.data) ? value.data : value;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return json({ error: 'Forbidden' }, 403);
    }

    const input = await parseRequest(req);
    const entities = base44.asServiceRole.entities;
    await authorizeAgency(entities, user, input.agencyId);
    await requireEnabledAgency(entities, input.agencyId);

    const secret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
    if (!secret) return json({ error: 'Outcome computation is not configured on this server' }, 503);
    const request = {
      agency_id: input.agencyId,
      period_type: input.periodType,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      idempotency_key: `on-demand-outcome:${input.today}:${input.periodType}:${input.periodStart}:${input.periodEnd}`,
    };
    const dispatchProof = await createOutcomeDispatchProof(secret, request);
    let data: Record<string, any>;
    try {
      data = workerPayload(await base44.asServiceRole.functions.invoke(
        'computeOutcomeMeasuresV2',
        { ...request, dispatch_proof: dispatchProof },
      ));
    } catch (error) {
      const record = plainObject(error) ? error : {};
      const response = plainObject(record.response) ? record.response : {};
      const status = Number(response.status || record.status || 0);
      const failure = workerPayload(response.data ?? record.data);
      const message = typeof failure.error === 'string' && failure.error ? failure.error : 'Outcome computation failed';
      return json({
        success: false,
        error: message,
        ...(failure.retry_with_same_key === true ? { retry: true } : {}),
      }, Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502);
    }
    if (data.success !== true || data.agency_id !== request.agency_id
      || data.period_start !== request.period_start || data.period_end !== request.period_end) {
      return json({ success: false, error: 'Outcome computation did not publish a result' }, 502);
    }
    return json(Object.fromEntries(RESULT_FIELDS.filter((key) => key in data).map((key) => [key, data[key]])));
  } catch (error) {
    if (error instanceof PublicError) return json(error.body, error.status);
    console.error('computeOutcomeMeasures failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
