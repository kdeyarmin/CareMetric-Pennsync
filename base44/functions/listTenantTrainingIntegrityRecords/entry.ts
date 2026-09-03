import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MAX_IDENTIFIER_LENGTH = 200;
const CALLER_MEMBERSHIP_LIMIT = 100;
const ROSTER_LIMIT = 5000;
const RECORD_SCAN_LIMIT = 5000;
const MAX_RETURN_LIMIT = 2000;
const ACTIVE_AGENCY_STATUSES = new Set(['active', 'trial']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const PRIVILEGED_TENANT_ROLES = new Set(['agency_admin', 'manager']);

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

function exactIdentifier(value: unknown, required = false) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new PublicError(400, 'A required identifier is missing');
  }
  if (
    typeof value !== 'string'
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
  ) {
    throw new PublicError(400, 'An identifier is invalid');
  }
  return value;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function isProtectedPlatformOwner(user: Record<string, unknown>) {
  const configuredEmail = normalizeEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && user.role === 'admin'
    && normalizeEmail(user.email) === configuredEmail;
}

async function parsePayload(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }

  const record = body as Record<string, unknown>;
  if (!['plan_enrollments', 'training_recommendations'].includes(String(record.resource || ''))) {
    throw new PublicError(400, 'resource is invalid');
  }
  const rawLimit = record.limit ?? 500;
  if (!Number.isInteger(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_RETURN_LIMIT) {
    throw new PublicError(400, `limit must be an integer from 1-${MAX_RETURN_LIMIT}`);
  }

  const planId = exactIdentifier(record.plan_id);
  if (planId && record.resource !== 'plan_enrollments') {
    throw new PublicError(400, 'plan_id is only valid for plan enrollments');
  }
  return {
    resource: String(record.resource),
    agencyId: exactIdentifier(record.agency_id),
    planId,
    limit: Number(rawLimit),
  };
}

function validateMembership(
  row: Record<string, any>,
  expectedUserId: string | null,
  expectedEmail: string | null,
  expectedAgencyId: string | null,
) {
  const id = exactIdentifier(row?.id);
  const userId = exactIdentifier(row?.user_id);
  const agencyId = exactIdentifier(row?.agency_id);
  const membershipKey = exactIdentifier(row?.membership_key);
  const email = normalizeEmail(row?.user_email_normalized);
  const role = typeof row?.tenant_role === 'string' ? row.tenant_role : '';
  if (
    !id
    || !userId
    || !agencyId
    || !membershipKey
    || !email
    || row.user_email_normalized !== email
    || row.status !== 'active'
    || membershipKey !== `${agencyId}:${userId}`
    || !TENANT_ROLES.has(role)
    || (expectedUserId && userId !== expectedUserId)
    || (expectedEmail && email !== expectedEmail)
    || (expectedAgencyId && agencyId !== expectedAgencyId)
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  return { ...row, id, user_id: userId, agency_id: agencyId, email, tenant_role: role };
}

async function loadExactActiveAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, 10),
    'Agency.filter',
  );
  const exact = rows.filter((row) => row?.id === agencyId);
  if (exact.length === 0) throw new PublicError(403, 'Agency is unavailable');
  if (exact.length !== 1 || rows.length >= 10) {
    throw new PublicError(409, 'Agency is ambiguous');
  }
  if (!ACTIVE_AGENCY_STATUSES.has(String(exact[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
}

async function resolveScope(
  entities: Record<string, any>,
  user: Record<string, any>,
  requestedAgencyId: string | null,
) {
  const userId = exactIdentifier(user.id);
  const userEmail = normalizeEmail(user.email);
  if (!userId || !userEmail) throw new PublicError(403, 'Immutable user identity is required');

  const rawCallerRows = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId, status: 'active' },
      '-updated_date',
      CALLER_MEMBERSHIP_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rawCallerRows.length >= CALLER_MEMBERSHIP_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  const callerRows = rawCallerRows
    .filter((row) => row?.user_id === userId && row?.status === 'active')
    .map((row) => validateMembership(row, userId, userEmail, null));
  const seenAgencies = new Set<string>();
  for (const row of callerRows) {
    if (seenAgencies.has(row.agency_id)) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }
    seenAgencies.add(row.agency_id);
  }

  const isPlatformOwner = isProtectedPlatformOwner(user);
  if (callerRows.length === 0 && !isPlatformOwner) {
    throw new PublicError(403, 'No active tenant membership');
  }
  if (callerRows.length > 1 && !requestedAgencyId) {
    throw new PublicError(409, 'agency_id is required for multiple memberships');
  }

  const selected = requestedAgencyId
    ? callerRows.find((row) => row.agency_id === requestedAgencyId) || null
    : callerRows[0] || null;
  if (!selected && requestedAgencyId && !isPlatformOwner) {
    throw new PublicError(403, 'No active membership for agency');
  }
  if (selected && !isPlatformOwner && !PRIVILEGED_TENANT_ROLES.has(selected.tenant_role)) {
    throw new PublicError(403, 'Privileged tenant role required');
  }

  const agencyId = requestedAgencyId || selected?.agency_id || null;
  if (!agencyId) {
    // The exact secret-bound platform owner is the only unscoped caller.
    return { agencyId: null, allowedEmails: null, isPlatformOwner: true };
  }

  await loadExactActiveAgency(entities, agencyId);
  const rawRoster = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: agencyId, status: 'active' },
      '-updated_date',
      ROSTER_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rawRoster.length >= ROSTER_LIMIT) {
    throw new PublicError(409, 'Agency membership roster is too large to read safely');
  }
  const exactRoster = rawRoster
    .filter((row) => row?.agency_id === agencyId && row?.status === 'active')
    .map((row) => validateMembership(row, null, null, agencyId));
  const userIds = new Set<string>();
  const emails = new Set<string>();
  for (const row of exactRoster) {
    if (userIds.has(row.user_id) || emails.has(row.email)) {
      throw new PublicError(409, 'Agency membership roster is ambiguous');
    }
    userIds.add(row.user_id);
    emails.add(row.email);
  }
  if (selected && !userIds.has(userId)) {
    throw new PublicError(409, 'Caller membership is missing from the agency roster');
  }
  return { agencyId, allowedEmails: emails, isPlatformOwner };
}

