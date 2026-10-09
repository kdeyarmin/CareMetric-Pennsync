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

// Tolerant JSON extractor: we ask for strict JSON in-prompt instead of passing
// response_json_schema, because the provider rejects deeply-nested object
// schemas that lack an explicit `required` array at every level.
function parseLLMJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}


// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Released by the owner on 2026-10-08 ("turn everything on"). This is a
// documentation tool, not risk prediction: it scores a note's Medicare
// documentation compliance, points to OASIS evidence in the note (never a
// response or score), and suggests follow-up documentation and tasks; the
// PDGM type still answers with the unavailable payload because payment
// features were removed. It used to read the chart, its visits and its OASIS
// upload BEFORE an access check built from editable account_type /
// agency_name / assigned_nurses fields. Now the chart alone is read, access is
// decided by callerMayAccessPatient (membership and the care-team table), and
// only then are its visits and OASIS upload read or the model called. Without
// a patient, the caller must hold exactly one active membership.
const BATCH_CLINICAL_AI_ENABLED = true;
const ANALYSIS_TYPES = new Set(['compliance', 'oasis', 'pdgm', 'proactive']);
const MAX_NOTE_LENGTH = 40_000;

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

// <<<BEGIN SHARED HELPER: pdgmReimbursementGate — generated, edit base44/_shared/backendHelpers.mjs>>>
const PDGM_REIMBURSEMENT_ENABLED = false;
// Independent retirement lock for every legacy PDGM financial surface. A future
// source edit to the global feature flag must not revive the factorized model.
const LEGACY_FACTORIZED_PDGM_MODEL_RETIRED = true;
const PDGM_LEGACY_SURFACES_ENABLED = PDGM_REIMBURSEMENT_ENABLED
  && !LEGACY_FACTORIZED_PDGM_MODEL_RETIRED;
const PDGM_REIMBURSEMENT_BLOCKER = 'The app does not yet use a verified CMS HHGS 432-group grouper with golden-case tests.';
const PDGM_REIMBURSEMENT_ACTION = 'Use the official EMR/CMS-approved grouper for billing and reimbursement decisions.';
function pdgmUnavailablePayload(extra = {}) {
  return {
    featureEnabled: PDGM_LEGACY_SURFACES_ENABLED,
    calculationStatus: 'blocked',
    paymentAvailable: false,
    payment: null,
    totalPayment: null,
    caseMixWeight: null,
    reason: 'cms_verified_pdgm_grouper_unavailable',
    message: `PDGM reimbursement is unavailable — this is not a $0 result. ${PDGM_REIMBURSEMENT_BLOCKER}`,
    actionRequired: [PDGM_REIMBURSEMENT_ACTION],
    ...extra,
  };
}
// <<<END SHARED HELPER: pdgmReimbursementGate>>>

