import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Append one immutable PatientNoteHistoryEntry revision.
 *
 * Patient.enhanced_notes_history is a legacy migration source only. Both
 * `append` and `update` create a new event, so concurrent writers cannot erase
 * each other's clinical history. The authorized reader projects the newest
 * revision for each Visit back into the legacy array shape used by Smart Note.
 */

const MAX_BODY_BYTES = 600_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_NOTE_LENGTH = 250_000;
const MAX_VISIT_TYPE_LENGTH = 100;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;
const TOP_LEVEL_FIELDS = new Set(['patient_id', 'mode', 'entry', 'clinical_notes']);
const ENTRY_FIELDS = new Set([
  'entry_id',
  'visit_id',
  'date',
  'visit_type',
  'note',
  'compliance_score',
]);
const MODES = new Set(['append', 'update']);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const NOTE_AUTHOR_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'social_worker',
  'spiritual_care',
]);
const AGENCY_WIDE_ROLES = new Set(['agency_admin', 'manager']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const DOCUMENTABLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const DOCUMENTED_VISIT_STATUSES = new Set(['completed', 'pending_review']);

class PublicError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
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

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validCalendarDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function boundedText(value: unknown, maxLength: number, required = false) {
  if (value === undefined || value === null) return required ? null : undefined;
  if (typeof value !== 'string' || value.length > maxLength) return null;
  if (required && !value.trim()) return null;
  return value;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseRequest(req: Request) {
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  if (Object.keys(body).some((key) => !TOP_LEVEL_FIELDS.has(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }

  const patientId = exactIdentifier(body.patient_id);
  if (!patientId) throw new PublicError(400, 'patient_id is invalid');
  if (typeof body.mode !== 'string' || !MODES.has(body.mode)) {
    throw new PublicError(400, 'mode is invalid');
  }
  if (!plainObject(body.entry)) throw new PublicError(400, 'entry must be an object');
  if (Object.keys(body.entry).some((key) => !ENTRY_FIELDS.has(key))) {
    throw new PublicError(400, 'entry contains unsupported fields');
  }

  const sourceEntryId = body.entry.entry_id === undefined
    ? null
    : exactIdentifier(body.entry.entry_id);
  if (body.entry.entry_id !== undefined && !sourceEntryId) {
    throw new PublicError(400, 'entry.entry_id is invalid');
  }
  const visitId = exactIdentifier(body.entry.visit_id);
  if (!visitId) throw new PublicError(400, 'entry.visit_id is invalid');
  if (body.entry.date !== undefined && !validCalendarDate(body.entry.date)) {
    throw new PublicError(400, 'entry.date is invalid');
  }
  const visitType = boundedText(body.entry.visit_type, MAX_VISIT_TYPE_LENGTH);
  if (visitType === null) throw new PublicError(400, 'entry.visit_type is invalid');
  const note = boundedText(body.entry.note, MAX_NOTE_LENGTH, true);
  if (note === null) throw new PublicError(400, 'entry.note is invalid');
  const clinicalNotes = boundedText(body.clinical_notes, MAX_NOTE_LENGTH);
  if (clinicalNotes === null) throw new PublicError(400, 'clinical_notes is invalid');
  if (clinicalNotes !== undefined && clinicalNotes !== note) {
    throw new PublicError(400, 'clinical_notes must match entry.note');
  }
  if (
    body.entry.compliance_score !== undefined
    && (
      typeof body.entry.compliance_score !== 'number'
      || !Number.isFinite(body.entry.compliance_score)
      || body.entry.compliance_score < 0
      || body.entry.compliance_score > 100
    )
  ) {
    throw new PublicError(400, 'entry.compliance_score is invalid');
  }

  return {
    patientId,
    visitId,
    sourceEntryId,
    mode: body.mode,
    visitDate: body.entry.date as string | undefined,
    visitType,
    note,
    clinicalNotes: clinicalNotes ?? note,
    complianceScore: body.entry.compliance_score as number | undefined,
  };
}

function validateMembership(
  rawRows: Array<Record<string, any>>,
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
  const storedEmail = canonicalEmail(row.user_email_normalized);
  const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
  const status = typeof row.status === 'string' ? row.status : '';
  if (
    !exactIdentifier(row.id)
    || !exactIdentifier(row.membership_key)
    || row.membership_key !== `${agencyId}:${userId}`
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== normalizedEmail
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !MEMBERSHIP_STATUSES.has(status)
    || !Number.isSafeInteger(row.version)
    || Number(row.version) < 1
    || !exactIdentifier(row.created_by_user_id)
    || !exactIdentifier(row.last_transition_by_user_id)
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
  if (!NOTE_AUTHOR_ROLES.has(String(row.tenant_role || ''))) {
    throw new PublicError(403, 'Tenant role cannot author clinical notes');
  }
  return row;
}

async function loadExact(entities: Record<string, any>, entityName: string, id: string) {
  const rows = requireRows(
    await entities[entityName].filter({ id }, undefined, EXACT_ROW_LIMIT),
    `${entityName}.filter`,
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, `${entityName} is ambiguous`);
  const exact = rows.filter((row) => row?.id === id);
  if (exact.length === 0) throw new PublicError(403, `${entityName} is unavailable`);
  if (exact.length !== 1) throw new PublicError(409, `${entityName} is ambiguous`);
  return exact[0];
}

function canonicalAssignments(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500) {
    throw new PublicError(409, 'Patient care-team integrity check failed');
  }
  return value.map((email) => {
    const normalized = canonicalEmail(email);
    if (!normalized || email !== normalized) {
      throw new PublicError(409, 'Patient care-team integrity check failed');
    }
    return normalized;
  });
}

async function loadAuthority(
  entities: Record<string, any>,
  input: Awaited<ReturnType<typeof parseRequest>>,
  userId: string,
  normalizedEmail: string,
) {
  const patient = await loadExact(entities, 'Patient', input.patientId);
  const agencyId = exactIdentifier(patient.agency_id);
  if (
    !agencyId
    || !DOCUMENTABLE_PATIENT_STATUSES.has(String(patient.status || ''))
    || patient.is_archived === true
    || patient.is_sample === true
  ) {
    throw new PublicError(403, 'Patient is unavailable');
  }
  const agency = await loadExact(entities, 'Agency', agencyId);
  if (!ENABLED_AGENCY_STATUSES.has(String(agency.status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  const membershipRows = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId, agency_id: agencyId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  const membership = validateMembership(membershipRows, userId, normalizedEmail, agencyId);
  const assignments = canonicalAssignments(patient.assigned_nurses);
  if (
    !AGENCY_WIDE_ROLES.has(String(membership.tenant_role || ''))
    && normalizeEmail(patient.created_by) !== normalizedEmail
    && !assignments.includes(normalizedEmail)
  ) {
    throw new PublicError(403, 'Patient is unavailable');
  }
  const visit = await loadExact(entities, 'Visit', input.visitId);
  if (
    visit.patient_id !== input.patientId
    || visit.agency_id !== agencyId
    || !DOCUMENTED_VISIT_STATUSES.has(String(visit.status || ''))
  ) {
    throw new PublicError(403, 'Visit is unavailable');
  }
  const authoritativeVisitDate = validCalendarDate(visit.visit_date)
    ? String(visit.visit_date)
    : null;
  const authoritativeVisitType = boundedText(visit.visit_type, MAX_VISIT_TYPE_LENGTH, true);
  const visitRevisionAt = validInstant(visit.updated_date) ? String(visit.updated_date) : null;
  if (!authoritativeVisitDate || !authoritativeVisitType || !visitRevisionAt) {
    throw new PublicError(409, 'Visit documentation metadata is incomplete');
  }
  if (
    (input.visitDate !== undefined && input.visitDate !== authoritativeVisitDate)
    || (input.visitType !== undefined && input.visitType !== authoritativeVisitType)
  ) {
    throw new PublicError(409, 'Visit documentation metadata does not match the stored Visit');
  }
  if (
    visit.nurse_notes !== input.note
    || (
      input.complianceScore !== undefined
      && visit.compliance_score !== input.complianceScore
    )
  ) {
    throw new PublicError(409, 'Patient note content does not match the stored Visit');
  }

  return {
    agencyId,
    membership,
    visitDate: authoritativeVisitDate,
    visitType: authoritativeVisitType,
    visitRevisionAt,
    snapshot: {
      patient: {
        id: patient.id,
        agency_id: patient.agency_id,
        status: patient.status,
        is_archived: patient.is_archived === true,
        is_sample: patient.is_sample === true,
        created_by: normalizeEmail(patient.created_by),
        assigned_nurses: assignments,
      },
      agency: { id: agency.id, status: agency.status },
      membership: {
        id: membership.id,
        membership_key: membership.membership_key,
        agency_id: membership.agency_id,
        user_id: membership.user_id,
        user_email_normalized: membership.user_email_normalized,
        tenant_role: membership.tenant_role,
        status: membership.status,
        version: membership.version,
        activated_at: membership.activated_at,
        last_transition_by_user_id: membership.last_transition_by_user_id,
        last_transition_by_email_normalized: membership.last_transition_by_email_normalized,
        last_transition_at: membership.last_transition_at,
        last_transition_reason: membership.last_transition_reason,
      },
      visit: {
        id: visit.id,
        patient_id: visit.patient_id,
        agency_id: visit.agency_id,
        status: visit.status,
        visit_date: visit.visit_date,
        visit_type: visit.visit_type,
        nurse_notes: visit.nurse_notes,
        compliance_score: visit.compliance_score,
        updated_date: visit.updated_date,
      },
    },
  };
}

function eventMatches(event: Record<string, any>, expected: Record<string, unknown>) {
  return Object.entries(expected).every(([field, value]) => sameValue(event?.[field], value));
}

function narrowEvent(event: Record<string, any>) {
  return {
    id: event.id,
    event_key: event.event_key,
    logical_note_key: event.logical_note_key,
    patient_id: event.patient_id,
    visit_id: event.visit_id,
    mode: event.mode,
    date: event.visit_date || null,
    visit_type: event.visit_type || null,
    note: event.note,
    clinical_notes: event.clinical_notes || event.note,
    compliance_score: event.compliance_score ?? null,
    created_by: event.actor_email_normalized,
    created_at: event.recorded_at,
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
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (
      user.is_active === false
      || user.disabled === true
      || user.is_service === true
      || user.is_verified === false
    ) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const userId = exactIdentifier(user.id);
    const normalizedEmail = canonicalEmail(user.email);
    if (!userId || !normalizedEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const input = await parseRequest(req);
    const entities = base44.asServiceRole.entities;
    const firstAuthority = await loadAuthority(entities, input, userId, normalizedEmail);
    const canonicalPayload = {
      mode: input.mode,
      visit_date: firstAuthority.visitDate,
      visit_type: firstAuthority.visitType,
      note: input.note,
      clinical_notes: input.clinicalNotes,
      compliance_score: input.complianceScore ?? null,
    };
    const payloadFingerprint = await sha256(JSON.stringify(canonicalJson(canonicalPayload)));
    const logicalNoteKey = await sha256(
      JSON.stringify([firstAuthority.agencyId, input.patientId, input.visitId]),
    );
    const idempotencyScope = input.sourceEntryId || payloadFingerprint;
    const eventKey = await sha256(
      JSON.stringify([firstAuthority.agencyId, input.patientId, input.visitId, idempotencyScope]),
    );
    const replayExpected = {
      agency_id: firstAuthority.agencyId,
      patient_id: input.patientId,
      visit_id: input.visitId,
      logical_note_key: logicalNoteKey,
      event_key: eventKey,
      payload_fingerprint: payloadFingerprint,
      ...(input.sourceEntryId ? { source_entry_id: input.sourceEntryId } : {}),
      mode: input.mode,
      visit_date: firstAuthority.visitDate,
      visit_type: firstAuthority.visitType,
      note: input.note,
      clinical_notes: input.clinicalNotes,
      ...(input.complianceScore !== undefined
        ? { compliance_score: input.complianceScore }
        : {}),
      actor_user_id: userId,
      actor_email_normalized: normalizedEmail,
      membership_id: firstAuthority.membership.id,
    };
    const expectedEvent = {
      ...replayExpected,
      membership_version: firstAuthority.membership.version,
      visit_revision_at: firstAuthority.visitRevisionAt,
    };

    const existingRows = requireRows(
      await entities.PatientNoteHistoryEntry.filter(
        { event_key: eventKey },
        'created_date',
        EXACT_ROW_LIMIT,
      ),
      'PatientNoteHistoryEntry.filter',
    );
    if (existingRows.length >= EXACT_ROW_LIMIT) {
      throw new PublicError(409, 'Patient note event key is ambiguous');
    }
    if (existingRows.length) {
      if (existingRows.some((row) => !eventMatches(row, replayExpected))) {
        throw new PublicError(409, 'Patient note event key conflicts with another payload');
      }
      const replayAuthority = await loadAuthority(entities, input, userId, normalizedEmail);
      if (!sameValue(replayAuthority.snapshot, firstAuthority.snapshot)) {
        throw new PublicError(409, 'Patient note authority changed during request');
      }
      return Response.json({
        success: true,
        created: false,
        duplicate_count: existingRows.length,
        event: narrowEvent(existingRows[0]),
      });
    }

    // Repeat the complete authority proof immediately before the service-role
    // create. Base44 has no cross-entity transaction, so the post-commit check
    // below detects (but cannot roll back) a membership transition racing the
    // immutable append.
    const writeAuthority = await loadAuthority(entities, input, userId, normalizedEmail);
    if (!sameValue(writeAuthority.snapshot, firstAuthority.snapshot)) {
      throw new PublicError(409, 'Patient note authority changed during request');
    }
    const recordedAt = new Date().toISOString();
    const created = await entities.PatientNoteHistoryEntry.create({
      ...expectedEvent,
      recorded_at: recordedAt,
    });
    const createdId = exactIdentifier(created?.id);
    if (!createdId) throw new Error('PatientNoteHistoryEntry.create returned no exact id');
    const stored = await loadExact(entities, 'PatientNoteHistoryEntry', createdId);
    if (!eventMatches(stored, { ...expectedEvent, recorded_at: recordedAt })) {
      throw new Error('Patient note event failed immutable post-create verification');
    }

    let finalAuthority;
    try {
      finalAuthority = await loadAuthority(entities, input, userId, normalizedEmail);
    } catch (error) {
      if (error instanceof PublicError) {
        throw new PublicError(
          409,
          'Patient note was recorded but authority changed during the request',
          'PATIENT_NOTE_COMMITTED_AUTHORITY_CHANGED',
        );
      }
      throw error;
    }
    if (!sameValue(finalAuthority.snapshot, firstAuthority.snapshot)) {
      throw new PublicError(
        409,
        'Patient note was recorded but authority changed during the request',
        'PATIENT_NOTE_COMMITTED_AUTHORITY_CHANGED',
      );
    }
    return Response.json({ success: true, created: true, event: narrowEvent(stored) });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        { status: error.status },
      );
    }
    console.error('appendPatientNoteHistory failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
