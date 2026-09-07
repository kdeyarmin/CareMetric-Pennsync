import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/**
 * Dormant urgent-message trigger validator.
 *
 * The retired entity trigger is not an authority boundary. A future dispatcher
 * must call this endpoint with a short-lived, purpose-bound HMAC capability.
 * Notification.create has no documented atomic create-if-absent primitive, so
 * delivery remains separately paused until a uniquely keyed outbox is proven.
 */
const SECURE_MESSAGE_DOMAIN_PAUSED = true;
const SECURE_MESSAGE_MUTATIONS_PAUSED = true;
const URGENT_MESSAGE_OUTBOX_PAUSED = true;

const URGENT_TRIGGER_ACTION = 'notify_urgent_message_v2';
const MAX_BODY_BYTES = 8_000;
const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_ROW_LIMIT = 10;
const THREAD_ROW_LIMIT = 101;
const CAPABILITY_MAX_LIFETIME_MS = 5 * 60 * 1_000;
const CAPABILITY_CLOCK_SKEW_MS = 30 * 1_000;
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

const MESSAGE_FIELDS = [
  'id', 'provenance_version', 'provenance_status', 'agency_id', 'thread_id',
  'thread_subject', 'patient_id', 'sender_user_id', 'sender_email', 'sender_name',
  'sender_membership_id', 'sender_membership_version', 'participant_user_ids',
  'participant_membership_bindings', 'participant_set_sha256',
  'recipient_user_ids', 'recipients', 'client_request_id', 'message_creation_key',
  'payload_sha256', 'subject', 'message_text', 'priority', 'read_by_user_ids',
  'read_by', 'is_read', 'state_version', 'created_by', 'created_date',
];
const MEMBERSHIP_FIELDS = [
  'id', 'membership_key', 'agency_id', 'user_id', 'user_email_normalized',
  'tenant_role', 'status', 'created_by_user_id', 'activated_at', 'revoked_at',
  'revocation_reason', 'last_transition_by_user_id',
  'last_transition_by_email_normalized', 'last_transition_at',
  'last_transition_reason', 'version',
];
const USER_FIELDS = ['id', 'email', 'is_active', 'disabled', 'is_verified', 'is_service'];
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
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

async function sha256(value: unknown) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonicalJson(value))),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function capabilityMac(secret: string, capability: Record<string, any>) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const payload = [
    capability.version, capability.action, capability.message_id,
    capability.trigger_id, capability.issued_at, capability.expires_at,
    capability.nonce,
  ].join('\u0000');
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseAuthenticatedTrigger(req: Request) {
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
  const record = body as Record<string, any>;
  if (Object.keys(record).some((key) => !['action', 'message_id', 'trigger_id', 'capability'].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const messageId = exactIdentifier(record.message_id);
  const triggerId = exactIdentifier(record.trigger_id);
  if (record.action !== URGENT_TRIGGER_ACTION || !messageId || !triggerId) {
    throw new PublicError(400, 'Urgent-message trigger is invalid');
  }
  const capability = record.capability;
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)
    || Object.keys(capability).some((key) => ![
      'version', 'action', 'message_id', 'trigger_id', 'issued_at', 'expires_at', 'nonce', 'mac',
    ].includes(key))) {
    throw new PublicError(401, 'Urgent-message trigger authentication failed');
  }
  const issuedAt = Date.parse(capability.issued_at);
  const expiresAt = Date.parse(capability.expires_at);
  const now = Date.now();
  if (capability.version !== 1 || capability.action !== URGENT_TRIGGER_ACTION
    || capability.message_id !== messageId || capability.trigger_id !== triggerId
    || !exactIdentifier(capability.nonce) || !validInstant(capability.issued_at)
    || !validInstant(capability.expires_at) || !/^[a-f0-9]{64}$/.test(String(capability.mac || ''))
    || issuedAt > now + CAPABILITY_CLOCK_SKEW_MS || expiresAt <= now
    || expiresAt < issuedAt || expiresAt - issuedAt > CAPABILITY_MAX_LIFETIME_MS) {
    throw new PublicError(401, 'Urgent-message trigger authentication failed');
  }
  const secret = String(Deno.env.get('INTERNAL_FN_SECRET') || '');
  if (secret.length < 32) throw new PublicError(503, 'Urgent-message trigger authentication is unavailable');
  const expected = await capabilityMac(secret, capability);
  if (!timingSafeEqual(String(capability.mac), expected)) {
    throw new PublicError(401, 'Urgent-message trigger authentication failed');
  }
  return { messageId, triggerId };
}

