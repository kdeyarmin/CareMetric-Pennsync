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

    const [visits, clinicalEvents] = await Promise.all([
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 100),
      base44.asServiceRole.entities.ClinicalEvent.filter({ patient_id }, '-event_date', 100)
    ]);

    // Extract vital signs over time
    const vitalsHistory = visits
      .filter(v => v.vital_signs)
      .map(v => ({
        date: v.visit_date,
        vitals: v.vital_signs
      }));

    // Group events by type
    const medicationEvents = clinicalEvents.filter(e =>
      e.event_type?.includes('medication')
    );
    const symptomEvents = clinicalEvents.filter(e =>
      e.event_type?.includes('symptom')
    );
    const labEvents = clinicalEvents.filter(e =>
      e.event_type?.includes('lab')
    );

    // Analyze trends with AI
    const rawTrends = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `Analyze this patient's clinical data over time and identify significant trends, patterns, and risks.

PATIENT: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}

VITAL SIGNS HISTORY (${vitalsHistory.length} visits):
${JSON.stringify(vitalsHistory, null, 2)}

MEDICATION CHANGES (${medicationEvents.length} events):
${JSON.stringify(medicationEvents.map(e => ({ date: e.event_date, title: e.event_title, description: e.event_description })), null, 2)}

SYMPTOM PROGRESSION (${symptomEvents.length} events):
${JSON.stringify(symptomEvents.map(e => ({ date: e.event_date, title: e.event_title, description: e.event_description, severity: e.severity })), null, 2)}

LAB RESULTS (${labEvents.length} events):
${JSON.stringify(labEvents.map(e => ({ date: e.event_date, title: e.event_title, description: e.event_description })), null, 2)}

Analyze and provide:

1. VITAL SIGNS TRENDS: For each vital sign (BP, HR, temp, O2, weight), identify:
   - Overall trend (improving, stable, declining, fluctuating)
   - Specific concerns or patterns
   - Rate of change
   - Clinical significance

2. SYMPTOM PATTERNS: Identify:
   - Recurring symptoms
   - Symptom progression or resolution
   - Triggers or correlations
   - Severity trends

3. MEDICATION ADHERENCE & EFFECTIVENESS:
   - Changes over time
   - Potential side effects appearing in timeline
   - Effectiveness indicators

4. COMPARATIVE ANALYSIS: Identify correlations between:
   - Symptoms appearing after medication changes
   - Vital sign changes following symptom reports
   - Lab results correlating with clinical deterioration
   - Time-based patterns (e.g., symptoms worsening before hospitalization)

5. PREDICTIVE ANALYTICS:
   - Calculate hospital readmission risk (0-100 score)
   - Identify early warning signs of clinical deterioration
   - Predict likelihood of care plan goal achievement
   - Forecast potential complications based on current trajectory

6. RISK INDICATORS:
   - Early warning signs
   - Deteriorating metrics
   - Hospital readmission risks

7. POSITIVE TRENDS:
   - Improvements
   - Goals being met
   - Successful interventions

Provide actionable insights for clinicians.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"vital_trends":[{"vital_type":"","trend_direction":"","concern_level":"","description":"","recommendation":""}],"symptom_patterns":[{"symptom":"","pattern":"","severity_trend":"","clinical_notes":""}],"medication_insights":{"adherence_assessment":"","effectiveness_notes":"","concerns":[""]},"risk_indicators":[{"risk_type":"","severity":"","evidence":"","action_needed":""}],"positive_trends":[{"achievement":"","supporting_data":""}],"comparative_insights":[{"correlation":"","metric_a":"","metric_b":"","relationship":"","clinical_significance":""}],"predictive_analytics":{"readmission_risk_score":0,"readmission_risk_level":"","deterioration_risk_score":0,"deterioration_risk_level":"","key_risk_factors":[""],"predicted_outcomes":[{"outcome":"","probability":"","timeframe":"","prevention_strategies":[""]}]},"overall_trajectory":"","priority_recommendations":[""]}`
    });
    const result = parseLLMJson(rawTrends) || {};

    return Response.json({
      success: true,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      data_analyzed: {
        visits: vitalsHistory.length,
        medication_events: medicationEvents.length,
        symptom_events: symptomEvents.length,
        lab_events: labEvents.length
      },
      vitals_data: vitalsHistory,
      vital_trends: result?.vital_trends || [],
      symptom_patterns: result?.symptom_patterns || [],
      medication_insights: result?.medication_insights || {},
      risk_indicators: result?.risk_indicators || [],
      positive_trends: result?.positive_trends || [],
      comparative_insights: result?.comparative_insights || [],
      predictive_analytics: result?.predictive_analytics || {},
      overall_trajectory: result?.overall_trajectory || 'unknown',
      priority_recommendations: result?.priority_recommendations || []
    });

  } catch (error) {
    console.error('Error analyzing clinical trends:', error);
    return Response.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
});