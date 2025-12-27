import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate user first
    const user = await base44.auth.me();
    if (!user) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { phone_number, user_email } = await req.json();

    if (!phone_number || !user_email) {
      return Response.json(
        { error: 'Phone number and user email are required' },
        { status: 400 }
      );
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiration to 10 minutes from now
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Delete any existing unverified codes for this user
    const existingCodes = await base44.asServiceRole.entities.VerificationCode.filter({
      user_email: user_email,
      verified: false
    });
    
    for (const existing of existingCodes) {
      await base44.asServiceRole.entities.VerificationCode.delete(existing.id);
    }

    // Store verification code
    await base44.asServiceRole.entities.VerificationCode.create({
      user_email: user_email,
      phone_number: phone_number,
      code: code,
      expires_at: expiresAt,
      verified: false,
      attempts: 0
    });

    // Send SMS via Twilio
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    
    const formData = new URLSearchParams();
    formData.append('To', phone_number);
    formData.append('From', twilioPhoneNumber);
    formData.append('Body', `Your CareMetric AI verification code is: ${code}. This code expires in 10 minutes.`);

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    });

    if (!twilioResponse.ok) {
      const errorData = await twilioResponse.json();
      console.error('Twilio error:', errorData);
      return Response.json(
        { error: 'Failed to send verification code' },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      message: 'Verification code sent successfully'
    });

  } catch (error) {
    console.error('Send verification code error:', error);
    return Response.json(
      { error: 'Failed to send verification code', details: error.message },
      { status: 500 }
    );
  }
});