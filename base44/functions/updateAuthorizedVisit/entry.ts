import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) headers.set(name, value);
  return Response.json(body, { ...init, headers });
}

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_BODY_BYTES = 1_000_000;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;
const MAX_NOTE_LENGTH = 250_000;
const MAX_SHORT_TEXT = 2_000;
const MAX_TAGS = 64;
const MAX_HISTORY = 100;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const AI_CLAIM_TOKEN_PATTERN = /^visit-ai-v1:([a-f0-9]{64}):([A-Za-z0-9-]{16,80})$/;

const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const AGENCY_WIDE_VISIT_ROLES = new Set(['agency_admin', 'manager']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const VISIT_STATUSES = new Set([
  'scheduled',
  'in_progress',
  'completed',
  'pending_review',
  'cancelled',
]);
const DOCUMENTATION_STATUSES = new Set(['completed', 'pending_review']);
const DOCUMENTATION_SOURCES = new Set(['smart_note', 'audio', 'manual']);
const DOCUMENTATION_TAG_PREFIXES = ['trend:', 'chart_flag:', 'denial_risk:'];
const COMPLETED_VISIT_AI_TAGS = new Set([
  'stable',
  'declining',
  'pain_management',
  'wound_care',
  'medication',
  'edema',
  'respiratory',
  'cardiac',
  'safety',
  'teaching',
  'homebound',
]);
const INTERNAL_VISIT_ACTIONS = new Set([
  'read_ai_processing_source',
  'claim_ai_processing',
  'publish_ai_processing',
]);
const INTERNAL_SECRET_HEADER = 'x-internal-secret';
const VISIT_MUTATION_PREIMAGE_FIELDS = [
  'id',
  'agency_id',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'created_by',
  'patient_id',
  'visit_date',
  'visit_time',
  'visit_type',
  'status',
  'start_time',
  'end_time',
  'nurse_notes',
  'audio_url',
  'raw_transcription',
  'vital_signs',
  'family_update_sent',
  'family_update_date',
  'family_update_text',
  'ai_tags',
  'telehealth_room_id',
  'telehealth_room_name',
  'telehealth_call_duration',
  'telehealth_summary',
  'telehealth_shared_files',
  'telehealth_recording_url',
  'is_sample',
  'client_request_id',
  'compliance_score',
  'compliance_issues',
  'homebound_status_verified',
  'skilled_intervention_documented',
  'homebound_justification',
  'documentation_source',
  'grounding_pending',
  'ai_process_claimed_by',
  'ai_processed_at',
  'supply_usage_claimed_by',
  'events_extract_claimed_by',
  'events_extracted_at',
  'emr_handoff_status',
  'emr_handoff_history',
  'documentation_review_ack',
  'followup_tasks_claimed_by',
  'created_date',
  'updated_date',
] as const;
const HANDOFF_STATUSES = [
  'not_started',
  'copied_to_emr',
  'reviewed_in_emr',
  'signed_in_emr',
] as const;
const HANDOFF_ORDER = new Map(HANDOFF_STATUSES.map((status, index) => [status, index]));
const REVIEW_STATEMENT =
  'I reviewed this suggested documentation for accuracy before copying it to the EMR.';

const SAVE_DOCUMENTATION_FIELDS = new Set([
  'patient_id',
  'status',
  'nurse_notes',
  'raw_transcription',
  'vital_signs',
  'compliance_score',
  'compliance_issues',
  'homebound_status_verified',
  'skilled_intervention_documented',
  'homebound_justification',
  'documentation_source',
  'grounding_pending',
  'ai_tags',
]);

const ACTION_FIELDS: Record<string, Set<string>> = {
  save_documentation: SAVE_DOCUMENTATION_FIELDS,
  reschedule: new Set(['visit_time']),
  set_ai_tags: new Set(['ai_tags']),
  advance_handoff: new Set(['next_status']),
  set_review_ack: new Set(['acknowledged', 'nurse_edited', 'expected_note_hash']),
  read_ai_processing_source: new Set(),
  // These two actions are callable only by processCompletedVisit through the
  // server-only INTERNAL_FN_SECRET header. They keep the AI claim and final
  // publication inside the same immutable tenant/Patient/Visit authority
  // proof as every other privileged Visit mutation.
  claim_ai_processing: new Set(['claim_token', 'expected_source_sha256']),
  publish_ai_processing: new Set([
    'claim_token',
    'expected_source_sha256',
    'nurse_notes',
    'raw_transcription',
    'ai_tags',
    'ai_processed_at',
  ]),
  // The retired browser queue remains preserved, but replay is deliberately
  // paused until a one-time, owner-approved recovery protocol exists. Keeping
  // this action recognized lets the client retain work on an explicit 503
  // instead of falling back to a broad service-role patch surface.
  legacy_recovery: new Set(),
};

const VITAL_FIELDS = new Set([
  'temperature',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'heart_rate',
  'respiratory_rate',
  'oxygen_saturation',
  'pain_level',
  'weight',
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
  if (value.startsWith('$')) return null;
  return value;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, unknown>>;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function assignmentLifecycleIsCoherent(row: Record<string, any>, status: string, action: string) {
  if (action === 'grant') {
    return status === 'active'
      && row.version === 1
      && row.activated_at === row.last_transition_at
      && row.suspended_at == null;
  }
  if (action === 'activate') {
    return status === 'active'
      && row.version >= 3
      && row.version % 2 === 1
      && validInstant(row.suspended_at)
      && row.activated_at === row.last_transition_at;
  }
  if (action === 'suspend') {
    return status === 'suspended'
      && row.version >= 2
      && row.version % 2 === 0
      && row.suspended_at === row.last_transition_at;
  }
  if (action === 'revoke') {
    return status === 'revoked'
      && row.version >= 2
      && row.revoked_at === row.last_transition_at
      && row.revocation_reason === row.last_transition_reason;
  }
  return false;
}

function timingSafeEqualString(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function requireInternalActionAuthorization(req: Request, action: string) {
  if (!INTERNAL_VISIT_ACTIONS.has(action)) return;
  const expected = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (expected.length < 32) {
    throw new PublicError(500, 'Internal Visit mutation authorization is unavailable');
  }
  const provided = String(req.headers.get(INTERNAL_SECRET_HEADER) || '').trim();
  if (!timingSafeEqualString(provided, expected)) {
    throw new PublicError(403, 'Forbidden');
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value: unknown, label: string, maximum: number, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new PublicError(400, `${label} is invalid`);
  }
  return value;
}

function boundedStringList(value: unknown, label: string, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new PublicError(400, `${label} is invalid`);
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== 'string'
      || !item
      || item.length > maximumLength
      || item.trim() !== item
      || /[\u0000-\u001f\u007f]/.test(item)
      || seen.has(item)
    ) {
      throw new PublicError(400, `${label} is invalid`);
    }
    seen.add(item);
    output.push(item);
  }
  return output;
}

function sanitizeVitals(value: unknown) {
  if (!plainObject(value)) throw new PublicError(400, 'vital_signs is invalid');
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!VITAL_FIELDS.has(key)) throw new PublicError(400, 'vital_signs is invalid');
    // The form preserves a cleared field as null. Treat that as removal so a
    // clinician can clear a previously entered vital without blocking the save.
    if (item === null) continue;
    if (typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1_000_000) {
      throw new PublicError(400, 'vital_signs is invalid');
    }
    output[key] = item;
  }
  return output;
}

