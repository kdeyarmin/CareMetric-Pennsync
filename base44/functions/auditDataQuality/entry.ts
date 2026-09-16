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

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>

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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    // Fetch active data. Scope to the caller's agency when known so an
    // agency_admin cannot audit (and see names/ids for) every tenant.
    let [patients, users, visits, credentials] = await Promise.all([
      base44.asServiceRole.entities.Patient.filter({ status: 'active' }, '-created_date', 5000),
      base44.asServiceRole.entities.User.list('-created_date', 5000),
      base44.asServiceRole.entities.Visit.filter({ status: 'completed' }, '-visit_date', 5000),
      base44.asServiceRole.entities.PersonnelCredential.list('-expiration_date', 500),
    ]);

    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }
    if (user.account_type !== 'super_admin' && user.agency_name) {
      // Scope strictly to the caller's agency. The old filter also kept every
      // super_admin account, which then (a) surfaced platform-staff profiles in
      // every agency's user_issues and (b) seeded agencyEmails, so any patient
      // created by a super_admin (central intake / bulk import) counted as
      // in-agency for EVERY tenant and their name + gaps leaked cross-agency.
      users = (Array.isArray(users) ? users : []).filter((u) =>
        u.agency_name === user.agency_name
      );
      const agencyEmails = new Set(users.map((u) => u?.email).filter(Boolean));
      patients = (Array.isArray(patients) ? patients : []).filter((p) =>
        (p.created_by && agencyEmails.has(p.created_by))
        || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e)))
      );
      const patientIds = new Set(patients.map((p) => p.id));
      visits = (Array.isArray(visits) ? visits : []).filter((v) => patientIds.has(v.patient_id));
      credentials = (Array.isArray(credentials) ? credentials : []).filter((c) =>
        (c.agency_name && c.agency_name === user.agency_name)
        || (c.employee_email && agencyEmails.has(c.employee_email))
      );
    }

    const criticalFields = {
      patient: ['emergency_contact_name', 'emergency_contact_phone', 'physician_name', 'phone', 'date_of_birth'],
      user: ['phone', 'care_scope', 'credential_type'],
      visit: ['nurse_notes', 'homebound_justification', 'vital_signs']
    };

    // Audit patient records
    const patientIssues = patients.map(patient => {
      const missing = criticalFields.patient.filter(field => !patient[field] || patient[field] === '');
      const score = ((criticalFields.patient.length - missing.length) / criticalFields.patient.length * 100).toFixed(0);
      return {
        id: patient.id,
        name: `${patient.first_name} ${patient.last_name}`,
        missing_fields: missing,
        completeness_score: parseInt(score),
        critical: missing.length >= 3
      };
    }).filter(p => p.missing_fields.length > 0);

    // Audit user profiles
    const userIssues = users.map(user => {
      const missing = criticalFields.user.filter(field => !user[field] || user[field] === '');
      const score = ((criticalFields.user.length - missing.length) / criticalFields.user.length * 100).toFixed(0);
      return {
        email: user.email,
        name: user.full_name,
        missing_fields: missing,
        completeness_score: parseInt(score),
        critical: missing.length >= 2
      };
    }).filter(u => u.missing_fields.length > 0);

    // Audit visit documentation
    const visitIssues = visits.map(visit => {
      const missing = criticalFields.visit.filter(field => {
        if (field === 'nurse_notes') return !visit.nurse_notes || visit.nurse_notes.length < 100;
        const v = visit[field];
        // An empty object/array (e.g. vital_signs: {} or []) is truthy, so a bare
        // !v would count it as complete and inflate the score — treat it as missing.
        if (v && typeof v === 'object') return Object.keys(v).length === 0;
        return !v;
      });
      const score = ((criticalFields.visit.length - missing.length) / criticalFields.visit.length * 100).toFixed(0);
      return {
        id: visit.id,
        visit_date: visit.visit_date,
        patient_id: visit.patient_id,
        missing_fields: missing,
        completeness_score: parseInt(score),
        critical: missing.includes('homebound_justification')
      };
    }).filter(v => v.missing_fields.length > 0);

    // Check credential coverage
    const credentialCoverage = users.map(user => {
      const userCreds = credentials.filter(c => c.user_id === user.email);
      return {
        email: user.email,
        name: user.full_name,
        has_credentials: userCreds.length > 0,
        credential_count: userCreds.length,
        needs_upload: userCreds.length === 0
      };
    }).filter(u => u.needs_upload);

    // Guard against division by zero — a tenant/segment with no patients, users,
    // or completed visits would otherwise emit "NaN" strings into the dashboard.
    const pct = (count, total) => (total > 0 ? (count / total) * 100 : 0).toFixed(1);

    // Calculate summary statistics
    const summary = {
      total_patients: patients.length,
      patients_with_issues: patientIssues.length,
      patient_completeness: pct(patients.length - patientIssues.length, patients.length),

      total_users: users.length,
      users_with_issues: userIssues.length,
      user_completeness: pct(users.length - userIssues.length, users.length),

      total_visits: visits.length,
      visits_with_issues: visitIssues.length,
      visit_completeness: pct(visits.length - visitIssues.length, visits.length),

      users_without_credentials: credentialCoverage.length,
      credential_coverage: pct(users.length - credentialCoverage.length, users.length),
      
      critical_patient_issues: patientIssues.filter(p => p.critical).length,
      critical_user_issues: userIssues.filter(u => u.critical).length,
      critical_visit_issues: visitIssues.filter(v => v.critical).length,
    };

    return Response.json({
      summary,
      patient_issues: patientIssues.slice(0, 50),
      user_issues: userIssues.slice(0, 50),
      visit_issues: visitIssues.slice(0, 50),
      credential_coverage: credentialCoverage.slice(0, 50),
      audit_date: new Date().toISOString()
    });

  } catch (error) {
    console.error('Data quality audit error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});