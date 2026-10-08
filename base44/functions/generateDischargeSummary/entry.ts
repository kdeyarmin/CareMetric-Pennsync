import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>

// <<<BEGIN SHARED HELPER: patientCareTeamAccess — generated, edit base44/_shared/backendHelpers.mjs>>>
async function callerMayAccessPatient(base44, user, patient) {
  if (!user || !patient || typeof patient !== 'object') return false;
  if (user.role === 'admin') return true;
  const claims = await withTrustedClaims(base44, user);
  const agencyId = claims && claimIdentifier(claims.agency_id) ? claims.agency_id : null;
  if (!agencyId || patient.agency_id !== agencyId || !claimIdentifier(patient.id)) return false;
  if (claims.account_type === 'agency_admin' || claims.is_manager === true) return true;
  if (claimIdentifier(patient.created_by_user_id) && patient.created_by_user_id === user.id) return true;
  try {
    const rows = await base44.asServiceRole.entities.PatientCareTeamAssignment.filter(
      { agency_id: agencyId, patient_id: patient.id, user_id: user.id, status: 'active' },
      undefined,
      2,
    );
    return Array.isArray(rows) && rows.some((row) => row && row.agency_id === agencyId
      && row.patient_id === patient.id && row.user_id === user.id && row.status === 'active');
  } catch {
    return false;
  }
}
// <<<END SHARED HELPER: patientCareTeamAccess>>>

/**
 * generateDischargeSummary — AI-drafted discharge summary for one chart
 * (owner decision, 2026-10-08).
 *
 * The chart, its completed visits and the education sent are read with
 * service-role authority only after callerMayAccessPatient admits the caller
 * (the built-in administrator, or an agency member in the chart's agency who
 * is a manager/agency_admin there, the chart's creator, or on its care team).
 * The draft is saved through the caller's own client with generated_by set to
 * the caller, so DischargeSummary's own rule decides who reviews it. Clinical
 * conclusions (disposition, functional status at discharge, understanding)
 * are left for the reviewing clinician — the model never asserts them.
 *
 * Body: { patient_id, discharge_date? }
 */

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const VISIT_LIMIT = 500;

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { ...NO_STORE_HEADERS, ...headers },
});