function sanitizeClinicalField(key: string, value: unknown) {
  switch (key) {
    case 'visit_time':
      if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new PublicError(400, 'visit_time is invalid');
      }
      return value;
    case 'status':
      if (typeof value !== 'string' || !DOCUMENTATION_STATUSES.has(value)) {
        throw new PublicError(400, 'status is invalid');
      }
      return value;
    case 'nurse_notes':
    case 'raw_transcription':
      return boundedString(value, key, MAX_NOTE_LENGTH);
    case 'homebound_justification':
      return boundedString(value, key, 20_000);
    case 'vital_signs':
      return sanitizeVitals(value);
    case 'compliance_score':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new PublicError(400, 'compliance_score is invalid');
      }
      return value;
    case 'compliance_issues':
      return boundedStringList(value, key, 100, MAX_SHORT_TEXT);
    case 'ai_tags':
      return boundedStringList(value, key, MAX_TAGS, 128);
    case 'homebound_status_verified':
    case 'skilled_intervention_documented':
    case 'grounding_pending':
      if (typeof value !== 'boolean') throw new PublicError(400, `${key} is invalid`);
      return value;
    case 'documentation_source':
      if (typeof value !== 'string' || !DOCUMENTATION_SOURCES.has(value)) {
        throw new PublicError(400, 'documentation_source is invalid');
      }
      return value;
    default:
      throw new PublicError(400, `Unsupported clinical field: ${key}`);
  }
}

type ParsedInput = {
  visitId: string;
  action: keyof typeof ACTION_FIELDS;
  fields: Record<string, unknown>;
};

