import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/**
 * Dormant secure-message v2 create broker.
 *
 * Base44 currently documents create/filter/updateMany but no unique constraint,
 * transaction, or atomic create-if-absent primitive. Consequently the domain
 * and this mutation remain statically paused. The implementation below makes
 * the intended authority, provenance, idempotency, and duplicate quarantine
 * contract executable in tests without representing create as race-safe.
 */

const SECURE_MESSAGE_DOMAIN_PAUSED = true;
const SECURE_MESSAGE_MUTATIONS_PAUSED = true;

const MAX_BODY_BYTES = 24_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_RECIPIENTS = 25;
const EXACT_ROW_LIMIT = 10;
const THREAD_ROW_LIMIT = 500;
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const VISIBLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const TENANT_ROLES = new Set([
  'agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care',
]);
const PATIENT_WIDE_ROLES = new Set(['agency_admin', 'manager']);
const PRIORITIES = new Set(['normal', 'high', 'urgent']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual', 'patient_creator', 'legacy_assigned_nurses', 'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);

const MEMBERSHIP_FIELDS = [
  'id', 'membership_key', 'agency_id', 'user_id', 'user_email_normalized',
  'tenant_role', 'status', 'created_by_user_id', 'activated_at', 'revoked_at',
  'revocation_reason', 'last_transition_by_user_id',
  'last_transition_by_email_normalized', 'last_transition_at',
  'last_transition_reason', 'version',
];
const USER_FIELDS = ['id', 'email', 'full_name', 'is_active', 'disabled', 'is_verified', 'is_service'];
const PATIENT_FIELDS = [
  'id', 'agency_id', 'created_by_user_id', 'created_by_user_email_normalized',
  'created_by', 'client_request_id', 'patient_creation_key',
  'is_sample', 'is_archived', 'status', 'updated_date',
];
const ASSIGNMENT_FIELDS = [
  'id', 'assignment_key', 'agency_id', 'patient_id', 'user_id',
  'user_email_normalized', 'assignee_membership_id',
  'assignee_membership_version_at_enablement', 'status', 'source',
  'created_by_user_id', 'created_by_user_email_normalized', 'activated_at',
  'suspended_at', 'revoked_at', 'revocation_reason',
  'last_transition_by_user_id', 'last_transition_by_email_normalized',
  'last_transition_at', 'last_transition_reason', 'last_transition_action',
  'last_transition_request_id', 'last_transition_request_key', 'version', 'updated_date',
];
const MESSAGE_AUTHORITY_FIELDS = [
  'id', 'provenance_version', 'provenance_status', 'agency_id', 'thread_id',
  'thread_subject', 'patient_id', 'sender_user_id', 'sender_email',
  'sender_membership_id', 'sender_membership_version', 'participant_user_ids',
  'participant_membership_bindings', 'participant_set_sha256',
  'recipient_user_ids', 'recipients', 'client_request_id',
  'message_creation_key', 'payload_sha256', 'subject', 'message_text',
  'priority', 'read_by_user_ids', 'read_by', 'is_read', 'state_version',
  'created_by', 'created_date',
];
const RESPONSE_FIELDS = [
  'id', 'agency_id', 'thread_id', 'thread_subject', 'patient_id',
  'sender_user_id', 'sender_name', 'recipient_user_ids', 'subject',
  'message_text', 'priority', 'read_by_user_ids', 'is_read',
  'state_version', 'created_date',
];

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

const secureMessageUnavailable = () => json({
  error: 'Secure messaging is temporarily unavailable',
  code: 'secure_message_tenant_broker_required',
}, 503);

const secureMessageMutationUnavailable = () => json({
  error: 'Secure message writes are temporarily unavailable',
  code: 'secure_message_atomic_create_required',
}, 503);

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const result = normalizeEmail(value);
  if (!result || result.length > 320 || !result.includes('@') || /\s/.test(result)) return null;
  return result;
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  if (value.startsWith('$')) return null;
  return value;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= 500 ? result : null;
}

