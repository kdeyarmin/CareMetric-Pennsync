import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Epic EHR Integration using FHIR R4 API
 * Pushes clinical notes to Epic DocumentReference
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
        error: 'Missing required fields: noteContent, patientMRN' 
      }, { status: 400 });
    }

    // Get Epic credentials
    const clientId = Deno.env.get('EPIC_CLIENT_ID');
    const clientSecret = Deno.env.get('EPIC_CLIENT_SECRET');
    const fhirBaseUrl = Deno.env.get('EPIC_FHIR_BASE_URL');

    if (!clientId || !clientSecret || !fhirBaseUrl) {
      return Response.json({ 
        error: 'Epic EHR integration not configured. Contact admin to set API credentials.' 
      }, { status: 500 });
    }

    // Get OAuth access token
    const tokenResponse = await fetch(`${fhirBaseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to authenticate with Epic');
    }

    const { access_token } = await tokenResponse.json();

    // Create DocumentReference in Epic FHIR
    const documentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      type: {
        coding: [{
          system: 'http://loinc.org',
          code: '34117-2',
          display: 'History and physical note'
        }],
        text: noteType || 'Clinical Note'
      },
      subject: {
        identifier: {
          system: 'urn:oid:1.2.840.114350',
          value: patientMRN
        }
      },
      date: encounterDate || new Date().toISOString(),
      author: [{
        display: user.full_name
      }],
      content: [{
        attachment: {
          contentType: 'text/plain',
          data: btoa(noteContent) // Base64 encode
        }
      }]
    };

    const createResponse = await fetch(`${fhirBaseUrl}/DocumentReference`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json'
      },
      body: JSON.stringify(documentReference)
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Epic API error: ${errorText}`);
    }

    const result = await createResponse.json();

    return Response.json({
      success: true,
      documentId: result.id,
      message: 'Note successfully pushed to Epic EHR'
    });

  } catch (error) {
    console.error('Epic integration error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});