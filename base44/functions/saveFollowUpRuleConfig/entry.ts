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


// saveFollowUpRuleConfig — the ONLY write path for the agency's follow-up
// review configuration (mirrors savePDGMRateConfig). The FollowUpRuleConfig
// entity is service-role-write only, so browsers can't write it directly;
// this function gates on admin and sanitizes the payload shape.

const SEVERITIES = new Set(['critical', 'high', 'medium']);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me().catch(() => null));
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    const isAdmin = user?.role === 'admin';
    if (!user || !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    // Guard against empty payloads: an accidental invocation with no body
    // would wipe the agency's existing config with empty defaults.
    if (!body || Object.keys(body).length === 0) {
      return Response.json({ error: 'Request body is required (disabled_rules, severity_overrides, or custom_items)' }, { status: 400 });
    }

    const disabled_rules = Array.isArray(body.disabled_rules)
      ? body.disabled_rules.filter((r: unknown) => typeof r === 'string').slice(0, 100)
      : [];

    const severity_overrides: Record<string, string> = {};
    if (body.severity_overrides && typeof body.severity_overrides === 'object') {
      for (const [key, val] of Object.entries(body.severity_overrides)) {
        if (typeof key === 'string' && SEVERITIES.has(String(val))) {
          severity_overrides[key] = String(val);
        }
      }
    }

    const custom_items = Array.isArray(body.custom_items)
      ? body.custom_items
          .filter((c: Record<string, unknown>) => c && typeof c.title === 'string' && c.title.trim() && typeof c.question === 'string' && c.question.trim())
          .slice(0, 50)
          .map((c: Record<string, unknown>) => ({
            title: String(c.title).slice(0, 200),
            question: String(c.question).slice(0, 1000),
            category: c.category === 'reimbursement' ? 'reimbursement' : 'compliance',
            severity: SEVERITIES.has(String(c.severity)) ? String(c.severity) : 'medium',
            why: String(c.why || '').slice(0, 1000),
            citation: String(c.citation || '').slice(0, 200),
            impact: String(c.impact || '').slice(0, 300),
            hint: String(c.hint || '').slice(0, 300),
            response_type: c.response_type === 'document' ? 'document' : 'text',
          }))
      : [];

    const agencyName = String(user.agency_name || '').trim();
    const isAgencyScoped = user.account_type !== 'super_admin'
      && agencyName
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    // Only agency_admin accounts require agency_name. Bare role:admin with no
    // agency is platform-wide and may manage the unscoped legacy config row.
    // (The prior `isAgencyScoped && !agencyName` check was dead — isAgencyScoped
    // already requires a truthy agencyName.)
    if (user.account_type === 'agency_admin' && !agencyName) {
      return Response.json({ error: 'Forbidden: agency_name is required' }, { status: 403 });
    }

    const payload = {
      disabled_rules,
      severity_overrides,
      custom_items,
      updated_by_email: user.email,
      ...(agencyName ? { agency_name: agencyName } : {}),
    };

    // Prefer the caller's agency row; never overwrite another tenant's newest row.
    let existing = [];
    if (agencyName) {
      existing = await base44.asServiceRole.entities.FollowUpRuleConfig
        .filter({ agency_name: agencyName }, '-created_date', 1).catch(() => []);
    }
    if (!existing?.length && !isAgencyScoped) {
      // Only touch a legacy unscoped row when it is unambiguously the only
      // candidate — never clobber another tenant's newest row.
      const newest = await base44.asServiceRole.entities.FollowUpRuleConfig
        .list('-created_date', 5).catch(() => []);
      const legacy = (newest || []).filter((r) => !String(r?.agency_name || '').trim());
      if (legacy.length === 1) existing = legacy;
      else if ((newest || []).length === 1 && !String(newest[0]?.agency_name || '').trim()) {
        existing = newest;
      } else {
        existing = [];
      }
    }
    const current = existing && existing[0];
    const saved = current
      ? await base44.asServiceRole.entities.FollowUpRuleConfig.update(current.id, payload)
      : await base44.asServiceRole.entities.FollowUpRuleConfig.create(payload);

    return Response.json({ success: true, id: saved.id });
  } catch (error) {
    console.error('saveFollowUpRuleConfig error:', error);
    return Response.json({ error: 'Failed to save follow-up rule configuration' }, { status: 500 });
  }
});
