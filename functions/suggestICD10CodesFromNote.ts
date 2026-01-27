import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { note_content, primary_diagnosis, visit_type } = await req.json();

    if (!note_content || !primary_diagnosis) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Call Gemini to extract and suggest ICD-10 codes
    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a medical coding expert. Analyze the clinical note and suggest relevant ICD-10 codes.

Primary Diagnosis: ${primary_diagnosis}
Visit Type: ${visit_type}

Clinical Note:
${note_content}

Based on the note, provide additional ICD-10 codes that may be relevant. For each code, provide:
1. The ICD-10 code (e.g., E11.9)
2. The description
3. The category/type (e.g., "Secondary Diagnosis", "Comorbidity", "Procedure")
4. Relevance percentage (0-100)

Return as a JSON array of objects with fields: code, description, category, relevance

Only suggest codes that are clearly supported by the note content. Be conservative and accurate.`,
      response_json_schema: {
        type: 'object',
        properties: {
          suggested_codes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string' },
                relevance: { type: 'number' }
              }
            }
          },
          reasoning: { type: 'string' }
        }
      }
    });

    const codes = response.suggested_codes || [];

    return Response.json({
      suggested_codes: codes,
      count: codes.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in suggestICD10CodesFromNote:', error);
    return Response.json({ 
      error: error.message,
      suggested_codes: []
    }, { status: 500 });
  }
});