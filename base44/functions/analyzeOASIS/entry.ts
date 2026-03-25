import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { oasis_file_url, narrative_text } = await req.json();

    if (!oasis_file_url && !narrative_text) {
      return Response.json({ success: false, error: 'Either OASIS file URL or narrative text is required.' }, { status: 400 });
    }

    const medicareRules = await base44.entities.MedicareComplianceRule.filter({ is_active: true });
    const medicareContext = medicareRules.map(rule => 
      `- ${rule.category}: ${rule.description} (Reference: ${rule.cop_reference})`
    ).join('\n');

    let fileContent = "";
    if (oasis_file_url) {
      try {
        const response = await fetch(oasis_file_url);
        fileContent = await response.text();
      } catch (fetchError) {
        console.warn('Could not fetch file content:', fetchError);
      }
    }

    const prompt = `You are an expert in OASIS-E documentation, Medicare compliance, and home health regulations.
Analyze the following OASIS assessment data and narrative notes. Your goal is to identify:
1. Inconsistencies between structured data (if provided from file) and the narrative.
2. Unreasonable or contradictory answers in the assessment.
3. Potential compliance issues or missing elements according to Medicare and OASIS guidelines.

Medicare Compliance Context:\n${medicareContext}\n
OASIS Assessment File Content (if provided):\n"""
${fileContent}
"""

Narrative Notes (if provided):\n"""
${narrative_text}
"""

Provide a structured JSON output with:
- overall_status: "compliant" | "flagged" | "critical"
- summary_message: A brief overall assessment.
- inconsistencies: Array of { field: string, issue: string, suggestion: string } if data and narrative conflict.
- reasonableness_flags: Array of { field: string, issue: string, context: string } for questionable answers.
- compliance_warnings: Array of { rule: string, details: string } for potential regulatory risks.
- suggestions: Array of strings for general improvement recommendations.

Ensure the output is valid JSON.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a meticulous OASIS documentation auditor."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 2000
    });

    const result = JSON.parse(completion.choices[0].message.content);

    await base44.asServiceRole.entities.OASISAudit.create({
      user_email: user.email,
      status: result.overall_status,
      summary: result.summary_message,
      details: result,
      oasis_file_url: oasis_file_url,
      analysis_date: new Date().toISOString()
    });

    return Response.json({ success: true, ...result });

  } catch (error) {
    console.error('OASIS analysis error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});