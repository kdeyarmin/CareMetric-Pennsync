import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

/**
 * Resolve the authenticated user's server-owned agency membership.
 *
 * This function deliberately ignores every custom User authorization claim.
 * The immutable built-in User id is the primary identity, with the normalized
 * built-in email used only as a corroborating integrity check.
 */

const MEMBERSHIP_SCAN_LIMIT = 100;
const AGENCY_SCAN_LIMIT = 10;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REASON_LENGTH = 500;
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

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 320 || !normalized.includes('@') || /\s/.test(normalized)) {
    return null;
  }
  return normalized;
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  return value;
}

function isProtectedPlatformOwner(user: Record<string, unknown>) {
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && user.role === 'admin'
    && canonicalEmail(user.email) === configuredEmail;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) return null;
  return reason;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} returned a non-array result`);
  }
  return value as Array<Record<string, unknown>>;
}

async function parseRequestedAgencyId(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }

  const supplied = (body as Record<string, unknown>).agency_id;
  if (supplied === undefined || supplied === null) return null;

  const agencyId = exactIdentifier(supplied);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  return agencyId;
}

function validateMemberships(
  rawRows: Array<Record<string, unknown>>,
  userId: string,
  normalizedEmail: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }

  // Recheck the service-role query in memory. Rows outside the requested user
  // are ignored, but every lifecycle state for this exact immutable user id is
  // validated before active memberships are selected. This prevents a hidden
  // suspended/revoked duplicate from coexisting with an authorizing active row.
  const candidates = rawRows.filter((row) => row?.user_id === userId);

  const memberships: Array<Record<string, unknown>> = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  const agencyIds = new Set<string>();

  for (const row of candidates) {
    const id = exactIdentifier(row.id);
    const agencyId = exactIdentifier(row.agency_id);
    const membershipKey = exactIdentifier(row.membership_key);
    const storedEmail = canonicalEmail(row.user_email_normalized);
    const tenantRole = typeof row.tenant_role === 'string' ? row.tenant_role : '';
    const status = typeof row.status === 'string' ? row.status : '';
    const createdBy = exactIdentifier(row.created_by_user_id);
    const transitionedBy = exactIdentifier(row.last_transition_by_user_id);
    const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
    const transitionAt = Date.parse(String(row.last_transition_at || ''));
    const transitionReason = boundedReason(row.last_transition_reason);
    const activatedAt = Date.parse(String(row.activated_at || ''));
    const revokedAt = Date.parse(String(row.revoked_at || ''));
    const revocationReason = boundedReason(row.revocation_reason);

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
      || !createdBy
      || !transitionedBy
      || !transitionEmail
      || row.last_transition_by_email_normalized !== transitionEmail
      || !Number.isFinite(transitionAt)
      || !transitionReason
      || (
        (status === 'active' || status === 'suspended')
        && !Number.isFinite(activatedAt)
      )
      || (
        status === 'revoked'
        && (!Number.isFinite(revokedAt) || !revocationReason)
      )
      || (
        status !== 'revoked'
        && (row.revoked_at != null || row.revocation_reason != null)
      )
    ) {
      throw new PublicError(409, 'Tenant membership integrity check failed');
    }

    if (ids.has(id) || keys.has(membershipKey) || agencyIds.has(agencyId)) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }

    ids.add(id);
    keys.add(membershipKey);
    agencyIds.add(agencyId);
    memberships.push(row);
  }

  return memberships;
}

async function loadExactAgency(entities: Record<string, any>, agencyId: string) {
  const rawRows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, AGENCY_SCAN_LIMIT),
    'Agency.filter',
  );
  if (rawRows.length >= AGENCY_SCAN_LIMIT) {
    throw new PublicError(409, 'Agency is ambiguous');
  }

  const exactMatches = rawRows.filter((row) => row?.id === agencyId);
  if (exactMatches.length === 0) throw new PublicError(403, 'Agency is unavailable');
  if (exactMatches.length !== 1) throw new PublicError(409, 'Agency is ambiguous');

  const agency = exactMatches[0];
  if (!ACTIVE_AGENCY_STATUSES.has(String(agency.status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return agency;
}

function publicAgency(agency: Record<string, unknown> | null) {
  if (!agency) return null;
  return {
    id: agency.id,
    name: typeof agency.agency_name === 'string' ? agency.agency_name : '',
    status: agency.status,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = exactIdentifier(user.id);
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const normalizedEmail = canonicalEmail(user.email);
    if (!userId || !normalizedEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const requestedAgencyId = await parseRequestedAgencyId(req);
    const entities = base44.asServiceRole.entities;
    const isPlatformOwner = isProtectedPlatformOwner(user);
    const rawMemberships = requireRows(
      await entities.AgencyMembership.filter(
        { user_id: userId },
        '-updated_date',
        MEMBERSHIP_SCAN_LIMIT,
      ),
      'AgencyMembership.filter',
    );

    if (isPlatformOwner) {
      if (rawMemberships.length >= MEMBERSHIP_SCAN_LIMIT) {
        throw new PublicError(409, 'Tenant membership is ambiguous');
      }
      if (rawMemberships.some((row) => row?.user_id !== userId)) {
        throw new PublicError(409, 'Tenant membership query scope could not be verified');
      }
      if (rawMemberships.length !== 0) {
        throw new PublicError(409, 'Platform owner tenant membership must not exist');
      }

      // The protected owner is intentionally membership-free. Cross-tenant
      // selection is authorized only by the exact built-in admin + configured
      // email match above, never by an AgencyMembership row.
      const agency = requestedAgencyId
        ? await loadExactAgency(entities, requestedAgencyId)
        : null;
      return Response.json({
        tenant_context: {
          user_id: userId,
          user_email: normalizedEmail,
          membership_id: null,
          membership_key: null,
          membership_version: null,
          agency_id: requestedAgencyId,
          tenant_role: 'platform_owner',
          membership_status: null,
          is_platform_owner: true,
          agency: publicAgency(agency),
        },
      });
    }

    const allMemberships = validateMemberships(
      rawMemberships,
      userId,
      normalizedEmail,
    );
    const memberships = allMemberships.filter((row) => row.status === 'active');

    if (memberships.length === 0) {
      return Response.json({ error: 'No active tenant membership' }, { status: 403 });
    }

    if (memberships.length > 1 && !requestedAgencyId) {
      throw new PublicError(409, 'agency_id is required for multiple memberships');
    }

    const selected = requestedAgencyId
      ? memberships.find((row) => row.agency_id === requestedAgencyId)
      : memberships[0];
    if (!selected) throw new PublicError(403, 'No active membership for agency');

    const agencyId = selected.agency_id as string;
    const agency = await loadExactAgency(entities, agencyId);
    return Response.json({
      tenant_context: {
        user_id: userId,
        user_email: normalizedEmail,
        membership_id: selected.id,
        membership_key: selected.membership_key,
        membership_version: selected.version,
        agency_id: agencyId,
        tenant_role: selected.tenant_role,
        membership_status: 'active',
        is_platform_owner: false,
        agency: publicAgency(agency),
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Never retain provider error objects: they may embed identity or tenant data.
    console.error('getMyTenantContext failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
