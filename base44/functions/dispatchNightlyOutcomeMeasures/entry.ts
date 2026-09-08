import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

// Source deployment is harmless by default. The native workflow owns the
// schedule, but staging must explicitly set OUTCOME_PIPELINE_RELEASE=enabled-v1
// only after the hosted datastore/tenant evidence is reviewed.
const OUTCOME_DISPATCH_ENABLED =
  String(Deno.env.get('OUTCOME_PIPELINE_RELEASE') || '').trim() === 'enabled-v1';

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

const MAX_BODY_BYTES = 1_000;
const MAX_AGENCY_SCAN = 1_000;
const MAX_AGENCIES_PER_DISPATCH = 100;
const EXACT_ROW_LIMIT = 10;
const MAX_IDENTIFIER_LENGTH = 200;
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLICATION_MODE = 'single_run_record_gate_v1';

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value: unknown) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return null;
  return value;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

async function requireEmptyRequestBody(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  if (Object.keys(body).length !== 0) {
    throw new PublicError(400, 'Nightly dispatch does not accept caller-selected scope');
  }
}

async function loadScheduledAgencyIds(entities: Record<string, any>) {
  const ids = new Set<string>();
  for (const status of ENABLED_AGENCY_STATUSES) {
    const rows = requireRows(
      await entities.Agency.filter({ status }, undefined, MAX_AGENCY_SCAN),
      'Agency.filter',
    );
    if (rows.length >= MAX_AGENCY_SCAN) {
      throw new PublicError(409, 'Agency scan is incomplete');
    }
    for (const row of rows) {
      const id = exactIdentifier(row?.id);
      if (!id || row?.id !== id || row?.status !== status || ids.has(id)) {
        throw new PublicError(409, 'Agency scan scope could not be verified');
      }
      ids.add(id);
    }
  }
  if (ids.size > MAX_AGENCIES_PER_DISPATCH) {
    throw new PublicError(409, 'Agency set exceeds the synchronous outcome-dispatch safety cap');
  }
  return [...ids].sort();
}

async function requireExactEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT || rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency scope could not be revalidated');
  }
  if (rows.length !== 1 || !ENABLED_AGENCY_STATUSES.has(String(rows[0]?.status || ''))) {
    throw new PublicError(409, 'Agency became unavailable during nightly dispatch');
  }
}

function previousUtcDate(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayStart - DAY_MS).toISOString().slice(0, 10);
}

function resultPayload(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, any>;
    if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
      return record.data as Record<string, any>;
    }
    return record;
  }
  return {} as Record<string, any>;
}

function exactPublishedResult(data: Record<string, any>, request: Record<string, any>) {
  return data.success === true
    && data.agency_id === request.agency_id
    && data.period_type === request.period_type
    && data.period_start === request.period_start
    && data.period_end === request.period_end
    && data.publication_status === 'published'
    && data.publication_mode === PUBLICATION_MODE
    && !!exactIdentifier(data.outcome_computation_run_id)
    && !!exactIdentifier(data.outcome_computation_attempt_id);
}

function invocationFailure(error: unknown) {
  const record = error && typeof error === 'object' ? error as Record<string, any> : {};
  const status = Number(record.response?.status || record.status || 0);
  const data = resultPayload(record.response?.data || record.data || {});
  return { status, data };
}

function retryableFailure(status: number, data: Record<string, any>) {
  return data.retry_with_same_key === true
    || !Number.isFinite(status)
    || status === 0
    || status >= 500;
}

async function invokeOneAgency(
  base44: Record<string, any>,
  secret: string,
  request: Record<string, any>,
) {
  const dispatchProof = await createOutcomeDispatchProof(secret, request);
  const signedRequest = { ...request, dispatch_proof: dispatchProof };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await base44.asServiceRole.functions.invoke(
        'computeOutcomeMeasures',
        signedRequest,
      );
      const data = resultPayload(response);
      if (exactPublishedResult(data, request)) {
        return { success: true, idempotentReplay: data.idempotent_replay === true };
      }
      if (attempt === 1 && retryableFailure(Number(response?.status || 0), data)) continue;
      return { success: false, idempotentReplay: false };
    } catch (error) {
      const failure = invocationFailure(error);
      if (attempt === 1 && retryableFailure(failure.status, failure.data)) continue;
      return { success: false, idempotentReplay: false };
    }
  }
  return { success: false, idempotentReplay: false };
}

Deno.serve(async (req) => {
  if (!OUTCOME_DISPATCH_ENABLED) {
    return Response.json(
      { error: 'Nightly outcome dispatch is disabled pending hosted validation' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, user);
    if (authError) {
      authError.headers.set('Cache-Control', 'no-store');
      return authError;
    }
    if (isDeactivatedUser(user)) {
      const response = DEACTIVATED_USER_RESPONSE();
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    await requireEmptyRequestBody(req);

    const secret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
    if (!secret) throw new PublicError(500, 'Server scheduler secret is not configured');
    const entities = base44.asServiceRole.entities;
    const agencyIds = await loadScheduledAgencyIds(entities);
    const periodEnd = previousUtcDate();
    const requestBase = {
      period_type: 'daily',
      period_start: periodEnd,
      period_end: periodEnd,
      idempotency_key: `nightly-outcome-daily:${periodEnd}`,
    };

    let succeeded = 0;
    let idempotentReplays = 0;
    let failed = 0;
    for (const agencyId of agencyIds) {
      try {
        await requireExactEnabledAgency(entities, agencyId);
        const result = await invokeOneAgency(base44, secret, {
          agency_id: agencyId,
          ...requestBase,
        });
        if (result.success) {
          succeeded += 1;
          if (result.idempotentReplay) idempotentReplays += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }

    const summary = {
      success: failed === 0,
      period_type: requestBase.period_type,
      period_start: requestBase.period_start,
      period_end: requestBase.period_end,
      agencies_discovered: agencyIds.length,
      agencies_succeeded: succeeded,
      idempotent_replays: idempotentReplays,
      agencies_failed: failed,
    };
    return Response.json(summary, {
      status: failed === 0 ? 200 : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: {
            'Cache-Control': 'no-store',
            ...(error.status === 405 ? { Allow: 'POST' } : {}),
          },
        },
      );
    }
    console.error('dispatchNightlyOutcomeMeasures failed');
    return Response.json(
      { error: 'Nightly outcome dispatch failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
});
