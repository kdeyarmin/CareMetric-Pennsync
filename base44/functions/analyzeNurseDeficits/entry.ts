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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { nurseEmail, daysPeriod = 30 } = await req.json();
    // Only admin-like callers may analyze another nurse's deficits/PHI, and
    // only within their agency.
    if (nurseEmail && nurseEmail !== user.email) {
      const isAdminLike = user.role === 'admin'
        || user.account_type === 'agency_admin'
        || user.account_type === 'super_admin';
      if (!isAdminLike) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }
    if (user.account_type !== 'super_admin' && user.agency_name) {
        const [target] = await base44.asServiceRole.entities.User
          .filter({ email: nurseEmail }, '-created_date', 1).catch(() => []);
        if (!target?.agency_name || target.agency_name !== user.agency_name) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }
    const emailToAnalyze = nurseEmail || user.email;

    // Fetch AI suggestions for this nurse newest-first with an explicit high limit.
    // Without a sort/limit the SDK returns only the default first page (~50 rows,
    // not newest-first), so a nurse with many older recommendations got an empty
    // recent window and a blank deficit report.
    const suggestions = await base44.asServiceRole.entities.TrainingRecommendation.filter(
      { nurse_email: emailToAnalyze },
      '-created_date',
      1000
    );

    // Filter by date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysPeriod);
    
    const recentSuggestions = suggestions.filter(s => 
      new Date(s.created_date) >= cutoffDate
    );

    if (recentSuggestions.length === 0) {
      return Response.json({
        nurseEmail: emailToAnalyze,
        totalSuggestions: 0,
        deficits: [],
        patterns: [],
        recommendations: [],
        strengths: []
      });
    }

    // Pattern Analysis
    const categoryFrequency = {};
    const elementFrequency = {};
    const sourceFrequency = {};
    const severityDistribution = { critical: 0, high: 0, medium: 0, low: 0 };
    const timelineData = {};
    const patientSpecificPatterns = {};

    recentSuggestions.forEach(sugg => {
      // Category frequency
      categoryFrequency[sugg.recommendation_type] = (categoryFrequency[sugg.recommendation_type] || 0) + 1;

      // Element frequency (from context_data)
      if (sugg.context_data?.element) {
        elementFrequency[sugg.context_data.element] = (elementFrequency[sugg.context_data.element] || 0) + 1;
      }

      // Source frequency
      sourceFrequency[sugg.source] = (sourceFrequency[sugg.source] || 0) + 1;

      // Severity distribution
      if (sugg.severity) {
        severityDistribution[sugg.severity]++;
      }

      // Timeline (by week)
      const weekKey = new Date(sugg.created_date).toISOString().split('T')[0].substring(0, 7); // YYYY-MM
      timelineData[weekKey] = (timelineData[weekKey] || 0) + 1;

      // Patient-specific patterns
      if (sugg.patient_id) {
        patientSpecificPatterns[sugg.patient_id] = (patientSpecificPatterns[sugg.patient_id] || 0) + 1;
      }
    });

    // Identify deficits (categories/elements with high frequency)
    const categoryDeficits = Object.entries(categoryFrequency)
      .filter(([_, count]) => count >= 3)
      .map(([category, count]) => ({
        type: 'category',
        name: category,
        count,
        severity: count >= 10 ? 'critical' : count >= 6 ? 'high' : 'medium',
        percentage: Math.round((count / recentSuggestions.length) * 100),
        examples: recentSuggestions
          .filter(s => s.recommendation_type === category)
          .slice(0, 3)
          .map(s => ({
            text: s.recommendation_text,
            source: s.source,
            date: s.created_date,
            element: s.context_data?.element
          }))
      }))
      .sort((a, b) => b.count - a.count);

    const elementDeficits = Object.entries(elementFrequency)
      .filter(([_, count]) => count >= 2)
      .map(([element, count]) => ({
        type: 'element',
        name: element,
        count,
        severity: count >= 5 ? 'high' : 'medium',
        percentage: Math.round((count / recentSuggestions.length) * 100),
        examples: recentSuggestions
          .filter(s => s.context_data?.element === element)
          .slice(0, 2)
          .map(s => ({
            text: s.recommendation_text,
            source: s.source,
            date: s.created_date
          }))
      }))
      .sort((a, b) => b.count - a.count);

    // Combine deficits
    const allDeficits = [...categoryDeficits, ...elementDeficits];

    // Identify patterns
    const patterns = [];

    // Pattern: Consistent issues with specific source
    Object.entries(sourceFrequency).forEach(([source, count]) => {
      if (count >= 5) {
        patterns.push({
          type: 'source_dependency',
          description: `High reliance on ${source} (${count} suggestions)`,
          implication: 'May indicate foundational skill gap requiring comprehensive training',
          count
        });
      }
    });

    // Pattern: High severity issues
    if (severityDistribution.critical + severityDistribution.high > recentSuggestions.length * 0.3) {
      patterns.push({
        type: 'high_severity',
        description: 'High proportion of critical/high severity suggestions',
        implication: 'Urgent training needed to prevent compliance issues',
        count: severityDistribution.critical + severityDistribution.high
      });
    }

    // Pattern: Specific element repetition
    const topElement = Object.entries(elementFrequency).sort((a, b) => b[1] - a[1])[0];
    if (topElement && topElement[1] >= 4) {
      patterns.push({
        type: 'element_repetition',
        description: `Recurring issue with "${topElement[0]}" (${topElement[1]} times)`,
        implication: 'Targeted practice on this specific element recommended',
        count: topElement[1]
      });
    }

    // Training recommendations based on deficits
    const trainingMap = {
      'documentation': {
        scenarios: ['homebound_justification', 'skilled_need'],
        quizzes: ['medicare_cop', 'oasis'],
        priority: 1
      },
      'clinical': {
        scenarios: ['vital_signs', 'skilled_need'],
        quizzes: ['skilled_need', 'oasis'],
        priority: 2
      },
      'communication': {
        scenarios: ['patient_response'],
        quizzes: ['homebound', 'safety'],
        priority: 3
      },
      'compliance': {
        scenarios: ['homebound_justification', 'skilled_need', 'patient_response'],
        quizzes: ['medicare_cop', 'oasis', 'homebound'],
        priority: 1
      },
      'safety': {
        scenarios: ['vital_signs', 'patient_response'],
        quizzes: ['safety', 'infection_control'],
        priority: 2
      }
    };

    const recommendations = categoryDeficits.map(deficit => ({
      category: deficit.name,
      severity: deficit.severity,
      count: deficit.count,
      percentage: deficit.percentage,
      suggestedScenarios: trainingMap[deficit.name]?.scenarios || [],
      suggestedQuizzes: trainingMap[deficit.name]?.quizzes || [],
      priority: trainingMap[deficit.name]?.priority || 3,
      rationale: `Based on ${deficit.count} AI suggestions in ${deficit.name}, focused training is recommended`
    })).sort((a, b) => a.priority - b.priority);

    // Identify strengths (categories with low suggestion frequency)
    const allCategories = ['documentation', 'clinical', 'compliance', 'safety', 'communication', 'technology'];
    const strengths = allCategories
      .filter(cat => !categoryFrequency[cat] || categoryFrequency[cat] < 2)
      .map(cat => ({
        category: cat,
        description: `Strong ${cat} skills with minimal AI assistance needed`
      }));

    return Response.json({
      nurseEmail: emailToAnalyze,
      analysisPeriod: `${daysPeriod} days`,
      totalSuggestions: recentSuggestions.length,
      deficits: allDeficits,
      patterns,
      recommendations,
      strengths,
      analytics: {
        categoryBreakdown: categoryFrequency,
        elementBreakdown: elementFrequency,
        sourceBreakdown: sourceFrequency,
        severityDistribution,
        timeline: timelineData,
        patientSpecificCount: Object.keys(patientSpecificPatterns).length
      },
      rawSuggestions: recentSuggestions.slice(0, 50) // Include raw data for detailed view
    });

  } catch (error) {
    console.error('analyzeNurseDeficits failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});