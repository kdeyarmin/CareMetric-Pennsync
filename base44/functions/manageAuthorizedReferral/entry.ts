import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/**
 * Tenant-authorized Referral read/write broker.
 *
 * Referral carries intake PHI, so direct entity CRUD is denied. Every action
 * derives immutable tenant authority from the authenticated built-in User and
 * one exact active AgencyMembership. Patient links are accepted only after an
 * exact same-agency Patient check. Updates use a conditional versioned write;
 * no caller may set tenant, identity, audit-actor, or revision fields.
 */

const ACTIONS = new Set(['list', 'get', 'create', 'update', 'delete']);
const INTAKE_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const VISIBLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const REFERRAL_STATUSES = new Set([
  'new',
  'pending',
  'processing',
  'awaiting_info',
  'active',
  'declined',
  'ready_for_admission',
  'soc_completed',
]);
const REFERRAL_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const DOCUMENT_TYPES = new Set(['pdf', 'fax', 'image', 'manual', 'electronic']);

const MAX_BODY_BYTES = 1_000_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_LIST_LIMIT = 5000;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;

const CLIENT_REFERRAL_FIELDS = new Set([
  'patient_name',
  'patient_id',
  'patient_dob',
  'diagnosis',
  'referral_source',
  'referral_date',
  'estimated_start_date',
  'document_type',
  'priority',
  'status',
  'soc_date',
  'first_visit_date',
  'document_url',
  'processed_document_url',
  'page_range',
  'detection_confidence',
  'manually_confirmed',
  'requires_manual_review',
  'assigned_to',
  'match_confidence',
  'match_factors',
  'match_suggestions',
  'match_analysis',
  'analysis_results',
  'missing_information',
  'discrepancies',
  'ai_generated_tasks',
  'extracted_data',
  'diagnosis_coding',
  'follow_up_requests',
  'follow_up_notes',
]);

const RESPONSE_FIELDS = [
  'id',
  'agency_id',
  'version',
  'created_date',
  'updated_date',
  ...CLIENT_REFERRAL_FIELDS,
  'rejection_date',
  'rejected_by',
  'soc_completed_by',
];

class PublicError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    this.code = code;
  }
}

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const normalized = normalizeEmail(value);
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

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (
    !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  return value;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function pickFields(row: Record<string, any>, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new PublicError(400, `${label} contains unsupported fields`);
  }
}

async function parseRequest(req: Request) {
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
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
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  const action = typeof body.action === 'string' ? body.action : '';
  if (!ACTIONS.has(action)) throw new PublicError(400, 'action is invalid');
  const agencyId = exactIdentifier(body.agency_id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  return { body, action, agencyId };
}

function validateMembershipRows(
  rawRows: Array<Record<string, any>>,
  userId: string,
  normalizedEmail: string,
  agencyId: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  if (rawRows.some((row) => row?.user_id !== userId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified');
  }
  if (rawRows.length === 0) throw new PublicError(403, 'No tenant membership for agency');
  if (rawRows.length !== 1) throw new PublicError(409, 'Tenant membership is ambiguous');
  const row = rawRows[0];
  const storedEmail = canonicalEmail(row.user_email_normalized);
  const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
  const status = typeof row.status === 'string' ? row.status : '';
  if (
    !exactIdentifier(row.id)
    || row.membership_key !== `${agencyId}:${userId}`
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== normalizedEmail
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !MEMBERSHIP_STATUSES.has(status)
    || !exactIdentifier(row.created_by_user_id)
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  if (status !== 'active') throw new PublicError(403, 'No active membership for agency');
  if (!INTAKE_ROLES.has(String(row.tenant_role || ''))) {
    throw new PublicError(403, 'Tenant role cannot use Referral intake');
  }
  return row;
}

async function loadExactEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  if (rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query scope could not be verified');
  }
  if (rows.length !== 1 || !ENABLED_AGENCY_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return rows[0];
}

async function loadAuthority(
  base44: Record<string, any>,
  agencyId: string,
  expectedSnapshot: Record<string, unknown> | null = null,
) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (
    user.role !== 'user'
    || user.is_active === false
    || user.disabled === true
    || user.is_service === true
    || user.is_verified === false
  ) {
    throw new PublicError(403, 'Forbidden');
  }
  const userId = exactIdentifier(user.id);
  const normalizedEmail = canonicalEmail(user.email);
  if (!userId || !normalizedEmail) throw new PublicError(403, 'Forbidden');
  const entities = base44.asServiceRole.entities;
  const memberships = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId, agency_id: agencyId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  const membership = validateMembershipRows(
    memberships,
    userId,
    normalizedEmail,
    agencyId,
  );
  const agency = await loadExactEnabledAgency(entities, agencyId);
  const snapshot = {
    user_id: userId,
    user_email: normalizedEmail,
    agency_id: agencyId,
    agency_status: agency.status,
    membership_id: membership.id,
    membership_key: membership.membership_key,
    membership_version: membership.version,
    membership_status: membership.status,
    membership_transition_at: membership.last_transition_at,
    tenant_role: membership.tenant_role,
  };
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'Referral authority changed during request');
  }
  return {
    userId,
    normalizedEmail,
    agencyId,
    tenantRole: String(membership.tenant_role),
    snapshot,
  };
}

