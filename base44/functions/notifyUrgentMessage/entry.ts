import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
/**
 * Urgent secure-message notifier.
 *
 * Released by the owner on 2026-10-08 ("turn everything on"). It was paused
 * because nothing proved that an urgent message notified each recipient once:
 * the retired entity trigger could fire twice and Notification has no unique
 * constraint. That is now solved on the MESSAGE row itself:
 *
 *   1. Only the message's own sender may ask, and only while their exact
 *      active membership still matches the binding the message was sent
 *      under. Authentication precedes the body; membership precedes any
 *      Message read.
 *   2. The sender takes a claim on the message with the same state_version
 *      compare-and-swap markMessageRead uses. A second caller sees the live
 *      claim (409, in progress) or the finished urgent_notified_at stamp
 *      (already_notified) and creates nothing.
 *   3. Each recipient's notification carries a deterministic dedupe_key
 *      (urgent-message:<message>:<recipient>). An existing row is never
 *      re-created, and if a claim that outlived its lease was taken over
 *      while its first holder was still writing, every duplicate but the
 *      lowest id is removed, so each recipient converges on exactly one row.
 *   4. urgent_notified_at is stamped under the same claim once the fan-out
 *      finishes; every later call answers already_notified.
 *
 * A recipient whose membership, identity or chart access no longer matches
 * the thread's binding is skipped, never notified. The notification names the
 * sender only: no subject, body or patient reaches the notification surface.
 */
const SECURE_MESSAGE_DOMAIN_PAUSED = false;
const SECURE_MESSAGE_MUTATIONS_PAUSED = false;

const MAX_BODY_BYTES = 2_000;
const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_ROW_LIMIT = 10;
const THREAD_ROW_LIMIT = 101;
const CAS_ATTEMPTS = 3;
const CLAIM_LEASE_MS = 2 * 60 * 1_000;
const NOTIFICATION_TITLE = 'Urgent secure message';
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
  'urgent_notification_claim_token', 'urgent_notification_claimed_at',
  'urgent_notified_at', 'urgent_notification_recipient_count',
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

async function parseRequest(req: Request) {
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
  if (Object.keys(record).some((key) => !['agency_id', 'message_id'].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(record.agency_id);
  const messageId = exactIdentifier(record.message_id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!messageId) throw new PublicError(400, 'message_id is invalid');
  return { agencyId, messageId };
}

function requireUsableCaller(user: Record<string, any> | null) {
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (user.is_active === false) throw new PublicError(403, 'Unauthorized - account is deactivated');
  if (!exactIdentifier(user.id) || !canonicalEmail(user.email)
    || user.disabled === true || user.is_service === true || user.is_verified === false) {
    throw new PublicError(403, 'Forbidden');
  }
  return user;
}

async function loadCallerMembership(
  entities: Record<string, any>,
  agencyId: string,
  user: Record<string, any>,
) {
  const memberships = requireRows(await entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: user.id }, '-updated_date', EXACT_ROW_LIMIT, undefined, MEMBERSHIP_FIELDS,
  ), 'AgencyMembership.filter');
  if (memberships.length >= EXACT_ROW_LIMIT || memberships.length > 1
    || memberships.some((row) => row?.agency_id !== agencyId || row?.user_id !== user.id)) {
    throw new PublicError(409, 'Tenant membership query is ambiguous');
  }
  if (memberships.length !== 1) throw new PublicError(403, 'No exact active membership for agency');
  const row = memberships[0];
  const email = canonicalEmail(user.email);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  if (!exactIdentifier(row?.id) || !email || row.membership_key !== `${agencyId}:${user.id}`
    || row.user_email_normalized !== email || row.status !== 'active'
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !exactIdentifier(row.created_by_user_id) || !validInstant(row.activated_at)
    || row.revoked_at != null || row.revocation_reason != null
    || !exactIdentifier(row.last_transition_by_user_id) || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at) || !boundedReason(row.last_transition_reason)
    || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new PublicError(403, 'No exact active membership for agency');
  }
  return row;
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

function plainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireReconcilableUpdate(outcome: unknown) {
  if (!plainObject(outcome) || outcome.success !== true || !Number.isInteger(outcome.updated)
    || outcome.updated < 0 || outcome.updated > 1 || outcome.has_more !== false) {
    throw new Error('Message CAS returned an ambiguous result');
  }
  return outcome.updated === 1;
}

