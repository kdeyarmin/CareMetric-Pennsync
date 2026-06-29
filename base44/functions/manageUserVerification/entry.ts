import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me();

    if (!currentUser || currentUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { action, email, otp } = await req.json();

    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
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