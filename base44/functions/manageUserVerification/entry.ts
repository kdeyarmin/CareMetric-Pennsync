import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
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
    const currentUser = await base44.auth.me();

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