function referralCreationKey(agencyId: string, userId: string, requestId: string) {
  return `${agencyId}:${userId}:${requestId}`;
}

function validateReferralIntegrity(
  row: Record<string, any>,
  referralId: string,
  agencyId: string,
) {
  const creatorId = exactIdentifier(row.created_by_user_id);
  const creatorEmail = canonicalEmail(row.created_by_user_email_normalized);
  const platformCreator = canonicalEmail(row.created_by);
  const requestId = exactIdentifier(row.client_request_id);
  if (
    row.id !== referralId
    || row.agency_id !== agencyId
    || !creatorId
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || platformCreator !== creatorEmail
    || row.created_by !== creatorEmail
    || !requestId
    || row.referral_creation_key !== referralCreationKey(agencyId, creatorId, requestId)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !validInstant(row.created_date)
    || !validInstant(row.updated_date)
    || (row.patient_id != null && !exactIdentifier(row.patient_id))
    || (row.status != null && !REFERRAL_STATUSES.has(String(row.status)))
    || (row.priority != null && !REFERRAL_PRIORITIES.has(String(row.priority)))
  ) {
    throw new PublicError(409, 'Referral authority integrity check failed');
  }
  return row;
}

async function loadExactReferral(
  entities: Record<string, any>,
  referralId: string,
  agencyId: string,
) {
  const rows = requireRows(
    await entities.Referral.filter(
      { id: referralId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Referral is ambiguous');
  if (rows.some((row) => row?.id !== referralId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Referral query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(404, 'Referral unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Referral is ambiguous');
  return validateReferralIntegrity(rows[0], referralId, agencyId);
}

async function loadExactPatient(
  entities: Record<string, any>,
  patientId: string,
  agencyId: string,
) {
  const rows = requireRows(
    await entities.Patient.filter(
      { id: patientId, agency_id: agencyId, is_sample: false, is_archived: false },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  if (rows.some((row) => (
    row?.id !== patientId
    || row?.agency_id !== agencyId
    || row?.is_sample !== false
    || row?.is_archived !== false
  ))) {
    throw new PublicError(409, 'Patient query scope could not be verified');
  }
  if (rows.length !== 1 || !VISIBLE_PATIENT_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(403, 'Patient is unavailable');
  }
  return rows[0];
}

function validateBusinessFields(
  value: unknown,
  normalizedEmail: string,
  mode: 'create' | 'update',
) {
  if (!plainObject(value)) throw new PublicError(400, `Referral ${mode} fields must be an object`);
  if (Object.keys(value).length === 0) {
    throw new PublicError(400, `Referral ${mode} fields cannot be empty`);
  }
  for (const key of Object.keys(value)) {
    if (!CLIENT_REFERRAL_FIELDS.has(key)) {
      throw new PublicError(400, `Unsupported Referral field: ${key}`);
    }
  }
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) output[key] = nested;
  }
  if (Object.hasOwn(output, 'patient_id') && output.patient_id !== null) {
    const patientId = exactIdentifier(output.patient_id);
    if (!patientId) throw new PublicError(400, 'patient_id is invalid');
    output.patient_id = patientId;
  }
  if (Object.hasOwn(output, 'status') && !REFERRAL_STATUSES.has(String(output.status))) {
    throw new PublicError(400, 'status is invalid');
  }
  if (Object.hasOwn(output, 'priority') && !REFERRAL_PRIORITIES.has(String(output.priority))) {
    throw new PublicError(400, 'priority is invalid');
  }
  if (
    Object.hasOwn(output, 'document_type')
    && output.document_type !== null
    && !DOCUMENT_TYPES.has(String(output.document_type))
  ) {
    throw new PublicError(400, 'document_type is invalid');
  }
  if (Object.hasOwn(output, 'assigned_to') && output.assigned_to !== null) {
    const assignedTo = canonicalEmail(output.assigned_to);
    if (!assignedTo || assignedTo !== normalizedEmail || mode === 'update') {
      throw new PublicError(
        503,
        'Referral assignment mutations are paused',
        'referral_assignment_mutations_paused',
      );
    }
    output.assigned_to = assignedTo;
  }
  return output;
}

function serverAuditFields(
  fields: Record<string, unknown>,
  normalizedEmail: string,
) {
  const output = { ...fields };
  const now = new Date().toISOString();
  if (output.status === 'declined') {
    output.rejection_date = now;
    output.rejected_by = normalizedEmail;
  }
  if (output.status === 'soc_completed') {
    output.soc_completed_by = normalizedEmail;
  }
  return output;
}

function narrowReferral(row: Record<string, any>) {
  return pickFields(row, RESPONSE_FIELDS);
}

function scope(authority: Record<string, any>) {
  return {
    agency_id: authority.agencyId,
    membership_id: authority.snapshot.membership_id,
    membership_version: authority.snapshot.membership_version,
    tenant_role: authority.tenantRole,
  };
}

async function removeCreatedReferral(
  entities: Record<string, any>,
  referralId: string,
  agencyId: string,
) {
  const result = await entities.Referral.delete(referralId).catch(() => null);
  if (!plainObject(result) || result.success !== true) {
    throw new Error('Referral create compensation failed');
  }
  const remaining = requireRows(
    await entities.Referral.filter(
      { id: referralId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (remaining.some((row) => row?.id === referralId && row?.agency_id === agencyId)) {
    throw new Error('Referral create compensation failed verification');
  }
}

async function listReferrals(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(
    body,
    ['action', 'agency_id', 'limit', 'patient_id', 'status', 'assigned_to'],
    'Referral list',
  );
  const limit = body.limit === undefined ? 200 : body.limit;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > MAX_LIST_LIMIT) {
    throw new PublicError(400, 'limit is invalid');
  }
  const query: Record<string, unknown> = { agency_id: authority.agencyId };
  if (body.patient_id !== undefined) {
    const patientId = exactIdentifier(body.patient_id);
    if (!patientId) throw new PublicError(400, 'patient_id is invalid');
    query.patient_id = patientId;
  }
  if (body.status !== undefined) {
    if (!REFERRAL_STATUSES.has(String(body.status))) {
      throw new PublicError(400, 'status is invalid');
    }
    query.status = body.status;
  }
  if (body.assigned_to !== undefined) {
    const assignedTo = canonicalEmail(body.assigned_to);
    if (!assignedTo || assignedTo !== authority.normalizedEmail) {
      throw new PublicError(403, 'Referral assignment filter is unavailable');
    }
    query.assigned_to = assignedTo;
  }
  const rows = requireRows(
    await base44.asServiceRole.entities.Referral.filter(
      query,
      '-created_date',
      Number(limit),
    ),
    'Referral.filter',
  );
  if (rows.length > Number(limit)) throw new PublicError(409, 'Referral list is ambiguous');
  if (rows.some((row) => (
    row?.agency_id !== authority.agencyId
    || (query.patient_id !== undefined && row?.patient_id !== query.patient_id)
    || (query.status !== undefined && row?.status !== query.status)
    || (query.assigned_to !== undefined && row?.assigned_to !== query.assigned_to)
  ))) {
    throw new PublicError(409, 'Referral query scope could not be verified');
  }
  const referrals = rows.map((row) => (
    narrowReferral(validateReferralIntegrity(
      row,
      exactIdentifier(row?.id) || '',
      authority.agencyId,
    ))
  ));
  const disclosureAuthority = await loadAuthority(
    base44,
    authority.agencyId,
    authority.snapshot,
  );
  return Response.json({
    success: true,
    action: 'list',
    referrals,
    scope: scope(disclosureAuthority),
  });
}

async function getReferral(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(body, ['action', 'agency_id', 'referral_id'], 'Referral get');
  const referralId = exactIdentifier(body.referral_id);
  if (!referralId) throw new PublicError(400, 'referral_id is invalid');
  const row = await loadExactReferral(
    base44.asServiceRole.entities,
    referralId,
    authority.agencyId,
  );
  const disclosureAuthority = await loadAuthority(
    base44,
    authority.agencyId,
    authority.snapshot,
  );
  const finalRow = await loadExactReferral(
    base44.asServiceRole.entities,
    referralId,
    authority.agencyId,
  );
  if (!sameValue(narrowReferral(finalRow), narrowReferral(row))) {
    throw new PublicError(409, 'Referral changed during read');
  }
  return Response.json({
    success: true,
    action: 'get',
    referral: narrowReferral(finalRow),
    scope: scope(disclosureAuthority),
  });
}

async function createReferral(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(
    body,
    ['action', 'agency_id', 'client_request_id', 'referral'],
    'Referral create',
  );
  const requestId = exactIdentifier(body.client_request_id);
  if (!requestId) throw new PublicError(400, 'client_request_id is invalid');
  const clientFields = validateBusinessFields(
    body.referral,
    authority.normalizedEmail,
    'create',
  );
  const fields = serverAuditFields(clientFields, authority.normalizedEmail);
  if (fields.patient_id) {
    await loadExactPatient(
      base44.asServiceRole.entities,
      String(fields.patient_id),
      authority.agencyId,
    );
  }
  const key = referralCreationKey(authority.agencyId, authority.userId, requestId);
  const existingRows = requireRows(
    await base44.asServiceRole.entities.Referral.filter(
      { referral_creation_key: key, agency_id: authority.agencyId },
      '-created_date',
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (existingRows.some((row) => (
    row?.referral_creation_key !== key || row?.agency_id !== authority.agencyId
  ))) {
    throw new PublicError(409, 'client_request_id query scope could not be verified');
  }
  if (existingRows.length >= EXACT_ROW_LIMIT || existingRows.length > 1) {
    throw new PublicError(409, 'client_request_id is ambiguous');
  }
  if (existingRows.length === 1) {
    const existing = validateReferralIntegrity(
      existingRows[0],
      String(existingRows[0].id),
      authority.agencyId,
    );
    const expectedClientFields = Object.fromEntries(
      Object.keys(clientFields).map((field) => [field, existing[field]]),
    );
    if (existing.version !== 1 || !sameValue(expectedClientFields, clientFields)) {
      throw new PublicError(409, 'client_request_id conflicts with another referral');
    }
    const replayAuthority = await loadAuthority(
      base44,
      authority.agencyId,
      authority.snapshot,
    );
    const replay = await loadExactReferral(
      base44.asServiceRole.entities,
      String(existing.id),
      authority.agencyId,
    );
    if (!sameValue(narrowReferral(replay), narrowReferral(existing))) {
      throw new PublicError(409, 'Referral changed during replay');
    }
    return Response.json({
      success: true,
      action: 'create',
      created: false,
      referral: narrowReferral(replay),
      scope: scope(replayAuthority),
    });
  }

  await loadAuthority(base44, authority.agencyId, authority.snapshot);
  if (fields.patient_id) {
    await loadExactPatient(
      base44.asServiceRole.entities,
      String(fields.patient_id),
      authority.agencyId,
    );
  }
  const created = await base44.asServiceRole.entities.Referral.create({
    ...fields,
    agency_id: authority.agencyId,
    created_by_user_id: authority.userId,
    created_by_user_email_normalized: authority.normalizedEmail,
    created_by: authority.normalizedEmail,
    client_request_id: requestId,
    referral_creation_key: key,
    version: 1,
  });
  const createdId = exactIdentifier(created?.id);
  if (!createdId) throw new Error('Referral.create returned no exact id');
  let exact: Record<string, any>;
  let finalAuthority: Record<string, any>;
  try {
    exact = await loadExactReferral(
      base44.asServiceRole.entities,
      createdId,
      authority.agencyId,
    );
    for (const [field, value] of Object.entries(fields)) {
      if (!sameValue(exact[field], value)) {
        throw new Error('Referral fields failed post-create verification');
      }
    }
    const keyedRows = requireRows(
      await base44.asServiceRole.entities.Referral.filter(
        { referral_creation_key: key, agency_id: authority.agencyId },
        '-created_date',
        EXACT_ROW_LIMIT,
      ),
      'Referral.filter',
    );
    if (
      keyedRows.some((row) => (
        row?.referral_creation_key !== key || row?.agency_id !== authority.agencyId
      ))
      || keyedRows.length !== 1
      || keyedRows[0]?.id !== createdId
    ) {
      throw new PublicError(409, 'client_request_id is ambiguous');
    }
    finalAuthority = await loadAuthority(base44, authority.agencyId, authority.snapshot);
  } catch (error) {
    await removeCreatedReferral(
      base44.asServiceRole.entities,
      createdId,
      authority.agencyId,
    );
    throw error;
  }
  return Response.json({
    success: true,
    action: 'create',
    created: true,
    referral: narrowReferral(exact),
    scope: scope(finalAuthority),
  }, { status: 201 });
}

async function updateReferral(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(body, ['action', 'agency_id', 'referral_id', 'changes'], 'Referral update');
  const referralId = exactIdentifier(body.referral_id);
  if (!referralId) throw new PublicError(400, 'referral_id is invalid');
  const changes = serverAuditFields(
    validateBusinessFields(body.changes, authority.normalizedEmail, 'update'),
    authority.normalizedEmail,
  );
  const entities = base44.asServiceRole.entities;
  const initial = await loadExactReferral(entities, referralId, authority.agencyId);
  if (changes.patient_id) {
    await loadExactPatient(entities, String(changes.patient_id), authority.agencyId);
  }
  await loadAuthority(base44, authority.agencyId, authority.snapshot);
  const current = await loadExactReferral(entities, referralId, authority.agencyId);
  if (!sameValue(narrowReferral(current), narrowReferral(initial))) {
    throw new PublicError(409, 'Referral changed during update');
  }
  if (changes.patient_id) {
    await loadExactPatient(entities, String(changes.patient_id), authority.agencyId);
  }
  const result = await entities.Referral.updateMany(
    {
      id: referralId,
      agency_id: authority.agencyId,
      version: current.version,
      updated_date: current.updated_date,
    },
    { $set: changes, $inc: { version: 1 } },
  );
  if (
    !plainObject(result)
    || result.success !== true
    || result.updated !== 1
    || result.has_more !== false
  ) {
    throw new PublicError(409, 'Referral changed during update');
  }
  const updated = await loadExactReferral(entities, referralId, authority.agencyId);
  if (updated.version !== current.version + 1) {
    throw new Error('Referral version failed post-update verification');
  }
  for (const [field, value] of Object.entries(changes)) {
    if (!sameValue(updated[field], value)) {
      throw new Error('Referral fields failed post-update verification');
    }
  }
  const finalAuthority = await loadAuthority(base44, authority.agencyId, authority.snapshot);
  return Response.json({
    success: true,
    action: 'update',
    referral: narrowReferral(updated),
    scope: scope(finalAuthority),
  });
}

async function deleteReferral(
  _base44: Record<string, any>,
  _authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(body, ['action', 'agency_id', 'referral_id'], 'Referral delete');
  const referralId = exactIdentifier(body.referral_id);
  if (!referralId) throw new PublicError(400, 'referral_id is invalid');
  // The SDK exposes no conditional delete. A read-then-delete sequence can
  // erase a row changed or re-bound between calls, so deletion remains paused
  // until the datastore supplies an atomic revision predicate.
  throw new PublicError(
    503,
    'Referral deletion is paused',
    'referral_delete_requires_atomic_compare_and_delete',
  );
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    }
    const input = await parseRequest(req);
    const base44 = createClientFromRequest(req);
    const authority = await loadAuthority(base44, input.agencyId);
    if (input.action === 'list') return await listReferrals(base44, authority, input.body);
    if (input.action === 'get') return await getReferral(base44, authority, input.body);
    if (input.action === 'create') return await createReferral(base44, authority, input.body);
    if (input.action === 'update') return await updateReferral(base44, authority, input.body);
    return await deleteReferral(base44, authority, input.body);
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        { status: error.status },
      );
    }
    // Provider errors may contain predicates or PHI; never log the object.
    console.error('manageAuthorizedReferral failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
