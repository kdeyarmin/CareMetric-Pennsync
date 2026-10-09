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
 * generatePatientEducation — personalized patient education for one chart
 * (owner decision, 2026-10-08).
 *
 * The chart is read with service-role authority only to decide access, and
 * its content is used only after callerMayAccessPatient admits the caller:
 * the built-in administrator, or an agency member in the chart's agency who is
 * a manager/agency_admin there, the chart's creator, or on its care team. A
 * visit, when named, must belong to that chart. Generated materials are saved
 * through the caller's own client, so PatientEducationDelivery's
 * creator-or-administrator rule decides who can read them back.
 *
 * Body: { patientId, visitId? }
 */

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const MAX_TOPICS = 4;
const MAX_TEXT = 12000;

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { ...NO_STORE_HEADERS, ...headers },
});

function exactId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value.trim() === value && !value.startsWith('$') ? value : null;
}

async function loadExact(entity, id) {
  const rows = await entity.filter({ id }, undefined, 2);
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== id) return null;
  return rows[0];
}

function topicsFrom(result) {
  const topics = Array.isArray(result?.topics) ? result.topics : [];
  return topics
    .filter((topic) => topic && typeof topic === 'object' && typeof topic.title === 'string' && topic.title.trim())
    .slice(0, MAX_TOPICS)
    .map((topic) => ({
      title: topic.title.trim().slice(0, 200),
      reason: typeof topic.reason === 'string' ? topic.reason.slice(0, 1000) : '',
      key_points: Array.isArray(topic.key_points)
        ? topic.key_points.filter((point) => typeof point === 'string').slice(0, 10)
        : [],
    }));
}

export default async function(req) {
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
    const patientId = exactId(body?.patientId);
    const visitId = body?.visitId == null ? null : exactId(body.visitId);
    if (!patientId) return json({ error: 'patientId is required' }, 400);
    if (body?.visitId != null && !visitId) return json({ error: 'visitId is invalid' }, 400);

    const entities = base44.asServiceRole.entities;
    const patient = await loadExact(entities.Patient, patientId);
    if (!patient || !(await callerMayAccessPatient(base44, user, patient))) {
      // One answer for "absent" and "not yours", so a probe learns nothing.
      return json({ error: 'Patient not found or access denied' }, 403);
    }

    let visit = null;
    if (visitId) {
      visit = await loadExact(entities.Visit, visitId);
      if (!visit || visit.patient_id !== patientId) {
        return json({ error: 'visitId does not belong to this patient' }, 400);
      }
    }

    const educationPrompt = `You are a healthcare education specialist. Based on the patient's medical information, generate 3-4 personalized educational topics that would benefit this patient.

Patient Information:
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${Array.isArray(patient.secondary_diagnoses) ? patient.secondary_diagnoses.join(', ') : 'None'}
- Current Medications: ${Array.isArray(patient.current_medications) ? patient.current_medications.map((m) => m?.name).filter(Boolean).join(', ') : 'None'}
- Allergies: ${patient.allergies || 'NKDA'}
- Functional Status: ${patient.functional_status?.adl_independence || 'Not documented'}
${typeof visit?.nurse_notes === 'string' && visit.nurse_notes ? `\nLatest Visit Notes: ${visit.nurse_notes.substring(0, 500)}` : ''}

Return JSON: { "topics": [{ "title": "string", "reason": "brief explanation why this education is needed", "key_points": ["point1", "point2", "point3"] }] }`;

    const topicsResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'automatic',
      prompt: educationPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          topics: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                reason: { type: 'string' },
                key_points: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    });
    const topics = topicsFrom(topicsResult);
    if (topics.length === 0) {
      return json({ error: 'The model returned no usable education topics. Try again.' }, 502);
    }

    const materials = [];
    for (const topic of topics) {
      const contentResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: 'automatic',
        prompt: `Create patient-friendly educational material on "${topic.title}" for a patient with ${patient.primary_diagnosis || 'a chronic health condition'}.

Key Points to Cover:
${topic.key_points.map((point) => `- ${point}`).join('\n')}

Instructions:
1. Use simple, clear language (8th grade reading level)
2. Include practical, actionable steps
3. Format with headings and bullet points
4. Include warning signs to watch for
5. Suggest when to call the doctor
6. Keep to 300-400 words

Do NOT use medical jargon. Make it conversational and supportive.`,
      });
      if (typeof contentResult !== 'string' || !contentResult.trim()) continue;
      // Saved through the caller's client: the row's creator is the caller.
      const saved = await base44.entities.PatientEducationDelivery.create({
        patient_id: patientId,
        topic: topic.title,
        diagnosis_related: patient.primary_diagnosis || '',
        education_content: contentResult.slice(0, MAX_TEXT),
        content_type: 'text',
        reading_level: 'basic',
        generated_from_visit_id: visitId,
        generated_date: new Date().toISOString(),
        delivery_status: 'pending',
      });
      materials.push(saved);
    }

    return json({
      success: true,
      patient_id: patientId,
      materials_generated: materials.length,
      materials,
    });
  } catch (error) {
    console.error('Education generation error:', error?.message || error);
    return json({ error: 'Internal server error' }, 500);
  }
}