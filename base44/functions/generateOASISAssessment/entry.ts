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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Even an evidence-only prompt can leak an OASIS response through unconstrained
// model text when a direct caller bypasses the browser sanitizer. Keep the
// endpoint paused until server-side output validation and tenant provenance are
// implemented and clinically verified.
const OASIS_ASSESSMENT_AI_ENABLED = false;


/** Explicit patient access — Patient RLS treats role:admin as platform-wide. */
async function assertPatientAccess(base44, user, patient) {
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
  const isSuperAdmin = user.account_type === 'super_admin';
  const isAgencyScopedAdmin =
    user.account_type === 'agency_admin'
    || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
  const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
  const isAssigned = Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.includes(user.email);
  if (!isPlatformAdmin && !isAgencyScopedAdmin && patient.created_by !== user.email && !isAssigned) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (isAgencyScopedAdmin) {
    if (!user.agency_name) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const agencyUsers = await base44.asServiceRole.entities.User
      .list('-created_date', 5000).catch(() => []);
    const agencyEmails = new Set(
      (agencyUsers || [])
        .filter((u) => u.agency_name === user.agency_name && u.email)
        .map((u) => u.email),
    );
    const inAgency = (patient.created_by && agencyEmails.has(patient.created_by))
      || (Array.isArray(patient.assigned_nurses)
        && patient.assigned_nurses.some((e) => agencyEmails.has(e)));
    if (!inAgency) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (!OASIS_ASSESSMENT_AI_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'oasis_assessment_ai_paused',
      message: 'AI OASIS assessment guidance is unavailable pending tenant-scoped provenance and server-side clinical validation.',
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await withTrustedClaims(base44, await base44.auth.me());

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { patient_id, visit_type, referral_data } = await req.json();

    if (!patient_id && !referral_data) {
      return Response.json({ error: 'Either patient_id or referral_data required' }, { status: 400 });
    }

    // Fetch patient data if patient_id provided
    let patientData = null;

    if (patient_id) {
      const [claimed] = await base44.asServiceRole.entities.Patient
        .filter({ id: patient_id }, '', 1).catch(() => []);
      const denied = await assertPatientAccess(base44, user, claimed);
      if (denied) return denied;
      patientData = claimed;
    } else if (referral_data) {
      // referral_data-only path still feeds PHI into the LLM — require admin
      // so a nurse cannot submit arbitrary referral payloads for another tenant.
      const isAdminLike = user.role === 'admin'
        || user.account_type === 'agency_admin'
        || user.account_type === 'super_admin';
      if (!isAdminLike) {
        return Response.json({ error: 'Forbidden: patient_id is required' }, { status: 403 });
      }
    }

    const contextData = referral_data || patientData;

    // Generate OASIS assessment using AI
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `Generate a comprehensive OASIS assessment guide for this home health patient.

VISIT TYPE: ${visit_type || 'Start of Care'}

PATIENT DATA:
${JSON.stringify(contextData, null, 2)}

CRITICAL INSTRUCTIONS:
- Provide clear, complete responses without abbreviations or truncated text
- Write full words and sentences - do NOT use shortened text like "- & A s s e s s"
- Always write complete OASIS item names
- Use proper spacing between words
- Do NOT include administrative items M1000-M1060 (Medicare Number, Medicaid Number, Physician Name, Physician Phone)
- These administrative items are auto-generated in the EHR system

Generate:

1. KEY OASIS ITEMS: Identify the most relevant OASIS items based on diagnoses and clinical presentation (15-20 items)
   - Exclude M1000-M1060 administrative section
   - Focus on clinical assessment items only

2. PREPARATION FOR EACH ITEM — evidence and questions, NEVER an answer:
   - Item number and full description (not truncated)
   - The verbatim sentence(s) from the referral/record that relate to this item
   - Confidence that the record contains enough to answer it (High/Medium/Low)
   - What the record does and does not establish
   - Specific questions to ask the patient/caregiver in order to answer it
   - Documentation tips with complete sentences

3. ASSESSMENT PRIORITIES: What to assess first based on clinical urgency

4. MISSING DATA: What critical information is needed but not available

HARD RULES — these override anything else in this prompt:
- NEVER provide, suggest, recommend or imply an OASIS response, score or code.
  The clinician selects every official response themselves. If you are tempted
  to state a code, state the evidence and ask the question instead.
- NEVER consider or mention payment, reimbursement, revenue, PDGM or case-mix
  impact, and never suggest what would "maximize" any of them.

Focus on functional status, cognitive status, medications, wounds, and clinical factors affecting care.
Write everything clearly and completely - no truncated text.`,
      response_json_schema: {
        type: "object",
        properties: {
          oasis_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_number: { type: "string" },
                item_name: { type: "string" },
                category: { type: "string" },
                // No `suggested_response`: the model does not choose an OASIS
                // response. `evidence` is the verbatim quote it is grounded in.
                evidence: { type: "string" },
                confidence_level: { type: "string" },
                rationale: { type: "string" },
                questions_to_ask: {
                  type: "array",
                  items: { type: "string" }
                },
                documentation_tips: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          },
          assessment_priorities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                priority: { type: "string" },
                area: { type: "string" },
                rationale: { type: "string" }
              }
            }
          },
          missing_critical_data: {
            type: "array",
            items: { type: "string" }
          },
          // `pdgm_optimization_notes` and `estimated_pdgm_group` are removed:
          // both asked the model to reason about payment from clinical items.
          clinical_summary: { type: "string" }
        }
      }
    });

    return Response.json({
      success: true,
      visit_type: visit_type || 'Start of Care',
      ...result
    });

  } catch (error) {
    console.error('Error generating OASIS assessment:', error);
    // Do not leak internal error details (error.toString()/stack) to the
    // caller — could expose PHI or implementation details.
    return Response.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
});