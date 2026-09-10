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

// Returns APPROVED time-off requests for the whole team so the Team Calendar can
// show who is out — visible to every authenticated user. Privacy: only the
// employee name, type, dates and half-day flag are exposed (never the private
// reason, coverage notes, or reviewer notes). RLS on TimeOffRequest would
// otherwise limit a regular employee to their own rows, so this runs as the
// service role and hard-filters to status === "approved".
// Non-platform callers are further scoped to their own agency via employee
// email → User.agency_name (TimeOffRequest has no agency_name field).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    let approved = await base44.asServiceRole.entities.TimeOffRequest.filter(
      { status: 'approved' },
      '-start_date',
      1000
    );

    const isPlatformAdmin = user.account_type === 'super_admin'
      || (user.role === 'admin' && !user.agency_name);
    if (!isPlatformAdmin) {
      // Fail closed without agency membership — otherwise every authenticated
      // user receives every agency's approved leave via the service role.
      if (!user.agency_name) {
        return Response.json({ requests: [] });
      }
      const agencyUsers = await base44.asServiceRole.entities.User
        .list('-created_date', 5000)
        .catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name)
          .map((u) => u.email)
      );
      approved = (approved || []).filter((r) => agencyEmails.has(r.employee_email));
    }

    // Strip to the minimum fields needed to render the calendar.
    const sanitized = (approved || []).map((r) => ({
      id: r.id,
      employee_name: r.employee_name,
      // Intentionally NOT exposing the employee email here — this feed is visible
      // to every authenticated user, and the calendar renders on employee_name.
      // Returning the email leaked a full name->email directory of everyone
      // who's ever had approved time off. (Guarded by securityGuardrails.test.js.)
      request_type: r.request_type,
      start_date: r.start_date,
      end_date: r.end_date,
      half_day: r.half_day,
      status: 'approved',
    }));

    return Response.json({ requests: sanitized });
  } catch (error) {
    console.error('getApprovedTimeOff failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});