const PLAN_ENROLLMENT_FIELDS = [
  'id', 'plan_id', 'plan_name', 'user_id', 'user_name', 'enrolled_at', 'enrolled_by',
  'status', 'progress_percentage', 'courses_completed', 'courses_total', 'completion_date',
  'due_date', 'submitted_at', 'created_date', 'updated_date',
];
const TRAINING_RECOMMENDATION_FIELDS = [
  'id', 'nurse_email', 'recommendation_type', 'recommendation_text', 'source', 'severity',
  'addressed', 'patient_id', 'visit_id', 'context_data', 'created_date', 'updated_date',
];

function project(row: Record<string, any>, fields: string[]) {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (row[field] !== undefined) result[field] = row[field];
  }
  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await parsePayload(req);
    const entities = base44.asServiceRole.entities;
    const scope = await resolveScope(entities, user, payload.agencyId);

    let rawRows: Array<Record<string, any>>;
    let ownerField: string;
    let projection: string[];
    if (payload.resource === 'plan_enrollments') {
      rawRows = requireRows(
        payload.planId
          ? await entities.PlanEnrollment.filter(
            { plan_id: payload.planId },
            '-enrolled_at',
            RECORD_SCAN_LIMIT,
          )
          : await entities.PlanEnrollment.list('-enrolled_at', RECORD_SCAN_LIMIT),
        'PlanEnrollment read',
      );
      ownerField = 'user_id';
      projection = PLAN_ENROLLMENT_FIELDS;
    } else {
      rawRows = requireRows(
        await entities.TrainingRecommendation.list('-created_date', RECORD_SCAN_LIMIT),
        'TrainingRecommendation.list',
      );
      ownerField = 'nurse_email';
      projection = TRAINING_RECOMMENDATION_FIELDS;
    }
    if (rawRows.length >= RECORD_SCAN_LIMIT) {
      throw new PublicError(409, 'Training record set is too large to read safely');
    }

    const records = rawRows
      .filter((row) => !payload.planId || row?.plan_id === payload.planId)
      .filter((row) => {
        if (scope.allowedEmails === null) return true;
        return scope.allowedEmails.has(normalizeEmail(row?.[ownerField]));
      })
      .slice(0, payload.limit)
      .map((row) => project(row, projection));

    return Response.json({
      records,
      scope: {
        agency_id: scope.agencyId,
        is_platform_owner: scope.isPlatformOwner,
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('listTenantTrainingIntegrityRecords failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
