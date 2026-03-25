import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { providerEmail } = await req.json();
    const targetEmail = providerEmail || user.email;

    // Fetch provider's recent compliance audits
    const audits = await base44.entities.ComplianceAudit.filter(
      { audited_user_email: targetEmail },
      '-created_date',
      50
    );

    // Fetch recent note conversions (AI-enhanced notes)
    const noteConversions = await base44.entities.NoteConversion.filter(
      { created_by: targetEmail },
      '-created_date',
      30
    );

    // Fetch training completions
    const completions = await base44.entities.TrainingCompletion.filter(
      { provider_email: targetEmail }
    );

    // Analyze skill gaps with AI
    const analysisPrompt = `Analyze healthcare provider documentation patterns and identify skill gaps:

PROVIDER DATA:
- Recent Compliance Audits: ${audits.length} audits
- Average Compliance Score: ${audits.length > 0 ? (audits.reduce((sum, a) => sum + (a.overall_score || 0), 0) / audits.length).toFixed(1) : 'N/A'}
- Common Issues: ${audits.slice(0, 10).flatMap(a => a.issues || []).map(i => i.issue_type).join(', ')}
- Notes Enhanced: ${noteConversions.length}
- Training Completed: ${completions.length} modules

ANALYSIS REQUIRED:
1. Identify top 3-5 skill gaps based on:
   - Recurring compliance issues
   - Documentation quality patterns
   - Areas where AI frequently corrects notes
   - Missing or weak documentation areas

2. For each gap, provide:
   - Area (specific skill/knowledge gap)
   - Severity (critical/high/medium/low)
   - Description (what's lacking)
   - Evidence (specific examples from data)
   - Recommended training modules

Return JSON only: 
{
  "gaps": [
    {
      "area": "string",
      "severity": "critical|high|medium|low",
      "description": "string",
      "evidence": "string",
      "recommendedModules": ["string"]
    }
  ],
  "overallAssessment": "string",
  "strengths": ["string"]
}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          gaps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                area: { type: "string" },
                severity: { type: "string" },
                description: { type: "string" },
                evidence: { type: "string" },
                recommendedModules: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          },
          overallAssessment: { type: "string" },
          strengths: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    return Response.json(result);
  } catch (error) {
    console.error('Error analyzing skill gaps:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});