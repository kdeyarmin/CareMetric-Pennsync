import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Cerner/Oracle Health EHR Integration using FHIR R4
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { noteContent, patientMRN, encounterDate, noteType } = await req.json();

    if (!noteContent || !patientMRN) {
      return Response.json({ 
        error: 'Missing required fields' 
      }, { status: 400 });
    }

    const clientId = Deno.env.get('CERNER_CLIENT_ID');
    const clientSecret = Deno.env.get('CERNER_CLIENT_SECRET');
    const fhirBaseUrl = Deno.env.get('CERNER_FHIR_BASE_URL');

    if (!clientId || !clientSecret || !fhirBaseUrl) {
      return Response.json({ 
        error: 'Cerner integration not configured' 
      }, { status: 500 });
    }

    // OAuth token
    const tokenResponse = await fetch(`${fhirBaseUrl}oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'system/DocumentReference.write'
      })
    });

    const { access_token } = await tokenResponse.json();

    // Create FHIR DocumentReference
    const documentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      docStatus: 'final',
      type: {
        text: noteType
      },
      subject: {
        identifier: { value: patientMRN }
      },
      date: encounterDate || new Date().toISOString(),
      author: [{ display: user.full_name }],
      content: [{
        attachment: {
          contentType: 'text/plain',
          data: btoa(noteContent)
        }
      }]
    };

    const createResponse = await fetch(`${fhirBaseUrl}DocumentReference`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/fhir+json'
      },
      body: JSON.stringify(documentReference)
    });

    const result = await createResponse.json();

    return Response.json({
      success: true,
      documentId: result.id,
      message: 'Note pushed to Cerner'
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});