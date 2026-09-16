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


// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>

Deno.serve(async (req) => {
  // SECURITY CONTAINMENT: keep the legacy bulk Patient writer unreachable
  // until an immutable tenant-authorized, atomic replacement is available.
  return Response.json({
    error: 'Legacy Patient service-role writer is temporarily unavailable',
    code: 'legacy_patient_service_writer_paused',
    reason: 'immutable_tenant_authorization_and_atomic_write_broker_required',
    endpoint: 'enforceDataCompleteness',
  }, { status: 503 });

  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }

    const payload = await req.json();
    const { entity_type, entity_id } = payload;

    if (!entity_type || !entity_id) {
      return Response.json({ error: 'Missing entity_type or entity_id' }, { status: 400 });
    }

    let entity;
    let criticalFields = [];
    let score = 0;
    let missing = [];

    if (entity_type === 'Patient') {
      entity = await base44.asServiceRole.entities.Patient.get(entity_id);
      if (!entity) return Response.json({ error: 'Patient not found' }, { status: 404 });
      // Agency-scope: an agency_admin must not rewrite quality fields on another
      // tenant's chart via a guessed entity_id.
      if (user.account_type !== 'super_admin' && user.agency_name) {
        const agencyUsers = await base44.asServiceRole.entities.User
          .filter({ agency_name: user.agency_name }, '-created_date', 5000)
          .catch(() => []);
        const agencyEmails = new Set(
          (Array.isArray(agencyUsers) ? agencyUsers : []).map((u) => u?.email).filter(Boolean)
        );
        const inAgency = (entity.created_by && agencyEmails.has(entity.created_by))
          || (Array.isArray(entity.assigned_nurses)
            && entity.assigned_nurses.some((e) => agencyEmails.has(e)));
        if (!inAgency) {
          return Response.json({ error: 'Forbidden: patient is outside your agency' }, { status: 403 });
        }
      }
      criticalFields = [
        'first_name', 'last_name', 'date_of_birth', 'phone', 'address',
        'emergency_contact_name', 'emergency_contact_phone', 
        'physician_name', 'primary_diagnosis'
      ];
      
      missing = criticalFields.filter(field => !entity[field] || entity[field] === '');
      score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      // Update patient record with quality metrics
      await base44.asServiceRole.entities.Patient.update(entity_id, {
        data_completeness_score: parseInt(score),
        missing_critical_fields: missing
      });

    } else if (entity_type === 'User') {
      entity = await base44.asServiceRole.entities.User.get(entity_id);
      if (!entity) return Response.json({ error: 'User not found' }, { status: 404 });
      // Agency-scoped admins require a matching non-empty target agency —
      // empty target agency previously bypassed the check (`entity.agency_name &&`).
      const isSuperAdmin = user.account_type === 'super_admin';
      const isAgencyScopedAdmin = user.account_type === 'agency_admin'
        || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
      if (isAgencyScopedAdmin
        && entity.account_type !== 'super_admin'
        && (!entity.agency_name || entity.agency_name !== user.agency_name)) {
        return Response.json({ error: 'Forbidden: user is outside your agency' }, { status: 403 });
      }
      criticalFields = [
        'credential_type', 'phone', 'care_scope', 'license_number'
      ];
      
      missing = criticalFields.filter(field => !entity[field] || entity[field] === '');
      score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      // Update user record with quality metrics
      await base44.asServiceRole.entities.User.update(entity_id, {
        profile_completeness_score: parseInt(score)
      });

    } else if (entity_type === 'Visit') {
      entity = await base44.asServiceRole.entities.Visit.get(entity_id);
      if (!entity) return Response.json({ error: 'Visit not found' }, { status: 404 });
      if (user.account_type !== 'super_admin' && user.agency_name && entity.patient_id) {
        const [visitPatient] = await base44.asServiceRole.entities.Patient
          .filter({ id: entity.patient_id }, '', 1).catch(() => []);
        const agencyUsers = await base44.asServiceRole.entities.User
          .filter({ agency_name: user.agency_name }, '-created_date', 5000)
          .catch(() => []);
        const agencyEmails = new Set(
          (Array.isArray(agencyUsers) ? agencyUsers : []).map((u) => u?.email).filter(Boolean)
        );
        const inAgency = visitPatient
          && ((visitPatient.created_by && agencyEmails.has(visitPatient.created_by))
            || (Array.isArray(visitPatient.assigned_nurses)
              && visitPatient.assigned_nurses.some((e) => agencyEmails.has(e))));
        if (!inAgency) {
          return Response.json({ error: 'Forbidden: visit is outside your agency' }, { status: 403 });
        }
      }
      criticalFields = [
        'nurse_notes', 'homebound_justification', 'vital_signs', 'skilled_intervention_documented'
      ];
      
      missing = criticalFields.filter(field => {
        if (field === 'nurse_notes') return !entity.nurse_notes || entity.nurse_notes.length < 100;
        return !entity[field];
      });
      score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      const complianceIssues = [];
      if (!entity.homebound_justification) complianceIssues.push('Missing homebound justification');
      if (!entity.skilled_intervention_documented) complianceIssues.push('Skilled intervention not documented');
      if (!entity.nurse_notes || entity.nurse_notes.length < 100) complianceIssues.push('Insufficient documentation');

      // Update visit record with compliance metrics
      await base44.asServiceRole.entities.Visit.update(entity_id, {
        compliance_score: parseInt(score),
        compliance_issues: complianceIssues
      });
    } else {
      // Unrecognized entity_type would otherwise fall through to a bogus
      // "success" with completeness_score 0; reject it explicitly.
      return Response.json({ error: `Unsupported entity_type: ${entity_type}` }, { status: 400 });
    }

    return Response.json({
      entity_type,
      entity_id,
      completeness_score: parseInt(score),
      missing_fields: missing,
      critical: missing.length >= 3,
      message: `Data quality metrics updated for ${entity_type}`
    });

  } catch (error) {
    console.error('Data completeness enforcement error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
