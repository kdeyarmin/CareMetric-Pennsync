import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_BODY_BYTES = 10_000;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;
const ACTIVE_AGENCY_STATUSES = new Set(['active', 'trial']);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const AGENCY_WIDE_DOCUMENT_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);

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
  if (!email || email.length > 320 || !email.includes('@') || /\s/.test(email)) return null;
  return email;
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

async function parseInput(req: Request) {
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
    throw new PublicError(413, 'Document request is too large');
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'document_id')) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const documentId = exactIdentifier(record.document_id);
  if (!documentId) throw new PublicError(400, 'document_id is invalid');
  return documentId;
}

function validateMembershipRows(
  rawRows: Array<Record<string, any>>,
  userId: string,
  normalizedEmail: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  const candidates = rawRows.filter((row) => row?.user_id === userId);
  const ids = new Set<string>();
  const keys = new Set<string>();
  const agencies = new Set<string>();
  const validated: Array<Record<string, any>> = [];

  for (const row of candidates) {
    const id = exactIdentifier(row.id);
    const agencyId = exactIdentifier(row.agency_id);
    const membershipKey = exactIdentifier(row.membership_key);
    const storedEmail = canonicalEmail(row.user_email_normalized);
    const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
    const status = typeof row.status === 'string' ? row.status : '';
    if (
      !id
      || !agencyId
      || !membershipKey
      || !storedEmail
      || row.user_email_normalized !== storedEmail
      || storedEmail !== normalizedEmail
      || membershipKey !== `${agencyId}:${userId}`
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
    if (ids.has(id) || keys.has(membershipKey) || agencies.has(agencyId)) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }
    ids.add(id);
    keys.add(membershipKey);
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
  normalizedEmail: string,
  requestedAgencyId: string | null,
) {
  const memberships = validateMembershipRows(
    requireRows(
      await entities.AgencyMembership.filter(
        { user_id: userId },
        '-updated_date',
        MEMBERSHIP_SCAN_LIMIT,
      ),
      'AgencyMembership.filter',
    ),
    userId,
    normalizedEmail,
  ).filter((row) => row.status === 'active');
  if (memberships.length === 0) throw new PublicError(403, 'No active tenant membership');
  if (!requestedAgencyId && memberships.length !== 1) {
    throw new PublicError(409, 'Document tenant is ambiguous');
  }
  const membership = requestedAgencyId
    ? memberships.find((row) => row.agency_id === requestedAgencyId)
    : memberships[0];
  if (!membership) throw new PublicError(403, 'No active membership for document agency');
  const agencyId = exactIdentifier(membership.agency_id);
  if (!agencyId) throw new PublicError(409, 'Tenant membership integrity check failed');
  const agency = await loadExactAgency(entities, agencyId);
  return { membership, agency, agencyId };
}

async function loadExactDocument(entities: Record<string, any>, documentId: string) {
  const rows = requireRows(
    await entities.Document.filter({ id: documentId }, undefined, EXACT_ROW_LIMIT),
    'Document.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Document is ambiguous');
  const exact = rows.filter((row) => row?.id === documentId);
  if (exact.length === 0) throw new PublicError(404, 'Document not found');
  if (exact.length !== 1) throw new PublicError(409, 'Document is ambiguous');
  const document = exact[0];
  if (document.patient_id !== undefined && document.patient_id !== null && document.patient_id !== '') {
    if (!exactIdentifier(document.patient_id)) {
      throw new PublicError(409, 'Document patient linkage is invalid');
    }
  }
  if (document.agency_id !== undefined && document.agency_id !== null && document.agency_id !== '') {
    if (!exactIdentifier(document.agency_id)) {
      throw new PublicError(409, 'Document tenant linkage is invalid');
    }
  }
  return document;
}

async function loadExactPatient(entities: Record<string, any>, patientId: string) {
  const rows = requireRows(
    await entities.Patient.filter({ id: patientId }, undefined, EXACT_ROW_LIMIT),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  const exact = rows.filter((row) => row?.id === patientId);
  if (exact.length === 0) throw new PublicError(403, 'Patient is unavailable');
  if (exact.length !== 1) throw new PublicError(409, 'Patient is ambiguous');
  const patient = exact[0];
  const agencyId = exactIdentifier(patient.agency_id);
  const creatorId = exactIdentifier(patient.created_by_user_id);
  const creatorEmail = canonicalEmail(patient.created_by_user_email_normalized);
  const platformCreator = canonicalEmail(patient.created_by);
  if (
    !agencyId
    || !creatorId
    || !creatorEmail
    || patient.created_by_user_email_normalized !== creatorEmail
    || platformCreator !== creatorEmail
    || patient.is_sample !== false
    || patient.is_archived !== false
  ) {
    throw new PublicError(409, 'Patient tenant provenance is unavailable');
  }
  const assignments = Array.isArray(patient.assigned_nurses)
    ? patient.assigned_nurses.map(canonicalEmail)
    : [];
  if (assignments.some((email) => !email)) {
    throw new PublicError(409, 'Patient assignment integrity check failed');
  }
  return { patient, agencyId, assignments: assignments as string[] };
}

async function loadDocumentAuthority(
  entities: Record<string, any>,
  user: Record<string, any>,
  documentId: string,
) {
  const userId = exactIdentifier(user.id);
  const normalizedEmail = canonicalEmail(user.email);
  if (!userId || !normalizedEmail) throw new PublicError(403, 'Forbidden');

  const document = await loadExactDocument(entities, documentId);
  // Document data fields remain directly mutable until the creation/update
  // migration is complete. Therefore patient_id and agency_id can corroborate
  // scope but cannot independently confer access: only Base44's immutable
  // built-in creator may submit this row for AI analysis in this interim batch.
  if (canonicalEmail(document.created_by) !== normalizedEmail) {
    throw new PublicError(403, 'Document is unavailable');
  }
  const patientId = exactIdentifier(document.patient_id);
  if (!patientId) {
    // Until Document creation is brokered and tenant-stamped, an unlinked row
    // can be analyzed only by its immutable Base44 creator and only when that
    // user has one unambiguous active tenant membership.
    const authority = await loadTenantAuthority(
      entities,
      userId,
      normalizedEmail,
      exactIdentifier(document.agency_id),
    );
    return { document, patient: null, ...authority };
  }

  const patientContext = await loadExactPatient(entities, patientId);
  const authority = await loadTenantAuthority(
    entities,
    userId,
    normalizedEmail,
    patientContext.agencyId,
  );
  if (document.agency_id !== undefined && document.agency_id !== null
    && document.agency_id !== authority.agencyId) {
    throw new PublicError(409, 'Document tenant linkage is inconsistent');
  }

  const tenantRole = String(authority.membership.tenant_role || '');
  const isPatientCreator = patientContext.patient.created_by_user_id === userId
    && patientContext.patient.created_by_user_email_normalized === normalizedEmail;
  const isAssigned = patientContext.assignments.includes(normalizedEmail);
  if (
    !AGENCY_WIDE_DOCUMENT_ROLES.has(tenantRole)
    && !isPatientCreator
    && !isAssigned
  ) {
    throw new PublicError(403, 'Document is unavailable');
  }
  return { document, patient: patientContext.patient, ...authority };
}

function authoritySignature(context: Record<string, any>) {
  return JSON.stringify({
    document: {
      id: context.document.id,
      patient_id: context.document.patient_id || null,
      agency_id: context.document.agency_id || null,
      created_by: context.document.created_by || null,
      file_url: context.document.file_url || null,
      updated_date: context.document.updated_date || null,
    },
    patient: context.patient ? {
      id: context.patient.id,
      agency_id: context.patient.agency_id,
      created_by_user_id: context.patient.created_by_user_id,
      created_by_user_email_normalized: context.patient.created_by_user_email_normalized,
      assigned_nurses: context.patient.assigned_nurses || [],
      updated_date: context.patient.updated_date || null,
    } : null,
    membership: {
      id: context.membership.id,
      agency_id: context.membership.agency_id,
      tenant_role: context.membership.tenant_role,
      status: context.membership.status,
      version: context.membership.version,
    },
    agency: { id: context.agency.id, status: context.agency.status },
  });
}

// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. The allowlist is hardcoded (always-on, fail-closed).
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
function isSafeFetchUrl(raw: unknown) {
  let u: URL;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return FILE_URL_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const documentId = await parseInput(req);
    const entities = base44.asServiceRole.entities;
    const initialContext = await loadDocumentAuthority(entities, user, documentId);
    if (!isSafeFetchUrl(initialContext.document.file_url)) {
      throw new PublicError(400, 'Document has an invalid or disallowed file URL');
    }

    const analysisPrompt = `Analyze this medical document and provide:

1. A concise summary (2-3 sentences)
2. Extracted key data points (lab values, diagnoses, medications, vital signs, dates)
3. A more specific category (choose from: lab_results, imaging_report, pathology, consent_form, insurance_card, prior_auth, referral_letter, progress_note, admission_note, discharge_summary, medication_list, prescription, physician_orders, wound_care, vital_signs, assessment, care_plan, other)
4. Critical findings that need immediate attention (severity: critical/high/medium/low)
5. Confidence score (0-100)

Document title: ${initialContext.document.title}
Current category: ${initialContext.document.category}

Return a JSON object with summary, extracted_data, suggested_category, critical_flags, and confidence_score.`;

    const aiResponse = await base44.integrations.Core.InvokeLLM({
      model: 'automatic',
      prompt: analysisPrompt,
      file_urls: [initialContext.document.file_url],
      response_json_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          extracted_data: { type: 'object' },
          suggested_category: { type: 'string' },
          critical_flags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string' },
                finding: { type: 'string' },
                details: { type: 'string' },
              },
            },
          },
          confidence_score: { type: 'number' },
        },
      },
    });

    // Re-prove the full immutable authority and record linkage after the slow
    // AI call. This is still not a database CAS; a datastore conditional-write
    // primitive remains required to close the final sub-millisecond race.
    const finalContext = await loadDocumentAuthority(entities, user, documentId);
    if (authoritySignature(finalContext) !== authoritySignature(initialContext)) {
      throw new PublicError(409, 'Document authority changed during analysis');
    }

    await entities.Document.update(documentId, {
      ai_analysis: {
        analyzed: true,
        summary: aiResponse.summary,
        extracted_data: aiResponse.extracted_data,
        suggested_category: aiResponse.suggested_category,
        critical_flags: aiResponse.critical_flags || [],
        confidence_score: aiResponse.confidence_score,
        analyzed_date: new Date().toISOString(),
      },
    });

    return Response.json({ success: true, analysis: aiResponse });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Document analysis error:', error?.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
