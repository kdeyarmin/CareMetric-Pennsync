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
    endpoint: 'migrateExistingData',
  }, { status: 503 });

  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const results = {
      patients_updated: 0,
      visits_updated: 0,
      errors: []
    };

    // Migrate patients - add quality scores and defaults. Scope to the
    // caller's agency so an agency_admin cannot rewrite every tenant.
    let patients = await base44.asServiceRole.entities.Patient.filter({ status: 'active' }, '-created_date', 5000);
    let agencyEmails = null;
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }
    if (user.account_type !== 'super_admin' && user.agency_name) {
      const agencyUsers = await base44.asServiceRole.entities.User
        .filter({ agency_name: user.agency_name }, '-created_date', 5000)
        .catch(() => []);
      agencyEmails = new Set(
        (Array.isArray(agencyUsers) ? agencyUsers : []).map((u) => u?.email).filter(Boolean)
      );
      patients = (Array.isArray(patients) ? patients : []).filter((p) =>
        (p.created_by && agencyEmails.has(p.created_by))
        || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e)))
      );
    }
    
    for (const patient of patients) {
      const criticalFields = ['emergency_contact_name', 'emergency_contact_phone', 'physician_name', 'phone', 'date_of_birth', 'address'];
      const missing = criticalFields.filter(f => !patient[f] || patient[f] === '');
      const score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      const updates = {
        data_completeness_score: parseInt(score),
        missing_critical_fields: missing,
        secondary_diagnoses: patient.secondary_diagnoses || [],
        current_medications: patient.current_medications || [],
        past_medical_history: patient.past_medical_history || [],
        past_hospitalizations: patient.past_hospitalizations || [],
        goals_of_care: patient.goals_of_care || [],
        wounds: patient.wounds || [],
        enhanced_notes_history: patient.enhanced_notes_history || [],
        assigned_nurses: patient.assigned_nurses || []
      };

      try {
        await base44.asServiceRole.entities.Patient.update(patient.id, updates);
        results.patients_updated++;
      } catch (error) {
        results.errors.push({
          entity: 'Patient',
          id: patient.id,
          error: error.message
        });
      }
    }

    // Migrate visits - extract homebound justifications from notes
    let visits = await base44.asServiceRole.entities.Visit.filter({ status: 'completed' }, '-created_date', 5000);
    if (agencyEmails) {
      const patientIds = new Set(patients.map((p) => p.id));
      visits = (Array.isArray(visits) ? visits : []).filter((v) => patientIds.has(v.patient_id));
    }
    
    for (const visit of visits) {
      const updates = {
        ai_tags: visit.ai_tags || []
      };

      // Try to extract homebound justification from notes
      if (visit.nurse_notes && !visit.homebound_justification) {
        const homeboundMatch = visit.nurse_notes.match(/(homebound|cannot leave home|mobility limitation|requires assistance|confined to home)[^.]*\./gi);
        if (homeboundMatch && homeboundMatch.length > 0) {
          updates.homebound_justification = homeboundMatch[0];
          updates.homebound_status_verified = true;
        }
      }

      // Calculate compliance score
      const issues = [];
      if (!visit.homebound_justification && !updates.homebound_justification) {
        issues.push('Missing homebound justification');
      }
      if (!visit.nurse_notes || visit.nurse_notes.length < 100) {
        issues.push('Insufficient documentation');
      }
      
      const score = ((2 - issues.length) / 2 * 100).toFixed(0);
      updates.compliance_score = parseInt(score);
      updates.compliance_issues = issues;

      try {
        await base44.asServiceRole.entities.Visit.update(visit.id, updates);
        results.visits_updated++;
      } catch (error) {
        results.errors.push({
          entity: 'Visit',
          id: visit.id,
          error: error.message
        });
      }
    }

    return Response.json({
      success: true,
      summary: {
        patients_updated: results.patients_updated,
        visits_updated: results.visits_updated,
        total_errors: results.errors.length
      },
      errors: results.errors.slice(0, 20),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Data migration error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
