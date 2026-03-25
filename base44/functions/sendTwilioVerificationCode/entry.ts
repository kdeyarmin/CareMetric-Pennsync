import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const { phone_number, purpose } = await req.json();

    if (!phone_number) {
      return Response.json({ error: 'Phone number is required' }, { status: 400 });
    }

    // Generate 6-digit verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store verification code in database
    const base44 = createClientFromRequest(req);
    
    // Delete any existing codes for this phone number
    const existingCodes = await base44.asServiceRole.entities.VerificationCode.filter({ 
      phone_number 
    });
    
    for (const existingCode of existingCodes) {
      await base44.asServiceRole.entities.VerificationCode.delete(existingCode.id);
    }

    // Create new verification code (expires in 10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await base44.asServiceRole.entities.VerificationCode.create({
      phone_number,
      code,
      purpose: purpose || 'authentication',
      expires_at: expiresAt,
      verified: false
    });

    // Send SMS via Twilio
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!accountSid || !authToken || !twilioPhone) {
      console.error('Missing Twilio credentials');
      return Response.json({ error: 'SMS service not configured' }, { status: 500 });
    }

    const messageBody = `Your CareMetric AI verification code is: ${code}. Valid for 10 minutes.`;

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        To: phone_number,
        From: twilioPhone,
        Body: messageBody
      })
    });

    if (!twilioResponse.ok) {
      const error = await twilioResponse.text();
      console.error('Twilio error:', error);
      return Response.json({ error: 'Failed to send verification code' }, { status: 500 });
    }

    return Response.json({ 
      success: true, 
      message: 'Verification code sent successfully',
      expires_in_minutes: 10
    });

  } catch (error) {
    console.error('Error sending verification code:', error);
    return Response.json({ 
      error: error.message || 'Internal server error' 
    }, { status: 500 });
  }
});