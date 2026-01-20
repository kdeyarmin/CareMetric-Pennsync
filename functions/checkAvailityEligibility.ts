import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      firstName,
      lastName,
      dateOfBirth,
      memberId,
      payerId,
      serviceType = '30', // Default to Health Benefit Plan Coverage
      providerNPI
    } = await req.json();

    // Validate required fields
    if (!firstName || !lastName || !dateOfBirth || !memberId) {
      return Response.json({ 
        error: 'Missing required fields: firstName, lastName, dateOfBirth, memberId' 
      }, { status: 400 });
    }

    const clientId = Deno.env.get('AVAILITY_CLIENT_ID');
    const clientSecret = Deno.env.get('AVAILITY_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      console.error('Availity credentials not configured');
      return Response.json({ 
        error: 'Availity integration not configured. Please contact support.' 
      }, { status: 500 });
    }

    // Step 1: Get OAuth access token
    const tokenResponse = await fetch('https://api.availity.com/availity/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'hipaa'
      })
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Availity token error:', error);
      return Response.json({ 
        error: 'Failed to authenticate with Availity',
        details: error
      }, { status: 500 });
    }

    const { access_token } = await tokenResponse.json();

    // Step 2: Make eligibility request
    const eligibilityPayload = {
      asOfDate: new Date().toISOString().split('T')[0],
      payerId: payerId || '00001', // Default to a common payer if not specified
      provider: {
        npi: providerNPI || '1234567893', // Default NPI if not provided
      },
      subscriber: {
        memberId: memberId,
        firstName: firstName,
        lastName: lastName,
        dateOfBirth: dateOfBirth, // Format: YYYY-MM-DD
      },
      serviceTypeCode: serviceType,
      requestType: 'eligibility'
    };

    const eligibilityResponse = await fetch('https://api.availity.com/availity/v1/coverages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eligibilityPayload)
    });

    if (!eligibilityResponse.ok) {
      const error = await eligibilityResponse.text();
      console.error('Availity eligibility error:', error);
      return Response.json({ 
        error: 'Failed to check eligibility',
        details: error
      }, { status: 500 });
    }

    const eligibilityData = await eligibilityResponse.json();

    // Parse and structure the response
    const result = {
      success: true,
      requestDate: new Date().toISOString(),
      patient: {
        name: `${firstName} ${lastName}`,
        memberId: memberId,
        dateOfBirth: dateOfBirth
      },
      coverage: {
        isActive: eligibilityData.coverages?.[0]?.active || false,
        planName: eligibilityData.coverages?.[0]?.planName || 'N/A',
        planType: eligibilityData.coverages?.[0]?.planType || 'N/A',
        effectiveDate: eligibilityData.coverages?.[0]?.effectiveDate || null,
        terminationDate: eligibilityData.coverages?.[0]?.terminationDate || null,
        groupNumber: eligibilityData.coverages?.[0]?.groupNumber || 'N/A',
      },
      benefits: eligibilityData.coverages?.[0]?.benefits || [],
      copays: eligibilityData.coverages?.[0]?.copays || [],
      deductibles: eligibilityData.coverages?.[0]?.deductibles || [],
      outOfPocketMax: eligibilityData.coverages?.[0]?.outOfPocketMax || null,
      payerInfo: {
        payerId: eligibilityData.payerId || payerId,
        payerName: eligibilityData.payerName || 'N/A',
      },
      rawResponse: eligibilityData // Include full response for debugging
    };

    // Log the eligibility check for audit purposes
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'eligibility_check',
      details: {
        patient_name: `${firstName} ${lastName}`,
        member_id: memberId,
        payer_id: payerId,
        result: result.coverage.isActive ? 'active' : 'inactive'
      },
      page: 'availity_integration'
    });

    return Response.json(result);

  } catch (error) {
    console.error('Availity integration error:', error);
    return Response.json({ 
      error: 'An unexpected error occurred',
      message: error.message 
    }, { status: 500 });
  }
});