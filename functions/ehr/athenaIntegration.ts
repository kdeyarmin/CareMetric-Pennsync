import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Athenahealth EHR Integration
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { noteContent, patientMRN, encounterDate, noteType } = await req.json();

    const practiceId = Deno.env.get('ATHENA_PRACTICE_ID');
    const clientId = Deno.env.get('ATHENA_CLIENT_ID');
    const clientSecret = Deno.env.get('ATHENA_CLIENT_SECRET');

    if (!practiceId || !clientId || !clientSecret) {
      return Response.json({ 
        error: 'Athenahealth integration not configured' 
      }, { status: 500 });
    }

    // Get OAuth token
    const tokenResponse = await fetch('https://api.athenahealth.com/oauth2/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'athena/service/Athenanet.MDP.*'
      })
    });

    const { access_token } = await tokenResponse.json();

    // Create clinical note in Athena
    const noteResponse = await fetch(
      `https://api.athenahealth.com/v1/${practiceId}/patients/${patientMRN}/documents/clinicalnote`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          documenttypeid: '1', // Clinical note type
          documentdata: btoa(noteContent),
          internalnote: noteType || 'AI Generated Clinical Note',
          documentdate: encounterDate || new Date().toISOString().split('T')[0]
        })
      }
    );

    const result = await noteResponse.json();

    return Response.json({
      success: true,
      documentId: result.documentid,
      message: 'Note pushed to Athenahealth'
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});