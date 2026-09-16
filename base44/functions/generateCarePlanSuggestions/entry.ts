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

// This model-generated care-plan path includes reimbursement-oriented advice
// and depends on mutable tenant claims. Keep it unavailable until suggestions
// are payment-neutral, tenant-bound, and clinician-reviewed.
const CARE_PLAN_SUGGESTIONS_AI_ENABLED = false;


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
  if (!CARE_PLAN_SUGGESTIONS_AI_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'care_plan_suggestions_ai_paused',
      message: 'AI care-plan suggestions are unavailable pending tenant-scoped authorization and clinician review.',
      suggestions: [],
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'Missing patient_id' }, { status: 400 });
    }

    const [patient] = await base44.asServiceRole.entities.Patient
      .filter({ id: patient_id }, '', 1).catch(() => []);
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

    const [clinicalEvents, existingCarePlans, visits, incidents] = await Promise.all([
      base44.asServiceRole.entities.ClinicalEvent.filter({ patient_id }, '-event_date', 50),
      base44.asServiceRole.entities.CarePlan.filter({ patient_id }, undefined, 5000),
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 10),
      base44.asServiceRole.entities.Incident.filter({ patient_id }, '-incident_date', 10)
    ]);

    // Prepare context for AI analysis
    const recentEvents = clinicalEvents.slice(0, 20).map(e => ({
      type: e.event_type,
      title: e.event_title,
      description: e.event_description,
      date: e.event_date,
      severity: e.severity,
      structured_data: e.structured_data
    }));

    const recentVisits = visits.slice(0, 5).map(v => ({
      date: v.visit_date,
      type: v.visit_type,
      vital_signs: v.vital_signs,
      notes_summary: v.nurse_notes?.substring(0, 500)
    }));

    const recentIncidents = incidents.map(i => ({
      type: i.incident_type,
      date: i.incident_date,
      severity: i.severity,
      details: i.details
    }));

    const existingProblems = existingCarePlans.map(cp => cp.problem);

    const result = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `As a clinical expert, analyze this home health patient's data and generate comprehensive care plan suggestions.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${formatAge(patient.date_of_birth)}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Medications: ${patient.current_medications?.map(m => `${m.name} ${m.dosage || ''}`).join(', ') || 'None'}
- Allergies: ${patient.allergies || 'None documented'}
- Functional Status: ${JSON.stringify(patient.functional_status || {})}
- Living Situation: ${patient.social_history?.living_situation || 'Unknown'}

RECENT CLINICAL EVENTS (Last 30 days):
${JSON.stringify(recentEvents, null, 2)}

RECENT VISITS:
${JSON.stringify(recentVisits, null, 2)}

INCIDENTS:
${JSON.stringify(recentIncidents, null, 2)}

EXISTING CARE PLANS:
${existingProblems.join(', ') || 'None'}

Based on this comprehensive patient profile, generate care plan suggestions that address:
1. Unaddressed clinical needs or gaps in current care
2. Risk factors requiring preventive interventions
3. Medication management and adherence
4. Functional improvement opportunities
5. Safety concerns
6. Patient education needs
7. Chronic disease management
8. Post-hospitalization follow-up (if applicable)

For each suggested care plan, provide:
- Problem/Nursing Diagnosis (use NANDA-I terminology where appropriate)
- Measurable Goal (specific, achievable, time-bound)
- Interventions (list 3-5 evidence-based nursing interventions)
- Expected Outcomes (measurable)
- Baseline Measurement (how to measure initial status)
- Frequency (how often to assess: each visit, weekly, etc.)
- Priority (high, medium, low based on clinical urgency)
- Rationale (brief clinical reasoning for this care plan)
- Medicare/Insurance Considerations (documentation tips for reimbursement)

Only suggest care plans that are not already covered by existing plans. Focus on current, actionable needs.`,
      response_json_schema: {
        type: "object",
        properties: {
          suggestions: {
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
                expected_outcomes: { type: "string" },
                baseline_measurement: { type: "string" },
                frequency: { type: "string" },
                priority: { type: "string" },
                rationale: { type: "string" },
                medicare_considerations: { type: "string" },
                target_days: { type: "number" }
              }
            }
          },
          overall_assessment: { type: "string" },
          critical_gaps_identified: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    return Response.json({
      success: true,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      suggestions: result?.suggestions || [],
      overall_assessment: result?.overall_assessment || '',
      critical_gaps_identified: result?.critical_gaps_identified || []
    });

  } catch (error) {
    console.error('Error generating care plan suggestions:', error);
    // Generic client-facing message; detail stays server-side only (matches the
    // hardened userManagement pattern — leaking error.message aids reconnaissance).
    return Response.json({
      error: 'Failed to generate care plan suggestions'
    }, { status: 500 });
  }
});
