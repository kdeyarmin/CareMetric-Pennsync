import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const { phone_number, code } = await req.json();

    if (!phone_number || !code) {
      return Response.json({ 
        error: 'Phone number and code are required' 
      }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    
    // Find verification code
    const codes = await base44.asServiceRole.entities.VerificationCode.filter({ 
      phone_number,
      code,
      verified: false
    });

    if (codes.length === 0) {
      return Response.json({ 
        success: false,
        error: 'Invalid verification code' 
      }, { status: 400 });
    }

    const verificationRecord = codes[0];

    // Check if expired
    const expiresAt = new Date(verificationRecord.expires_at);
    if (expiresAt < new Date()) {
      // Delete expired code
      await base44.asServiceRole.entities.VerificationCode.delete(verificationRecord.id);
      return Response.json({ 
        success: false,
        error: 'Verification code has expired' 
      }, { status: 400 });
    }

    // Mark as verified
    await base44.asServiceRole.entities.VerificationCode.update(verificationRecord.id, {
      verified: true,
      verified_at: new Date().toISOString()
    });

    return Response.json({ 
      success: true,
      message: 'Phone number verified successfully'
    });

  } catch (error) {
    console.error('Error verifying code:', error);
    return Response.json({ 
      error: error.message || 'Internal server error' 
    }, { status: 500 });
  }
});