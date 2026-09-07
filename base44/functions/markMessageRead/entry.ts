import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/** Dormant secure-message v2 read-state broker with versioned updateMany CAS. */
const SECURE_MESSAGE_DOMAIN_PAUSED = true;
const SECURE_MESSAGE_MUTATIONS_PAUSED = true;

const MAX_BODY_BYTES = 2_000;
const MAX_IDENTIFIER_LENGTH = 200;
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
const MESSAGE_FIELDS = [
  'id', 'provenance_version', 'provenance_status', 'agency_id', 'thread_id',
  'thread_subject', 'patient_id', 'sender_user_id', 'sender_email', 'sender_name',
  'sender_membership_id', 'sender_membership_version', 'participant_user_ids',
  'participant_membership_bindings', 'participant_set_sha256',
  'recipient_user_ids', 'recipients', 'client_request_id', 'message_creation_key',
  'payload_sha256', 'subject', 'message_text', 'priority', 'read_by_user_ids',
  'read_by', 'is_read', 'state_version', 'created_by', 'created_date',
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
  code: 'secure_message_atomic_mutation_proof_required',
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
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value || value.startsWith('$')) return null;
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

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalJson(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pickFields(row: Record<string, any>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter((field) => row[field] !== undefined).map((field) => [field, row[field]]));
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
  if (Object.keys(record).some((key) => !['agency_id', 'id'].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(record.agency_id);
  const messageId = exactIdentifier(record.id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!messageId) throw new PublicError(400, 'id is invalid');
  return { agencyId, messageId };
}

function validateMembership(row: Record<string, any>, agencyId: string, user: Record<string, any>) {
  const email = canonicalEmail(user.email);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  if (!exactIdentifier(row?.id) || !email || row.agency_id !== agencyId || row.user_id !== user.id
    || row.membership_key !== `${agencyId}:${user.id}` || row.user_email_normalized !== email
    || row.status !== 'active' || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !exactIdentifier(row.created_by_user_id) || !validInstant(row.activated_at)
    || row.revoked_at != null || row.revocation_reason != null
    || !exactIdentifier(row.last_transition_by_user_id) || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at) || !boundedReason(row.last_transition_reason)
    || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  return row;
}

async function loadAuthority(base44: Record<string, any>, agencyId: string) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (!exactIdentifier(user.id) || !canonicalEmail(user.email) || user.is_active === false
    || user.disabled === true || user.is_service === true || user.is_verified === false) {
    throw new PublicError(403, 'Forbidden');
  }
  const entities = base44.asServiceRole.entities;
  const agencies = requireRows(await entities.Agency.filter(
    { id: agencyId }, undefined, EXACT_ROW_LIMIT, undefined, ['id', 'status'],
  ), 'Agency.filter');
  if (agencies.length >= EXACT_ROW_LIMIT || agencies.length > 1
    || agencies.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query is ambiguous');
  }
  if (agencies.length === 0 || !ENABLED_AGENCY_STATUSES.has(String(agencies[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  const memberships = requireRows(await entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: user.id }, '-updated_date', EXACT_ROW_LIMIT, undefined, MEMBERSHIP_FIELDS,
  ), 'AgencyMembership.filter');
  if (memberships.length >= EXACT_ROW_LIMIT
    || memberships.some((row) => row?.agency_id !== agencyId || row?.user_id !== user.id)) {
    throw new PublicError(409, 'Tenant membership query is ambiguous');
  }
  if (memberships.length > 1) throw new PublicError(409, 'Tenant membership query is ambiguous');
  if (memberships.length !== 1) throw new PublicError(403, 'No exact active membership for agency');
  const membership = validateMembership(memberships[0], agencyId, user);
  return { user, membership };
}

async function loadExactPatient(entities: Record<string, any>, agencyId: string, patientId: string) {
  const rows = requireRows(await entities.Patient.filter(
    { id: patientId, agency_id: agencyId, is_sample: false, is_archived: false },
    undefined, EXACT_ROW_LIMIT, undefined, PATIENT_FIELDS,
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
  if (!exactIdentifier(patient.created_by_user_id) || !creatorEmail
    || patient.created_by_user_email_normalized !== creatorEmail
    || platformCreatorEmail !== creatorEmail || patient.created_by !== creatorEmail
    || !clientRequestId
    || patient.patient_creation_key !== `${agencyId}:${patient.created_by_user_id}:${clientRequestId}`
    || patient.is_sample !== false || patient.is_archived !== false
    || !VISIBLE_PATIENT_STATUSES.has(String(patient.status || ''))
    || !validInstant(patient.updated_date)) {
    throw new PublicError(409, 'Patient provenance is incomplete');
  }
  return patient;
}

async function requirePatientAccess(
  entities: Record<string, any>,
  patient: Record<string, any>,
  authority: Record<string, any>,
) {
  if (PATIENT_WIDE_ROLES.has(authority.membership.tenant_role)) return;
  if (patient.created_by_user_id === authority.user.id
    && patient.created_by_user_email_normalized === canonicalEmail(authority.user.email)) return;
  const key = `${patient.agency_id}:${patient.id}:${authority.user.id}`;
  const rows = requireRows(await entities.PatientCareTeamAssignment.filter(
    { assignment_key: key, agency_id: patient.agency_id, patient_id: patient.id, user_id: authority.user.id },
    '-updated_date', EXACT_ROW_LIMIT, undefined, ASSIGNMENT_FIELDS,
  ), 'PatientCareTeamAssignment.filter');
  if (rows.length >= EXACT_ROW_LIMIT || rows.length > 1 || rows.some((row) => (
    row?.assignment_key !== key || row?.agency_id !== patient.agency_id
    || row?.patient_id !== patient.id || row?.user_id !== authority.user.id
  ))) throw new PublicError(409, 'Care-team assignment query is ambiguous');
  if (rows.length !== 1) throw new PublicError(404, 'Message unavailable');
  const assignment = rows[0];
  const creatorEmail = canonicalEmail(assignment.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(assignment.last_transition_by_email_normalized);
  const requestId = exactIdentifier(assignment.last_transition_request_id);
  const status = typeof assignment.status === 'string' ? assignment.status : '';
  const action = typeof assignment.last_transition_action === 'string'
    ? assignment.last_transition_action
    : '';
  if (!exactIdentifier(assignment.id) || !ASSIGNMENT_STATUSES.has(status)
    || !ASSIGNMENT_SOURCES.has(String(assignment.source || ''))
    || assignment.user_email_normalized !== canonicalEmail(authority.user.email)
    || assignment.assignee_membership_id !== authority.membership.id
    || assignment.assignee_membership_version_at_enablement !== authority.membership.version
    || !exactIdentifier(assignment.created_by_user_id) || !creatorEmail
    || assignment.created_by_user_email_normalized !== creatorEmail
    || !validInstant(assignment.activated_at)
    || (assignment.suspended_at != null && !validInstant(assignment.suspended_at))
    || (status === 'suspended' && !validInstant(assignment.suspended_at))
    || (assignment.revoked_at != null && !validInstant(assignment.revoked_at))
    || (status === 'revoked' && (
      !validInstant(assignment.revoked_at) || !boundedReason(assignment.revocation_reason)
    ))
    || (status !== 'revoked' && (assignment.revoked_at != null || assignment.revocation_reason != null))
    || !exactIdentifier(assignment.last_transition_by_user_id) || !transitionEmail
    || assignment.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(assignment.last_transition_at) || !boundedReason(assignment.last_transition_reason)
    || !ASSIGNMENT_ACTIONS.has(action)
    || (status === 'active' && action !== 'grant' && action !== 'activate')
    || (status === 'suspended' && action !== 'suspend')
    || (status === 'revoked' && action !== 'revoke')
    || !requestId || assignment.last_transition_request_key !== transitionRequestKey(key, requestId)
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
  if (status !== 'active') throw new PublicError(404, 'Message unavailable');
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

async function validateMessage(row: Record<string, any>, agencyId: string) {
  const threadId = exactIdentifier(row?.thread_id);
  const ids = Array.isArray(row?.participant_user_ids) ? row.participant_user_ids : [];
  const bindings = Array.isArray(row?.participant_membership_bindings)
    ? row.participant_membership_bindings
    : [];
  const senderBinding = bindings.find((binding) => binding.user_id === row.sender_user_id);
  const recipientUserIds = Array.isArray(row?.recipient_user_ids) ? row.recipient_user_ids : [];
  const expectedHash = threadId ? await sha256({
    agency_id: agencyId,
    thread_id: threadId,
    participant_membership_bindings: bindings,
  }) : null;
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
    || row.provenance_status !== 'verified_v2' || row.agency_id !== agencyId || !threadId
    || typeof row.thread_subject !== 'string' || !row.thread_subject || row.thread_subject.length > 300
    || (row.patient_id != null && !exactIdentifier(row.patient_id))
    || ids.length < 2 || new Set(ids).size !== ids.length || !sameValue(ids, [...ids].sort())
    || bindings.length !== ids.length
    || bindings.some((binding, index) => !validateBinding(binding) || binding.user_id !== ids[index])
    || row.participant_set_sha256 !== expectedHash || !senderBinding
    || row.sender_email !== senderBinding.user_email_normalized
    || row.sender_membership_id !== senderBinding.membership_id
    || row.sender_membership_version !== senderBinding.membership_version
    || row.created_by !== row.sender_email
    || !sameValue(recipientUserIds, ids.filter((id) => id !== row.sender_user_id))
    || !Array.isArray(row.recipients)
    || !sameValue(row.recipients, bindings.filter((binding) => binding.user_id !== row.sender_user_id)
      .map((binding) => binding.user_email_normalized))
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

async function loadExactMessage(entities: Record<string, any>, agencyId: string, messageId: string) {
  const rows = requireRows(await entities.Message.filter(
    { id: messageId, agency_id: agencyId }, undefined, EXACT_ROW_LIMIT, undefined, MESSAGE_FIELDS,
  ), 'Message.filter');
  if (rows.length >= EXACT_ROW_LIMIT || rows.length > 1
    || rows.some((row) => row?.id !== messageId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Message query is ambiguous');
  }
  if (rows.length !== 1) throw new PublicError(404, 'Message unavailable');
  return validateMessage(rows[0], agencyId);
}

async function requireThreadConsistency(entities: Record<string, any>, message: Record<string, any>) {
  const rows = requireRows(await entities.Message.filter(
    { agency_id: message.agency_id, thread_id: message.thread_id },
    'created_date', THREAD_ROW_LIMIT, undefined, MESSAGE_FIELDS,
  ), 'Message.filter');
  if (rows.length === 0 || rows.length >= THREAD_ROW_LIMIT
    || rows.some((row) => row?.agency_id !== message.agency_id || row?.thread_id !== message.thread_id)) {
    throw new PublicError(409, 'Thread provenance is incomplete or ambiguous');
  }
  for (const row of rows) {
    await validateMessage(row, message.agency_id);
    if (row.thread_subject !== message.thread_subject || row.patient_id !== message.patient_id
      || row.participant_set_sha256 !== message.participant_set_sha256
      || !sameValue(row.participant_user_ids, message.participant_user_ids)
      || !sameValue(row.participant_membership_bindings, message.participant_membership_bindings)) {
      throw new PublicError(409, 'Thread provenance is incomplete or ambiguous');
    }
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length
    || new Set(rows.map((row) => row.message_creation_key)).size !== rows.length) {
    throw new PublicError(409, 'Thread contains duplicate message identity');
  }
}

function immutableSnapshot(row: Record<string, any>) {
  return pickFields(row, [
    'id', 'agency_id', 'thread_id', 'thread_subject', 'patient_id',
    'sender_user_id', 'sender_email', 'sender_membership_id', 'sender_membership_version',
    'participant_user_ids', 'participant_membership_bindings', 'participant_set_sha256',
    'recipient_user_ids', 'recipients', 'client_request_id', 'message_creation_key',
    'payload_sha256', 'subject', 'message_text', 'priority', 'created_by', 'created_date',
  ]);
}

function requireReconcilableUpdate(outcome: Record<string, any> | null) {
  if (!outcome || outcome.success !== true || !Number.isInteger(outcome.updated)
    || outcome.updated < 0 || outcome.updated > 1 || outcome.has_more !== false) {
    throw new Error('Message CAS returned an ambiguous result');
  }
}

async function reconcileCas(
  entities: Record<string, any>,
  before: Record<string, any>,
  outcome: Record<string, any>,
  predicate: (row: Record<string, any>) => boolean,
) {
  requireReconcilableUpdate(outcome);
  const after = await loadExactMessage(entities, before.agency_id, before.id);
  if (!sameValue(immutableSnapshot(after), immutableSnapshot(before)) || !predicate(after)) {
    throw new PublicError(409, 'Message state changed; retry');
  }
  return after;
}

Deno.serve(async (req) => {
  if (SECURE_MESSAGE_DOMAIN_PAUSED) return secureMessageUnavailable();
  if (SECURE_MESSAGE_MUTATIONS_PAUSED) return secureMessageMutationUnavailable();

  try {
    const input = await parseRequest(req);
    const base44 = createClientFromRequest(req);
    const authority = await loadAuthority(base44, input.agencyId);
    const entities = base44.asServiceRole.entities;
    let message = await loadExactMessage(entities, input.agencyId, input.messageId);
    await requireThreadConsistency(entities, message);

    const participantIndex = message.participant_user_ids.indexOf(authority.user.id);
    if (participantIndex < 0) throw new PublicError(404, 'Message unavailable');
    const bound = message.participant_membership_bindings[participantIndex];
    if (bound.membership_id !== authority.membership.id
      || bound.membership_version !== authority.membership.version
      || bound.user_email_normalized !== canonicalEmail(authority.user.email)) {
      throw new PublicError(409, 'Thread participant authority changed');
    }
    if (message.patient_id) {
      const patient = await loadExactPatient(entities, input.agencyId, message.patient_id);
      await requirePatientAccess(entities, patient, authority);
    }

    const callerId = authority.user.id;
    if (!message.read_by_user_ids.includes(callerId)) {
      const expectedVersion = message.state_version;
      const outcome = await entities.Message.updateMany(
        {
          id: message.id,
          agency_id: message.agency_id,
          provenance_version: 2,
          provenance_status: 'verified_v2',
          state_version: expectedVersion,
        },
        {
          $addToSet: {
            read_by_user_ids: callerId,
            read_by: canonicalEmail(authority.user.email),
          },
          $set: { state_version: expectedVersion + 1 },
        },
      );
      message = await reconcileCas(
        entities,
        message,
        outcome,
        (row) => row.state_version === expectedVersion + 1 && row.read_by_user_ids.includes(callerId),
      );
    }

    const everyRecipientRead = message.recipient_user_ids.every(
      (recipientId: string) => message.read_by_user_ids.includes(recipientId),
    );
    if (everyRecipientRead && message.is_read !== true) {
      const expectedVersion = message.state_version;
      const outcome = await entities.Message.updateMany(
        {
          id: message.id,
          agency_id: message.agency_id,
          provenance_version: 2,
          provenance_status: 'verified_v2',
          state_version: expectedVersion,
        },
        { $set: { is_read: true, state_version: expectedVersion + 1 } },
      );
      message = await reconcileCas(
        entities,
        message,
        outcome,
        (row) => row.state_version === expectedVersion + 1 && row.is_read === true,
      );
    }

    if (message.patient_id) {
      const finalAuthority = await loadAuthority(base44, input.agencyId);
      if (finalAuthority.user.id !== authority.user.id
        || canonicalEmail(finalAuthority.user.email) !== canonicalEmail(authority.user.email)
        || !sameValue(finalAuthority.membership, authority.membership)) {
        throw new PublicError(409, 'Message authority changed; retry');
      }
      const finalPatient = await loadExactPatient(entities, input.agencyId, message.patient_id);
      await requirePatientAccess(entities, finalPatient, finalAuthority);
    }

    return json({ success: true, message: pickFields(message, RESPONSE_FIELDS) });
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ error: error.message }, error.status, error.status === 405 ? { Allow: 'POST' } : {});
    }
    console.error('markMessageRead failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
