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


const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assignmentId } = await req.json();
    if (!assignmentId) {
      return Response.json({ error: 'assignmentId is required' }, { status: 400 });
    }

    const [assignment] = await base44.asServiceRole.entities.TrainingAssignment.filter({ id: assignmentId }, undefined, 5000);
    if (!assignment) {
      return Response.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // The assignee may start their own assignment; admins may start others' —
    // but an agency-scoped admin only within their own agency. A bare
    // isAdminUser() check let an agency_admin of one tenant flip another
    // tenant's assignment to in_progress and stamp a TrainingAuditLog for it.
    const isSuperAdmin = user.account_type === 'super_admin';
    // A user who is BOTH account_type agency_admin AND role admin with no
    // agency_name must NOT be promoted to platform-wide via the bare-role:admin
    // path — an agency_admin without an agency_name fails closed by design.
    const isPlatformAdmin = isSuperAdmin
      || (user.role === 'admin' && user.account_type !== 'agency_admin' && !String(user.agency_name || '').trim());
    const isAgencyScopedAdmin = !isPlatformAdmin
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    const isAssignee = assignment.assigned_to_user_id === user.email;
    if (!isAssignee && !isPlatformAdmin) {
      if (!isAgencyScopedAdmin) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      const agency = String(user.agency_name || '').trim();
      const [assignee] = agency
        ? await base44.asServiceRole.entities.User
            .filter({ email: assignment.assigned_to_user_id }, undefined, 5).catch(() => [])
        : [];
      if (!agency || !assignee || assignee.agency_name !== agency) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const now = new Date().toISOString();
    await base44.asServiceRole.entities.TrainingAssignment.update(assignmentId, {
      status: assignment.status === 'assigned' ? 'in_progress' : assignment.status,
      started_date: assignment.started_date || now,
      last_accessed: now,
      progress_percentage: Math.max(assignment.progress_percentage || 0, 5)
    });

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'assignment_modified',
      entity_type: 'TrainingAssignment',
      entity_id: assignmentId,
      reason: assignment.latest_attempt_number > 0 ? 'retaken' : 'started',
      after_json: { status: assignment.status === 'assigned' ? 'in_progress' : assignment.status, started_date: assignment.started_date || now },
      severity: 'info'
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('startTrainingAssignment failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});