async function parseInput(req: Request): Promise<ParsedInput> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Visit mutation payload is too large');
  }

  const visitId = exactIdentifier(body.visit_id);
  const action = typeof body.action === 'string'
    && Object.hasOwn(ACTION_FIELDS, body.action)
    ? body.action as keyof typeof ACTION_FIELDS
    : null;
  if (!visitId) throw new PublicError(400, 'visit_id is invalid');
  if (!action) throw new PublicError(400, 'action is invalid');

  // Do not inspect internal mutation fields or touch an entity until the
  // server-to-server capability is verified. User authentication is still
  // required by the handler, and the full tenant authority proof follows.
  requireInternalActionAuthorization(req, action);

  // Fail before inspecting clinical fields or reading any entity. The queued
  // record must stay on-device until recovery has an approved bounded protocol.
  if (action === 'legacy_recovery') {
    throw new PublicError(503, 'Legacy Visit recovery is paused');
  }

  const allowed = ACTION_FIELDS[action];
  for (const key of Object.keys(body)) {
    if (key !== 'visit_id' && key !== 'action' && !allowed.has(key)) {
      throw new PublicError(400, `Unsupported ${action} field: ${key}`);
    }
  }

  const rawFields = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== 'visit_id' && key !== 'action'),
  );
  const fields: Record<string, unknown> = {};

  if (action === 'save_documentation') {
    if (Object.keys(rawFields).length === 0) {
      throw new PublicError(400, `${action} requires at least one field`);
    }
    for (const [key, value] of Object.entries(rawFields)) {
      if (key === 'patient_id') {
        const patientId = exactIdentifier(value);
        if (!patientId) throw new PublicError(400, 'patient_id is invalid');
        fields.patient_id = patientId;
      } else fields[key] = sanitizeClinicalField(key, value);
    }
    if (
      Array.isArray(fields.ai_tags)
      && fields.ai_tags.some(
        (tag) => !DOCUMENTATION_TAG_PREFIXES.some((prefix) => String(tag).startsWith(prefix)),
      )
    ) {
      throw new PublicError(400, 'save_documentation accepts only system ai_tags');
    }
    return { visitId, action, fields };
  }

  if (action === 'read_ai_processing_source') {
    if (Object.keys(rawFields).length !== 0) {
      throw new PublicError(400, 'read_ai_processing_source accepts no fields');
    }
  } else if (action === 'reschedule') {
    if (Object.keys(rawFields).length !== 1 || rawFields.visit_time === undefined) {
      throw new PublicError(400, 'reschedule requires visit_time');
    }
    fields.visit_time = sanitizeClinicalField('visit_time', rawFields.visit_time);
  } else if (action === 'set_ai_tags') {
    if (Object.keys(rawFields).length !== 1 || rawFields.ai_tags === undefined) {
      throw new PublicError(400, 'set_ai_tags requires ai_tags');
    }
    fields.ai_tags = sanitizeClinicalField('ai_tags', rawFields.ai_tags);
  } else if (action === 'advance_handoff') {
    if (Object.keys(rawFields).length !== 1 || typeof rawFields.next_status !== 'string') {
      throw new PublicError(400, 'advance_handoff requires next_status');
    }
    if (!HANDOFF_ORDER.has(rawFields.next_status)) {
      throw new PublicError(400, 'next_status is invalid');
    }
    fields.next_status = rawFields.next_status;
  } else if (action === 'set_review_ack') {
    if (typeof rawFields.acknowledged !== 'boolean') {
      throw new PublicError(400, 'set_review_ack requires acknowledged');
    }
    if (rawFields.nurse_edited !== undefined && typeof rawFields.nurse_edited !== 'boolean') {
      throw new PublicError(400, 'nurse_edited is invalid');
    }
    if (rawFields.acknowledged === false && (
      rawFields.nurse_edited !== undefined || rawFields.expected_note_hash !== undefined
    )) {
      throw new PublicError(400, 'withdrawal accepts only acknowledged');
    }
    if (rawFields.acknowledged === true && (
      typeof rawFields.expected_note_hash !== 'string'
      || !/^[a-f0-9]{64}$/.test(rawFields.expected_note_hash)
    )) {
      throw new PublicError(400, 'expected_note_hash is invalid');
    }
    fields.acknowledged = rawFields.acknowledged;
    if (rawFields.nurse_edited !== undefined) fields.nurse_edited = rawFields.nurse_edited;
    if (rawFields.expected_note_hash !== undefined) {
      fields.expected_note_hash = rawFields.expected_note_hash;
    }
  } else if (action === 'claim_ai_processing') {
    if (Object.keys(rawFields).length !== 2) {
      throw new PublicError(
        400,
        'claim_ai_processing requires claim_token and expected_source_sha256',
      );
    }
    const claimToken = exactIdentifier(rawFields.claim_token);
    if (!claimToken) throw new PublicError(400, 'claim_token is invalid');
    const claimMatch = AI_CLAIM_TOKEN_PATTERN.exec(claimToken);
    if (
      !claimMatch
      || typeof rawFields.expected_source_sha256 !== 'string'
      || !SHA256_PATTERN.test(rawFields.expected_source_sha256)
      || claimMatch[1] !== rawFields.expected_source_sha256
    ) {
      throw new PublicError(400, 'claim source binding is invalid');
    }
    fields.claim_token = claimToken;
    fields.expected_source_sha256 = rawFields.expected_source_sha256;
  } else if (action === 'publish_ai_processing') {
    for (const required of [
      'claim_token',
      'expected_source_sha256',
      'nurse_notes',
      'ai_tags',
      'ai_processed_at',
    ]) {
      if (rawFields[required] === undefined) {
        throw new PublicError(400, `publish_ai_processing requires ${required}`);
      }
    }
    const claimToken = exactIdentifier(rawFields.claim_token);
    if (!claimToken) throw new PublicError(400, 'claim_token is invalid');
    const claimMatch = AI_CLAIM_TOKEN_PATTERN.exec(claimToken);
    if (
      !claimMatch
      || typeof rawFields.expected_source_sha256 !== 'string'
      || !SHA256_PATTERN.test(rawFields.expected_source_sha256)
      || claimMatch[1] !== rawFields.expected_source_sha256
    ) {
      throw new PublicError(400, 'publish source binding is invalid');
    }
    fields.claim_token = claimToken;
    fields.expected_source_sha256 = rawFields.expected_source_sha256;
    fields.nurse_notes = boundedString(
      rawFields.nurse_notes,
      'nurse_notes',
      MAX_NOTE_LENGTH,
      false,
    );
    if (rawFields.raw_transcription !== undefined) {
      fields.raw_transcription = boundedString(
        rawFields.raw_transcription,
        'raw_transcription',
        MAX_NOTE_LENGTH,
      );
    }
    const tags = boundedStringList(rawFields.ai_tags, 'ai_tags', MAX_TAGS, 128);
    if (tags.some((tag) => !COMPLETED_VISIT_AI_TAGS.has(tag))) {
      throw new PublicError(400, 'publish_ai_processing ai_tags are invalid');
    }
    fields.ai_tags = tags;
    if (
      typeof rawFields.ai_processed_at !== 'string'
      || !validInstant(rawFields.ai_processed_at)
      || new Date(rawFields.ai_processed_at).toISOString() !== rawFields.ai_processed_at
    ) {
      throw new PublicError(400, 'ai_processed_at is invalid');
    }
    fields.ai_processed_at = rawFields.ai_processed_at;
  }
  return { visitId, action, fields };
}