function transitionRequestKey(key: string, requestId: string) {
  return `${key}:${requestId}`;
}

function boundedString(value: unknown, label: string, maximum: number, required = false) {
  if (value == null) {
    if (required) throw new PublicError(400, `${label} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new PublicError(400, `${label} is invalid`);
  const result = value.trim();
  if (required && !result) throw new PublicError(400, `${label} is required`);
  if (result.length > maximum) throw new PublicError(400, `${label} is too long`);
  return result || null;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function pickFields(row: Record<string, any>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter((field) => row[field] !== undefined).map((field) => [field, row[field]]));
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

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalJson(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseRequest(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
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
  const record = body as Record<string, unknown>;
  const allowed = new Set([
    'agency_id', 'client_request_id', 'recipient_user_ids', 'thread_id',
    'patient_id', 'subject', 'message_text', 'priority',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(record.agency_id);
  const clientRequestId = exactIdentifier(record.client_request_id);
  const threadId = record.thread_id == null ? null : exactIdentifier(record.thread_id);
  const patientId = record.patient_id == null ? null : exactIdentifier(record.patient_id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!clientRequestId) throw new PublicError(400, 'client_request_id is invalid');
  if (record.thread_id != null && !threadId) throw new PublicError(400, 'thread_id is invalid');
  if (record.patient_id != null && !patientId) throw new PublicError(400, 'patient_id is invalid');
  const messageText = boundedString(record.message_text, 'message_text', 20_000, true) as string;
  const subject = boundedString(record.subject, 'subject', 300, !threadId);
  const priority = record.priority == null ? 'normal' : String(record.priority);
  if (!PRIORITIES.has(priority)) throw new PublicError(400, 'priority is invalid');

  let recipientUserIds: string[] | null = null;
  if (!threadId) {
    if (!Array.isArray(record.recipient_user_ids) || record.recipient_user_ids.length === 0) {
      throw new PublicError(400, 'recipient_user_ids is required for a new thread');
    }
    if (record.recipient_user_ids.length > MAX_RECIPIENTS) {
      throw new PublicError(400, 'too many recipients');
    }
    recipientUserIds = [...new Set(record.recipient_user_ids.map((value) => {
      const id = exactIdentifier(value);
      if (!id) throw new PublicError(400, 'recipient_user_ids is invalid');
      return id;
    }))].sort();
  } else if (record.recipient_user_ids !== undefined || record.subject !== undefined || record.patient_id !== undefined) {
    throw new PublicError(400, 'Thread replies derive recipients, subject, and patient from the verified thread');
  }
  return {
    agencyId, clientRequestId, threadId, patientId, subject,
    messageText, priority, recipientUserIds,
  };
}

function validateMembership(row: Record<string, any>, agencyId: string, user: Record<string, any>) {
  const membershipId = exactIdentifier(row?.id);
  const userId = exactIdentifier(user?.id);
  const email = canonicalEmail(user?.email);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  if (
    !membershipId || !userId || !email
    || row.agency_id !== agencyId
    || row.user_id !== userId
    || row.membership_key !== `${agencyId}:${userId}`
    || row.user_email_normalized !== email
    || row.status !== 'active'
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !exactIdentifier(row.created_by_user_id)
    || !validInstant(row.activated_at)
    || row.revoked_at != null
    || row.revocation_reason != null
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
  ) throw new PublicError(409, 'Tenant membership integrity check failed');
  return row;
}

async function loadExactMembership(entities: Record<string, any>, agencyId: string, user: Record<string, any>) {
  const rows = requireRows(await entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: user.id }, '-updated_date', EXACT_ROW_LIMIT, undefined, MEMBERSHIP_FIELDS,
  ), 'AgencyMembership.filter');
  if (rows.length >= EXACT_ROW_LIMIT || rows.some((row) => row?.agency_id !== agencyId || row?.user_id !== user.id)) {
    throw new PublicError(409, 'Tenant membership query is ambiguous');
  }
  if (rows.length > 1) throw new PublicError(409, 'Tenant membership query is ambiguous');
  if (rows.length !== 1) throw new PublicError(403, 'No exact active membership for agency');
  return validateMembership(rows[0], agencyId, user);
}

async function loadExactAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(await entities.Agency.filter(
    { id: agencyId }, undefined, EXACT_ROW_LIMIT, undefined, ['id', 'status'],
  ), 'Agency.filter');
  if (rows.length >= EXACT_ROW_LIMIT || rows.length > 1 || rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query is ambiguous');
  }
  if (rows.length === 0 || !ENABLED_AGENCY_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
}

async function loadExactUser(entities: Record<string, any>, userId: string) {
  const rows = requireRows(await entities.User.filter(
    { id: userId }, undefined, EXACT_ROW_LIMIT, undefined, USER_FIELDS,
  ), 'User.filter');
  if (rows.length >= EXACT_ROW_LIMIT || rows.length > 1 || rows.some((row) => row?.id !== userId)) {
    throw new PublicError(409, 'Participant identity is ambiguous');
  }
  if (rows.length !== 1) throw new PublicError(403, 'One or more participants are unavailable');
  const user = rows[0];
  if (!canonicalEmail(user.email) || user.is_active === false || user.disabled === true
    || user.is_service === true || user.is_verified === false) {
    throw new PublicError(403, 'One or more participants are unavailable');
  }
  return user;
}

function bindingFor(user: Record<string, any>, membership: Record<string, any>) {
  return {
    user_id: user.id,
    user_email_normalized: canonicalEmail(user.email),
    membership_id: membership.id,
    membership_version: membership.version,
    tenant_role: membership.tenant_role,
  };
}

async function loadAuthority(base44: Record<string, any>, agencyId: string) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (!exactIdentifier(user.id) || !canonicalEmail(user.email) || user.is_active === false
    || user.disabled === true || user.is_service === true || user.is_verified === false) {
    throw new PublicError(403, 'Forbidden');
  }
  const entities = base44.asServiceRole.entities;
  await loadExactAgency(entities, agencyId);
  const membership = await loadExactMembership(entities, agencyId, user);
  return { user, membership, binding: bindingFor(user, membership) };
}

async function loadParticipant(entities: Record<string, any>, agencyId: string, userId: string) {
  const user = await loadExactUser(entities, userId);
  const membership = await loadExactMembership(entities, agencyId, user);
  return { user, membership, binding: bindingFor(user, membership) };
}

async function loadExactPatient(entities: Record<string, any>, agencyId: string, patientId: string) {
  const rows = requireRows(await entities.Patient.filter(
    { id: patientId, agency_id: agencyId }, undefined, EXACT_ROW_LIMIT, undefined, PATIENT_FIELDS,
  ), 'Patient.filter');
  if (rows.length >= EXACT_ROW_LIMIT || rows.length > 1
    || rows.some((row) => row?.id !== patientId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Patient query is ambiguous');
  }
  if (rows.length !== 1) throw new PublicError(404, 'Patient unavailable');
  const patient = rows[0];
  const creatorEmail = canonicalEmail(patient.created_by_user_email_normalized);
  const platformCreatorEmail = canonicalEmail(patient.created_by);
  const clientRequestId = exactIdentifier(patient.client_request_id);
  if (!exactIdentifier(patient.created_by_user_id)
    || !creatorEmail
    || patient.created_by_user_email_normalized !== creatorEmail
    || platformCreatorEmail !== creatorEmail
    || patient.created_by !== creatorEmail
    || !clientRequestId
    || patient.patient_creation_key !== `${agencyId}:${patient.created_by_user_id}:${clientRequestId}`
    || patient.is_sample !== false
    || patient.is_archived !== false
    || !VISIBLE_PATIENT_STATUSES.has(String(patient.status || ''))
    || !validInstant(patient.updated_date)) {
    throw new PublicError(409, 'Patient provenance is incomplete');
  }
  return patient;
}

async function requirePatientAccess(entities: Record<string, any>, patient: Record<string, any>, participant: Record<string, any>) {
  if (PATIENT_WIDE_ROLES.has(participant.membership.tenant_role)) return;
  if (patient.created_by_user_id === participant.user.id
    && patient.created_by_user_email_normalized === canonicalEmail(participant.user.email)) return;
  const key = `${patient.agency_id}:${patient.id}:${participant.user.id}`;
  const rows = requireRows(await entities.PatientCareTeamAssignment.filter(
    { assignment_key: key, agency_id: patient.agency_id, patient_id: patient.id, user_id: participant.user.id },
    '-updated_date', EXACT_ROW_LIMIT, undefined, ASSIGNMENT_FIELDS,
  ), 'PatientCareTeamAssignment.filter');
  if (rows.length >= EXACT_ROW_LIMIT || rows.length > 1 || rows.some((row) => (
    row?.assignment_key !== key || row?.agency_id !== patient.agency_id
    || row?.patient_id !== patient.id || row?.user_id !== participant.user.id
  ))) throw new PublicError(409, 'Care-team assignment query is ambiguous');
  if (rows.length !== 1) throw new PublicError(403, 'One or more participants cannot access the patient');
  const assignment = rows[0];
  const creatorEmail = canonicalEmail(assignment.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(assignment.last_transition_by_email_normalized);
  const requestId = exactIdentifier(assignment.last_transition_request_id);
  const status = typeof assignment.status === 'string' ? assignment.status : '';
  const action = typeof assignment.last_transition_action === 'string'
    ? assignment.last_transition_action
    : '';
  if (!exactIdentifier(assignment.id)
    || !ASSIGNMENT_STATUSES.has(status)
    || !ASSIGNMENT_SOURCES.has(String(assignment.source || ''))
    || assignment.user_email_normalized !== canonicalEmail(participant.user.email)
    || assignment.assignee_membership_id !== participant.membership.id
    || assignment.assignee_membership_version_at_enablement !== participant.membership.version
    || !exactIdentifier(assignment.created_by_user_id)
    || !creatorEmail
    || assignment.created_by_user_email_normalized !== creatorEmail
    || !validInstant(assignment.activated_at)
    || (assignment.suspended_at != null && !validInstant(assignment.suspended_at))
    || (status === 'suspended' && !validInstant(assignment.suspended_at))
    || (assignment.revoked_at != null && !validInstant(assignment.revoked_at))
    || (status === 'revoked' && (
      !validInstant(assignment.revoked_at) || !boundedReason(assignment.revocation_reason)
    ))
    || (status !== 'revoked' && (assignment.revoked_at != null || assignment.revocation_reason != null))
    || !exactIdentifier(assignment.last_transition_by_user_id)
    || !transitionEmail
    || assignment.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(assignment.last_transition_at)
    || !boundedReason(assignment.last_transition_reason)
    || !ASSIGNMENT_ACTIONS.has(action)
    || (status === 'active' && action !== 'grant' && action !== 'activate')
    || (status === 'suspended' && action !== 'suspend')
    || (status === 'revoked' && action !== 'revoke')
    || !requestId
    || assignment.last_transition_request_key !== transitionRequestKey(key, requestId)
    || !Number.isSafeInteger(assignment.version) || assignment.version < 1
    || !validInstant(assignment.updated_date)
    || Date.parse(assignment.updated_date) < Date.parse(assignment.last_transition_at)
    || (action === 'grant' && (
      assignment.version !== 1
      || assignment.activated_at !== assignment.last_transition_at
      || assignment.suspended_at != null
    ))
    || (action === 'activate' && (
      assignment.version < 3
      || assignment.version % 2 !== 1
      || !validInstant(assignment.suspended_at)
      || Date.parse(assignment.suspended_at) > Date.parse(assignment.activated_at)
      || assignment.activated_at !== assignment.last_transition_at
    ))) {
    throw new PublicError(409, 'Care-team assignment integrity check failed');
  }
  if (status !== 'active') {
    throw new PublicError(403, 'One or more participants cannot access the patient');
  }
}

function validateBinding(binding: Record<string, any>) {
  return !!exactIdentifier(binding?.user_id)
    && !!canonicalEmail(binding?.user_email_normalized)
    && binding.user_email_normalized === canonicalEmail(binding.user_email_normalized)
    && !!exactIdentifier(binding?.membership_id)
    && Number.isSafeInteger(binding?.membership_version)
    && binding.membership_version >= 1
    && TENANT_ROLES.has(String(binding?.tenant_role || ''));
}

async function expectedParticipantHash(agencyId: string, threadId: string, bindings: Array<Record<string, any>>) {
  return sha256({ agency_id: agencyId, thread_id: threadId, participant_membership_bindings: bindings });
}

async function validateMessageRow(row: Record<string, any>, agencyId: string, threadId: string) {
  const bindings = Array.isArray(row?.participant_membership_bindings) ? row.participant_membership_bindings : [];
  const ids = Array.isArray(row?.participant_user_ids) ? row.participant_user_ids : [];
  const sortedIds = [...ids].sort();
  const senderBinding = bindings.find((binding) => binding.user_id === row.sender_user_id);
  const recipientUserIds = Array.isArray(row?.recipient_user_ids) ? row.recipient_user_ids : [];
  const expectedPayload = {
    agency_id: agencyId,
    thread_id: threadId,
    thread_subject: row?.thread_subject,
    patient_id: row?.patient_id ?? null,
    sender_user_id: row?.sender_user_id,
    sender_membership_id: row?.sender_membership_id,
    sender_membership_version: row?.sender_membership_version,
    participant_membership_bindings: bindings,
    participant_set_sha256: row?.participant_set_sha256,
    recipient_user_ids: recipientUserIds,
    subject: row?.subject,
    message_text: row?.message_text,
    priority: row?.priority,
  };
  if (!exactIdentifier(row?.id) || row.provenance_version !== 2
    || row.provenance_status !== 'verified_v2' || row.agency_id !== agencyId
    || row.thread_id !== threadId || !exactIdentifier(row.thread_id)
    || typeof row.thread_subject !== 'string' || !row.thread_subject || row.thread_subject.length > 300
    || (row.patient_id != null && !exactIdentifier(row.patient_id))
    || ids.length < 2 || new Set(ids).size !== ids.length || !sameValue(ids, sortedIds)
    || bindings.length !== ids.length
    || bindings.some((binding, index) => !validateBinding(binding) || binding.user_id !== ids[index])
    || row.participant_set_sha256 !== await expectedParticipantHash(agencyId, threadId, bindings)
    || !ids.includes(row.sender_user_id) || !senderBinding
    || row.sender_membership_id !== senderBinding.membership_id
    || row.sender_membership_version !== senderBinding.membership_version
    || row.sender_email !== senderBinding.user_email_normalized || row.created_by !== row.sender_email
    || !sameValue(recipientUserIds, ids.filter((id) => id !== row.sender_user_id))
    || !Array.isArray(row.recipients)
    || !sameValue(row.recipients, bindings.filter((binding) => binding.user_id !== row.sender_user_id).map((binding) => binding.user_email_normalized))
    || !exactIdentifier(row.client_request_id)
    || row.message_creation_key !== `${threadId}:${row.sender_user_id}:${row.client_request_id}`
    || row.subject !== row.thread_subject
    || typeof row.message_text !== 'string' || !row.message_text || row.message_text.length > 20_000
    || !PRIORITIES.has(String(row.priority || ''))
    || row.payload_sha256 !== await sha256(expectedPayload)
    || !Array.isArray(row.read_by_user_ids) || !row.read_by_user_ids.includes(row.sender_user_id)
    || new Set(row.read_by_user_ids).size !== row.read_by_user_ids.length
    || row.read_by_user_ids.some((id) => !ids.includes(id))
    || !Number.isSafeInteger(row.state_version) || row.state_version < 1) {
    throw new PublicError(409, 'Message provenance is incomplete or ambiguous');
  }
  return row;
}

async function loadVerifiedThread(
  entities: Record<string, any>,
  agencyId: string,
  threadId: string,
  allowMissing = false,
) {
  const rows = requireRows(await entities.Message.filter(
    { agency_id: agencyId, thread_id: threadId }, 'created_date', THREAD_ROW_LIMIT, undefined, MESSAGE_AUTHORITY_FIELDS,
  ), 'Message.filter');
  if (rows.length === 0) {
    if (allowMissing) return null;
    throw new PublicError(404, 'Thread unavailable');
  }
  if (rows.length >= THREAD_ROW_LIMIT || rows.some((row) => row?.agency_id !== agencyId || row?.thread_id !== threadId)) {
    throw new PublicError(409, 'Thread is incomplete or ambiguous');
  }
  for (const row of rows) await validateMessageRow(row, agencyId, threadId);
  if (new Set(rows.map((row) => row.id)).size !== rows.length
    || new Set(rows.map((row) => row.message_creation_key)).size !== rows.length) {
    throw new PublicError(409, 'Thread contains duplicate message identity');
  }
  const root = rows[0];
  if (rows.some((row) => row.thread_subject !== root.thread_subject || row.patient_id !== root.patient_id
    || row.participant_set_sha256 !== root.participant_set_sha256
    || !sameValue(row.participant_user_ids, root.participant_user_ids)
    || !sameValue(row.participant_membership_bindings, root.participant_membership_bindings))) {
    throw new PublicError(409, 'Thread provenance is inconsistent');
  }
  return { root, rows };
}

async function loadCurrentParticipants(entities: Record<string, any>, agencyId: string, participantIds: string[]) {
  return Promise.all(participantIds.map((userId) => loadParticipant(entities, agencyId, userId)));
}

async function loadByCreationKey(entities: Record<string, any>, creationKey: string) {
  const rows = requireRows(await entities.Message.filter(
    { message_creation_key: creationKey }, '-created_date', EXACT_ROW_LIMIT, undefined, MESSAGE_AUTHORITY_FIELDS,
  ), 'Message.filter');
  if (rows.length >= EXACT_ROW_LIMIT || rows.some((row) => row?.message_creation_key !== creationKey) || rows.length > 1) {
    throw new PublicError(409, 'Message idempotency state is ambiguous');
  }
  return rows[0] || null;
}

Deno.serve(async (req) => {
  if (SECURE_MESSAGE_DOMAIN_PAUSED) return secureMessageUnavailable();
  if (SECURE_MESSAGE_MUTATIONS_PAUSED) return secureMessageMutationUnavailable();

  try {
    const input = await parseRequest(req);
    const base44 = createClientFromRequest(req);
    const authority = await loadAuthority(base44, input.agencyId);
    const entities = base44.asServiceRole.entities;

    let threadId = input.threadId;
    let threadSubject = input.subject;
    let patientId = input.patientId;
    let participants: Array<Record<string, any>>;
    let verifiedThread: Record<string, any> | null = null;

    if (threadId) {
      verifiedThread = await loadVerifiedThread(entities, input.agencyId, threadId);
      if (!verifiedThread?.root.participant_user_ids.includes(authority.user.id)) {
        throw new PublicError(403, 'Thread unavailable');
      }
      threadSubject = verifiedThread.root.thread_subject;
      patientId = verifiedThread.root.patient_id || null;
      participants = await loadCurrentParticipants(entities, input.agencyId, verifiedThread.root.participant_user_ids);
      const currentBindings = participants.map((participant) => participant.binding)
        .sort((left, right) => left.user_id.localeCompare(right.user_id));
      if (!sameValue(currentBindings, verifiedThread.root.participant_membership_bindings)) {
        throw new PublicError(409, 'Thread participant authority changed');
      }
    } else {
      if (input.recipientUserIds?.includes(authority.user.id)) {
        throw new PublicError(400, 'sender cannot also be a recipient');
      }
      const recipients = await loadCurrentParticipants(entities, input.agencyId, input.recipientUserIds || []);
      participants = [authority, ...recipients]
        .sort((left, right) => left.user.id.localeCompare(right.user.id));
      const seed = await sha256({
        agency_id: input.agencyId,
        creator_user_id: authority.user.id,
        client_request_id: input.clientRequestId,
      });
      threadId = `message-thread-${seed}`;
      verifiedThread = await loadVerifiedThread(entities, input.agencyId, threadId, true);
    }

    const patient = patientId ? await loadExactPatient(entities, input.agencyId, patientId) : null;
    if (patient) {
      for (const participant of participants) await requirePatientAccess(entities, patient, participant);
    }

    const bindings = participants.map((participant) => participant.binding)
      .sort((left, right) => left.user_id.localeCompare(right.user_id));
    const participantUserIds = bindings.map((binding) => binding.user_id);
    const participantSetSha256 = await expectedParticipantHash(input.agencyId, threadId, bindings);
    const recipientBindings = bindings.filter((binding) => binding.user_id !== authority.user.id);
    const creationKey = `${threadId}:${authority.user.id}:${input.clientRequestId}`;
    const payload = {
      agency_id: input.agencyId, thread_id: threadId, thread_subject: threadSubject,
      patient_id: patientId, sender_user_id: authority.user.id,
      sender_membership_id: authority.membership.id,
      sender_membership_version: authority.membership.version,
      participant_membership_bindings: bindings,
      participant_set_sha256: participantSetSha256,
      recipient_user_ids: recipientBindings.map((binding) => binding.user_id),
      subject: threadSubject, message_text: input.messageText, priority: input.priority,
    };
    const payloadSha256 = await sha256(payload);

    const existing = await loadByCreationKey(entities, creationKey);
    if (existing) {
      await validateMessageRow(existing, input.agencyId, threadId);
      if (existing.payload_sha256 !== payloadSha256) {
        throw new PublicError(409, 'client_request_id was already used for different content');
      }
      return json({ success: true, idempotent_replay: true, message: pickFields(existing, RESPONSE_FIELDS) });
    }
    if (!input.threadId && verifiedThread) {
      throw new PublicError(409, 'Thread identity already exists without the requested message identity');
    }

    const senderEmail = canonicalEmail(authority.user.email) as string;
    const record = {
      provenance_version: 2,
      provenance_status: 'verified_v2',
      agency_id: input.agencyId,
      thread_id: threadId,
      thread_subject: threadSubject,
      ...(patientId ? { patient_id: patientId } : {}),
      sender_user_id: authority.user.id,
      sender_membership_id: authority.membership.id,
      sender_membership_version: authority.membership.version,
      sender_email: senderEmail,
      sender_name: String(authority.user.full_name || senderEmail).trim().slice(0, 300),
      created_by: senderEmail,
      participant_user_ids: participantUserIds,
      participant_membership_bindings: bindings,
      participant_set_sha256: participantSetSha256,
      recipient_user_ids: recipientBindings.map((binding) => binding.user_id),
      recipients: recipientBindings.map((binding) => binding.user_email_normalized),
      subject: threadSubject,
      message_text: input.messageText,
      priority: input.priority,
      client_request_id: input.clientRequestId,
      message_creation_key: creationKey,
      payload_sha256: payloadSha256,
      read_by_user_ids: [authority.user.id],
      read_by: [senderEmail],
      is_read: false,
      state_version: 1,
    };

    const created = await entities.Message.create(record);
    if (!exactIdentifier(created?.id)) throw new Error('Message create returned no exact id');
    const persisted = await loadByCreationKey(entities, creationKey);
    if (!persisted || persisted.id !== created.id) {
      throw new PublicError(409, 'Message create could not be uniquely reconciled');
    }
    await validateMessageRow(persisted, input.agencyId, threadId);
    if (persisted.payload_sha256 !== payloadSha256) {
      throw new PublicError(409, 'Message create could not be reconciled');
    }
    return json({ success: true, idempotent_replay: false, message: pickFields(persisted, RESPONSE_FIELDS) });
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ error: error.message }, error.status, error.status === 405 ? { Allow: 'POST' } : {});
    }
    console.error('sendMessage failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
