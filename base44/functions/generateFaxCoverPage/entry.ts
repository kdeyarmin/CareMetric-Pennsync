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
const TENANT_ROLES = new Set([
  'agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care',
]);
const AGENCY_WIDE_FAX_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);
const FAX_COVER_FIELDS = new Set([
  'patient_id',
  'document_id',
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
    throw new PublicError(413, 'Fax cover request is too large');
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((field) => !FAX_COVER_FIELDS.has(field))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  for (const field of ['patient_id', 'document_id']) {
    const value = record[field];
    if (value !== undefined && value !== null && value !== '' && !exactIdentifier(value)) {
      throw new PublicError(400, `${field} is invalid`);
    }
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
  if (
    !agencyId || !creatorId || !creatorEmail
    || patient.created_by_user_email_normalized !== creatorEmail
    || canonicalEmail(patient.created_by) !== creatorEmail
    || patient.is_sample !== false || patient.is_archived !== false
  ) {
    throw new PublicError(409, 'Patient tenant provenance is unavailable');
  }
  const assignments = Array.isArray(patient.assigned_nurses)
    ? patient.assigned_nurses.map(canonicalEmail)
    : [];
  if (assignments.some((value) => !value)) {
    throw new PublicError(409, 'Patient assignment integrity check failed');
  }
  return { agencyId, creatorId, creatorEmail, assignments: assignments as string[] };
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
  const isAssigned = provenance.assignments.includes(email);
  if (!AGENCY_WIDE_FAX_ROLES.has(role) && !isCreator && !isAssigned) {
    throw new PublicError(403, 'Patient is unavailable');
  }
  return authority;
}

async function loadFaxContext(
  base44: Record<string, any>,
  user: Record<string, any>,
  requestedPatientId: string | null,
  requestedDocumentId: string | null,
) {
  const entities = base44.asServiceRole.entities;
  const userId = exactIdentifier(user.id);
  const email = canonicalEmail(user.email);
  if (!userId || !email) throw new PublicError(403, 'Forbidden');

  const document = requestedDocumentId
    ? await exactRow(entities.Document, requestedDocumentId, 'Document', 404)
    : null;
  // Legacy Document relation fields are still browser-mutable. The immutable
  // built-in creator must match before document metadata can enter an external
  // AI prompt; patient/agency links only corroborate that owner boundary.
  if (document && canonicalEmail(document.created_by) !== email) {
    throw new PublicError(403, 'Document is unavailable');
  }
  const storedAgencyId = document?.agency_id === undefined
    || document?.agency_id === null
    || document?.agency_id === ''
    ? null
    : exactIdentifier(document.agency_id);
  if (document && document.agency_id !== undefined && document.agency_id !== null
    && document.agency_id !== '' && !storedAgencyId) {
    throw new PublicError(409, 'Document tenant linkage is invalid');
  }
  const storedPatientId = document?.patient_id === undefined
    || document?.patient_id === null
    || document?.patient_id === ''
    ? null
    : exactIdentifier(document.patient_id);
  const hasStoredPatientId = !!document
    && document.patient_id !== undefined
    && document.patient_id !== null
    && document.patient_id !== '';
  if (hasStoredPatientId && !storedPatientId) {
    throw new PublicError(409, 'Document patient linkage is invalid');
  }
  if (requestedPatientId && document && storedPatientId !== requestedPatientId) {
    throw new PublicError(409, 'Document is not linked to the requested patient');
  }

  const patientId = requestedPatientId || storedPatientId;
  const patient = patientId
    ? await exactRow(entities.Patient, patientId, 'Patient', 403)
    : null;
  if (patient) {
    const authority = await assertPatientAccess(base44, user, patient);
    if (document?.agency_id !== undefined && document?.agency_id !== null
      && document.agency_id !== authority.agencyId) {
      throw new PublicError(409, 'Document tenant linkage is inconsistent');
    }
    return { patient, document, ...authority };
  }

  const authority = await loadTenantAuthority(entities, userId, email, storedAgencyId);
  return { patient: null, document, ...authority };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseBody(req);
    const {
      patient_id,
      document_id,
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
      exactIdentifier(document_id),
    );
    const { patient, document } = context;

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return Response.json({ error: 'Anthropic API key not configured' }, { status: 500 });

    // AgencySettings does not yet carry an immutable agency_id, so this broker
    // must not select a row by mutable User claims or a non-unique agency name.
    // Until that schema is tenant-stamped, callers may supply an explicit
    // office reply number or let the generated cover sheet say "See letterhead".
    const senderFax = (sender_number || '').toString().trim();

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const prompt = `You are a medical administrative assistant. Generate a HIPAA-compliant professional fax cover sheet as a clean JSON object.

Sender: ${sender_name || user.full_name}
Sender Fax: ${senderFax || 'See letterhead'}
Recipient Name: ${recipient_name || 'To Whom It May Concern'}
Recipient Organization: ${recipient_organization || ''}
Recipient Fax: ${recipient_number || ''}
Date: ${dateStr} at ${timeStr}
Subject: ${subject || (patient ? `RE: Patient ${patient.first_name} ${patient.last_name}` : 'Medical Communication')}
Urgency: ${urgency}
Total Pages (including cover): ${(Number(page_count) || 0) + 1}
Additional Notes: ${notes || ''}

Patient Info (if provided):
  Name: ${patient ? `${patient.first_name} ${patient.last_name}` : 'N/A'}
  DOB: ${patient?.date_of_birth || 'N/A'}
  MRN: ${patient?.medical_record_number || 'N/A'}
  Primary Diagnosis: ${patient?.primary_diagnosis || 'N/A'}

Document: ${document?.title || 'See attached'}
Document Category: ${document?.category || ''}

Generate a professional cover sheet with a HIPAA confidentiality disclaimer. Return only JSON.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        // Real Anthropic model id. 'automatic' is a Base44 InvokeLLM
        // convention that 404s on the direct Messages API, so this call always
        // failed and the cover-sheet fields silently came back empty.
        // claude-opus-4-8 runs without thinking when the field is omitted, so
        // the whole max_tokens budget goes to the JSON answer.
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt + `\n\nReturn JSON with exactly these fields:
{
  "from_name": string,
  "from_fax": string,
  "to_name": string,
  "to_organization": string,
  "to_fax": string,
  "date": string,
  "time": string,
  "subject": string,
  "urgency": "routine" | "urgent" | "stat",
  "total_pages": number,
  "patient_name": string,
  "patient_dob": string,
  "patient_mrn": string,
  "patient_diagnosis": string,
  "document_title": string,
  "notes": string,
  "confidentiality_notice": string
}`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return Response.json({ error: 'AI generation failed' }, { status: 500 });
    }

    const claudeData = await response.json();
    const content = claudeData.content[0]?.text || '{}';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let coverData = {};
    if (jsonMatch) {
      try {
        coverData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('Failed to parse cover page JSON from AI response:', e);
      }
    }

    return Response.json({ success: true, cover_page_data: coverData });

  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Cover page generation error:', error?.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