// <<<BEGIN SHARED HELPER: formatAge — generated, edit base44/_shared/backendHelpers.mjs>>>
function parseLocalDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const d = new Date(y, mo, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function calculateAge(dob, now = new Date()) {
  const birth = parseLocalDate(dob);
  const today = parseLocalDate(now);
  if (!birth || !today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
function formatAge(dob, now = new Date(), fallback = 'Unknown') {
  const age = calculateAge(dob, now);
  return age == null ? fallback : age;
}
// <<<END SHARED HELPER: formatAge>>>
Deno.serve(async (req) => {
  if (!BATCH_CLINICAL_AI_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'batch_clinical_ai_paused',
      message: 'Batch clinical AI analysis is unavailable pending tenant-scoped authorization and clinical validation.',
      analyses: {},
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const claims = await withTrustedClaims(base44, user);
    if (claims.role !== 'admin' && !claimIdentifier(claims.agency_id)) {
      return Response.json({ error: 'An active agency membership is required' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Request body must be an object' }, { status: 400 });
    }
    const {
      roughNote,
      enhancedNote,
      visitType,
      diagnosis,
      vitalSigns,
      patientId,
      analysisTypes, // ['compliance', 'oasis', 'pdgm', 'proactive']
    } = body;

    if (!analysisTypes || !Array.isArray(analysisTypes) || analysisTypes.length === 0
      || analysisTypes.some((type) => !ANALYSIS_TYPES.has(type))) {
      return Response.json({ error: 'analysisTypes array required' }, { status: 400 });
    }
    for (const note of [roughNote, enhancedNote]) {
      if (note != null && (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH)) {
        return Response.json({ error: 'Note text is invalid or too long' }, { status: 400 });
      }
    }
    if (patientId != null && !claimIdentifier(patientId)) {
      return Response.json({ error: 'patientId is invalid' }, { status: 400 });
    }
    if (analysisTypes.length === 1 && analysisTypes[0] === 'pdgm') {
      return Response.json({
        success: true,
        analyses: { pdgm: pdgmUnavailablePayload({ analysisAvailable: false }) },
      });
    }

    // Fetch patient data once for all analyses
    let patientData = null;
    let recentVisits = [];
    let oasisData = null;

    if (patientId) {
      // The chart alone is read to decide access; its visits and OASIS upload
      // are read only after callerMayAccessPatient admits the caller.
      const patientRows = await base44.asServiceRole.entities.Patient.filter({ id: patientId }, undefined, 2);
      const patient = Array.isArray(patientRows) && patientRows.length === 1 && patientRows[0]?.id === patientId
        ? patientRows[0]
        : null;
      if (!patient || !(await callerMayAccessPatient(base44, user, patient))) {
        return Response.json({ error: 'Patient not found or access denied' }, { status: 403 });
      }
      patientData = patient;
      const [visits, oasis] = await Promise.all([
        base44.asServiceRole.entities.Visit.filter({ patient_id: patientId, status: 'completed' }, '-visit_date', 3),
        base44.asServiceRole.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date', 1),
      ]);
      recentVisits = (Array.isArray(visits) ? visits : []).filter((visit) => visit?.patient_id === patientId);
      oasisData = (Array.isArray(oasis) ? oasis : []).find((row) => row?.patient_id === patientId) || null;
    }

    // Build shared context for all analyses
    const sharedContext = `
PATIENT DATA:
${patientData ? `- Primary Diagnosis: ${patientData.primary_diagnosis || diagnosis}
- Age: ${formatAge(patientData.date_of_birth)}
- Allergies: ${patientData.allergies || 'None documented'}` : ''}

VISIT DETAILS:
- Visit Type: ${visitType}
- Diagnosis: ${diagnosis}
- Vitals: ${JSON.stringify(vitalSigns)}

RECENT VISITS: ${recentVisits.length > 0 ? `Last visit ${recentVisits[0].visit_date}` : 'None'}
`;

    // Batch all AI analyses in parallel
    const analyses = analysisTypes.includes('pdgm')
      ? { pdgm: pdgmUnavailablePayload({ analysisAvailable: false }) }
      : {};
    const promises = [];

    if (analysisTypes.includes('compliance') && (roughNote || enhancedNote)) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: "automatic",
          prompt: `Analyze this clinical note for Medicare compliance. Return score and specific gaps.

${sharedContext}

NOTE TO ANALYZE:
${enhancedNote || roughNote}

Return ONLY valid JSON, no prose or code fences, with this shape:
{"compliance_score":0,"missing_elements":[""],"specific_gaps":[{}]}`
        }).then(result => { analyses.compliance = parseLLMJson(result) || {}; })
      );
    }

    if (analysisTypes.includes('oasis') && enhancedNote && oasisData) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: "automatic",
          prompt: `Point out which OASIS items this clinical note contains evidence for.

NEVER state, suggest or imply an OASIS response, score or code — the clinician
selects every official response themselves. Quote the note verbatim instead, and
say what the note does and does not establish.

${sharedContext}

ENHANCED NOTE:
${enhancedNote}

Return ONLY valid JSON, no prose or code fences, with this shape:
{"mappings":[{"oasis_item":"","evidence_from_note":"","what_is_established":"","what_is_missing":""}],"items_with_evidence":0,"items_needing_more_documentation":0}`
        }).then(result => { analyses.oasis = parseLLMJson(result) || {}; })
      );
    }

    if (analysisTypes.includes('proactive') && (roughNote || enhancedNote)) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: "automatic",
          prompt: `Generate proactive suggestions for tasks, care plan updates, and clinical alerts.

${sharedContext}

NOTE:
${enhancedNote || roughNote}

Return ONLY valid JSON, no prose or code fences, with this shape:
{"followup_tasks":[{}],"care_plan_suggestions":[{}],"clinical_alerts":[{}],"documentation_gaps":[{}],"education_needs":[{}]}`
        }).then(result => { analyses.proactive = parseLLMJson(result) || {}; })
      );
    }

    // Wait for all analyses to settle. allSettled (not all) so one analysis
    // failing doesn't discard the others that already succeeded — each writes
    // its own result into `analyses` on success, and a rejected one is simply
    // omitted rather than 500-ing the whole batch.
    await Promise.allSettled(promises);

    return Response.json({
      success: true,
      analyses,
      context: {
        patient_id: patientId,
        has_oasis: !!oasisData,
        recent_visits_count: recentVisits.length
      }
    });

  } catch (error) {
    console.error('Batch analysis error:', error);
    return Response.json({ 
      error: 'Internal server error',
      success: false 
    }, { status: 500 });
  }
});
