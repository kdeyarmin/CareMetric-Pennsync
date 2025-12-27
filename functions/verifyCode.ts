import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { user_email, code } = await req.json();

    if (!user_email || !code) {
      return Response.json(
        { error: 'User email and code are required' },
        { status: 400 }
      );
    }

    // Find the verification code
    const verificationCodes = await base44.asServiceRole.entities.VerificationCode.filter({
      user_email: user_email,
      verified: false
    }, '-created_date', 1);

    if (verificationCodes.length === 0) {
      return Response.json(
        { error: 'No verification code found. Please request a new code.' },
        { status: 404 }
      );
    }

    const verificationRecord = verificationCodes[0];

    // Check if expired
    if (new Date(verificationRecord.expires_at) < new Date()) {
      await base44.asServiceRole.entities.VerificationCode.delete(verificationRecord.id);
      return Response.json(
        { error: 'Verification code has expired. Please request a new code.' },
        { status: 400 }
      );
    }

    // Check attempts
    if (verificationRecord.attempts >= 5) {
      await base44.asServiceRole.entities.VerificationCode.delete(verificationRecord.id);
      return Response.json(
        { error: 'Too many failed attempts. Please request a new code.' },
        { status: 400 }
      );
    }

    // Check if code matches
    if (verificationRecord.code !== code) {
      // Increment attempts
      await base44.asServiceRole.entities.VerificationCode.update(verificationRecord.id, {
        attempts: verificationRecord.attempts + 1
      });
      
      return Response.json(
        { 
          error: 'Invalid verification code',
          attempts_remaining: 5 - (verificationRecord.attempts + 1)
        },
        { status: 400 }
      );
    }

    // Mark as verified
    await base44.asServiceRole.entities.VerificationCode.update(verificationRecord.id, {
      verified: true
    });

    // Clean up old verification codes for this user
    await base44.asServiceRole.entities.VerificationCode.deleteMany({
      user_email: user_email,
      verified: false
    });

    return Response.json({
      success: true,
      message: 'Verification successful'
    });

  } catch (error) {
    console.error('Verify code error:', error);
    return Response.json(
      { error: 'Failed to verify code' },
      { status: 500 }
    );
  }
});