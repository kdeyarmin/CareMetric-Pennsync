import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_BODY_BYTES = 100_000;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;
const ACTIVE_AGENCY_STATUSES = new Set(['active', 'trial']);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const VISIBLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const TENANT_ROLES = new Set([
  'agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care',
]);
const AGENCY_WIDE_FAX_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const ASSIGNMENT_AUTHORITY_FIELDS = [
  'id',
  'assignment_key',
  'agency_id',
  'patient_id',
  'user_id',
  'user_email_normalized',
  'assignee_membership_id',
  'assignee_membership_version_at_enablement',
  'status',
  'source',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'activated_at',
  'suspended_at',
  'revoked_at',
  'revocation_reason',
  'last_transition_by_user_id',
  'last_transition_by_email_normalized',
  'last_transition_at',
  'last_transition_reason',
  'last_transition_action',
  'last_transition_request_id',
  'last_transition_request_key',
  'version',
];
const FAX_COVER_FIELDS = new Set([
  'patient_id',
  'recipient_number',
  'recipient_name',
  'recipient_organization',
  'sender_name',
  'sender_number',
  'subject',
  'notes',
  'urgency',
  'page_count',
]);
const FAX_COVER_TEXT_LIMITS: Record<string, number> = {
  recipient_number: 64,
  recipient_name: 200,
  recipient_organization: 300,
  sender_name: 200,
  sender_number: 64,
  subject: 300,
  notes: 5_000,
};
const FAX_COVER_URGENCIES = new Set(['routine', 'urgent', 'stat']);
const MAX_FAX_ATTACHMENT_PAGES = 10_000;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) headers.set(name, value);
  return Response.json(body, { ...init, headers });
}

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const email = normalizeEmail(value);
  return email && email.length <= 320 && email.includes('@') && !/\s/.test(email)
    ? email
    : null;
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
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

