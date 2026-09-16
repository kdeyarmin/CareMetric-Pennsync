import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

// Fail closed until generated plans have immutable tenant authority, explicit
// clinician review provenance, and a non-active draft workflow.
const REFERRAL_CARE_PLAN_AI_ENABLED = false;

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
  if (!REFERRAL_CARE_PLAN_AI_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'referral_care_plan_ai_paused',
      message: 'AI-generated care plans are unavailable pending tenant-scoped authorization and clinician review controls.',
      care_plans_created: 0,
      care_plans: [],
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, referral_data, primary_diagnosis, secondary_diagnoses } = await req.json();

    if (!patient_id || !referral_data) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Service-role get + explicit access (user-scoped Patient.filter alone is not
    // enough for agency-scoped facility admins under platform-wide role:admin RLS).
    const [patient] = await base44.asServiceRole.entities.Patient
      .filter({ id: patient_id }, '', 1).catch(() => []);
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

    const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `care-plans-gen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await base44.asServiceRole.entities.Patient.update(patient_id, {
        care_plans_gen_claimed_by: claimToken,
      });
    } catch {
      return Response.json({ error: 'Could not claim patient for care plan generation' }, { status: 409 });
    }
    const claimCheck = await base44.asServiceRole.entities.Patient
      .filter({ id: patient_id }, '', 1).catch(() => []);
    if (!claimCheck[0] || claimCheck[0].care_plans_gen_claimed_by !== claimToken) {
      return Response.json({
        success: true,
        already_processed: true,
        care_plans_created: 0,
        care_plans: [],
        skipped: 'claimed by concurrent run',
      });
    }
    const existingActive = await base44.asServiceRole.entities.CarePlan
      .filter({ patient_id, status: 'active' }, undefined, 1)
      .catch(() => []);
    if (existingActive && existingActive.length > 0) {
      return Response.json({
        success: true,
        already_processed: true,
        care_plans_created: 0,
        care_plans: [],
        skipped: 'active care plans already exist',
      });
    }

    // Generate comprehensive care plans using AI
    const result = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `Generate comprehensive, Medicare-compliant care plans for this home health patient based on their referral and diagnoses.

PRIMARY DIAGNOSIS: ${primary_diagnosis}
SECONDARY DIAGNOSES: ${secondary_diagnoses?.join(', ') || 'None'}

REFERRAL DATA:
${JSON.stringify(referral_data, null, 2)}

Generate 3-5 specific care plans that:
1. Address the primary diagnosis and key comorbidities
2. Are measurable and time-bound (typically 60 days)
3. Include specific nursing interventions
4. Are Medicare-compliant and PDGM-optimized
5. Follow standard nursing diagnosis frameworks

For each care plan provide:
- Problem/Nursing Diagnosis
- Measurable Goal
- Specific Interventions (3-5)
- Baseline Measurement
- Frequency of Assessment
- Target Date
- Priority Level`,
      response_json_schema: {
        type: "object",
        properties: {
          care_plans: {
            type: "array",
            items: {
              type: "object",
              properties: {
                problem: { type: "string" },
                goal: { type: "string" },
                interventions: {
                  type: "array",
                  items: { type: "string" }
                },
                baseline_measurement: { type: "string" },
                frequency: { type: "string" },
                target_days: { type: "number" },
                priority: { type: "string" }
              }
            }
          },
          education_priorities: {
            type: "array",
            items: { type: "string" }
          },
          coordination_needs: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    // Create care plans in database
    const createdCarePlans = [];
    const targetDate = new Date();
    
    for (const plan of (result?.care_plans || [])) {
      const planTargetDate = new Date(targetDate);
      planTargetDate.setDate(planTargetDate.getDate() + (plan.target_days || 60));

      const carePlan = await base44.asServiceRole.entities.CarePlan.create({
        patient_id,
        problem: plan.problem,
        goal: plan.goal,
        interventions: plan.interventions,
        baseline_measurement: plan.baseline_measurement,
        frequency: plan.frequency,
        target_date: planTargetDate.toISOString().split('T')[0],
        status: 'active'
      });

      createdCarePlans.push(carePlan);
    }

    return Response.json({
      success: true,
      care_plans_created: createdCarePlans.length,
      care_plans: createdCarePlans,
      education_priorities: result.education_priorities,
      coordination_needs: result.coordination_needs
    });

  } catch (error) {
    console.error('Error generating care plans:', error);
    // Generic client-facing message; detail stays server-side only (matches the
    // hardened userManagement pattern — leaking error.message aids reconnaissance).
    return Response.json({
      error: 'Failed to generate care plans'
    }, { status: 500 });
  }
});