function claimToken() {
  return typeof crypto.randomUUID === 'function'
    ? `urgent-v1:${crypto.randomUUID()}`
    : `urgent-v1:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function liveClaim(message: Record<string, any>, now: number) {
  return typeof message.urgent_notification_claim_token === 'string'
    && message.urgent_notification_claim_token.length > 0
    && validInstant(message.urgent_notification_claimed_at)
    && Date.parse(message.urgent_notification_claimed_at) > now - CLAIM_LEASE_MS;
}

// Take (or take over an expired) claim with the state_version CAS. Returns the
// reloaded message carrying OUR token, or an outcome another caller decided.
async function claimMessage(entities: Record<string, any>, initial: Record<string, any>, token: string) {
  let message = initial;
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    if (validInstant(message.urgent_notified_at)) return { outcome: 'already_notified', message };
    if (liveClaim(message, Date.now())) return { outcome: 'in_progress', message };
    const expectedVersion = message.state_version;
    const claimedAt = new Date().toISOString();
    const updated = requireReconcilableUpdate(await entities.Message.updateMany(
      {
        id: message.id,
        agency_id: message.agency_id,
        provenance_version: 2,
        provenance_status: 'verified_v2',
        state_version: expectedVersion,
      },
      {
        $set: {
          state_version: expectedVersion + 1,
          urgent_notification_claim_token: token,
          urgent_notification_claimed_at: claimedAt,
        },
      },
    ));
    message = await loadExactMessage(entities, message.id);
    if (updated && message.urgent_notification_claim_token === token) {
      return { outcome: 'claimed', message };
    }
  }
  throw new PublicError(409, 'Message state changed; retry');
}

async function stampNotified(
  entities: Record<string, any>,
  initial: Record<string, any>,
  token: string,
  recipientCount: number,
) {
  let message = initial;
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    if (message.urgent_notification_claim_token !== token) {
      throw new PublicError(409, 'Urgent notification claim was taken over; retry');
    }
    if (validInstant(message.urgent_notified_at)) return message;
    const expectedVersion = message.state_version;
    const updated = requireReconcilableUpdate(await entities.Message.updateMany(
      {
        id: message.id,
        agency_id: message.agency_id,
        provenance_version: 2,
        provenance_status: 'verified_v2',
        state_version: expectedVersion,
        urgent_notification_claim_token: token,
      },
      {
        $set: {
          state_version: expectedVersion + 1,
          urgent_notified_at: new Date().toISOString(),
          urgent_notification_recipient_count: recipientCount,
        },
      },
    ));
    message = await loadExactMessage(entities, message.id);
    if (updated && message.urgent_notification_claim_token === token
      && validInstant(message.urgent_notified_at)) return message;
  }
  throw new PublicError(409, 'Message state changed; retry');
}

function urgentDedupeKey(messageId: string, recipientUserId: string) {
  return `urgent-message:${messageId}:${recipientUserId}`;
}

function expectedNotification(
  message: Record<string, any>,
  participant: Record<string, any>,
  senderName: string,
) {
  return {
    agency_id: message.agency_id,
    dedupe_key: urgentDedupeKey(message.id, participant.user.id),
    recipient_user_id: participant.user.id,
    recipient_membership_id: participant.membership.id,
    recipient_membership_version: participant.membership.version,
    authority_version: 1,
    authority_state: 'active',
    version: 1,
    user_email: participant.membership.user_email_normalized,
    title: NOTIFICATION_TITLE,
    message: `${senderName} sent you an urgent secure message. Open Messages to read it.`,
    type: 'message_received',
    priority: 'critical',
    is_read: false,
    dismissed: false,
    action_url: '/Messages',
    action_label: 'Open Messages',
    metadata: {
      agency_id: message.agency_id,
      related_entity: 'Message',
      related_entity_id: message.id,
      thread_id: message.thread_id,
      workflow: 'urgent_secure_message',
    },
  };
}

async function notificationsFor(entities: Record<string, any>, agencyId: string, dedupeKey: string) {
  const rows = requireRows(await entities.Notification.filter(
    { agency_id: agencyId, dedupe_key: dedupeKey }, 'created_date', EXACT_ROW_LIMIT,
  ), 'Notification.filter');
  if (rows.length >= EXACT_ROW_LIMIT
    || rows.some((row) => row?.agency_id !== agencyId || row?.dedupe_key !== dedupeKey)) {
    throw new PublicError(409, 'Urgent notification query is ambiguous');
  }
  return rows;
}

// Exactly one row per (message, recipient). A duplicate can only exist when an
// expired claim was taken over while its first holder was still writing; both
// writers keep the lowest id and remove the rest, so they converge.
async function ensureNotification(
  entities: Record<string, any>,
  message: Record<string, any>,
  participant: Record<string, any>,
  senderName: string,
) {
  const notification = expectedNotification(message, participant, senderName);
  const expected = notification;
  let rows = await notificationsFor(entities, expected.agency_id, expected.dedupe_key);
  let created = false;
  if (rows.length === 0) {
    await entities.Notification.create(notification);
    created = true;
    rows = await notificationsFor(entities, expected.agency_id, expected.dedupe_key);
  }
  if (rows.length === 0) throw new Error('Urgent notification was not persisted');
  const survivor = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)))[0];
  for (const row of rows) {
    if (row.id !== survivor.id) await entities.Notification.delete(row.id);
  }
  if (survivor.recipient_user_id !== expected.recipient_user_id
    || survivor.recipient_membership_id !== expected.recipient_membership_id
    || survivor.recipient_membership_version !== expected.recipient_membership_version) {
    throw new PublicError(409, 'Urgent notification recipient binding changed');
  }
  return created;
}

Deno.serve(async (req) => {
  if (SECURE_MESSAGE_DOMAIN_PAUSED) return secureMessageUnavailable();
  if (SECURE_MESSAGE_MUTATIONS_PAUSED) return secureMessageMutationUnavailable();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    // Authentication precedes the body; the caller's exact membership in the
    // named agency precedes any Message read.
    const user = requireUsableCaller(await base44.auth.me().catch(() => null));
    const input = await parseRequest(req);
    const entities = base44.asServiceRole.entities;
    await requireEnabledAgency(entities, input.agencyId);
    const callerMembership = await loadCallerMembership(entities, input.agencyId, user);

    let message = await loadExactMessage(entities, input.messageId);
    if (message.agency_id !== input.agencyId) throw new PublicError(404, 'Message unavailable');
    // Only the sender may announce their own message as urgent, and only under
    // the membership the message was sent with.
    if (message.sender_user_id !== user.id) {
      throw new PublicError(403, 'Only the sender can send urgent notifications');
    }
    const senderBinding = message.participant_membership_bindings
      .find((binding: Record<string, any>) => binding.user_id === user.id);
    if (!senderBinding || senderBinding.membership_id !== callerMembership.id
      || senderBinding.membership_version !== callerMembership.version
      || senderBinding.user_email_normalized !== canonicalEmail(user.email)) {
      throw new PublicError(409, 'Sender membership changed since the message was sent');
    }
    await loadVerifiedThread(entities, message);
    const sender = await requireCurrentParticipant(entities, message.agency_id, senderBinding);
    const patient = message.patient_id
      ? await loadExactPatient(entities, message.agency_id, message.patient_id)
      : null;
    if (patient) await requirePatientAccess(entities, patient, sender);

    if (message.priority !== 'urgent') {
      return json({ success: true, ignored: true, reason: 'not_urgent', notified: 0 });
    }

    const token = claimToken();
    const claim = await claimMessage(entities, message, token);
    if (claim.outcome === 'already_notified') {
      return json({
        success: true,
        already_notified: true,
        notified: Number.isSafeInteger(claim.message.urgent_notification_recipient_count)
          ? claim.message.urgent_notification_recipient_count
          : null,
      });
    }
    if (claim.outcome === 'in_progress') {
      return json({ error: 'Urgent notification is already in progress; retry shortly' }, 409);
    }
    message = claim.message;

    const senderName = typeof message.sender_name === 'string' && message.sender_name.trim()
      ? message.sender_name.trim().slice(0, 200)
      : 'A colleague';
    let notified = 0;
    let created = 0;
    let skipped = 0;
    for (const binding of message.participant_membership_bindings) {
      if (binding.user_id === message.sender_user_id) continue;
      let participant;
      try {
        participant = await requireCurrentParticipant(entities, message.agency_id, binding);
        if (patient) await requirePatientAccess(entities, patient, participant);
      } catch (error) {
        // A recipient whose identity, membership or chart access no longer
        // matches the thread's binding is skipped, never notified.
        if (error instanceof PublicError && error.status === 409) {
          skipped += 1;
          continue;
        }
        throw error;
      }
      if (await ensureNotification(entities, message, participant, senderName)) {
        created += 1;
      }
      notified += 1;
    }

    await stampNotified(entities, message, token, notified);
    return json({ success: true, notified, created, skipped });
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ error: error.message }, error.status, error.status === 405 ? { Allow: 'POST' } : {});
    }
    console.error('notifyUrgentMessage failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