async function parseBody(req: Request) {
  const statedLength = req.headers.get('content-length');
  if (
    statedLength != null
    && (!/^\d+$/.test(statedLength) || Number(statedLength) > MAX_BODY_BYTES)
  ) {
    throw new PublicError(413, 'Fax cover request is too large');
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Fax cover request is too large');
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
  if (Object.keys(record).some((field) => !FAX_COVER_FIELDS.has(field))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  for (const field of ['patient_id']) {
    const value = record[field];
    if (value !== undefined && value !== null && value !== '' && !exactIdentifier(value)) {
      throw new PublicError(400, `${field} is invalid`);
    }
  }
  for (const [field, maximum] of Object.entries(FAX_COVER_TEXT_LIMITS)) {
    const value = record[field];
    if (value == null || value === '') continue;
    if (typeof value !== 'string' || value.length > maximum) {
      throw new PublicError(400, `${field} is invalid`);
    }
  }
  if (
    record.urgency != null
    && (typeof record.urgency !== 'string'
      || !FAX_COVER_URGENCIES.has(record.urgency.trim().toLowerCase()))
  ) {
    throw new PublicError(400, 'urgency is invalid');
  }
  if (
    record.page_count != null
    && (!Number.isSafeInteger(record.page_count)
      || Number(record.page_count) < 0
      || Number(record.page_count) > MAX_FAX_ATTACHMENT_PAGES)
  ) {
    throw new PublicError(400, 'page_count is invalid');
  }
  return record;
}

function validateMembershipRows(
  rows: Array<Record<string, any>>,
  userId: string,
  email: string,
) {
  if (rows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  if (rows.some((row) => row?.user_id !== userId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified');
  }
  const validated: Array<Record<string, any>> = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  const agencies = new Set<string>();
  for (const row of rows.filter((candidate) => candidate?.user_id === userId)) {
    const id = exactIdentifier(row.id);
    const agencyId = exactIdentifier(row.agency_id);
    const key = exactIdentifier(row.membership_key);
    const storedEmail = canonicalEmail(row.user_email_normalized);
    const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
    const status = typeof row.status === 'string' ? row.status : '';
    if (
      !id || !agencyId || !key || key !== `${agencyId}:${userId}`
      || !storedEmail || row.user_email_normalized !== storedEmail || storedEmail !== email
      || !TENANT_ROLES.has(String(row.tenant_role || '')) || !MEMBERSHIP_STATUSES.has(status)
      || !Number.isSafeInteger(row.version) || row.version < 1
      || !exactIdentifier(row.created_by_user_id)
      || !exactIdentifier(row.last_transition_by_user_id)
      || !transitionEmail || row.last_transition_by_email_normalized !== transitionEmail
      || !validInstant(row.last_transition_at) || !boundedReason(row.last_transition_reason)
      || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
      || (status === 'revoked' && (
        !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
      ))
      || (status !== 'revoked' && (
        row.revoked_at != null || row.revocation_reason != null
      ))
    ) {
      throw new PublicError(409, 'Tenant membership integrity check failed');
    }
    if (ids.has(id) || keys.has(key) || agencies.has(agencyId)) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }
    ids.add(id);
    keys.add(key);
    agencies.add(agencyId);
    validated.push(row);
  }
  return validated;
}

async function loadExactAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  const exact = rows.filter((row) => row?.id === agencyId);
  if (exact.length === 0) throw new PublicError(403, 'Agency is unavailable');
  if (exact.length !== 1) throw new PublicError(409, 'Agency is ambiguous');
  if (!ACTIVE_AGENCY_STATUSES.has(String(exact[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return exact[0];
}

async function loadTenantAuthority(
  entities: Record<string, any>,
  userId: string,
  email: string,
  requestedAgencyId: string | null,
) {
  const active = validateMembershipRows(
    requireRows(
      await entities.AgencyMembership.filter(
        { user_id: userId },
        '-updated_date',
        MEMBERSHIP_SCAN_LIMIT,
      ),
      'AgencyMembership.filter',
    ),
    userId,
    email,
  ).filter((row) => row.status === 'active');
  if (active.length === 0) throw new PublicError(403, 'No active tenant membership');
  if (!requestedAgencyId && active.length !== 1) {
    throw new PublicError(409, 'Fax tenant is ambiguous');
  }
  const membership = requestedAgencyId
    ? active.find((row) => row.agency_id === requestedAgencyId)
    : active[0];
  if (!membership) throw new PublicError(403, 'No active membership for fax agency');
  const agencyId = exactIdentifier(membership.agency_id);
  if (!agencyId) throw new PublicError(409, 'Tenant membership integrity check failed');
  const agency = await loadExactAgency(entities, agencyId);
  return { membership, agency, agencyId };
}

async function exactRow(
  entity: Record<string, any>,
  id: string,
  label: string,
  missingStatus: number,
) {
  const rows = requireRows(
    await entity.filter({ id }, undefined, EXACT_ROW_LIMIT),
    `${label}.filter`,
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, `${label} is ambiguous`);
  const exact = rows.filter((row) => row?.id === id);
  if (exact.length === 0) throw new PublicError(missingStatus, `${label} not found`);
  if (exact.length !== 1) throw new PublicError(409, `${label} is ambiguous`);
  return exact[0];
}

function validatePatientProvenance(patient: Record<string, any>) {
  const agencyId = exactIdentifier(patient.agency_id);
  const creatorId = exactIdentifier(patient.created_by_user_id);
  const creatorEmail = canonicalEmail(patient.created_by_user_email_normalized);
  const clientRequestId = exactIdentifier(patient.client_request_id);
  if (
    !agencyId || !creatorId || !creatorEmail || !clientRequestId
    || patient.created_by_user_email_normalized !== creatorEmail
    || canonicalEmail(patient.created_by) !== creatorEmail
    || patient.created_by !== creatorEmail
    || patient.patient_creation_key !== `${agencyId}:${creatorId}:${clientRequestId}`
    || patient.is_sample !== false || patient.is_archived !== false
    || !VISIBLE_PATIENT_STATUSES.has(String(patient.status || ''))
    || !validInstant(patient.updated_date)
  ) {
    throw new PublicError(409, 'Patient tenant provenance is unavailable');
  }
  return { agencyId, creatorId, creatorEmail };
}

function assignmentKey(agencyId: string, patientId: string, userId: string) {
  return `${agencyId}:${patientId}:${userId}`;
}

function transitionRequestKey(key: string, requestId: string) {
  return `${key}:${requestId}`;
}

function orderedInstants(earlier: unknown, later: unknown) {
  return validInstant(earlier)
    && validInstant(later)
    && Date.parse(String(earlier)) <= Date.parse(String(later));
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
      && orderedInstants(row.suspended_at, row.activated_at)
      && row.activated_at === row.last_transition_at;
  }
  if (action === 'suspend') {
    return status === 'suspended'
      && row.version >= 2
      && row.version % 2 === 0
      && orderedInstants(row.activated_at, row.suspended_at)
      && row.suspended_at === row.last_transition_at;
  }
  if (action === 'revoke') {
    return status === 'revoked'
      && row.version >= 2
      && orderedInstants(row.activated_at, row.revoked_at)
      && (row.suspended_at == null || orderedInstants(row.suspended_at, row.revoked_at))
      && row.revoked_at === row.last_transition_at
      && row.revocation_reason === row.last_transition_reason;
  }
  return false;
}

function validateAssignmentIntegrity(
  row: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const id = exactIdentifier(row?.id);
  const key = assignmentKey(authority.agencyId, patientId, authority.userId);
  const userEmail = canonicalEmail(row?.user_email_normalized);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const requestId = exactIdentifier(row?.last_transition_request_id);
  const status = typeof row?.status === 'string' ? row.status : '';
  const action = typeof row?.last_transition_action === 'string'
    ? row.last_transition_action
    : '';
  if (
    !id
    || row.assignment_key !== key
    || row.agency_id !== authority.agencyId
    || row.patient_id !== patientId
    || row.user_id !== authority.userId
    || !userEmail
    || row.user_email_normalized !== userEmail
    || userEmail !== authority.email
    || row.assignee_membership_id !== authority.membership.id
    || row.assignee_membership_version_at_enablement !== authority.membership.version
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || row.assignee_membership_version_at_enablement < 1
    || !ASSIGNMENT_STATUSES.has(status)
    || !ASSIGNMENT_SOURCES.has(String(row.source || ''))
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || !validInstant(row.activated_at)
    || (row.suspended_at != null && !validInstant(row.suspended_at))
    || (status === 'suspended' && !validInstant(row.suspended_at))
    || (row.revoked_at != null && !validInstant(row.revoked_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
    || (status !== 'revoked' && (
      row.revoked_at != null || row.revocation_reason != null
    ))
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
  ) {
    throw new PublicError(409, 'Care-team assignment integrity check failed');
  }
  return row;
}

async function loadExactAssignment(
  entities: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const key = assignmentKey(authority.agencyId, patientId, authority.userId);
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      {
        assignment_key: key,
        agency_id: authority.agencyId,
        patient_id: patientId,
        user_id: authority.userId,
      },
      '-updated_date',
      EXACT_ROW_LIMIT,
      undefined,
      ASSIGNMENT_AUTHORITY_FIELDS,
    ),
    'PatientCareTeamAssignment.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Care-team assignment is ambiguous');
  }
  if (rows.some((row) => (
    row?.assignment_key !== key
    || row?.agency_id !== authority.agencyId
    || row?.patient_id !== patientId
    || row?.user_id !== authority.userId
  ))) {
    throw new PublicError(409, 'Care-team assignment query scope could not be verified');
  }
  if (rows.length > 1) throw new PublicError(409, 'Care-team assignment is ambiguous');
  return rows.length === 1
    ? validateAssignmentIntegrity(rows[0], patientId, authority)
    : null;
}

async function assertPatientAccess(base44, user, patient) {
  if (!patient) throw new PublicError(403, 'Patient is unavailable');
  const userId = exactIdentifier(user.id);
  const email = canonicalEmail(user.email);
  if (!userId || !email) throw new PublicError(403, 'Forbidden');
  const provenance = validatePatientProvenance(patient);
  const authority = await loadTenantAuthority(
    base44.asServiceRole.entities,
    userId,
    email,
    provenance.agencyId,
  );
  const role = String(authority.membership.tenant_role || '');
  const isCreator = provenance.creatorId === userId && provenance.creatorEmail === email;
  if (!AGENCY_WIDE_FAX_ROLES.has(role) && !isCreator) {
    const assignmentAuthority = {
      ...authority,
      userId,
      email,
    };
    const assignment = await loadExactAssignment(
      base44.asServiceRole.entities,
      patient.id,
      assignmentAuthority,
    );
    if (!assignment || assignment.status !== 'active') {
      throw new PublicError(403, 'Patient is unavailable');
    }
  }
  return authority;
}

async function loadFaxContext(
  base44: Record<string, any>,
  user: Record<string, any>,
  requestedPatientId: string | null,
) {
  const entities = base44.asServiceRole.entities;
  const userId = exactIdentifier(user.id);
  const email = canonicalEmail(user.email);
  if (!userId || !email) throw new PublicError(403, 'Forbidden');

  // Document metadata is deliberately absent from this helper. Callers select
  // private files through list/getAuthorizedDocuments and the cover generator
  // accepts no document id, so a legacy Document row can never enter its output.
  const patient = requestedPatientId
    ? await exactRow(entities.Patient, requestedPatientId, 'Patient', 403)
    : null;
  if (patient) {
    const authority = await assertPatientAccess(base44, user, patient);
    return { patient, ...authority };
  }

  const authority = await loadTenantAuthority(entities, userId, email, null);
  return { patient: null, ...authority };
}

// Reviewed, deterministic cover-sheet copy. Keeping this local avoids sending
// patient identifiers to an external model for what is purely formatting work.
const FAX_CONFIDENTIALITY_NOTICE =
  'CONFIDENTIALITY NOTICE: This fax transmission contains confidential health information protected by HIPAA. If you have received this fax in error, please notify the sender immediately and destroy all copies.';

function coverText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function buildFaxCoverPage({
  user,
  patient,
  recipientNumber,
  recipientName,
  recipientOrganization,
  senderName,
  senderNumber,
  subject,
  notes,
  urgency,
  pageCount,
  now,
}: Record<string, any>) {
  const normalizedUrgency = ['routine', 'urgent', 'stat'].includes(
    String(urgency || '').toLowerCase(),
  ) ? String(urgency).toLowerCase() : 'routine';
  const attachmentPages = Number(pageCount);
  const safeAttachmentPages = Number.isSafeInteger(attachmentPages) && attachmentPages >= 0
    ? attachmentPages
    : 0;
  const patientName = patient
    ? `${coverText(patient.first_name)} ${coverText(patient.last_name)}`.trim() || 'N/A'
    : 'N/A';

  return {
    from_name: coverText(senderName, coverText(user?.full_name, coverText(user?.email))),
    from_fax: coverText(senderNumber, 'See letterhead'),
    to_name: coverText(recipientName, 'To Whom It May Concern'),
    to_organization: coverText(recipientOrganization),
    to_fax: coverText(recipientNumber),
    date: now.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
    time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    subject: coverText(
      subject,
      patient ? `RE: Patient ${patientName}` : 'Medical Communication',
    ),
    urgency: normalizedUrgency,
    total_pages: safeAttachmentPages + 1,
    patient_name: patientName,
    patient_dob: coverText(patient?.date_of_birth, 'N/A'),
    patient_mrn: coverText(patient?.medical_record_number, 'N/A'),
    patient_diagnosis: coverText(patient?.primary_diagnosis, 'N/A'),
    document_title: 'See attached',
    notes: coverText(notes),
    confidentiality_notice: FAX_CONFIDENTIALITY_NOTICE,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed' },
      { status: 405, headers: { Allow: 'POST' } },
    );
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) {
      const response = DEACTIVATED_USER_RESPONSE();
      for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
        response.headers.set(name, value);
      }
      return response;
    }
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseBody(req);
    const {
      patient_id,
      recipient_number,
      recipient_name,
      recipient_organization,
      sender_name,
      sender_number,
      subject,
      notes,
      urgency = 'routine',
      page_count = 1
    } = body;

    const context = await loadFaxContext(
      base44,
      user,
      exactIdentifier(patient_id),
    );
    const { patient } = context;

    // AgencySettings does not yet carry an immutable agency_id, so this broker
    // must not select a row by mutable User claims or a non-unique agency name.
    // Until that schema is tenant-stamped, callers may supply an explicit
    // office reply number or let the generated cover sheet say "See letterhead".
    const now = new Date();
    const coverData = buildFaxCoverPage({
      user,
      patient,
      recipientNumber: recipient_number,
      recipientName: recipient_name,
      recipientOrganization: recipient_organization,
      senderName: sender_name,
      senderNumber: sender_number,
      subject,
      notes,
      urgency,
      pageCount: page_count,
      now,
    });

    return jsonResponse({ success: true, cover_page_data: coverData });

  } catch (error) {
    if (error instanceof PublicError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    // Error objects may retain query predicates or patient data.
    console.error('generateFaxCoverPage failed');
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }
});
