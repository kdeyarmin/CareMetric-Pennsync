import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Service-owned lifecycle for immutable tenant membership.
 *
 * A protected platform owner can bootstrap the first membership without already
 * holding one and is the only actor allowed to provision pending memberships
 * until an exact agency-bound UserInvitation workflow is integrated. Every other
 * caller must hold exactly one active agency_admin membership for the requested
 * agency. Custom User agency/account fields never participate in authorization.
 */

const ACTIONS = new Set(['inspect', 'provision', 'activate', 'suspend', 'revoke', 'change_role']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const SUBORDINATE_ROLES = new Set([
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const AGENCY_STATUSES = new Set(['active', 'trial', 'suspended', 'cancelled']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_RECORD_SCAN_LIMIT = 10;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REASON_LENGTH = 500;

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

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  return value;
}

function canonicalEmail(value: unknown) {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 320 || !normalized.includes('@') || /\s/.test(normalized)) {
    return null;
  }
  return normalized;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) return null;
  return reason;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function isProtectedPlatformOwner(user: Record<string, any>) {
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && user.role === 'admin'
    && canonicalEmail(user.email) === configuredEmail;
}

function isProtectedOwnerIdentity(user: Record<string, any>) {
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail && canonicalEmail(user.email) === configuredEmail;
}

async function parseRequest(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }

  const input = body as Record<string, unknown>;
  const action = typeof input.action === 'string' ? input.action : '';
  const agencyId = exactIdentifier(input.agency_id);
  const targetUserId = exactIdentifier(input.target_user_id);
  const targetUserEmail = canonicalEmail(input.target_user_email);
  const reason = action === 'inspect' ? null : boundedReason(input.reason);
  if (!ACTIONS.has(action)) throw new PublicError(400, 'Invalid membership action');
  if (!agencyId || !targetUserId || !targetUserEmail) {
    throw new PublicError(400, 'agency_id and exact target User identity are required');
  }
  if (action === 'inspect') {
    if (input.reason !== undefined) throw new PublicError(400, 'reason is not accepted when inspecting');
  } else if (!reason) {
    throw new PublicError(400, 'A bounded transition reason is required');
  }

  const roleAction = action === 'provision' || action === 'change_role';
  const versionedAction = !['inspect', 'provision'].includes(action);
  const allowedKeys = new Set([
    'action',
    'agency_id',
    'target_user_id',
    'target_user_email',
    ...(action === 'inspect' ? [] : ['reason']),
    ...(roleAction ? ['tenant_role'] : []),
    ...(versionedAction ? ['expected_version'] : []),
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const tenantRole = input.tenant_role;
  if (roleAction) {
    if (typeof tenantRole !== 'string' || !TENANT_ROLES.has(tenantRole)) {
      throw new PublicError(400, 'tenant_role is invalid');
    }
  } else if (tenantRole !== undefined) {
    throw new PublicError(400, 'tenant_role is not accepted for this action');
  }

  let expectedVersion: number | null = null;
  if (versionedAction) {
    if (!Number.isSafeInteger(input.expected_version) || Number(input.expected_version) < 1) {
      throw new PublicError(400, 'expected_version is required for membership transitions');
    }
    expectedVersion = Number(input.expected_version);
  } else if (input.expected_version !== undefined) {
    throw new PublicError(400, 'expected_version is not accepted for this action');
  }

  return {
    action,
    agencyId,
    targetUserId,
    targetUserEmail,
    tenantRole: roleAction ? tenantRole as string : null,
    expectedVersion,
    reason: reason as string | null,
  };
}

async function loadExactUser(entities: Record<string, any>, userId: string, expectedEmail: string) {
  const rows = requireRows(
    await entities.User.filter({ id: userId }, '-created_date', EXACT_RECORD_SCAN_LIMIT),
    'User.filter',
  );
  if (rows.length >= EXACT_RECORD_SCAN_LIMIT) throw new PublicError(409, 'Target User is ambiguous');
  const exact = rows.filter((row) => row?.id === userId);
  if (exact.length === 0) throw new PublicError(404, 'Target User not found');
  if (exact.length !== 1) throw new PublicError(409, 'Target User is ambiguous');
  const user = exact[0];
  if (canonicalEmail(user.email) !== expectedEmail) {
    throw new PublicError(409, 'Target User identity does not match');
  }
  return user;
}

async function loadExactAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, '-created_date', EXACT_RECORD_SCAN_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_RECORD_SCAN_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  const exact = rows.filter((row) => row?.id === agencyId);
  if (exact.length === 0) throw new PublicError(404, 'Agency not found');
  if (exact.length !== 1) throw new PublicError(409, 'Agency is ambiguous');
  const agency = exact[0];
  if (!AGENCY_STATUSES.has(String(agency.status || ''))) {
    throw new PublicError(409, 'Agency integrity check failed');
  }
  return agency;
}

function validateMembershipRecord(row: Record<string, any>, agencyId: string, userId: string) {
  const id = exactIdentifier(row.id);
  const email = canonicalEmail(row.user_email_normalized);
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
    || row.agency_id !== agencyId
    || row.user_id !== userId
    || row.membership_key !== `${agencyId}:${userId}`
    || !email
    || row.user_email_normalized !== email
    || !TENANT_ROLES.has(row.tenant_role)
    || !MEMBERSHIP_STATUSES.has(row.status)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !createdBy
    || !transitionedBy
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !Number.isFinite(transitionAt)
    || !transitionReason
    || (
      (row.status === 'active' || row.status === 'suspended')
      && !Number.isFinite(activatedAt)
    )
    || (
      row.status === 'revoked'
      && (!Number.isFinite(revokedAt) || !revocationReason)
    )
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  return row;
}

async function loadExactMembership(
  entities: Record<string, any>,
  agencyId: string,
  userId: string,
) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: agencyId, user_id: userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  const exact = rows.filter((row) => row?.agency_id === agencyId && row?.user_id === userId);
  if (exact.length > 1) throw new PublicError(409, 'Tenant membership is ambiguous');
  return exact.length === 1 ? validateMembershipRecord(exact[0], agencyId, userId) : null;
}

function publicMembership(row: Record<string, any>) {
  return {
    id: row.id,
    agency_id: row.agency_id,
    user_id: row.user_id,
    user_email_normalized: row.user_email_normalized,
    tenant_role: row.tenant_role,
    status: row.status,
    version: row.version,
    activated_at: row.activated_at || null,
    revoked_at: row.revoked_at || null,
    last_transition_at: row.last_transition_at,
  };
}

function success(row: Record<string, any>, action: string, idempotent: boolean, status = 200) {
  return Response.json({
    success: true,
    action,
    idempotent,
    membership: publicMembership(row),
  }, { status });
}

function requireExpectedVersion(row: Record<string, any>, expectedVersion: number | null) {
  if (row.version !== expectedVersion) {
    throw new PublicError(409, 'Membership version changed; reload before retrying');
  }
}

function requireVersionCapacity(row: Record<string, any>) {
  if (row.version >= Number.MAX_SAFE_INTEGER) {
    throw new PublicError(409, 'Membership version capacity is exhausted');
  }
}

function transitionMetadata(actorId: string, actorEmail: string, reason: string, now: string) {
  return {
    last_transition_by_user_id: actorId,
    last_transition_by_email_normalized: actorEmail,
    last_transition_at: now,
    last_transition_reason: reason,
  };
}

async function reconcileTransition(
  entities: Record<string, any>,
  before: Record<string, any>,
  expected: Record<string, any>,
) {
  const after = await loadExactMembership(entities, before.agency_id, before.user_id);
  if (
    !after
    || after.id !== before.id
    || Object.entries(expected).some(([field, value]) => after[field] !== value)
  ) {
    throw new PublicError(409, 'Membership transition could not be reconciled');
  }
  return after;
}

async function recheckCallerAuthority(
  entities: Record<string, any>,
  expected: Record<string, any> | null,
  agencyId: string,
  callerId: string,
  callerEmail: string,
) {
  if (!expected) return;
  const current = await loadExactMembership(entities, agencyId, callerId);
  if (
    !current
    || current.status !== 'active'
    || current.tenant_role !== 'agency_admin'
    || current.user_email_normalized !== callerEmail
  ) {
    throw new PublicError(403, 'Agency administrator authority changed; reload before retrying');
  }
  const stableFields = [
    'id',
    'membership_key',
    'agency_id',
    'user_id',
    'user_email_normalized',
    'tenant_role',
    'status',
    'created_by_user_id',
    'activated_at',
    'last_transition_by_user_id',
    'last_transition_by_email_normalized',
    'last_transition_at',
    'last_transition_reason',
    'version',
  ];
  if (stableFields.some((field) => current[field] !== expected[field])) {
    throw new PublicError(403, 'Agency administrator authority changed; reload before retrying');
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    }
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }
    if (caller.disabled === true || caller.is_service === true || caller.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const callerId = exactIdentifier(caller.id);
    const callerEmail = canonicalEmail(caller.email);
    if (!callerId || !callerEmail) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const input = await parseRequest(req);
    const entities = base44.asServiceRole.entities;
    const callerIsOwner = isProtectedPlatformOwner(caller);
    let callerAuthority: Record<string, any> | null = null;

    if (!callerIsOwner) {
      const authority = await loadExactMembership(entities, input.agencyId, callerId);
      if (
        !authority
        || authority.status !== 'active'
        || authority.tenant_role !== 'agency_admin'
        || authority.user_email_normalized !== callerEmail
      ) {
        throw new PublicError(403, 'Active agency administrator membership is required');
      }
      if (input.targetUserId === callerId) {
        throw new PublicError(403, 'Agency administrators cannot change their own membership');
      }
      if (input.action === 'provision') {
        throw new PublicError(
          403,
          'Only the protected platform owner may provision memberships',
        );
      }
      callerAuthority = authority;
    }

    const agency = await loadExactAgency(entities, input.agencyId);
    const targetUser = await loadExactUser(
      entities,
      input.targetUserId,
      input.targetUserEmail,
    );
    const targetIsPlatformOwner = isProtectedPlatformOwner(targetUser);
    if (!callerIsOwner && isProtectedOwnerIdentity(targetUser)) {
      throw new PublicError(403, 'Only the protected platform owner may manage this identity');
    }

    const current = await loadExactMembership(entities, input.agencyId, input.targetUserId);
    const requestedPrivilegedRole = input.tenantRole === 'agency_admin';
    const currentPrivilegedRole = current?.tenant_role === 'agency_admin';
    if (!callerIsOwner && (requestedPrivilegedRole || currentPrivilegedRole)) {
      throw new PublicError(403, 'Only the protected platform owner may manage agency administrators');
    }
    if (!callerIsOwner && input.tenantRole && !SUBORDINATE_ROLES.has(input.tenantRole)) {
      throw new PublicError(403, 'Agency administrator role assignment is outside caller scope');
    }

    if (
      (input.action === 'provision' || input.action === 'activate' || input.action === 'change_role')
      && !ENABLED_AGENCY_STATUSES.has(agency.status)
    ) {
      throw new PublicError(409, 'Agency is unavailable for an enabling transition');
    }
    if (
      (input.action === 'provision' || input.action === 'activate' || input.action === 'change_role')
      && (
        (!targetIsPlatformOwner && targetUser.role !== 'user')
        || targetUser.is_active === false
        || targetUser.disabled === true
        || targetUser.is_service === true
        || targetUser.is_verified === false
      )
    ) {
      throw new PublicError(409, 'Target User is deactivated');
    }

    if (input.action === 'inspect') {
      if (!current) throw new PublicError(404, 'Membership not found');
      return success(current, input.action, true);
    }

    const transitionReason = input.reason;
    if (!transitionReason) throw new Error('Validated transition reason is missing');
    const now = new Date().toISOString();
    const metadata = transitionMetadata(callerId, callerEmail, transitionReason, now);

    if (input.action === 'provision') {
      if (current) {
        if (
          current.status === 'pending'
          && current.user_email_normalized === input.targetUserEmail
          && current.tenant_role === input.tenantRole
        ) {
          return success(current, input.action, true);
        }
        throw new PublicError(409, 'A membership already exists for this User and Agency');
      }

      const created = await entities.AgencyMembership.create({
        membership_key: `${input.agencyId}:${input.targetUserId}`,
        agency_id: input.agencyId,
        user_id: input.targetUserId,
        user_email_normalized: input.targetUserEmail,
        tenant_role: input.tenantRole,
        status: 'pending',
        created_by_user_id: callerId,
        version: 1,
        ...metadata,
      });
      const createdId = exactIdentifier(created?.id);
      if (!createdId) throw new Error('AgencyMembership create did not return an id');
      const reconciled = await loadExactMembership(entities, input.agencyId, input.targetUserId);
      if (
        !reconciled
        || reconciled.id !== createdId
        || reconciled.status !== 'pending'
        || reconciled.tenant_role !== input.tenantRole
        || reconciled.user_email_normalized !== input.targetUserEmail
        || reconciled.created_by_user_id !== callerId
        || reconciled.version !== 1
        || reconciled.last_transition_by_user_id !== callerId
        || reconciled.last_transition_by_email_normalized !== callerEmail
        || reconciled.last_transition_at !== now
        || reconciled.last_transition_reason !== transitionReason
      ) {
        throw new PublicError(409, 'Provisioned membership could not be reconciled');
      }
      return success(reconciled, input.action, false, 201);
    }

    if (!current) throw new PublicError(404, 'Membership not found');
    const emailMatchesCurrentUser = current.user_email_normalized === input.targetUserEmail;

    if (input.action === 'change_role') {
      if (current.status === 'revoked') throw new PublicError(409, 'Revoked membership is terminal');
      if (!emailMatchesCurrentUser) {
        throw new PublicError(409, 'Membership email integrity requires protected reconciliation');
      }
      if (current.tenant_role === input.tenantRole) return success(current, input.action, true);
      requireVersionCapacity(current);
      requireExpectedVersion(current, input.expectedVersion);
      const expected = {
        tenant_role: input.tenantRole,
        version: current.version + 1,
        ...metadata,
      };
      await recheckCallerAuthority(
        entities,
        callerAuthority,
        input.agencyId,
        callerId,
        callerEmail,
      );
      await entities.AgencyMembership.update(current.id, expected);
      const reconciled = await reconcileTransition(entities, current, expected);
      return success(reconciled, input.action, false);
    }

    const desiredStatus = input.action === 'activate'
      ? 'active'
      : input.action === 'suspend'
        ? 'suspended'
        : 'revoked';
    if (current.status === desiredStatus && emailMatchesCurrentUser) {
      return success(current, input.action, true);
    }
    if (input.action === 'activate') {
      if (current.status !== 'pending' && current.status !== 'suspended') {
        throw new PublicError(409, 'Membership cannot be activated from its current state');
      }
      if (!emailMatchesCurrentUser) {
        throw new PublicError(409, 'Membership email integrity requires protected reconciliation');
      }
    } else if (input.action === 'suspend') {
      if (current.status !== 'active' && current.status !== 'suspended') {
        throw new PublicError(409, 'Membership cannot be suspended from its current state');
      }
    } else if (!['pending', 'active', 'suspended', 'revoked'].includes(current.status)) {
      throw new PublicError(409, 'Membership cannot be revoked from its current state');
    }

    requireVersionCapacity(current);
    requireExpectedVersion(current, input.expectedVersion);
    const expected = {
      status: desiredStatus,
      user_email_normalized: input.targetUserEmail,
      version: current.version + 1,
      ...(input.action === 'activate' ? { activated_at: now } : {}),
      ...(input.action === 'revoke' ? { revoked_at: now, revocation_reason: transitionReason } : {}),
      ...metadata,
    };
    await recheckCallerAuthority(
      entities,
      callerAuthority,
      input.agencyId,
      callerId,
      callerEmail,
    );
    await entities.AgencyMembership.update(current.id, expected);
    const reconciled = await reconcileTransition(entities, current, expected);
    return success(reconciled, input.action, false);
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('manageAgencyMembership failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
