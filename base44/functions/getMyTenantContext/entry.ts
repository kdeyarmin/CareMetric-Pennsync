import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Resolve one exact, current, server-owned tenant context.
 *
 * The caller may optionally bind an explicit selector choice to the observed
 * membership id/version. This is optimistic read binding only: every authority
 * and public Agency field is still re-read before a context is returned.
 */

const MAX_BODY_BYTES = 2_000;
const MAX_BODY_CHUNKS = 64;
const MEMBERSHIP_QUERY_LIMIT = 51;
const MAX_MEMBERSHIP_ROWS = 50;
const MAX_ACTIVE_MEMBERSHIPS = 25;
const AGENCY_EXACT_QUERY_LIMIT = 2;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_AGENCY_NAME_LENGTH = 200;
const MAX_REASON_LENGTH = 500;
const UNSAFE_AGENCY_NAME = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

const ACTIVE_AGENCY_STATUSES = new Set(['active', 'trial']);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const REQUEST_KEYS = new Set([
  'agency_id',
  'expected_membership_id',
  'expected_membership_version',
]);

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

function noStore(response: Response) {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (
    !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
  ) {
    return null;
  }
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (
    !normalized
    || normalized.length > 320
    || !normalized.includes('@')
    || /\s/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function canonicalInstant(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? value : null;
}

function exactReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  if (!reason || reason.length > MAX_REASON_LENGTH || reason !== value) return null;
  return reason;
}

function exactAgencyName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (
    !name
    || name.length > MAX_AGENCY_NAME_LENGTH
    || name !== value
    || UNSAFE_AGENCY_NAME.test(name)
  ) {
    return null;
  }
  return name;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, unknown>>;
}

function isProtectedPlatformOwner(user: Record<string, unknown>) {
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && user.role === 'admin'
    && canonicalEmail(user.email) === configuredEmail;
}

function callerSnapshot(user: Record<string, unknown>) {
  const userId = exactIdentifier(user.id);
  const userEmail = canonicalEmail(user.email);
  if (
    !userId
    || !userEmail
    || user.disabled === true
    || user.is_service === true
    || user.is_verified === false
  ) {
    throw new PublicError(403, 'Forbidden');
  }
  return {
    user_id: userId,
    user_email: userEmail,
    built_in_role: typeof user.role === 'string' ? user.role : null,
    is_active: !isDeactivatedUser(user),
    is_disabled: user.disabled === true,
    is_service: user.is_service === true,
    is_verified: user.is_verified !== false,
    is_platform_owner: isProtectedPlatformOwner(user),
  };
}

async function readBoundedBody(req: Request) {
  const statedLength = req.headers.get('content-length');
  if (statedLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(statedLength)) {
      throw new PublicError(400, 'Invalid Content-Length');
    }
    const contentLength = Number(statedLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new PublicError(400, 'Invalid Content-Length');
    }
    if (contentLength > MAX_BODY_BYTES) {
      throw new PublicError(413, 'Request body is too large');
    }
  }

  const reader = req.body?.getReader();
  if (!reader) throw new PublicError(400, 'Invalid JSON body');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let chunkCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new PublicError(400, 'Invalid request body');
      }
      chunkCount += 1;
      if (chunkCount > MAX_BODY_CHUNKS) {
        await reader.cancel().catch(() => {});
        throw new PublicError(413, 'Request body has too many chunks');
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new PublicError(413, 'Request body is too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(400, 'Invalid request body');
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PublicError(400, 'Invalid request body encoding');
  }
}

async function parseRequest(req: Request) {
  const raw = await readBoundedBody(req);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !REQUEST_KEYS.has(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }

  const hasAgencyId = Object.hasOwn(record, 'agency_id');
  const agencyId = hasAgencyId ? exactIdentifier(record.agency_id) : null;
  if (hasAgencyId && !agencyId) throw new PublicError(400, 'agency_id is invalid');

  const hasExpectedId = Object.hasOwn(record, 'expected_membership_id');
  const hasExpectedVersion = Object.hasOwn(record, 'expected_membership_version');
  if (hasExpectedId !== hasExpectedVersion) {
    throw new PublicError(400, 'Expected membership id and version must be provided together');
  }
  if ((hasExpectedId || hasExpectedVersion) && !agencyId) {
    throw new PublicError(400, 'agency_id is required for an expected membership');
  }

  let expectedMembership: Record<string, unknown> | null = null;
  if (hasExpectedId && hasExpectedVersion) {
    const membershipId = exactIdentifier(record.expected_membership_id);
    const membershipVersion = record.expected_membership_version;
    if (
      !membershipId
      || !Number.isSafeInteger(membershipVersion)
      || Number(membershipVersion) < 1
    ) {
      throw new PublicError(400, 'Expected membership identity is invalid');
    }
    expectedMembership = {
      id: membershipId,
      version: membershipVersion,
    };
  }

  return { agencyId, expectedMembership };
}

