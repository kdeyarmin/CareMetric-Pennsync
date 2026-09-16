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
    endpoint: 'deletePatientsMissingFirstName',
  }, { status: 503 });

  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!isAdminLike(user)) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }

    // Require an explicit confirm so a single accidental call can't irreversibly
    // wipe charts. Default is a DRY RUN that previews what would be archived.
    const body = await req.json().catch(() => ({}));
    const confirm = body?.confirm === true;

    // Fetch patients (bounded to the SDK's 5000/request max; omitting a limit
    // silently caps at the SDK default of 50). Re-run if more remain.
    let allPatients = await base44.asServiceRole.entities.Patient.list('-created_date', 5000);

    // Scope to the caller's agency so an agency_admin cannot archive another
    // tenant's stub charts. Super admins (or admins with no agency) keep the
    // platform-wide view. Orphan stubs (no care team) are platform-admin only —
    // including them for every agency let Agency A archive Agency B's unattributed PHI.
    const isAgencyScoped = user.account_type !== 'super_admin'
      && !!user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (isAgencyScoped) {
      const agencyUsers = await base44.asServiceRole.entities.User
        .filter({ agency_name: user.agency_name }, '-created_date', 5000)
        .catch(() => []);
      const agencyEmails = new Set(
        (Array.isArray(agencyUsers) ? agencyUsers : [])
          .map((u) => u?.email)
          .filter(Boolean)
      );
      allPatients = (Array.isArray(allPatients) ? allPatients : []).filter((p) =>
        (p.created_by && agencyEmails.has(p.created_by))
        || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e)))
      );
    }

    // Filter patients without first_name. Skip already-archived records —
    // re-archiving flipped e.g. a 'discharged' status to 'merged'.
    const candidates = allPatients.filter(p => (!p.first_name || p.first_name.trim() === '') && !p.is_archived);

    // Surface candidates that still carry identifying data — archiving one of
    // these is far more consequential than removing an empty stub, so the admin
    // should see them in the preview before confirming.
    const preview = candidates.map(p => ({
      id: p.id,
      last_name: p.last_name || null,
      mrn: p.medical_record_number || null,
      has_other_identifying_data: Boolean(
        (p.last_name && p.last_name.trim()) ||
        (p.medical_record_number && String(p.medical_record_number).trim()) ||
        p.date_of_birth
      ),
    }));

    if (candidates.length === 0) {
      return Response.json({
        success: true,
        message: 'No patients found without first name',
        archivedCount: 0,
      });
    }

    if (!confirm) {
      return Response.json({
        success: true,
        dryRun: true,
        message: `Dry run: ${candidates.length} patient(s) without a first name would be archived. Re-send with { confirm: true } to apply.`,
        wouldArchiveCount: candidates.length,
        candidates: preview,
      });
    }

    // Soft-archive (recoverable) rather than hard-delete + cascade. Mirrors
    // deduplicatePatients, which deliberately switched away from Patient.delete()
    // so a mistaken cleanup can be undone by clearing is_archived/status.
    let archivedCount = 0;
    const failed = [];
    const skippedFlagged = [];

    for (const patient of candidates) {
      // A candidate that still carries identifying data (last name, MRN, DOB)
      // may be a REAL patient hit by an import bug — never archive those in
      // the blanket confirm; they need individual review. Only bare stubs go.
      const flagged = Boolean(
        (patient.last_name && patient.last_name.trim()) ||
        (patient.medical_record_number && String(patient.medical_record_number).trim()) ||
        patient.date_of_birth
      );
      if (flagged && body?.include_flagged !== true) {
        skippedFlagged.push({ id: patient.id, last_name: patient.last_name || null });
        continue;
      }
      try {
        await base44.asServiceRole.entities.Patient.update(patient.id, {
          is_archived: true,
          // 'merged' is the soft-archive sentinel the Patient.status enum defines
          // (active|discharged|merged); the prior 'archived' value was not in the
          // enum and was silently dropped, leaving these stubs flagged 'active'.
          status: 'merged',
        });
        archivedCount++;
      } catch (error) {
        failed.push({
          id: patient.id,
          name: patient.last_name || 'Unknown',
          error: error.message,
        });
      }
    }

    return Response.json({
      success: true,
      message: `Archived ${archivedCount} patient(s) without first name`,
      archivedCount,
      failed,
      skippedFlagged,
      ...(skippedFlagged.length
        ? { note: `${skippedFlagged.length} candidate(s) with identifying data were skipped — review individually (re-send with { include_flagged: true } only after verifying each is a stub).` }
        : {}),
      totalProcessed: candidates.length,
    });
  } catch (error) {
    console.error('deletePatientsMissingFirstName failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
