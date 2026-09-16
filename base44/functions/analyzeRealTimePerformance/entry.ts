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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { nurse_email, training_module_id, session_id } = await req.json();
    // Only admin-like callers may analyze another nurse's real-time
    // performance metrics, and only within their agency.
    if (nurse_email && nurse_email !== user.email) {
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
          .filter({ email: nurse_email }, '-created_date', 1).catch(() => []);
        if (!target?.agency_name || target.agency_name !== user.agency_name) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }
    const targetEmail = nurse_email || user.email;

    // Fetch real-time metrics for this session
    const metrics = await base44.asServiceRole.entities.RealTimePerformanceMetric.filter({
      nurse_email: targetEmail,
      training_module_id,
      session_id
    }, undefined, 5000);

    if (metrics.length === 0) {
      return Response.json({
        recommendation: 'continue',
        suggested_difficulty: 'medium',
        insights: []
      });
    }

    // Analyze performance patterns
    const correctCount = metrics.filter(m => m.is_correct).length;
    const totalCount = metrics.filter(m => m.is_correct !== undefined).length;
    const accuracyRate = totalCount > 0 ? (correctCount / totalCount) * 100 : 0;

    const avgTime = metrics.length > 0
      ? metrics.reduce((sum, m) => sum + (m.time_spent_seconds || 0), 0) / metrics.length
      : 0;

    const difficultyPerformance = {
      easy: { correct: 0, total: 0 },
      medium: { correct: 0, total: 0 },
      hard: { correct: 0, total: 0 }
    };

    metrics.forEach(m => {
      // Guard on bucket membership, not just truthiness: an out-of-enum
      // difficulty (e.g. "expert") would index to undefined and throw on .total++.
      const bucket = difficultyPerformance[m.question_difficulty];
      if (bucket && m.is_correct !== undefined) {
        bucket.total++;
        if (m.is_correct) {
          bucket.correct++;
        }
      }
    });

    // Calculate accuracy by difficulty
    const easyAccuracy = difficultyPerformance.easy.total > 0
      ? (difficultyPerformance.easy.correct / difficultyPerformance.easy.total) * 100
      : 0;
    const mediumAccuracy = difficultyPerformance.medium.total > 0
      ? (difficultyPerformance.medium.correct / difficultyPerformance.medium.total) * 100
      : 0;
    const hardAccuracy = difficultyPerformance.hard.total > 0
      ? (difficultyPerformance.hard.correct / difficultyPerformance.hard.total) * 100
      : 0;

    // AI-driven recommendation
    let suggestedDifficulty = 'medium';
    let recommendation = 'continue';
    const insights = [];

    if (accuracyRate >= 90 && easyAccuracy >= 90) {
      suggestedDifficulty = 'hard';
      recommendation = 'increase_difficulty';
      insights.push('Excellent performance! Ready for more challenging content.');
    } else if (accuracyRate >= 80 && mediumAccuracy >= 80) {
      suggestedDifficulty = 'medium';
      recommendation = 'continue';
      insights.push('Great progress! Continue at this level.');
    } else if (accuracyRate < 60) {
      suggestedDifficulty = 'easy';
      recommendation = 'decrease_difficulty';
      insights.push('Struggling with current difficulty. Switching to easier content.');
    }

    if (avgTime > 60) {
      insights.push('Taking more time to answer - consider providing additional hints.');
    }

    const hintsUsed = metrics.filter(m => m.metric_type === 'hint_usage').length;
    if (hintsUsed > 3) {
      insights.push('Frequent hint usage detected - may need foundational review.');
    }

    // Use AI to generate personalized insights
    const prompt = `
Analyze this nurse's real-time training performance and provide adaptive recommendations:

Performance Data:
- Overall Accuracy: ${accuracyRate.toFixed(1)}%
- Easy Questions: ${easyAccuracy.toFixed(1)}% (${difficultyPerformance.easy.total} questions)
- Medium Questions: ${mediumAccuracy.toFixed(1)}% (${difficultyPerformance.medium.total} questions)
- Hard Questions: ${hardAccuracy.toFixed(1)}% (${difficultyPerformance.hard.total} questions)
- Average Time per Question: ${avgTime.toFixed(1)}s
- Hints Used: ${hintsUsed}

Provide:
1. Specific areas of strength
2. Areas needing improvement
3. Recommended next steps
4. Suggested difficulty level
5. Motivational message

Return ONLY valid JSON, no prose or code fences, with this shape:
{"strengths":[""],"improvement_areas":[""],"next_steps":[""],"recommended_difficulty":"","motivation":""}
`;

    const aiResponse = parseLLMJson(await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt
    })) || {};

    return Response.json({
      recommendation,
      suggested_difficulty: aiResponse.recommended_difficulty || suggestedDifficulty,
      accuracy_rate: accuracyRate,
      performance_by_difficulty: {
        easy: easyAccuracy,
        medium: mediumAccuracy,
        hard: hardAccuracy
      },
      avg_time_seconds: avgTime,
      hints_used: hintsUsed,
      insights: [...insights, ...(aiResponse.strengths || [])],
      improvement_areas: aiResponse.improvement_areas || [],
      next_steps: aiResponse.next_steps || [],
      motivation_message: aiResponse.motivation || ''
    });

  } catch (error) {
    console.error('Error analyzing performance:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});