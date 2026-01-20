import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { payload } = await req.json();
    const { source_url, document_text, payer_name_hint } = payload || {};

    let contentToAnalyze = document_text || '';

    // Fetch website content if URL provided
    if (source_url && !document_text) {
      try {
        const websiteResponse = await fetch(source_url);
        const html = await websiteResponse.text();
        
        // Extract text from HTML (simple approach)
        contentToAnalyze = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 15000); // Limit to prevent token overflow
      } catch (fetchError) {
        console.error('Error fetching URL:', fetchError);
        return Response.json({ error: 'Failed to fetch website content' }, { status: 400 });
      }
    }

    if (!contentToAnalyze) {
      return Response.json({ error: 'No content to analyze' }, { status: 400 });
    }

    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    
    const prompt = `You are a healthcare billing expert analyzing payer information to populate a payer database.

CONTENT TO ANALYZE:
${contentToAnalyze}

${payer_name_hint ? `PAYER NAME HINT: ${payer_name_hint}` : ''}

Extract the following information and return VALID JSON:

{
  "payer_name": "Official payer name",
  "payer_id": "Payer ID if mentioned",
  "payer_type": "One of: Medicare, Medicaid, Commercial, Managed Care, Workers Comp, Other",
  "states": ["Array of state codes where payer operates, e.g., CA, NY"],
  "applicable_provider_types": ["Array from: RN, LPN, NP, MD, DO, PA, PT, OT, ST, MSW, Chiropractor, All"],
  "contact_info": {
    "phone": "Phone number",
    "claims_address": "Claims mailing address",
    "website": "Website URL",
    "provider_portal": "Provider portal URL"
  },
  "electronic_submission_id": "EDI payer ID",
  "timely_filing_limit_days": 90,
  "prior_authorization_required": true/false,
  "general_requirements": ["Array of general billing requirements"],
  "suggested_billing_codes": [
    {
      "code": "99213",
      "code_type": "CPT",
      "description": "Office visit",
      "modifier_codes": ["25"],
      "requirements": ["Prior auth for some services"],
      "confidence": 85
    }
  ],
  "confidence_score": 85,
  "ambiguities": [
    {
      "field": "states",
      "issue": "Couldn't determine exact states of operation",
      "suggestion": "Verify state coverage manually"
    }
  ],
  "missing_critical_info": ["List of critical missing fields like payer_id, states, etc."],
  "notes": "Additional extracted information or context"
}

IMPORTANT:
- Return ONLY valid JSON, no markdown formatting
- Set confidence_score (0-100) based on how complete the information is
- Flag any ambiguities or missing critical information
- For states, use 2-letter codes
- Suggest billing codes only if clear information is available
- If payer type is unclear, set to "Commercial" and flag it
- Be conservative with confidence scores if information is incomplete`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return Response.json({ error: 'AI extraction failed', details: errorText }, { status: 500 });
    }

    const geminiData = await geminiResponse.json();
    const extractedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    let cleanedText = extractedText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    const extractedData = JSON.parse(cleanedText);

    // Log the extraction
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'payer_info_extracted',
      details: {
        source: source_url ? 'url' : 'document',
        confidence: extractedData.confidence_score,
        payer_name: extractedData.payer_name
      },
      page: 'PayerDatabase'
    });

    return Response.json({
      extracted_data: extractedData,
      source: source_url || 'document',
      extracted_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in extractPayerInformation:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});