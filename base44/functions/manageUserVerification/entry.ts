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

// <<<BEGIN SHARED HELPER: outboundDeliveryGate — generated, edit base44/_shared/backendHelpers.mjs>>>
const OUTBOUND_DELIVERY_RELEASE_ENV = 'OUTBOUND_DELIVERY_RELEASE';
const OUTBOUND_DELIVERY_RELEASE_VALUE = 'enabled-v1';
function outboundDeliveryReleased() {
  return Deno.env.get(OUTBOUND_DELIVERY_RELEASE_ENV)
    === OUTBOUND_DELIVERY_RELEASE_VALUE;
}
function outboundDeliveryPausedResponse(channel = 'outbound') {
  return Response.json({
    error: 'Outbound delivery is disabled in this environment.',
    code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
    channel,
    retryable: false,
  }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
// <<<END SHARED HELPER: outboundDeliveryGate>>>

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>



Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await withTrustedClaims(base44, await base44.auth.me());

    if (!isAdminLike(currentUser)) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
    if (currentUser.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(currentUser);
      if (_agencyAdminGate) return _agencyAdminGate;
    }

    const { action, email, otp } = await req.json();

    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    // Agency admins may only resend/verify OTP for staff in their own agency.
    if (currentUser.account_type !== 'super_admin' && currentUser.agency_name && (currentUser.account_type === 'agency_admin' || currentUser.role === 'admin')) {
      if (!currentUser.agency_name) {
        return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
      }
      const targets = await base44.asServiceRole.entities.User
        .filter({ email }, undefined, 5)
        .catch(() => []);
      const target = targets?.[0];
      if (!target || target.agency_name !== currentUser.agency_name) {
        return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
      }
    }

    // NOTE: the debug 'inspect' / 'raw_resend' / 'raw_verify' passthrough actions
    // were removed — they dumped SDK internals and let an admin hit the raw
    // OTP verify/resend endpoints unthrottled. Use the supported actions below.

    if (action === 'resend') {
      if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('email');
      const result = await base44.auth.resendOtp(email);
      return Response.json({ success: true, action, result });
    }

    if (action === 'verify') {
      try {
        const result = await base44.auth.verifyOtp({ email, otpCode: otp });
        return Response.json({ success: true, action, result });
      } catch (error) {
        // Generic — don't leak the SDK/OTP error internals to the client.
        return Response.json({
          error: 'OTP verification failed',
          status: error?.status || 500
        }, { status: error?.status || 500 });
      }
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('manageUserVerification error:', error);
    // Generic message — don't serialize/leak the full error object to the client.
    return Response.json({ error: 'Verification request failed' }, { status: 500 });
  }
});
