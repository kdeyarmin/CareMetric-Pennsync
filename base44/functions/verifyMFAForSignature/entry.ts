import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { verification_code, phone_number } = payload;

    if (!verification_code) {
      return Response.json({
        error: 'Verification code required'
      }, { status: 400 });
    }

    // Verify the code using existing verification system
    const verifications = await base44.asServiceRole.entities.VerificationCode.filter({
      phone_number: phone_number || user.phone_number,
      code: verification_code,
      verified: false,
      purpose: 'authentication'
    });

    if (verifications.length === 0) {
      return Response.json({
        success: false,
        error: 'Invalid or expired verification code'
      }, { status: 400 });
    }

    const verification = verifications[0];

    // Check if code is expired (10 minutes)
    const expiresAt = new Date(verification.expires_at);
    if (expiresAt < new Date()) {
      return Response.json({
        success: false,
        error: 'Verification code has expired'
      }, { status: 400 });
    }

    // Mark as verified
    await base44.asServiceRole.entities.VerificationCode.update(verification.id, {
      verified: true,
      verified_at: new Date().toISOString()
    });

    // Log security event
    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'mfa_verified_for_signature',
      details: {
        phone_number: phone_number || user.phone_number,
        verified_at: new Date().toISOString()
      },
      ip_address: req.headers.get('x-forwarded-for') || 'unknown',
      user_agent: req.headers.get('user-agent') || 'unknown'
    }).catch(err => console.error('Failed to log security event:', err));

    return Response.json({
      success: true,
      verified: true,
      message: 'MFA verified successfully'
    });

  } catch (error) {
    console.error('Error verifying MFA:', error);
    return Response.json({
      error: 'Failed to verify MFA',
      details: error.message
    }, { status: 500 });
  }
});