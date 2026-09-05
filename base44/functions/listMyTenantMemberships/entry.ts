import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Finite, read-only selector source for an authenticated user's exact active
 * tenant memberships.
 *
 * This broker deliberately returns no selected tenant. It exposes only the
 * minimum immutable membership authority needed to render a selector and the
 * public Agency label/status needed to identify each option. Selection must be
 * completed by a separate exact getMyTenantContext({ agency_id }) call.
 */

const MEMBERSHIP_QUERY_LIMIT = 51;
const MAX_MEMBERSHIP_ROWS = 50;
const MAX_ACTIVE_MEMBERSHIPS = 25;
const AGENCY_EXACT_QUERY_LIMIT = 2;
const MAX_BODY_BYTES = 1_000;
const MAX_BODY_CHUNKS = 64;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_AGENCY_NAME_LENGTH = 200;
const MAX_REASON_LENGTH = 500;
const UNSAFE_AGENCY_NAME = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);

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

function validateCaller(user: Record<string, unknown>) {
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
    is_platform_owner: isProtectedPlatformOwner(user),
  };
}

async function parseEmptyRequest(req: Request) {
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
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PublicError(400, 'Invalid request body encoding');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  if (Object.keys(body as Record<string, unknown>).length !== 0) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
}

function validateMembershipRows(
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

  const ids = new Set<string>();
  const keys = new Set<string>();
  const agencyIds = new Set<string>();
  const validated: Array<Record<string, unknown>> = [];

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
    validated.push({
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

  validated.sort((left, right) => {
    const leftKey = String(left.agency_id);
    const rightKey = String(right.agency_id);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const active = validated.filter((row) => row.status === 'active');
  if (active.length > MAX_ACTIVE_MEMBERSHIPS) {
    throw new PublicError(409, 'Active tenant membership list exceeds bounded capacity');
  }
  return { all: validated, active };
}

async function loadMembershipSnapshot(
  entities: Record<string, any>,
  userId: string,
  normalizedEmail: string,
) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId },
      'agency_id',
      MEMBERSHIP_QUERY_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  return validateMembershipRows(rows, userId, normalizedEmail);
}

async function loadExactPublicAgency(entities: Record<string, any>, agencyId: string) {
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
  if (!ENABLED_AGENCY_STATUSES.has(status)) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return { id, name, status };
}

async function loadAgencySnapshot(
  entities: Record<string, any>,
  memberships: Array<Record<string, unknown>>,
) {
  const agencies: Array<Record<string, unknown>> = [];
  for (const membership of memberships) {
    agencies.push(await loadExactPublicAgency(entities, String(membership.agency_id)));
  }
  return agencies;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function recheckCaller(base44: Record<string, any>, expected: Record<string, unknown>) {
  const currentUser = await base44.auth.me().catch(() => null);
  if (!currentUser || isDeactivatedUser(currentUser)) {
    throw new PublicError(409, 'Caller identity changed during request');
  }
  let current;
  try {
    current = validateCaller(currentUser);
  } catch {
    throw new PublicError(409, 'Caller identity changed during request');
  }
  if (!sameValue(current, expected)) {
    throw new PublicError(409, 'Caller identity changed during request');
  }
}

function publicOption(
  membership: Record<string, unknown>,
  agency: Record<string, unknown>,
) {
  return {
    membership_id: membership.id,
    membership_key: membership.membership_key,
    membership_version: membership.version,
    agency_id: membership.agency_id,
    tenant_role: membership.tenant_role,
    membership_status: 'active',
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
    const caller = validateCaller(user);
    await parseEmptyRequest(req);

    const entities = base44.asServiceRole.entities;
    const before = await loadMembershipSnapshot(
      entities,
      String(caller.user_id),
      String(caller.user_email),
    );

    if (caller.is_platform_owner && before.all.length !== 0) {
      throw new PublicError(409, 'Platform owner tenant membership must not exist');
    }

    // A platform owner deliberately receives an empty membership list. This
    // endpoint never converts global owner status into an inferred tenant.
    const beforeAgencies = caller.is_platform_owner
      ? []
      : await loadAgencySnapshot(entities, before.active);

    const after = await loadMembershipSnapshot(
      entities,
      String(caller.user_id),
      String(caller.user_email),
    );
    if (!sameValue(before.all, after.all)) {
      throw new PublicError(409, 'Tenant membership list changed during request');
    }
    if (caller.is_platform_owner && after.all.length !== 0) {
      throw new PublicError(409, 'Platform owner tenant membership must not exist');
    }

    const afterAgencies = caller.is_platform_owner
      ? []
      : await loadAgencySnapshot(entities, after.active);
    if (!sameValue(beforeAgencies, afterAgencies)) {
      throw new PublicError(409, 'Agency list changed during request');
    }
    await recheckCaller(base44, caller);

    return jsonResponse({
      subject: caller,
      memberships: caller.is_platform_owner
        ? []
        : before.active.map((membership, index) => publicOption(
          membership,
          beforeAgencies[index],
        )),
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    // Provider exceptions can contain identity or tenant fields; never retain them.
    console.error('listMyTenantMemberships failed');
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
