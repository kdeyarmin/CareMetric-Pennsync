import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { document_content, document_type, patient_name } = await req.json();

    if (!document_content) {
      return Response.json({ error: 'Document content is required' }, { status: 400 });
    }

    // Use AI to comprehensively review the document
    const review = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a healthcare documentation expert and patient communication specialist. Review the following ${document_type} document for a patient named ${patient_name || 'Unknown'}.

Document:
${document_content}

Analyze the document for:
1. CLARITY: Is the language clear and understandable for a general audience?
2. COMPLETENESS: Are all critical sections present and thoroughly explained?
3. MEDICAL ACCURACY: Does it follow standard medical documentation practices?
4. PATIENT SAFETY: Are there any potential safety concerns or missing information?
5. COMPLIANCE: Does it adhere to common documentation standards?
6. READABILITY: Is the tone appropriate and patient-friendly?

Respond with ONLY valid JSON (no markdown, no explanations):
{
  "overall_score": 0-100,
  "clarity_score": 0-100,
  "completeness_score": 0-100,
  "accuracy_score": 0-100,
  "safety_score": 0-100,
  "compliance_score": 0-100,
  "readability_score": 0-100,
  "summary": "brief overall assessment",
  "strengths": ["strength1", "strength2"],
  "concerns": [
    {
      "severity": "high|medium|low",
      "section": "section name",
      "issue": "description of issue",
      "suggestion": "specific suggestion for improvement"
    }
  ],
  "phrasing_suggestions": [
    {
      "original": "problematic phrase from document",
      "suggested": "clearer alternative",
      "reason": "why this is better"
    }
  ],
  "missing_elements": ["element1", "element2"],
  "action_items": ["action1", "action2"]
}`,
      response_json_schema: {
        type: 'object',
        properties: {
          overall_score: { type: 'number' },
          clarity_score: { type: 'number' },
          completeness_score: { type: 'number' },
          accuracy_score: { type: 'number' },
          safety_score: { type: 'number' },
          compliance_score: { type: 'number' },
          readability_score: { type: 'number' },
          summary: { type: 'string' },
          strengths: { type: 'array', items: { type: 'string' } },
          concerns: { type: 'array' },
          phrasing_suggestions: { type: 'array' },
          missing_elements: { type: 'array', items: { type: 'string' } },
          action_items: { type: 'array', items: { type: 'string' } }
        }
      }
    });

    return Response.json({
      success: true,
      review: review
    });

  } catch (error) {
    console.error('Error reviewing document:', error);
    return Response.json({
      error: 'Failed to review document',
      details: error.message
    }, { status: 500 });
  }
});