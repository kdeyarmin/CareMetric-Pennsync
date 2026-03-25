import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { document_content, template_type } = await req.json();

    if (!document_content) {
      return Response.json({ error: 'Document content is required' }, { status: 400 });
    }

    const reviewPrompt = `You are a medical documentation expert and patient education specialist. Review the following document for:

1. CLARITY: Identify sections that may be confusing or use overly complex medical terminology
2. COMPLETENESS: Check if all essential information is present for the document type
3. ERRORS: Look for spelling, grammar, factual inconsistencies, or medical inaccuracies
4. PATIENT UNDERSTANDING: Assess if the language is appropriate for a lay audience
5. BEST PRACTICES: Verify adherence to medical documentation and patient education standards

Document Type: ${template_type.replace('_', ' ')}

Document Content:
${document_content}

Provide your review in JSON format with the following structure:
{
  "clarity_issues": [
    { "location": "paragraph section", "issue": "description", "suggestion": "improved phrasing" }
  ],
  "completeness_issues": [
    { "missing_element": "what's missing", "importance": "high/medium/low", "suggestion": "what should be added" }
  ],
  "language_improvements": [
    { "current": "medical term or phrase", "suggested": "patient-friendly version", "reason": "why this is better" }
  ],
  "potential_errors": [
    { "type": "spelling/grammar/medical", "location": "where in document", "issue": "what's wrong", "correction": "corrected version" }
  ],
  "best_practice_gaps": [
    { "standard": "which best practice", "gap": "what's missing or incorrect", "recommendation": "how to fix" }
  ],
  "overall_assessment": {
    "clarity_score": 0-100,
    "completeness_score": 0-100,
    "accuracy_score": 0-100,
    "overall_quality_score": 0-100,
    "summary": "brief overall assessment",
    "critical_issues": "any issues that must be fixed before sending to patient"
  }
}

Return ONLY valid JSON, no explanations.`;

    const review = await base44.integrations.Core.InvokeLLM({
      prompt: reviewPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          clarity_issues: { type: 'array' },
          completeness_issues: { type: 'array' },
          language_improvements: { type: 'array' },
          potential_errors: { type: 'array' },
          best_practice_gaps: { type: 'array' },
          overall_assessment: { type: 'object' }
        }
      }
    });

    // Log the review for audit trail
    await base44.integrations.Core.InvokeLLM({
      prompt: `Log this document review. User: ${user.email}, Template: ${template_type}, Overall Score: ${review.overall_assessment?.overall_quality_score || 'N/A'}`,
      add_context_from_internet: false
    }).catch(() => null); // Don't fail if logging fails

    return Response.json({
      success: true,
      review: review,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.email
    });

  } catch (error) {
    console.error('Error reviewing document:', error);
    return Response.json({ 
      error: 'Failed to review document',
      details: error.message 
    }, { status: 500 });
  }
});