function resolveActiveMembership(
  rawRows: Array<Record<string, unknown>>,
  userId: string,
  normalizedEmail: string,
  agencyId: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  const exactRows = rawRows.filter(
    (row) => row?.user_id === userId && row?.agency_id === agencyId,
  );
  if (exactRows.length === 0) throw new PublicError(403, 'No tenant membership for agency');
  if (exactRows.length !== 1) throw new PublicError(409, 'Tenant membership is ambiguous');

  const row = exactRows[0];
  const id = exactIdentifier(row.id);
  const membershipKey = exactIdentifier(row.membership_key);
  const storedEmail = canonicalEmail(row.user_email_normalized);
  const createdBy = exactIdentifier(row.created_by_user_id);
  const transitionedBy = exactIdentifier(row.last_transition_by_user_id);
  const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
  const status = typeof row.status === 'string' ? row.status : '';
  if (
    !id
    || !membershipKey
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== normalizedEmail
    || membershipKey !== `${agencyId}:${userId}`
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !MEMBERSHIP_STATUSES.has(status)
    || !Number.isSafeInteger(row.version)
    || Number(row.version) < 1
    || !createdBy
    || !transitionedBy
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
    || (status !== 'revoked' && (row.revoked_at != null || row.revocation_reason != null))
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  if (status !== 'active') throw new PublicError(403, 'No active membership for agency');
  return row;
}

async function loadExactVisit(entities: Record<string, any>, visitId: string) {
  const rawRows = requireRows(
    await entities.Visit.filter({ id: visitId }, undefined, EXACT_ROW_LIMIT),
    'Visit.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Visit is ambiguous');
  const exactRows = rawRows.filter((row) => row?.id === visitId);
  if (exactRows.length === 0) throw new PublicError(403, 'Visit is unavailable');
  if (exactRows.length !== 1) throw new PublicError(409, 'Visit is ambiguous');

  const visit = exactRows[0];
  const patientId = exactIdentifier(visit.patient_id);
  const agencyId = exactIdentifier(visit.agency_id);
  const creatorId = exactIdentifier(visit.created_by_user_id);
  const creatorEmail = canonicalEmail(visit.created_by_user_email_normalized);
  const platformCreator = canonicalEmail(visit.created_by);
  if (
    !patientId
    || !agencyId
    || !creatorId
    || !creatorEmail
    || visit.created_by_user_email_normalized !== creatorEmail
    || platformCreator !== creatorEmail
    || !validInstant(visit.updated_date)
    || !VISIT_STATUSES.has(String(visit.status || 'scheduled'))
    || visit.is_sample === true
  ) {
    throw new PublicError(409, 'Visit authority integrity check failed');
  }
  return { visit, patientId, agencyId, creatorId, creatorEmail };
}

async function loadExactActivePatient(
  entities: Record<string, any>,
  patientId: string,
  agencyId: string,
) {
  const rawRows = requireRows(
    await entities.Patient.filter({ id: patientId }, undefined, EXACT_ROW_LIMIT),
    'Patient.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  const exactRows = rawRows.filter((row) => row?.id === patientId);
  if (exactRows.length !== 1) throw new PublicError(403, 'Patient is unavailable');
  const patient = exactRows[0];
  if (
    patient.agency_id !== agencyId
    || patient.status !== 'active'
    || !validInstant(patient.updated_date)
  ) {
    throw new PublicError(403, 'Patient is unavailable');
  }
  return patient;
}

async function loadExactEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rawRows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  const exactRows = rawRows.filter((row) => row?.id === agencyId);
  if (exactRows.length !== 1 || !ENABLED_AGENCY_STATUSES.has(String(exactRows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return exactRows[0];
}

async function loadExactActiveMembership(
  entities: Record<string, any>,
  userId: string,
  normalizedEmail: string,
  agencyId: string,
) {
  const rawRows = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId, agency_id: agencyId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  return resolveActiveMembership(rawRows, userId, normalizedEmail, agencyId);
}

function assignmentKey(agencyId: string, patientId: string, userId: string) {
  return `${agencyId}:${patientId}:${userId}`;
}

function transitionRequestKey(key: string, requestId: string) {
  return `${key}:${requestId}`;
}

function validateAssignmentIntegrity(
  row: Record<string, any>,
  patientId: string,
  membership: Record<string, any>,
  userId: string,
  normalizedEmail: string,
  agencyId: string,
) {
  const id = exactIdentifier(row?.id);
  const key = assignmentKey(agencyId, patientId, userId);
  const userEmail = canonicalEmail(row?.user_email_normalized);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const requestId = exactIdentifier(row?.last_transition_request_id);
  const status = typeof row?.status === 'string' ? row.status : '';
  const action = typeof row?.last_transition_action === 'string'
    ? row.last_transition_action
    : '';
  const suspendedAt = row?.suspended_at;
  const revokedAt = row?.revoked_at;
  const revocationReason = row?.revocation_reason;
  if (
    !id
    || row.assignment_key !== key
    || row.agency_id !== agencyId
    || row.patient_id !== patientId
    || row.user_id !== userId
    || !userEmail
    || row.user_email_normalized !== userEmail
    || userEmail !== normalizedEmail
    || row.assignee_membership_id !== membership.id
    || row.assignee_membership_version_at_enablement !== membership.version
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || row.assignee_membership_version_at_enablement < 1
    || !ASSIGNMENT_STATUSES.has(status)
    || !ASSIGNMENT_SOURCES.has(String(row.source || ''))
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || !validInstant(row.activated_at)
    || (suspendedAt != null && !validInstant(suspendedAt))
    || (status === 'suspended' && !validInstant(suspendedAt))
    || (revokedAt != null && !validInstant(revokedAt))
    || (status === 'revoked' && (
      !validInstant(revokedAt) || !boundedReason(revocationReason)
    ))
    || (status !== 'revoked' && (revokedAt != null || revocationReason != null))
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !ASSIGNMENT_ACTIONS.has(action)
    || !assignmentLifecycleIsCoherent(row, status, action)
    || !requestId
    || row.last_transition_request_key !== transitionRequestKey(key, requestId)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(409, 'Care-team assignment integrity check failed');
  }
  return row;
}

async function loadExactActiveAssignment(
  entities: Record<string, any>,
  patientId: string,
  membership: Record<string, any>,
  userId: string,
  normalizedEmail: string,
  agencyId: string,
) {
  const key = assignmentKey(agencyId, patientId, userId);
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      {
        assignment_key: key,
        agency_id: agencyId,
        patient_id: patientId,
        user_id: userId,
      },
      '-updated_date',
      EXACT_ROW_LIMIT,
    ),
    'PatientCareTeamAssignment.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Care-team assignment is ambiguous');
  }
  if (rows.some((row) => (
    row?.assignment_key !== key
    || row?.agency_id !== agencyId
    || row?.patient_id !== patientId
    || row?.user_id !== userId
  ))) {
    throw new PublicError(409, 'Care-team assignment query scope could not be verified');
  }
  if (rows.length > 1) throw new PublicError(409, 'Care-team assignment is ambiguous');
  if (rows.length === 0) throw new PublicError(403, 'Visit is unavailable');
  const assignment = validateAssignmentIntegrity(
    rows[0],
    patientId,
    membership,
    userId,
    normalizedEmail,
    agencyId,
  );
  if (assignment.status !== 'active') throw new PublicError(403, 'Visit is unavailable');
  return assignment;
}

async function loadAuthorizedBundle(
  entities: Record<string, any>,
  visitId: string,
  userId: string,
  normalizedEmail: string,
) {
  const exactVisit = await loadExactVisit(entities, visitId);
  const patient = await loadExactActivePatient(entities, exactVisit.patientId, exactVisit.agencyId);
  const agency = await loadExactEnabledAgency(entities, exactVisit.agencyId);
  const membership = await loadExactActiveMembership(
    entities,
    userId,
    normalizedEmail,
    exactVisit.agencyId,
  );
  const assignment = AGENCY_WIDE_VISIT_ROLES.has(String(membership.tenant_role || ''))
    ? null
    : await loadExactActiveAssignment(
      entities,
      exactVisit.patientId,
      membership,
      userId,
      normalizedEmail,
      exactVisit.agencyId,
    );
  return { ...exactVisit, patient, agency, membership, assignment };
}

function authoritySignature(bundle: Awaited<ReturnType<typeof loadAuthorizedBundle>>) {
  return JSON.stringify(canonicalize({
    visit: {
      id: bundle.visit.id,
      patient_id: bundle.patientId,
      agency_id: bundle.agencyId,
      created_by_user_id: bundle.creatorId,
      created_by_user_email_normalized: bundle.creatorEmail,
    },
    patient: {
      id: bundle.patient.id,
      agency_id: bundle.patient.agency_id,
      status: bundle.patient.status,
    },
    agency: {
      id: bundle.agency.id,
      status: bundle.agency.status,
    },
    membership: {
      id: bundle.membership.id,
      membership_key: bundle.membership.membership_key,
      agency_id: bundle.membership.agency_id,
      user_id: bundle.membership.user_id,
      user_email_normalized: bundle.membership.user_email_normalized,
      tenant_role: bundle.membership.tenant_role,
      status: bundle.membership.status,
      version: bundle.membership.version,
      last_transition_at: bundle.membership.last_transition_at,
    },
    assignment: bundle.assignment ? {
      id: bundle.assignment.id,
      assignment_key: bundle.assignment.assignment_key,
      agency_id: bundle.assignment.agency_id,
      patient_id: bundle.assignment.patient_id,
      user_id: bundle.assignment.user_id,
      user_email_normalized: bundle.assignment.user_email_normalized,
      assignee_membership_id: bundle.assignment.assignee_membership_id,
      assignee_membership_version_at_enablement:
        bundle.assignment.assignee_membership_version_at_enablement,
      status: bundle.assignment.status,
      source: bundle.assignment.source,
      last_transition_action: bundle.assignment.last_transition_action,
      last_transition_request_key: bundle.assignment.last_transition_request_key,
      version: bundle.assignment.version,
      updated_date: bundle.assignment.updated_date,
    } : null,
  }));
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function completedVisitAiSourcePreimage(
  agencyId: string,
  visit: Record<string, any>,
  patient: Record<string, any>,
) {
  return canonicalize({
    protocol: 'completed_visit_ai_source_v1',
    agency_id: agencyId,
    visit: {
      id: visit.id,
      patient_id: visit.patient_id,
      visit_date: visit.visit_date ?? null,
      visit_type: visit.visit_type ?? null,
      status: visit.status ?? null,
      nurse_notes: typeof visit.nurse_notes === 'string' ? visit.nurse_notes : '',
      raw_transcription:
        typeof visit.raw_transcription === 'string' ? visit.raw_transcription : '',
      vital_signs: plainObject(visit.vital_signs) ? visit.vital_signs : {},
      documentation_review_ack: plainObject(visit.documentation_review_ack)
        ? visit.documentation_review_ack
        : null,
    },
    patient: {
      id: patient.id,
      agency_id: patient.agency_id,
      first_name: typeof patient.first_name === 'string' ? patient.first_name : '',
      last_name: typeof patient.last_name === 'string' ? patient.last_name : '',
      primary_diagnosis:
        typeof patient.primary_diagnosis === 'string' ? patient.primary_diagnosis : '',
      updated_date: patient.updated_date,
    },
  });
}

async function completedVisitAiSourceSha256(
  agencyId: string,
  visit: Record<string, any>,
  patient: Record<string, any>,
) {
  return sha256(JSON.stringify(completedVisitAiSourcePreimage(agencyId, visit, patient)));
}

function requireValidHandoffHistory(visit: Record<string, unknown>) {
  const currentStatus = typeof visit.emr_handoff_status === 'string'
    ? visit.emr_handoff_status
    : 'not_started';
  if (!HANDOFF_ORDER.has(currentStatus)) {
    throw new PublicError(409, 'EMR handoff history is invalid');
  }
  const history = visit.emr_handoff_history === undefined || visit.emr_handoff_history === null
    ? []
    : visit.emr_handoff_history;
  if (!Array.isArray(history) || history.length > MAX_HISTORY) {
    throw new PublicError(409, 'EMR handoff history is invalid');
  }
  let priorOrder = 0;
  for (const entry of history) {
    if (!plainObject(entry)) throw new PublicError(409, 'EMR handoff history is invalid');
    const order = typeof entry.status === 'string' ? HANDOFF_ORDER.get(entry.status) : undefined;
    if (
      order === undefined
      || order !== priorOrder + 1
      || !canonicalEmail(entry.reported_by)
      || !validInstant(entry.reported_at)
      || entry.self_reported !== true
      || typeof entry.note !== 'string'
      || entry.note.length > MAX_SHORT_TEXT
    ) {
      throw new PublicError(409, 'EMR handoff history is invalid');
    }
    priorOrder = order;
  }
  if ((history.length === 0 && currentStatus !== 'not_started')
      || (history.length > 0 && history[history.length - 1]?.status !== currentStatus)) {
    throw new PublicError(409, 'EMR handoff history is invalid');
  }
  return { currentStatus, history: history.map((entry) => ({ ...entry })) };
}

async function buildMutation(
  input: ParsedInput,
  bundle: Awaited<ReturnType<typeof loadAuthorizedBundle>>,
  normalizedEmail: string,
) {
  const storedStatus = String(bundle.visit.status || 'scheduled');

  if (input.action === 'save_documentation') {
    if (input.fields.patient_id !== undefined && input.fields.patient_id !== bundle.patientId) {
      throw new PublicError(403, 'patient_id does not match Visit');
    }
    if (storedStatus === 'cancelled') {
      throw new PublicError(409, 'Cancelled Visit documentation cannot be changed');
    }
    const requestedStatus = input.fields.status as string | undefined;
    if (storedStatus === 'completed' && requestedStatus === 'pending_review') {
      throw new PublicError(409, 'Completed Visit cannot return to pending review');
    }
    const resultingStatus = requestedStatus || storedStatus;
    const resultingGrounding = input.fields.grounding_pending === undefined
      ? bundle.visit.grounding_pending === true
      : input.fields.grounding_pending === true;
    if ((resultingStatus === 'pending_review') !== resultingGrounding) {
      throw new PublicError(400, 'status and grounding_pending are inconsistent');
    }
    const { patient_id: _assertion, ...mutation } = input.fields;
    if (Object.keys(mutation).length === 0) {
      throw new PublicError(400, 'save_documentation requires a mutable clinical field');
    }
    if (mutation.nurse_notes !== undefined || mutation.raw_transcription !== undefined) {
      mutation.documentation_review_ack = null;
    }
    return mutation;
  }

  if (input.action === 'reschedule') {
    if (storedStatus !== 'scheduled') {
      throw new PublicError(409, 'Only a scheduled Visit can be rescheduled');
    }
    return { visit_time: input.fields.visit_time };
  }

  if (input.action === 'set_ai_tags') {
    return { ai_tags: input.fields.ai_tags };
  }

  if (input.action === 'advance_handoff') {
    const { currentStatus, history } = requireValidHandoffHistory(bundle.visit);
    const currentOrder = HANDOFF_ORDER.get(currentStatus)!;
    const nextStatus = String(input.fields.next_status);
    const nextOrder = HANDOFF_ORDER.get(nextStatus)!;
    if (nextOrder !== currentOrder + 1) {
      throw new PublicError(409, 'EMR handoff must advance exactly one step');
    }
    if (history.length >= MAX_HISTORY) {
      throw new PublicError(409, 'EMR handoff history is full');
    }
    return {
      emr_handoff_status: nextStatus,
      emr_handoff_history: [
        ...history,
        {
          status: nextStatus,
          reported_by: normalizedEmail,
          reported_at: new Date().toISOString(),
          self_reported: true,
          note: '',
        },
      ],
    };
  }

  if (input.action === 'set_review_ack') {
    if (input.fields.acknowledged === false) {
      return { documentation_review_ack: null };
    }
    const note = typeof bundle.visit.nurse_notes === 'string' ? bundle.visit.nurse_notes : '';
    if (!note.trim()) throw new PublicError(409, 'Visit has no documentation to acknowledge');
    const noteSha256 = await sha256(note);
    if (noteSha256 !== input.fields.expected_note_hash) {
      throw new PublicError(409, 'Visit documentation changed before acknowledgement');
    }
    return {
      documentation_review_ack: {
        acknowledged: true,
        acknowledged_by: normalizedEmail,
        acknowledged_at: new Date().toISOString(),
        note_hash: fnv1a(note),
        note_sha256: noteSha256,
        note_length: note.length,
        ai_assisted: true,
        nurse_edited: input.fields.nurse_edited === true,
        statement: REVIEW_STATEMENT,
        is_clinical_signature: false,
      },
    };
  }

  if (input.action === 'claim_ai_processing') {
    if (storedStatus !== 'completed') {
      throw new PublicError(409, 'Visit must be completed before AI processing');
    }
    if (bundle.visit.ai_processed_at != null) {
      throw new PublicError(
        409,
        validInstant(bundle.visit.ai_processed_at)
          ? 'Visit AI processing is already complete'
          : 'Visit AI processing state is invalid',
      );
    }
    if (bundle.visit.ai_process_claimed_by != null) {
      throw new PublicError(409, 'Visit AI processing is already claimed');
    }
    const currentSourceSha256 = await completedVisitAiSourceSha256(
      bundle.agencyId,
      bundle.visit,
      bundle.patient,
    );
    if (currentSourceSha256 !== input.fields.expected_source_sha256) {
      throw new PublicError(409, 'Visit AI source changed before claim');
    }
    return { ai_process_claimed_by: input.fields.claim_token };
  }

  if (input.action === 'publish_ai_processing') {
    if (storedStatus !== 'completed') {
      throw new PublicError(409, 'Visit must be completed before AI publication');
    }
    if (bundle.visit.ai_process_claimed_by !== input.fields.claim_token) {
      throw new PublicError(409, 'Visit AI processing claim is unavailable');
    }
    if (bundle.visit.ai_processed_at != null) {
      throw new PublicError(
        409,
        validInstant(bundle.visit.ai_processed_at)
          ? 'Visit AI processing is already complete'
          : 'Visit AI processing state is invalid',
      );
    }
    const currentSourceSha256 = await completedVisitAiSourceSha256(
      bundle.agencyId,
      bundle.visit,
      bundle.patient,
    );
    if (currentSourceSha256 !== input.fields.expected_source_sha256) {
      throw new PublicError(409, 'Visit AI source changed before publication');
    }
    const mutation: Record<string, unknown> = {
      nurse_notes: input.fields.nurse_notes,
      ai_tags: input.fields.ai_tags,
      ai_processed_at: input.fields.ai_processed_at,
      documentation_review_ack: null,
    };
    if (input.fields.raw_transcription !== undefined) {
      mutation.raw_transcription = input.fields.raw_transcription;
    }
    return mutation;
  }

  throw new PublicError(503, 'Legacy Visit recovery is paused');
}

function requireActionPolicy(
  action: ParsedInput['action'],
  bundle: Awaited<ReturnType<typeof loadAuthorizedBundle>>,
  user: Record<string, unknown>,
  normalizedEmail: string,
) {
  if (
    [
      'save_documentation',
      'advance_handoff',
      'set_review_ack',
      'read_ai_processing_source',
      'claim_ai_processing',
      'publish_ai_processing',
    ].includes(action)
    && bundle.membership.tenant_role !== 'clinician'
  ) {
    throw new PublicError(403, 'Active clinician membership required');
  }
  if (action === 'set_ai_tags') {
    const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
    if (!configuredEmail || user.role !== 'admin' || normalizedEmail !== configuredEmail) {
      throw new PublicError(403, 'Protected platform administrator required');
    }
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (plainObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function valuesMatch(left: unknown, right: unknown) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function visitMutationPreimage(row: Record<string, unknown>) {
  return Object.fromEntries(
    VISIT_MUTATION_PREIMAGE_FIELDS.map((field) => [field, row[field]]),
  );
}

function visitMutationQuery(preimage: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(preimage).map(([field, value]) => [
      field,
      value === undefined ? { $exists: false } : value,
    ]),
  );
}

function successfulExactUpdate(value: unknown) {
  return plainObject(value)
    && value.success === true
    && value.updated === 1
    && value.has_more === false;
}

async function applyConditionalVisitMutation(
  entities: Record<string, any>,
  before: Record<string, unknown>,
  mutation: Record<string, unknown>,
) {
  const preimage = visitMutationPreimage(before);
  if (
    !exactIdentifier(preimage.id)
    || !exactIdentifier(preimage.agency_id)
    || !exactIdentifier(preimage.patient_id)
    || !validInstant(preimage.updated_date)
  ) {
    throw new Error('Visit conditional update requires an exact preimage');
  }
  const outcome = await entities.Visit.updateMany(
    visitMutationQuery(preimage),
    { $set: mutation },
  );
  if (!successfulExactUpdate(outcome)) {
    throw new PublicError(409, 'Visit changed during mutation');
  }
  return preimage;
}

function requireExactVisitMutationReadback(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  mutation: Record<string, unknown>,
) {
  const beforePreimage = visitMutationPreimage(before);
  const afterPreimage = visitMutationPreimage(after);
  if (!validInstant(afterPreimage.updated_date)) {
    throw new PublicError(409, 'Visit update timestamp failed post-update verification');
  }
  for (const field of VISIT_MUTATION_PREIMAGE_FIELDS) {
    if (field === 'updated_date') continue;
    const expected = Object.hasOwn(mutation, field)
      ? mutation[field]
      : beforePreimage[field];
    if (!valuesMatch(afterPreimage[field], expected)) {
      throw new PublicError(409, `Visit.${field} failed exact post-update verification`);
    }
  }
}

function narrowVisit(row: Record<string, unknown>, action: ParsedInput['action']) {
  const narrowed: Record<string, unknown> = {
    id: row.id,
    patient_id: row.patient_id,
    agency_id: row.agency_id,
    status: row.status || 'scheduled',
    visit_time: row.visit_time || null,
    emr_handoff_status: row.emr_handoff_status || 'not_started',
    review_acknowledged: plainObject(row.documentation_review_ack)
      && row.documentation_review_ack.acknowledged === true,
  };
  if (INTERNAL_VISIT_ACTIONS.has(action)) {
    narrowed.ai_process_claimed_by = row.ai_process_claimed_by || null;
    narrowed.ai_processed_at = row.ai_processed_at || null;
  }
  return narrowed;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return jsonResponse(
        { error: 'Method not allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user) || user?.disabled === true) {
      const response = DEACTIVATED_USER_RESPONSE();
      for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
        response.headers.set(name, value);
      }
      return response;
    }
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    if (user.is_service === true || user.is_verified === false) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = exactIdentifier(user.id);
    const normalizedEmail = canonicalEmail(user.email);
    if (!userId || !normalizedEmail) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }

    const input = await parseInput(req);
    const entities = base44.asServiceRole.entities;
    const initial = await loadAuthorizedBundle(
      entities,
      input.visitId,
      userId,
      normalizedEmail,
    );

    // Re-resolve immediately before the privileged write. Every lifecycle state
    // remains in scope, so a suspension/revocation or tenant/Patient corruption
    // introduced after the initial authorization fails closed.
    const rechecked = await loadAuthorizedBundle(
      entities,
      input.visitId,
      userId,
      normalizedEmail,
    );
    requireActionPolicy(input.action, rechecked, user, normalizedEmail);
    if (authoritySignature(rechecked) !== authoritySignature(initial)) {
      throw new PublicError(409, 'Visit authority changed during mutation');
    }

    if (input.action === 'read_ai_processing_source') {
      if (rechecked.visit.status !== 'completed') {
        throw new PublicError(409, 'Visit must be completed before AI processing');
      }
      const source = completedVisitAiSourcePreimage(
        rechecked.agencyId,
        rechecked.visit,
        rechecked.patient,
      );
      const sourceSha256 = await sha256(JSON.stringify(source));
      const disclosure = await loadAuthorizedBundle(
        entities,
        input.visitId,
        userId,
        normalizedEmail,
      );
      requireActionPolicy(input.action, disclosure, user, normalizedEmail);
      const disclosureSource = completedVisitAiSourcePreimage(
        disclosure.agencyId,
        disclosure.visit,
        disclosure.patient,
      );
      if (
        authoritySignature(disclosure) !== authoritySignature(rechecked)
        || !valuesMatch(disclosureSource, source)
      ) {
        throw new PublicError(409, 'Visit AI source changed during read');
      }
      return jsonResponse({
        updated: false,
        action: input.action,
        source: disclosureSource,
        source_sha256: sourceSha256,
        processing: {
          claimed_by: disclosure.visit.ai_process_claimed_by ?? null,
          processed_at: disclosure.visit.ai_processed_at ?? null,
        },
      });
    }

    const mutation = await buildMutation(input, rechecked, normalizedEmail);
    await applyConditionalVisitMutation(entities, rechecked.visit, mutation);

    // A cross-entity transaction is not available. Re-running the complete
    // authorization proof after the write cannot eliminate the final race, but
    // it prevents a success response after membership revocation, Patient or
    // Agency drift, loss of access, or an immutable-stamp rewrite.
    const updated = await loadAuthorizedBundle(
      entities,
      input.visitId,
      userId,
      normalizedEmail,
    );
    requireActionPolicy(input.action, updated, user, normalizedEmail);
    if (authoritySignature(updated) !== authoritySignature(rechecked)) {
      throw new Error('Visit authority changed during update');
    }

    if (input.action === 'set_review_ack' && input.fields.acknowledged === true) {
      const postWriteNote = typeof updated.visit.nurse_notes === 'string'
        ? updated.visit.nurse_notes
        : '';
      const postWriteHash = await sha256(postWriteNote);
      const ack = updated.visit.documentation_review_ack;
      if (
        postWriteHash !== input.fields.expected_note_hash
        || !plainObject(ack)
        || ack.note_sha256 !== postWriteHash
      ) {
        await applyConditionalVisitMutation(
          entities,
          updated.visit,
          { documentation_review_ack: null },
        ).catch(() => {});
        throw new PublicError(409, 'Visit documentation changed during acknowledgement');
      }
    }

    requireExactVisitMutationReadback(rechecked.visit, updated.visit, mutation);

    return jsonResponse({
      updated: true,
      action: input.action,
      visit: narrowVisit(updated.visit, input.action),
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    // Conditional-update errors may retain the full clinical preimage.
    console.error('updateAuthorizedVisit failed');
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }
});