function validBinding(binding: Record<string, any>) {
  return !!exactIdentifier(binding?.user_id) && !!canonicalEmail(binding?.user_email_normalized)
    && binding.user_email_normalized === canonicalEmail(binding.user_email_normalized)
    && !!exactIdentifier(binding?.membership_id)
    && Number.isSafeInteger(binding?.membership_version) && binding.membership_version >= 1
    && TENANT_ROLES.has(String(binding?.tenant_role || ''));
}

async function validateMessage(row: Record<string, any>) {
  const agencyId = exactIdentifier(row?.agency_id);
  const threadId = exactIdentifier(row?.thread_id);
  const ids = Array.isArray(row?.participant_user_ids) ? row.participant_user_ids : [];
  const bindings = Array.isArray(row?.participant_membership_bindings)
    ? row.participant_membership_bindings
    : [];
  const senderBinding = bindings.find((binding) => binding.user_id === row.sender_user_id);
  const recipientUserIds = Array.isArray(row?.recipient_user_ids) ? row.recipient_user_ids : [];
  const expectedParticipantHash = agencyId && threadId ? await sha256({
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
  if (!exactIdentifier(row?.id) || !agencyId || !threadId || row.provenance_version !== 2
    || row.provenance_status !== 'verified_v2'
    || typeof row.thread_subject !== 'string' || !row.thread_subject || row.thread_subject.length > 300
    || (row.patient_id != null && !exactIdentifier(row.patient_id))
    || ids.length < 2 || new Set(ids).size !== ids.length || !sameValue(ids, [...ids].sort())
    || bindings.length !== ids.length
    || bindings.some((binding, index) => !validBinding(binding) || binding.user_id !== ids[index])
    || row.participant_set_sha256 !== expectedParticipantHash || !senderBinding
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

async function loadExactMessage(entities: Record<string, any>, messageId: string) {
  const rows = requireRows(await entities.Message.filter(
    { id: messageId }, undefined, EXACT_ROW_LIMIT, undefined, MESSAGE_FIELDS,
  ), 'Message.filter');
  if (rows.length >= EXACT_ROW_LIMIT || rows.length > 1 || rows.some((row) => row?.id !== messageId)) {
    throw new PublicError(409, 'Message trigger is ambiguous');
  }
  if (rows.length !== 1) throw new PublicError(404, 'Message unavailable');
  return validateMessage(rows[0]);
}

async function loadVerifiedThread(entities: Record<string, any>, message: Record<string, any>) {
  const rows = requireRows(await entities.Message.filter(
    { agency_id: message.agency_id, thread_id: message.thread_id },
    'created_date', THREAD_ROW_LIMIT, undefined, MESSAGE_FIELDS,
  ), 'Message.filter');
  if (rows.length === 0 || rows.length >= THREAD_ROW_LIMIT
    || rows.some((row) => row?.agency_id !== message.agency_id || row?.thread_id !== message.thread_id)) {
    throw new PublicError(409, 'Thread provenance is incomplete or ambiguous');
  }
  for (const row of rows) {
    await validateMessage(row);
    if (row.thread_subject !== message.thread_subject || row.patient_id !== message.patient_id
      || row.participant_set_sha256 !== message.participant_set_sha256
      || !sameValue(row.participant_user_ids, message.participant_user_ids)
      || !sameValue(row.participant_membership_bindings, message.participant_membership_bindings)) {
      throw new PublicError(409, 'Thread provenance is incomplete or ambiguous');
    }
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length
    || new Set(rows.map((row) => row.message_creation_key)).size !== rows.length
    || rows.filter((row) => row.id === message.id).length !== 1) {
    throw new PublicError(409, 'Thread contains duplicate message identity');
  }
}

async function requireEnabledAgency(entities: Record<string, any>, agencyId: string) {
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

function validateMembership(
  membership: Record<string, any>,
  agencyId: string,
  user: Record<string, any>,
  binding: Record<string, any>,
) {
  const email = canonicalEmail(user.email);
  const transitionEmail = canonicalEmail(membership.last_transition_by_email_normalized);
  if (!exactIdentifier(membership.id) || !email || membership.agency_id !== agencyId
    || membership.user_id !== user.id || membership.membership_key !== `${agencyId}:${user.id}`
    || membership.user_email_normalized !== email || membership.status !== 'active'
    || !TENANT_ROLES.has(String(membership.tenant_role || ''))
    || !exactIdentifier(membership.created_by_user_id) || !validInstant(membership.activated_at)
    || membership.revoked_at != null || membership.revocation_reason != null
    || !exactIdentifier(membership.last_transition_by_user_id) || !transitionEmail
    || membership.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(membership.last_transition_at) || !boundedReason(membership.last_transition_reason)
    || !Number.isSafeInteger(membership.version) || membership.version < 1
    || membership.id !== binding.membership_id || membership.version !== binding.membership_version
    || membership.tenant_role !== binding.tenant_role
    || membership.user_email_normalized !== binding.user_email_normalized) {
    throw new PublicError(409, 'Participant membership changed');
  }
  return membership;
}

async function requireCurrentParticipant(
  entities: Record<string, any>,
  agencyId: string,
  binding: Record<string, any>,
) {
  const users = requireRows(await entities.User.filter(
    { id: binding.user_id }, undefined, EXACT_ROW_LIMIT, undefined, USER_FIELDS,
  ), 'User.filter');
  if (users.length >= EXACT_ROW_LIMIT || users.some((row) => row?.id !== binding.user_id)
    || users.length !== 1) throw new PublicError(409, 'Participant identity is ambiguous');
  const user = users[0];
  if (canonicalEmail(user.email) !== binding.user_email_normalized || user.is_active === false
    || user.disabled === true || user.is_service === true || user.is_verified === false) {
    throw new PublicError(409, 'Participant identity changed');
  }
  const memberships = requireRows(await entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: binding.user_id },
    '-updated_date', EXACT_ROW_LIMIT, undefined, MEMBERSHIP_FIELDS,
  ), 'AgencyMembership.filter');
  if (memberships.length >= EXACT_ROW_LIMIT || memberships.some((row) => row?.agency_id !== agencyId
    || row?.user_id !== binding.user_id) || memberships.length > 1) {
    throw new PublicError(409, 'Participant membership is ambiguous');
  }
  if (memberships.length === 0) throw new PublicError(409, 'Participant membership changed');
  const membership = validateMembership(memberships[0], agencyId, user, binding);
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
  if (rows.length !== 1) throw new PublicError(404, 'Message unavailable');
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
  participant: Record<string, any>,
) {
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
  if (rows.length !== 1) throw new PublicError(409, 'Participant patient authority changed');
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
    || assignment.user_email_normalized !== canonicalEmail(participant.user.email)
    || assignment.assignee_membership_id !== participant.membership.id
    || assignment.assignee_membership_version_at_enablement !== participant.membership.version
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
  if (status !== 'active') throw new PublicError(409, 'Participant patient authority changed');
}

Deno.serve(async (req) => {
  if (SECURE_MESSAGE_DOMAIN_PAUSED) return secureMessageUnavailable();
  if (SECURE_MESSAGE_MUTATIONS_PAUSED) return secureMessageMutationUnavailable();

  try {
    const input = await parseAuthenticatedTrigger(req);
    const base44 = createClientFromRequest(req);
    const entities = base44.asServiceRole.entities;
    const message = await loadExactMessage(entities, input.messageId);
    await loadVerifiedThread(entities, message);
    if (message.priority !== 'urgent') return json({ success: true, ignored: true });
    await requireEnabledAgency(entities, message.agency_id);
    const participants = [];
    for (const binding of message.participant_membership_bindings) {
      participants.push(await requireCurrentParticipant(entities, message.agency_id, binding));
    }
    if (message.patient_id) {
      const patient = await loadExactPatient(entities, message.agency_id, message.patient_id);
      for (const participant of participants) await requirePatientAccess(entities, patient, participant);
    }
    if (URGENT_MESSAGE_OUTBOX_PAUSED) {
      return json({
        error: 'Urgent-message delivery requires a durable unique outbox',
        code: 'secure_message_notification_outbox_required',
      }, 503);
    }
    // Deliberately unreachable until a durable outbox entity atomically claims
    // input.triggerId and is proven under concurrent replay.
    void input.triggerId;
    return json({ error: 'Urgent-message delivery is unavailable' }, 503);
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ error: error.message }, error.status, error.status === 405 ? { Allow: 'POST' } : {});
    }
    console.error('notifyUrgentMessage failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
