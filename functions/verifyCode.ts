import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const body = await req.json();
    const { user_email, code } = body;

    if (!user_email || !code) {
      console.error('[verifyCode] Missing required fields', { user_email: !!user_email, code: !!code });
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
      console.warn('[verifyCode] No verification code found for user:', user_email);
      return Response.json(
        { error: 'No verification code found. Please request a new code.' },
        { status: 404 }
      );
    }

    const verificationRecord = verificationCodes[0];

    // Check if expired
    if (new Date(verificationRecord.expires_at) < new Date()) {
      console.warn('[verifyCode] Verification code expired for user:', user_email);
      await base44.asServiceRole.entities.VerificationCode.delete(verificationRecord.id);
      return Response.json(
        { error: 'Verification code has expired. Please request a new code.' },
        { status: 400 }
      );
    }

    // Check attempts
    if (verificationRecord.attempts >= 5) {
      console.warn('[verifyCode] Too many failed attempts for user:', user_email);
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
      
      console.warn('[verifyCode] Invalid code attempt for user:', user_email, 'attempts:', verificationRecord.attempts + 1);
      
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
    const oldCodes = await base44.asServiceRole.entities.VerificationCode.filter({
      user_email: user_email,
      verified: false
    });
    
    for (const old of oldCodes) {
      if (old.id !== verificationRecord.id) {
        await base44.asServiceRole.entities.VerificationCode.delete(old.id);
      }
    }

    console.log('[verifyCode] Verification successful for user:', user_email);

    return Response.json({
      success: true,
      message: 'Verification successful'
    });

  } catch (error) {
    console.error('[verifyCode] Error:', {
      message: error.message,
      stack: error.stack
    });
    return Response.json(
      { error: 'Failed to verify code', details: error.message },
      { status: 500 }
    );
  }
});