function validateMemberships(
  rawRows: Array<Record<string, unknown>>,
  userId: string,
  normalizedEmail: string,
) {
  if (rawRows.length > MAX_MEMBERSHIP_ROWS) {
    throw new PublicError(409, 'Tenant membership list exceeds bounded capacity');
  }
  if (rawRows.some((row) => !row || row.user_id !== userId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified');
  }

  const memberships: Array<Record<string, unknown>> = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  const agencyIds = new Set<string>();
  for (const row of rawRows) {
    const id = exactIdentifier(row.id);
    const agencyId = exactIdentifier(row.agency_id);
    const membershipKey = exactIdentifier(row.membership_key);
    const storedEmail = canonicalEmail(row.user_email_normalized);
    const tenantRole = typeof row.tenant_role === 'string' ? row.tenant_role : '';
    const status = typeof row.status === 'string' ? row.status : '';
    const invitationId = row.invitation_id == null
      ? null
      : exactIdentifier(row.invitation_id);
    const createdBy = exactIdentifier(row.created_by_user_id);
    const transitionedBy = exactIdentifier(row.last_transition_by_user_id);
    const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
    const transitionAt = canonicalInstant(row.last_transition_at);
    const transitionReason = exactReason(row.last_transition_reason);
    const activatedAt = row.activated_at == null ? null : canonicalInstant(row.activated_at);
    const revokedAt = row.revoked_at == null ? null : canonicalInstant(row.revoked_at);
    const revocationReason = row.revocation_reason == null
      ? null
      : exactReason(row.revocation_reason);

    if (
      !id
      || !agencyId
      || !membershipKey
      || !storedEmail
      || row.user_email_normalized !== storedEmail
      || storedEmail !== normalizedEmail
      || membershipKey !== `${agencyId}:${userId}`
      || !TENANT_ROLES.has(tenantRole)
      || !MEMBERSHIP_STATUSES.has(status)
      || !Number.isSafeInteger(row.version)
      || Number(row.version) < 1
      || (row.invitation_id != null && !invitationId)
      || !createdBy
      || !transitionedBy
      || !transitionEmail
      || row.last_transition_by_email_normalized !== transitionEmail
      || !transitionAt
      || !transitionReason
      || (row.activated_at != null && !activatedAt)
      || ((status === 'active' || status === 'suspended') && !activatedAt)
      || (status === 'pending' && row.activated_at != null)
      || (status === 'revoked' && (!revokedAt || !revocationReason))
      || (status !== 'revoked' && (row.revoked_at != null || row.revocation_reason != null))
    ) {
      throw new PublicError(409, 'Tenant membership integrity check failed');
    }
    if (ids.has(id) || keys.has(membershipKey) || agencyIds.has(agencyId)) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }

    ids.add(id);
    keys.add(membershipKey);
    agencyIds.add(agencyId);
    memberships.push({
      id,
      membership_key: membershipKey,
      agency_id: agencyId,
      user_id: userId,
      user_email_normalized: storedEmail,
      tenant_role: tenantRole,
      status,
      invitation_id: invitationId,
      created_by_user_id: createdBy,
      last_transition_by_user_id: transitionedBy,
      last_transition_by_email_normalized: transitionEmail,
      last_transition_at: transitionAt,
      last_transition_reason: transitionReason,
      activated_at: activatedAt,
      revoked_at: revokedAt,
      revocation_reason: revocationReason,
      version: row.version,
    });
  }

  memberships.sort((left, right) => {
    const leftKey = String(left.agency_id);
    const rightKey = String(right.agency_id);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (memberships.filter((row) => row.status === 'active').length > MAX_ACTIVE_MEMBERSHIPS) {
    throw new PublicError(409, 'Active tenant membership list exceeds bounded capacity');
  }
  return memberships;
}

async function loadMembershipSnapshot(
  entities: Record<string, any>,
  userId: string,
  normalizedEmail: string,
) {
  const rawRows = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId },
      'agency_id',
      MEMBERSHIP_QUERY_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  return validateMemberships(rawRows, userId, normalizedEmail);
}

async function loadExactAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter(
      { id: agencyId },
      undefined,
      AGENCY_EXACT_QUERY_LIMIT,
    ),
    'Agency.filter',
  );
  if (rows.length > 1) throw new PublicError(409, 'Agency is ambiguous');
  if (rows.length === 0) throw new PublicError(403, 'Agency is unavailable');
  const row = rows[0];
  if (!row || row.id !== agencyId) {
    throw new PublicError(409, 'Agency query scope could not be verified');
  }
  const id = exactIdentifier(row.id);
  const name = exactAgencyName(row.agency_name);
  const status = typeof row.status === 'string' ? row.status : '';
  if (!id || !name) throw new PublicError(409, 'Agency integrity check failed');
  if (!ACTIVE_AGENCY_STATUSES.has(status)) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return { id, name, status };
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireExpectedMembership(
  selected: Record<string, unknown>,
  expected: Record<string, unknown> | null,
) {
  if (!expected) return;
  if (selected.id !== expected.id || selected.version !== expected.version) {
    throw new PublicError(409, 'Selected tenant membership changed; refresh choices');
  }
}

