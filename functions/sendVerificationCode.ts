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

    if (!accountSid || !authToken || !twilioPhoneNumber) {
      return Response.json(
        { 
          error: 'Twilio credentials not configured',
          details: 'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER'
        },
        { status: 500 }
      );
    }

    // Validate Account SID format
    if (!accountSid.startsWith('AC')) {
      return Response.json(
        { 
          error: 'Invalid Twilio Account SID',
          details: 'TWILIO_ACCOUNT_SID must start with "AC" - please check your Twilio console for the correct Account SID'
        },
        { status: 500 }
      );
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    
    const formData = new URLSearchParams();
    formData.append('To', phone_number);
    formData.append('From', twilioPhoneNumber);
    formData.append('Body', `Your CareMetric AI verification code is: ${code}. This code expires in 10 minutes.`);

    console.log('Attempting Twilio request with Account SID:', accountSid?.substring(0, 10) + '...');
    
    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    });

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { raw: errorText };
      }
      console.error('Twilio error response:', errorData);
      return Response.json(
        { 
          error: 'Twilio authentication failed',
          details: `${errorData.message || errorText} (Status: ${twilioResponse.status})`,
          hint: 'Please verify your Twilio credentials are correct'
        },
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