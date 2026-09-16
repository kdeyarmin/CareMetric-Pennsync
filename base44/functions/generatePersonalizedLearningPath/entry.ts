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

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    const { nurse_email } = await req.json();
    // Only admin-like callers may build a path from another nurse's
    // PHI/performance data, and only within their agency.
    if (nurse_email && nurse_email !== user.email) {
      const isAdminLike = user.role === 'admin'
        || user.account_type === 'agency_admin'
        || user.account_type === 'super_admin';
      if (!isAdminLike) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (user.account_type !== 'super_admin' && user.agency_name) {
        const [target] = await base44.asServiceRole.entities.User
          .filter({ email: nurse_email }, '-created_date', 1).catch(() => []);
        if (!target?.agency_name || target.agency_name !== user.agency_name) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }
    const targetEmail = nurse_email || user.email;

    // Fetch nurse performance data
    // Explicit limits: an unlimited filter() returns only the server's default
    // page (~50 rows), so an established nurse's visit and audit history was
    // truncated and the "gaps" below were computed from an arbitrary slice.
    // The audits are also sorted newest-first — `audits.slice(0, 10)` below is
    // labelled recentAudits, but without a sort it took the first 10 of an
    // arbitrarily ordered page, so the compliance average and the weak-area
    // tally could be built from the nurse's OLDEST audits.
    const [assignments, recommendations, audits, visits, skills] = await Promise.all([
      base44.asServiceRole.entities.TrainingAssignment.filter({ assigned_to_user_id: targetEmail }, '-created_date', 1000),
      base44.asServiceRole.entities.TrainingRecommendation.filter({ nurse_email: targetEmail }, '-created_date', 1000),
      base44.asServiceRole.entities.ComplianceAudit.filter({ nurse_email: targetEmail }, '-audit_date', 1000),
      base44.asServiceRole.entities.Visit.filter({ created_by: targetEmail }, '-visit_date', 1000),
      base44.asServiceRole.entities.NurseSkill.filter({ nurse_email: targetEmail }, undefined, 1000)
    ]);

    // Analyze performance and gaps
    const recentAudits = audits.slice(0, 10);
    const avgComplianceScore = recentAudits.length > 0
      ? recentAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / recentAudits.length
      : 0;

    const completedTrainingCount = assignments.filter(a => a.status === 'completed' || a.pass_fail_result === 'passed').length;
    const unaddressedRecs = recommendations.filter(r => !r.addressed);
    const weakAreas = {};
    
    unaddressedRecs.forEach(rec => {
      weakAreas[rec.recommendation_type] = (weakAreas[rec.recommendation_type] || 0) + 1;
    });

    recentAudits.forEach(audit => {
      audit.issues?.forEach(issue => {
        weakAreas[issue.element] = (weakAreas[issue.element] || 0) + 1;
      });
    });

    // Get all available training modules. Explicit limit — unlimited returns
    // only the server's default page, so the path was recommended from a
    // partial catalog once the library passed ~50 modules.
    const allModules = await base44.asServiceRole.entities.TrainingModule.filter({}, undefined, 5000);

    // Use AI to generate personalized learning path
    const prompt = `
You are an expert nursing education specialist. Analyze this nurse's performance data and create a personalized learning path.

Performance Data:
- Compliance Score: ${avgComplianceScore.toFixed(1)}%
- Completed Training: ${completedTrainingCount}
- Unaddressed Recommendations: ${unaddressedRecs.length}
- Weak Areas: ${Object.entries(weakAreas).map(([area, count]) => `${area} (${count} issues)`).join(', ')}
- Documented Skills: ${skills.length}

Available Training Modules:
${allModules.map(m => `- ${m.title} (${m.category}, ${m.difficulty_level}, ${m.module_type})`).join('\n')}

Create a personalized learning path with:
1. Priority ranking (critical/high/medium/low)
2. Recommended sequence of modules
3. Estimated completion timeline
4. Specific learning objectives for each module
5. Personalized motivation message

Return JSON format.
`;

    const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          learning_path: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                module_id: { type: 'string' },
                priority: { type: 'string' },
                sequence: { type: 'number' },
                estimated_days: { type: 'number' },
                learning_objectives: { type: 'array', items: { type: 'string' } },
                why_recommended: { type: 'string' }
              }
            }
          },
          motivation_message: { type: 'string' },
          overall_goal: { type: 'string' },
          estimated_completion_weeks: { type: 'number' }
        }
      }
    });

    // Enrich with module details
    const enrichedPath = (aiResponse?.learning_path || []).map(item => {
      const module = allModules.find(m => m.id === item.module_id || m.title === item.module_id);
      return {
        ...item,
        module: module || null
      };
    });

    return Response.json({
      learning_path: enrichedPath,
      motivation_message: aiResponse.motivation_message,
      overall_goal: aiResponse.overall_goal,
      estimated_completion_weeks: aiResponse.estimated_completion_weeks,
      performance_summary: {
        compliance_score: avgComplianceScore,
        completed_training: completedTrainingCount,
        identified_gaps: Object.keys(weakAreas).length
      }
    });

  } catch (error) {
    console.error('Error generating learning path:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});