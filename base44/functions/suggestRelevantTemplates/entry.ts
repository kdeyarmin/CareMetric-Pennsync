import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { patientDiagnosis, visitType, existingContent, availableTemplates = [] } = await req.json();

    if (!patientDiagnosis && !visitType && !existingContent) {
      return new Response(
        JSON.stringify({ suggestions: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Prepare context for AI
    const contextStr = `
Patient Diagnosis: ${patientDiagnosis || 'Not specified'}
Visit Type: ${visitType || 'Not specified'}
Already Entered Content: ${existingContent ? existingContent.substring(0, 500) : 'None'}
Available Templates: ${availableTemplates.map(t => t.template_name).join(', ')}
`;

    const prompt = `Based on the following patient and document context, suggest the 3-5 most relevant templates from the available list that would be most helpful for this documentation. Consider the diagnosis, visit type, and what's already been entered.

${contextStr}

Return a JSON array with this structure:
{
  "suggestions": [
    {
      "template_name": "exact template name",
      "reason": "why this template is relevant",
      "priority": "high|medium|low"
    }
  ]
}

IMPORTANT: Only suggest templates that exist in the available templates list. Only return templates that are truly relevant to the context.`;

    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          suggestions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                template_name: { type: "string" },
                reason: { type: "string" },
                priority: { type: "string" }
              }
            }
          }
        }
      }
    });

    // Filter to ensure all suggestions exist in available templates
    const validSuggestions = (aiResponse.suggestions || []).filter(
      s => availableTemplates.some(t => t.template_name === s.template_name)
    );

    return new Response(
      JSON.stringify({ suggestions: validSuggestions }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Template Suggestion Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to generate suggestions', suggestions: [] }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});