import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let user;
  try {
    const base44 = createClientFromRequest(req);
    user = await base44.auth.me();

    if (!user) {
      console.error('[calculateNoteQualityScore] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { noteText, visitType, providerType, patientContext } = body;

    if (!noteText) {
      console.error('[calculateNoteQualityScore] Missing noteText');
      return Response.json({ error: 'noteText is required' }, { status: 400 });
    }

    console.log('[calculateNoteQualityScore] Calculating quality score for user:', user.email, 'visit type:', visitType);

    // Build detailed quality analysis prompt
    const prompt = `You are a clinical documentation quality expert specializing in home health and hospice care. Analyze the following clinical note and provide a comprehensive quality assessment.

PROVIDER TYPE: ${providerType || 'RN'}
VISIT TYPE: ${visitType || 'skilled_nursing'}

CLINICAL NOTE:
${noteText}

${patientContext ? `PATIENT CONTEXT: ${JSON.stringify(patientContext)}` : ''}

Provide a detailed quality analysis with the following JSON structure:
{
  "overall_score": <number 0-100>,
  "clarity_score": <number 0-100>,
  "completeness_score": <number 0-100>,
  "compliance_score": <number 0-100>,
  "medicare_readiness_score": <number 0-100>,
  "strengths": ["<specific strength 1>", "<specific strength 2>"],
  "areas_for_improvement": [
    {
      "category": "<clarity|completeness|compliance>",
      "issue": "<specific issue>",
      "suggestion": "<actionable suggestion>",
      "severity": "<low|medium|high>",
      "example": "<example of how to fix it>"
    }
  ],
  "compliance_gaps": [
    {
      "requirement": "<specific requirement>",
      "missing_element": "<what's missing>",
      "recommended_addition": "<what to add>"
    }
  ],
  "clarity_issues": [
    {
      "excerpt": "<problematic text>",
      "issue": "<why it's unclear>",
      "improved_version": "<clearer version>"
    }
  ],
  "grade": "<A|B|C|D|F>",
  "summary": "<brief summary of overall quality>"
}

Evaluate based on:
1. CLARITY: Is the note clear, well-organized, and easy to understand? Professional medical terminology?
2. COMPLETENESS: Are all required elements present (assessment, interventions, patient response, plan)?
3. COMPLIANCE: Does it meet Medicare/HIPAA/regulatory requirements? Skilled need justification?
4. MEDICARE READINESS: Is it audit-ready and billable?

Be specific and actionable in your feedback.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          overall_score: { type: "number" },
          clarity_score: { type: "number" },
          completeness_score: { type: "number" },
          compliance_score: { type: "number" },
          medicare_readiness_score: { type: "number" },
          strengths: { type: "array", items: { type: "string" } },
          areas_for_improvement: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                issue: { type: "string" },
                suggestion: { type: "string" },
                severity: { type: "string" },
                example: { type: "string" }
              }
            }
          },
          compliance_gaps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                requirement: { type: "string" },
                missing_element: { type: "string" },
                recommended_addition: { type: "string" }
              }
            }
          },
          clarity_issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                excerpt: { type: "string" },
                issue: { type: "string" },
                improved_version: { type: "string" }
              }
            }
          },
          grade: { type: "string" },
          summary: { type: "string" }
        }
      }
    });

    console.log('[calculateNoteQualityScore] Quality score calculated:', response.overall_score, 'Grade:', response.grade);

    return Response.json({
      success: true,
      quality_analysis: response
    });

  } catch (error) {
    console.error('[calculateNoteQualityScore] Error:', {
      message: error.message,
      stack: error.stack,
      userEmail: user?.email
    });
    return Response.json({ 
      error: 'Failed to calculate quality score',
      details: error.message 
    }, { status: 500 });
  }
});