function exactId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value.trim() === value && !value.startsWith('$') ? value : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true) return json({ error: 'Forbidden' }, 403);

    const body = await req.json().catch(() => null);
    const patientId = exactId(body?.patient_id);
    if (!patientId) return json({ error: 'patient_id is required' }, 400);
    const dischargeDate = body?.discharge_date == null
      ? new Date().toISOString().split('T')[0]
      : validDate(body.discharge_date);
    if (!dischargeDate) return json({ error: 'discharge_date must be YYYY-MM-DD' }, 400);

    const entities = base44.asServiceRole.entities;
    const patients = await entities.Patient.filter({ id: patientId }, undefined, 2);
    const patient = Array.isArray(patients) && patients.length === 1 && patients[0]?.id === patientId
      ? patients[0]
      : null;
    if (!patient || !(await callerMayAccessPatient(base44, user, patient))) {
      return json({ error: 'Patient not found or access denied' }, 403);
    }

    const visits = (await entities.Visit.filter(
      { patient_id: patientId, status: 'completed' },
      '-visit_date',
      VISIT_LIMIT,
    ) || []).filter((visit) => visit?.patient_id === patientId);
    const educationMaterials = (await entities.SentEducationMaterial.filter(
      { patient_id: patientId },
      undefined,
      VISIT_LIMIT,
    ).catch(() => []) || []).filter((row) => row?.patient_id === patientId);

    const admissionDate = visits.length > 0
      ? visits[visits.length - 1].visit_date
      : patient.admission_date || patient.created_date;

    // Visit.visit_type has no therapy type, so routine/prn/discharge are
    // counted separately and the signed summary stays truthful.
    const skilledNursingVisits = visits.filter((v) => ['skilled_nursing', 'admission', 'recertification'].includes(v.visit_type));
    const routineVisits = visits.filter((v) => ['routine_visit', 'prn', 'discharge'].includes(v.visit_type));

    const aiPrompt = `You are a home health discharge summary specialist. Generate a comprehensive, Medicare-compliant discharge summary based on the following patient data.

PATIENT INFORMATION:
Name: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${Array.isArray(patient.secondary_diagnoses) ? patient.secondary_diagnoses.join(', ') : 'None'}
Admission Date: ${admissionDate}
Discharge Date: ${dischargeDate}

VISIT SUMMARY:
Total Visits: ${visits.length}
Skilled Nursing / Admission / Recert Visits: ${skilledNursingVisits.length}
Routine / PRN / Discharge Visits: ${routineVisits.length}

RECENT VISIT NOTES (Last 5):
${visits.slice(0, 5).map((v) => `
Date: ${v.visit_date}
Type: ${v.visit_type}
Notes: ${typeof v.nurse_notes === 'string' ? v.nurse_notes.substring(0, 500) : 'No notes'}
`).join('\n')}

PATIENT EDUCATION PROVIDED:
${educationMaterials.map((e) => e.material_title).filter(Boolean).join(', ') || 'None recorded'}

Generate a comprehensive discharge summary with the following sections:
1. REASON FOR ADMISSION - Brief summary of why home health was initiated
2. SUMMARY OF CARE - Comprehensive narrative of care provided during episode
3. FUNCTIONAL STATUS - Patient's status at admission vs discharge
4. DISCHARGE INSTRUCTIONS - Clear patient instructions
5. FOLLOW-UP RECOMMENDATIONS - What patient should do after discharge

Format as a professional medical summary. Be detailed, objective, and Medicare-compliant.`;

    const aiResponseRaw = await base44.integrations.Core.InvokeLLM({ prompt: aiPrompt, model: 'automatic' });
    const aiResponse = typeof aiResponseRaw === 'string'
      ? aiResponseRaw
      : typeof aiResponseRaw?.text === 'string' ? aiResponseRaw.text : '';
    if (!aiResponse.trim()) {
      return json({ error: 'The model returned no discharge narrative. Try again.' }, 502);
    }

    const visitHighlights = visits.slice(0, 5).map((v) => {
      if (v.vital_signs && typeof v.vital_signs === 'object') {
        const vitals = Object.entries(v.vital_signs)
          .filter(([, value]) => value != null)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        return `${v.visit_date}: ${vitals}`;
      }
      return `${v.visit_date}: ${v.visit_type}`;
    });

    // Saved through the caller's client; DischargeSummary admits the row whose
    // generated_by is the caller (or an administrator).
    const dischargeSummary = await base44.entities.DischargeSummary.create({
      patient_id: patientId,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      admission_date: admissionDate,
      discharge_date: dischargeDate,
      primary_diagnosis: patient.primary_diagnosis,
      secondary_diagnoses: Array.isArray(patient.secondary_diagnoses) ? patient.secondary_diagnoses : [],
      reason_for_admission: aiResponse.split('REASON FOR ADMISSION')[1]?.split('\n\n')[0]?.trim()
        || `Patient admitted to home health for management of ${patient.primary_diagnosis || 'their condition'}`,
      summary_of_care: aiResponse,
      visit_summary: {
        total_visits: visits.length,
        skilled_nursing_visits: skilledNursingVisits.length,
        // Kept for schema compatibility; Visit has no therapy type.
        therapy_visits: routineVisits.length,
        routine_visits: routineVisits.length,
        visit_highlights: visitHighlights,
      },
      // Never fabricate affirmative clinical conclusions on a document that is
      // reviewed and signed: the reviewing clinician completes these.
      functional_status: {
        at_admission: 'See admission assessment',
        at_discharge: '',
        improvement_areas: [],
      },
      patient_education_provided: educationMaterials.map((e) => ({
        topic: e.material_title,
        materials_provided: 'Written materials',
        patient_understanding: '',
      })),
      discharge_instructions: 'Continue current medications. Follow up with physician as recommended. Contact home health if symptoms worsen.',
      follow_up_recommendations: [
        {
          recommendation: 'Follow up with primary care physician',
          provider: patient.physician_name || 'PCP',
          timeframe: 'Within 1-2 weeks',
        },
      ],
      status: 'pending_review',
      generated_by: user.email,
      generated_date: new Date().toISOString(),
      ai_generation_metadata: { visits_analyzed: visits.length },
    });

    return json({ success: true, discharge_summary: dischargeSummary });
  } catch (error) {
    console.error('Error generating discharge summary:', error?.message || error);
    return json({ error: 'Failed to generate discharge summary' }, 500);
  }
});
