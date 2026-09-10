import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const normalizeClaimEmail = (value) => String(value || '').trim().toLowerCase();
async function loadTrustedTenantClaim(base44, profileId, email) {
  if (!profileId || !email) return null;
  let membership = null;
  try {
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId, status: 'active' },
      undefined,
      2,
    );
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (row
      && String(row.user_id || '').trim() === profileId
      && String(row.status || '') === 'active'
      && normalizeClaimEmail(row.user_email_normalized) === email
      && typeof row.agency_id === 'string'
      && row.agency_id.trim()) {
      membership = row;
    }
  } catch {
    membership = null;
  }
  if (!membership) return null;
  try {
    const agencyId = membership.agency_id.trim();
    const rows = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    const agencyName = String(agency?.agency_name || '').trim();
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(String(agency.status || ''))
      || !agencyName) {
      return null;
    }
    return { tenantRole: String(membership.tenant_role || ''), agencyId, agencyName };
  } catch {
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Protected built-in admins (the platform owner included) already hold
  // platform-level RLS authority, so their legacy self-scoping claims cannot
  // widen access; leave them exactly as the handler saw them before.
  if (profile.role === 'admin') return profile;
  const email = normalizeClaimEmail(profile.email);
  const profileId = typeof profile.id === 'string' ? profile.id.trim() : '';
  const tenant = await loadTrustedTenantClaim(base44, profileId, email);
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false };
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