async function recheckCaller(base44: Record<string, any>, expected: Record<string, unknown>) {
  const currentUser = await base44.auth.me().catch(() => null);
  if (!currentUser || isDeactivatedUser(currentUser)) {
    throw new PublicError(409, 'Caller identity changed during request');
  }
  let current;
  try {
    current = callerSnapshot(currentUser);
  } catch {
    throw new PublicError(409, 'Caller identity changed during request');
  }
  if (!sameValue(current, expected)) {
    throw new PublicError(409, 'Caller identity changed during request');
  }
}

function publicContext(
  caller: Record<string, unknown>,
  membership: Record<string, unknown> | null,
  agency: Record<string, unknown> | null,
) {
  if (!membership) {
    return {
      user_id: caller.user_id,
      user_email: caller.user_email,
      membership_id: null,
      membership_key: null,
      membership_version: null,
      agency_id: agency?.id ?? null,
      tenant_role: 'platform_owner',
      membership_status: null,
      is_platform_owner: true,
      agency,
    };
  }
  return {
    user_id: caller.user_id,
    user_email: caller.user_email,
    membership_id: membership.id,
    membership_key: membership.membership_key,
    membership_version: membership.version,
    agency_id: membership.agency_id,
    tenant_role: membership.tenant_role,
    membership_status: 'active',
    is_platform_owner: false,
    agency,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed' },
      405,
      { Allow: 'POST' },
    );
  }
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return noStore(DEACTIVATED_USER_RESPONSE());
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
    const caller = callerSnapshot(user);
    const input = await parseRequest(req);
    const entities = base44.asServiceRole.entities;

    const beforeMemberships = await loadMembershipSnapshot(
      entities,
      String(caller.user_id),
      String(caller.user_email),
    );

    if (caller.is_platform_owner) {
      if (beforeMemberships.length !== 0) {
        throw new PublicError(409, 'Platform owner tenant membership must not exist');
      }
      if (input.expectedMembership) {
        throw new PublicError(409, 'Platform owner cannot bind a tenant membership');
      }
      const beforeAgency = input.agencyId
        ? await loadExactAgency(entities, input.agencyId)
        : null;
      const afterMemberships = await loadMembershipSnapshot(
        entities,
        String(caller.user_id),
        String(caller.user_email),
      );
      if (!sameValue(beforeMemberships, afterMemberships)) {
        throw new PublicError(409, 'Tenant membership changed during request');
      }
      const afterAgency = input.agencyId
        ? await loadExactAgency(entities, input.agencyId)
        : null;
      if (!sameValue(beforeAgency, afterAgency)) {
        throw new PublicError(409, 'Agency changed during request');
      }
      await recheckCaller(base44, caller);
      return jsonResponse({
        tenant_context: publicContext(caller, null, beforeAgency),
      });
    }

    const activeMemberships = beforeMemberships.filter((row) => row.status === 'active');
    if (activeMemberships.length === 0) {
      return jsonResponse({ error: 'No active tenant membership' }, 403);
    }
    if (activeMemberships.length > 1 && !input.agencyId) {
      throw new PublicError(409, 'agency_id is required for multiple memberships');
    }

    const selected = input.agencyId
      ? activeMemberships.find((row) => row.agency_id === input.agencyId)
      : activeMemberships[0];
    if (!selected) throw new PublicError(403, 'No active membership for agency');
    requireExpectedMembership(selected, input.expectedMembership);

    const agencyId = String(selected.agency_id);
    const beforeAgency = await loadExactAgency(entities, agencyId);
    const afterMemberships = await loadMembershipSnapshot(
      entities,
      String(caller.user_id),
      String(caller.user_email),
    );
    if (!sameValue(beforeMemberships, afterMemberships)) {
      throw new PublicError(409, 'Tenant membership changed during request');
    }
    const selectedAfter = afterMemberships.find((row) => (
      row.status === 'active' && row.agency_id === agencyId
    ));
    if (!selectedAfter || !sameValue(selected, selectedAfter)) {
      throw new PublicError(409, 'Tenant membership changed during request');
    }
    requireExpectedMembership(selectedAfter, input.expectedMembership);

    const afterAgency = await loadExactAgency(entities, agencyId);
    if (!sameValue(beforeAgency, afterAgency)) {
      throw new PublicError(409, 'Agency changed during request');
    }
    await recheckCaller(base44, caller);

    return jsonResponse({
      tenant_context: publicContext(caller, selected, beforeAgency),
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    // Never retain provider error objects: they may embed identity or tenant data.
    console.error('getMyTenantContext failed');
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
