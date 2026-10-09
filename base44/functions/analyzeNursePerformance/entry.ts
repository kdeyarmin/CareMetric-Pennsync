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

const MEMBER_SCAN_LIMIT = 5000;
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

/**
 * Who may analyse whom, from protected sources only (owner decision
 * 2026-10-08, replacing the old self-editable profile-field comparison):
 *   - the built-in admin (Base44 role 'admin') may analyse any active member;
 *   - a service-owned agency administrator (withTrustedClaims) may analyse an
 *     active member of their own agency;
 *   - anyone else may analyse only themselves.
 */
function performanceScope(user) {
  if (user.role === 'admin') return { admin: true, platform: true, agencyId: null };
  const agencyId = String(user.agency_id || '');
  if (user.role === 'user' && user.account_type === 'agency_admin' && claimIdentifier(agencyId)) {
    return { admin: true, platform: false, agencyId };
  }
  return { admin: false, platform: false, agencyId: claimIdentifier(agencyId) ? agencyId : null };
}

async function activeMembers(base44, agencyId) {
  const query = agencyId ? { agency_id: agencyId, status: 'active' } : { status: 'active' };
  const rows = await base44.asServiceRole.entities.AgencyMembership.filter(query, undefined, MEMBER_SCAN_LIMIT + 1);
  if (!Array.isArray(rows) || rows.length > MEMBER_SCAN_LIMIT) throw new Error('MEMBER_SCAN_INCOMPLETE');
  return rows.filter((row) => row?.status === 'active' && claimEmail(row?.user_email_normalized)
    && (!agencyId || row.agency_id === agencyId));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await withTrustedClaims(base44, await base44.auth.me());

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const scope = performanceScope(user);

    const body = await req.json().catch(() => ({}));

    // The nurse picker: administrators only, one agency for an agency admin.
    if (body?.action === 'roster') {
      if (!scope.admin) {
        return Response.json({ error: 'Administrator access required.' }, { status: 403 });
      }
      const members = (await activeMembers(base44, scope.platform ? null : scope.agencyId))
        .filter((row) => row.tenant_role !== 'office_staff');
      const ids = [...new Set(members.map((row) => row.user_id).filter(claimIdentifier))];
      const users = ids.length
        ? await base44.asServiceRole.entities.User.filter({ id: { $in: ids } }, undefined, ids.length + 1).catch(() => [])
        : [];
      const byId = new Map((Array.isArray(users) ? users : []).map((row) => [row.id, row]));
      const seen = new Set();
      const nurses = [];
      for (const row of members) {
        if (seen.has(row.user_email_normalized)) continue;
        seen.add(row.user_email_normalized);
        nurses.push({
          email: row.user_email_normalized,
          full_name: byId.get(row.user_id)?.full_name || null,
          role: row.tenant_role,
        });
      }
      nurses.sort((a, b) => String(a.full_name || a.email).localeCompare(String(b.full_name || b.email)));
      return Response.json({ success: true, nurses });
    }

    const nurse_email = normalizeEmail(body?.nurse_email);
    const requestedRange = Number(body?.date_range_days);
    const date_range_days = Number.isInteger(requestedRange) && requestedRange > 0 && requestedRange <= 3650
      ? requestedRange
      : 30;

    let targetEmail = normalizeEmail(user.email);
    // A non-admin asking about anyone else is answered about themselves, as
    // before; an administrator's target must be an active member in scope.
    let targetAgencyId = scope.agencyId;
    if (nurse_email && nurse_email !== targetEmail && scope.admin) {
      const memberships = await base44.asServiceRole.entities.AgencyMembership.filter(
        scope.platform
          ? { user_email_normalized: nurse_email, status: 'active' }
          : { agency_id: scope.agencyId, user_email_normalized: nurse_email, status: 'active' },
        undefined, 2,
      );
      const membership = Array.isArray(memberships) && memberships.length === 1 ? memberships[0] : null;
      if (!membership || membership.user_email_normalized !== nurse_email || membership.status !== 'active'
        || (!scope.platform && membership.agency_id !== scope.agencyId)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      targetEmail = nurse_email;
      targetAgencyId = membership.agency_id;
    }
    
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - date_range_days);

    // Fetch all relevant data
    // Note: patient counts are derived from this nurse's visits below, so we do
    // NOT bulk-read the whole Patient table (a needless 5000-record PHI fetch
    // that was fetched and never used).
    // Visits and incidents are read for this nurse only (the old code read the
    // deployment's 5,000 newest incidents), and inside their agency when known.
    const visitQuery = targetAgencyId
      ? { created_by: targetEmail, agency_id: targetAgencyId }
      : { created_by: targetEmail };
    const [activities, recommendations, audits, visits, incidents] = await Promise.all([
      base44.asServiceRole.entities.UserActivity.filter({ user_email: targetEmail }, '-created_date', 5000),
      base44.asServiceRole.entities.TrainingRecommendation.filter({ nurse_email: targetEmail }, '-created_date', 5000),
      base44.asServiceRole.entities.ComplianceAudit.filter({ nurse_email: targetEmail }, '-created_date', 5000),
      base44.asServiceRole.entities.Visit.filter(visitQuery, '-created_date', 5000),
      base44.asServiceRole.entities.Incident.filter({ created_by: targetEmail }, '-created_date', 5000)
    ]);

    // Calculate metrics
    const metrics = {
      // Overall activity
      total_activities: activities.length,
      activities_last_30_days: activities.filter(a => new Date(a.created_date) >= dateThreshold).length,
      
      // Visit metrics
      total_visits: visits.length,
      completed_visits: visits.filter(v => v.status === 'completed').length,
      avg_visit_duration: 0,
      visits_by_type: {},
      
      // Documentation metrics
      template_usage: activities.filter(a => a.action === 'template_generated').length,
      voice_command_usage: activities.filter(a => a.action === 'voice_command_used').length,
      ai_scribe_usage: activities.filter(a => a.action === 'ai_scribe_used').length,
      avg_documentation_time: 0,
      avg_word_count: 0,
      
      // AI assistance metrics
      total_suggestions_received: recommendations.length,
      suggestions_applied: recommendations.filter(r => r.addressed).length,
      suggestion_acceptance_rate: 0,
      suggestions_by_source: {},
      suggestions_by_type: {},
      
      // Compliance metrics
      total_audits: audits.length,
      avg_compliance_score: 0,
      passed_audits: audits.filter(a => a.status === 'passed').length,
      flagged_audits: audits.filter(a => a.status === 'flagged').length,
      critical_audits: audits.filter(a => a.status === 'critical').length,
      
      // Quality trends
      compliance_trend: [],
      productivity_trend: [],
      ai_adoption_trend: []
    };

    // Calculate visit duration
    const visitsWithDuration = visits.filter(v => v.start_time && v.end_time);
    if (visitsWithDuration.length > 0) {
      const totalMinutes = visitsWithDuration.reduce((sum, v) => {
        const start = new Date(`2000-01-01T${v.start_time}`);
        const end = new Date(`2000-01-01T${v.end_time}`);
        let minutes = (end - start) / (1000 * 60);
        // An overnight visit (e.g. 22:00 → 01:00) would otherwise contribute a
        // large negative duration and drag the average below zero. Wrap past
        // midnight rather than counting it as negative time.
        if (minutes < 0) minutes += 24 * 60;
        return sum + minutes;
      }, 0);
      metrics.avg_visit_duration = Math.round(totalMinutes / visitsWithDuration.length);
    }

    // Visits by type
    visits.forEach(v => {
      metrics.visits_by_type[v.visit_type] = (metrics.visits_by_type[v.visit_type] || 0) + 1;
    });

    // Documentation time - calculate from visit start_time and end_time for completed visits
    const completedVisitsWithTime = visits.filter(v => 
      v.status === 'completed' && v.start_time && v.end_time
    );
    
    if (completedVisitsWithTime.length > 0) {
      const totalDocMinutes = completedVisitsWithTime.reduce((sum, v) => {
        try {
          const start = new Date(`2000-01-01T${v.start_time}`);
          const end = new Date(`2000-01-01T${v.end_time}`);
          const minutes = (end - start) / (1000 * 60);
          return sum + (minutes > 0 ? minutes : 0);
        } catch (e) {
          return sum;
        }
      }, 0);
      metrics.avg_documentation_time = Math.round(totalDocMinutes / completedVisitsWithTime.length);
    }
    
    // Also check activities for documentation time if available
    const docActivities = activities.filter(a => a.action === 'visit_completed' && a.details?.documentation_time_minutes);
    if (docActivities.length > 0 && metrics.avg_documentation_time === 0) {
      metrics.avg_documentation_time = Math.round(
        docActivities.reduce((sum, a) => sum + (a.details.documentation_time_minutes || 0), 0) / docActivities.length
      );
    }
    
    // Word count from activities
    if (docActivities.length > 0) {
      metrics.avg_word_count = Math.round(
        docActivities.reduce((sum, a) => sum + (a.details.word_count || 0), 0) / docActivities.length
      );
    }

    // Suggestion acceptance rate
    if (recommendations.length > 0) {
      metrics.suggestion_acceptance_rate = Math.round((metrics.suggestions_applied / recommendations.length) * 100);
    }

    // Suggestions by source and type
    recommendations.forEach(r => {
      metrics.suggestions_by_source[r.source] = (metrics.suggestions_by_source[r.source] || 0) + 1;
      metrics.suggestions_by_type[r.recommendation_type] = (metrics.suggestions_by_type[r.recommendation_type] || 0) + 1;
    });

    // Compliance score
    if (audits.length > 0) {
      metrics.avg_compliance_score = Math.round(
        audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length
      );
    }

    // Trends (last 30 days, grouped by week)
    const weeks = 4;
    for (let i = 0; i < weeks; i++) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((i + 1) * 7));
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - (i * 7));

      const weekAudits = audits.filter(a => {
        const date = new Date(a.created_date);
        return date >= weekStart && date < weekEnd;
      });

      const weekActivities = activities.filter(a => {
        const date = new Date(a.created_date);
        return date >= weekStart && date < weekEnd;
      });

      metrics.compliance_trend.unshift({
        week: `Week ${weeks - i}`,
        score: weekAudits.length > 0 
          ? Math.round(weekAudits.reduce((s, a) => s + (a.compliance_score || 0), 0) / weekAudits.length)
          : 0
      });

      metrics.productivity_trend.unshift({
        week: `Week ${weeks - i}`,
        visits: weekActivities.filter(a => a.action === 'visit_completed').length
      });

      metrics.ai_adoption_trend.unshift({
        week: `Week ${weeks - i}`,
        usage: weekActivities.filter(a => 
          a.action === 'ai_scribe_used' || 
          a.action === 'template_generated' ||
          a.action === 'voice_command_used'
        ).length
      });
    }

    // Calculate skill gaps
    const skillGaps = [];
    
    // Low compliance = documentation training needed. Only a nurse who has
    // been audited can score low: with no audits the average is a placeholder
    // zero, not a finding.
    if (metrics.total_audits > 0 && metrics.avg_compliance_score < 85) {
      skillGaps.push({
        skill: 'Medicare Documentation Compliance',
        current_level: 'needs_improvement',
        gap_severity: 'high',
        recommendation: 'Complete Medicare documentation training modules'
      });
    }

    // Low suggestion acceptance = may not understand best practices
    if (metrics.suggestion_acceptance_rate < 50 && recommendations.length > 10) {
      skillGaps.push({
        skill: 'AI-Assisted Documentation',
        current_level: 'needs_improvement',
        gap_severity: 'medium',
        recommendation: 'Review AI suggestions more carefully and leverage tools'
      });
    }

    // Low template usage = efficiency opportunity
    if (metrics.template_usage < metrics.completed_visits * 0.3 && metrics.completed_visits > 5) {
      skillGaps.push({
        skill: 'Documentation Efficiency',
        current_level: 'needs_improvement',
        gap_severity: 'medium',
        recommendation: 'Use smart templates to improve efficiency'
      });
    }

    // High documentation time = efficiency issue
    if (metrics.avg_documentation_time > 30) {
      skillGaps.push({
        skill: 'Time Management',
        current_level: 'needs_improvement',
        gap_severity: 'medium',
        recommendation: 'Use voice dictation and AI scribe to reduce documentation time'
      });
    }

    // The Training Hub asks for skill gaps alone (owner decision, 2026-10-08:
    // skill-gap training is back; nothing predicts burnout or clinical risk).
    // These are the deterministic rules above, so no model call is made, and
    // the answer is about the target the authority checks above settled on
    // (the caller themselves unless an administrator named an in-scope member).
    if (body?.action === 'skill_gaps') {
      return Response.json({ success: true, nurse_email: targetEmail, skill_gaps: skillGaps });
    }

    // AI-generated insights and recommendations
    const analysisPrompt = `You are a nursing performance analyst. Analyze the following performance data for one nurse and provide:

1. Key Strengths (2-3 specific strengths based on data)
2. Areas for Improvement (2-3 specific areas with concrete suggestions)
3. Personalized Training Recommendations (3-5 specific training topics)
4. Risk Factors (any concerning patterns)
5. Overall Performance Summary (2-3 sentences)

DATA:
- Total Visits: ${metrics.total_visits} (${metrics.completed_visits} completed)
- Avg Compliance Score: ${metrics.avg_compliance_score}%
- AI Suggestion Acceptance Rate: ${metrics.suggestion_acceptance_rate}%
- Suggestions Received: ${metrics.total_suggestions_received}
- Compliance Issues: ${metrics.flagged_audits} flagged, ${metrics.critical_audits} critical
- Template Usage: ${metrics.template_usage} times
- AI Scribe Usage: ${metrics.ai_scribe_usage} times
- Voice Commands: ${metrics.voice_command_usage} times
- Avg Documentation Time: ${metrics.avg_documentation_time} minutes
- Visit Types: ${JSON.stringify(metrics.visits_by_type)}

SUGGESTION BREAKDOWN BY SOURCE:
${JSON.stringify(metrics.suggestions_by_source, null, 2)}

SUGGESTION BREAKDOWN BY TYPE:
${JSON.stringify(metrics.suggestions_by_type, null, 2)}

Recent Unaddressed Recommendations (sample):
${recommendations.filter(r => !r.addressed).slice(0, 5).map(r => `- ${r.recommendation_type}: ${String(r.recommendation_text || '').substring(0, 100)}`).join('\n')}

Provide actionable, specific insights. Be constructive and focus on growth opportunities.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"strengths":[""],"areas_for_improvement":[{"area":"","suggestion":"","priority":""}],"training_recommendations":[{"topic":"","reason":"","urgency":""}],"risk_factors":[""],"overall_summary":"","performance_grade":""}`;

    const insights = parseLLMJson(await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: analysisPrompt
    })) || {};

    // Calculate documentation quality metrics
    const docQualityMetrics = {
      total_notes: visits.filter(v => v.nurse_notes).length,
      avg_note_length: 0,
      notes_with_vitals: visits.filter(v => v.vital_signs && Object.keys(v.vital_signs).length > 0).length,
      notes_with_tags: visits.filter(v => v.ai_tags && v.ai_tags.length > 0).length,
      critical_issues: audits.filter(a => a.status === 'critical').length,
      flagged_issues: audits.filter(a => a.status === 'flagged').length
    };

    const notesWithContent = visits.filter(v => v.nurse_notes);
    if (notesWithContent.length > 0) {
      docQualityMetrics.avg_note_length = Math.round(
        notesWithContent.reduce((sum, v) => sum + (v.nurse_notes?.length || 0), 0) / notesWithContent.length
      );
    }

    // Calculate patient outcomes
    const nursePatientIds = [...new Set(visits.map(v => v.patient_id))];

    // "incidents_reported" = incidents this nurse actually reported. The old
    // visit_id join was always empty (writers don't set visit_id); attribute by
    // created_by (the reporter) — NOT by patient, which would count every incident
    // on a shared patient against every nurse who ever visited them.
    const nurseIncidents = incidents.filter(i =>
      i.created_by === targetEmail ||
      (i.visit_id && visits.some(v => v.id === i.visit_id))
    );

    const patientOutcomes = {
      total_patients: nursePatientIds.length,
      incidents_reported: nurseIncidents.length,
      high_severity_incidents: nurseIncidents.filter(i => i.severity === 'high').length
    };

    // Calculate utilization rates
    const last30DaysDate = new Date(dateThreshold);
    const recentVisits = visits.filter(v => new Date(v.visit_date) >= last30DaysDate);
    const workingDays = 22; // Approximate working days in 30 days
    const avgVisitsPerDay = recentVisits.length / workingDays;
    
    const utilizationMetrics = {
      visits_last_30_days: recentVisits.length,
      avg_visits_per_day: Math.round(avgVisitsPerDay * 10) / 10,
      productive_hours: Math.round((visitsWithDuration.length * metrics.avg_visit_duration) / 60),
      patients_managed: nursePatientIds.length,
      utilization_rate: Math.min(Math.round((avgVisitsPerDay / 6) * 100), 100) // Assuming 6 visits/day is 100%
    };

    return Response.json({
      success: true,
      nurse_email: targetEmail,
      metrics,
      insights,
      skill_gaps: skillGaps,
      recent_recommendations: recommendations.filter(r => !r.addressed).slice(0, 10),
      recent_activities: activities.slice(0, 20).map((a) => ({
        id: a.id,
        created_date: a.created_date,
        action: a.action,
        entity_type: a.entity_type || null,
        page: a.page || null,
        status: a.status || null,
      })),
      documentation_quality: docQualityMetrics,
      patient_outcomes: patientOutcomes,
      utilization: utilizationMetrics,
    });

  } catch {
    console.error('analyzeNursePerformance failed');
    return Response.json({ 
      error: 'Internal server error',
    }, { status: 500 });
  }
});