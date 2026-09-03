import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Read the append-only PatientNoteHistoryEntry log through the same immutable
 * tenant authority used by the writer. Direct entity reads remain disabled.
 * The response projects only the newest immutable revision per Visit into the
 * legacy array shape consumed by Smart Note. Projection is page-local: callers
 * that need a complete legal/clinical export must follow page.next_offset until
 * has_more is false and reconcile logical_note_key values across pages. The UI
 * intentionally requests only the recent bounded working context.
 */

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;
const DEFAULT_EVENT_LIMIT = 200;
const MAX_EVENT_LIMIT = 500;
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const NOTE_READER_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'social_worker',
  'spiritual_care',
]);
const AGENCY_WIDE_ROLES = new Set(['agency_admin', 'manager']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const VISIBLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);

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

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validCalendarDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validSha256(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['patient_id', 'event_limit', 'offset'].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const patientId = exactIdentifier(record.patient_id);
  if (!patientId) throw new PublicError(400, 'patient_id is invalid');
  const eventLimit = record.event_limit === undefined ? DEFAULT_EVENT_LIMIT : Number(record.event_limit);
  const offset = record.offset === undefined ? 0 : Number(record.offset);
  if (!Number.isSafeInteger(eventLimit) || eventLimit < 1 || eventLimit > MAX_EVENT_LIMIT) {
    throw new PublicError(400, 'event_limit is invalid');
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new PublicError(400, 'offset is invalid');
  }
  return { patientId, eventLimit, offset };
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
  if (!NOTE_READER_ROLES.has(String(row.tenant_role || ''))) {
    throw new PublicError(403, 'Tenant role cannot read clinical notes');
  }
  return row;
}

async function loadAuthority(
  entities: Record<string, any>,
  patientId: string,
  userId: string,
  normalizedEmail: string,
) {
  const patient = await loadExact(entities, 'Patient', patientId);
  const agencyId = exactIdentifier(patient.agency_id);
  if (
    !agencyId
    || !VISIBLE_PATIENT_STATUSES.has(String(patient.status || ''))
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
  return {
    agencyId,
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
    },
  };
}

function validateAndProjectEvents(
  rows: Array<Record<string, any>>,
  patientId: string,
  agencyId: string,
) {
  const byEventKey = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const id = exactIdentifier(row.id);
    const eventKey = validSha256(row.event_key) ? row.event_key : null;
    const logicalNoteKey = validSha256(row.logical_note_key) ? row.logical_note_key : null;
    const visitId = exactIdentifier(row.visit_id);
    const actorEmail = canonicalEmail(row.actor_email_normalized);
    if (
      !id
      || !eventKey
      || !logicalNoteKey
      || !visitId
      || row.patient_id !== patientId
      || row.agency_id !== agencyId
      || !['append', 'update'].includes(String(row.mode || ''))
      || typeof row.note !== 'string'
      || !row.note.trim()
      || row.note.length > 250_000
      || row.clinical_notes !== row.note
      || !validCalendarDate(row.visit_date)
      || typeof row.visit_type !== 'string'
      || !row.visit_type.trim()
      || row.visit_type.length > 100
      || (
        row.compliance_score !== undefined
        && row.compliance_score !== null
        && (
          typeof row.compliance_score !== 'number'
          || !Number.isFinite(row.compliance_score)
          || row.compliance_score < 0
          || row.compliance_score > 100
        )
      )
      || !validSha256(row.payload_fingerprint)
      || (row.source_entry_id !== undefined && row.source_entry_id !== null
        && !exactIdentifier(row.source_entry_id))
      || !exactIdentifier(row.actor_user_id)
      || !actorEmail
      || row.actor_email_normalized !== actorEmail
      || !exactIdentifier(row.membership_id)
      || !Number.isSafeInteger(row.membership_version)
      || row.membership_version < 1
      || !validInstant(row.recorded_at)
      || !validInstant(row.visit_revision_at)
    ) {
      throw new PublicError(409, 'Patient note history integrity check failed');
    }
    const prior = byEventKey.get(eventKey);
    if (prior) {
      const comparable = [
        'agency_id', 'patient_id', 'visit_id', 'logical_note_key', 'event_key',
        'payload_fingerprint', 'mode', 'visit_date',
        'visit_type', 'note', 'clinical_notes', 'compliance_score',
        'actor_user_id', 'actor_email_normalized', 'membership_id',
        // Concurrent idempotent creates can have different physical ids and
        // server or Visit-revision timestamps. Neither changes their semantic
        // payload; the first newest-by-created_date row is the representative.
        'membership_version',
      ];
      if (comparable.some((field) => !sameValue(prior[field], row[field]))) {
        throw new PublicError(409, 'Patient note event key is ambiguous');
      }
      continue;
    }
    byEventKey.set(eventKey, row);
  }

  const revisionOrder = (row: Record<string, any>) => [
    Date.parse(row.visit_revision_at),
    Date.parse(row.recorded_at),
    String(row.event_key),
    String(row.id),
  ];
  const compareRevision = (left: Record<string, any>, right: Record<string, any>) => {
    const leftOrder = revisionOrder(left);
    const rightOrder = revisionOrder(right);
    for (let index = 0; index < leftOrder.length; index += 1) {
      if (leftOrder[index] < rightOrder[index]) return -1;
      if (leftOrder[index] > rightOrder[index]) return 1;
    }
    return 0;
  };

  // Visit.updated_date captured at authorization time is the logical revision
  // order. Physical event creation can finish later than a newer writer, so
  // created_date alone could otherwise project an older note as current.
  const latestByLogicalNote = new Map<string, Record<string, any>>();
  for (const row of byEventKey.values()) {
    const current = latestByLogicalNote.get(row.logical_note_key);
    if (!current || compareRevision(row, current) > 0) {
      latestByLogicalNote.set(row.logical_note_key, row);
    }
  }
  return [...latestByLogicalNote.values()]
    .sort(compareRevision)
    .map((row) => ({
    entry_id: row.source_entry_id || row.event_key,
    event_id: row.id,
    event_key: row.event_key,
    visit_id: row.visit_id,
    date: row.visit_date || row.recorded_at,
    visit_type: row.visit_type || null,
    note: row.note,
    compliance_score: row.compliance_score ?? null,
    created_by: row.actor_email_normalized,
    created_at: row.recorded_at,
    revision_at: row.visit_revision_at,
  }));
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
    const firstAuthority = await loadAuthority(
      entities,
      input.patientId,
      userId,
      normalizedEmail,
    );
    const rows = requireRows(
      await entities.PatientNoteHistoryEntry.filter(
        { patient_id: input.patientId, agency_id: firstAuthority.agencyId },
        '-created_date',
        input.eventLimit,
        input.offset,
      ),
      'PatientNoteHistoryEntry.filter',
    );
    const entries = validateAndProjectEvents(rows, input.patientId, firstAuthority.agencyId);
    const finalAuthority = await loadAuthority(
      entities,
      input.patientId,
      userId,
      normalizedEmail,
    );
    if (!sameValue(finalAuthority.snapshot, firstAuthority.snapshot)) {
      throw new PublicError(409, 'Patient note authority changed during request');
    }
    return Response.json({
      success: true,
      patient_id: input.patientId,
      entries,
      latest_clinical_notes: entries.at(-1)?.note || '',
      page: {
        event_count: rows.length,
        offset: input.offset,
        next_offset: input.offset + rows.length,
        has_more: rows.length === input.eventLimit,
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('getAuthorizedPatientNoteHistory failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
