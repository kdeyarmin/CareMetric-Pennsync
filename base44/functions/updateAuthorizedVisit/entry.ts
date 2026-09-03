import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    if (!VITAL_FIELDS.has(key) || typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1_000_000) {
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

  if (action === 'reschedule') {
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
  if (patient.agency_id !== agencyId || patient.status !== 'active') {
    throw new PublicError(403, 'Patient is unavailable');
  }
  if (patient.assigned_nurses !== undefined && !Array.isArray(patient.assigned_nurses)) {
    throw new PublicError(409, 'Patient authority integrity check failed');
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

function requireVisitAccess(
  visit: Record<string, unknown>,
  patient: Record<string, unknown>,
  membership: Record<string, unknown>,
  userId: string,
  normalizedEmail: string,
) {
  if (AGENCY_WIDE_VISIT_ROLES.has(String(membership.tenant_role || ''))) return;
  const isOwner = visit.created_by_user_id === userId
    && visit.created_by_user_email_normalized === normalizedEmail;
  const isAssigned = Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.some((email) => canonicalEmail(email) === normalizedEmail);
  if (!isOwner && !isAssigned) throw new PublicError(403, 'Visit is unavailable');
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
  requireVisitAccess(exactVisit.visit, patient, membership, userId, normalizedEmail);
  return { ...exactVisit, patient, agency, membership };
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
      assigned_nurses: bundle.patient.assigned_nurses || [],
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

  throw new PublicError(503, 'Legacy Visit recovery is paused');
}

function requireActionPolicy(
  action: ParsedInput['action'],
  bundle: Awaited<ReturnType<typeof loadAuthorizedBundle>>,
  user: Record<string, unknown>,
  normalizedEmail: string,
) {
  if (
    ['save_documentation', 'advance_handoff', 'set_review_ack'].includes(action)
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

function narrowVisit(row: Record<string, unknown>) {
  return {
    id: row.id,
    patient_id: row.patient_id,
    agency_id: row.agency_id,
    status: row.status || 'scheduled',
    visit_time: row.visit_time || null,
    emr_handoff_status: row.emr_handoff_status || 'not_started',
    review_acknowledged: plainObject(row.documentation_review_ack)
      && row.documentation_review_ack.acknowledged === true,
  };
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
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user) || user?.disabled === true) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = exactIdentifier(user.id);
    const normalizedEmail = canonicalEmail(user.email);
    if (!userId || !normalizedEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
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

    const mutation = await buildMutation(input, rechecked, normalizedEmail);
    await entities.Visit.update(input.visitId, mutation);

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
    for (const [key, expected] of Object.entries(mutation)) {
      if (!valuesMatch(updated.visit[key], expected)) {
        throw new Error(`Visit.${key} failed exact post-update verification`);
      }
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
        await entities.Visit.update(
          input.visitId,
          { documentation_review_ack: null },
        ).catch(() => {});
        throw new PublicError(409, 'Visit documentation changed during acknowledgement');
      }
    }

    return Response.json({
      updated: true,
      action: input.action,
      visit: narrowVisit(updated.visit),
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('updateAuthorizedVisit failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
