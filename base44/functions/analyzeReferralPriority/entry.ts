import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Tolerant JSON extractor: we ask for strict JSON in-prompt instead of passing
// response_json_schema, because the provider rejects deeply-nested object
// schemas that lack an explicit `required` array at every level.
function parseLLMJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { extractedData, analysisResults } = await req.json();

        // Analyze referral and determine priority using AI
        const priorityAnalysis = await base44.integrations.Core.InvokeLLM({
            model: "claude_opus_4_8",
            prompt: `You are a clinical triage AI specializing in home health referral prioritization with advanced Natural Language Processing (NLP) capabilities to extract crucial details from unstructured clinical notes.

Analyze this referral and determine the urgency/priority level based on:
- **Medical condition severity and complexity**: Prioritize acute conditions, rapid deterioration, or complex care needs
- **Recent hospitalizations or ER visits**: Flag recent admissions as higher risk requiring prompt follow-up
- **Clinical stability indicators**: Assess vital signs, lab results, and reported symptoms for instability
- **Wound severity or infection risks**: Evaluate wound characteristics and infection signs for urgency
- **Medication complexity and safety concerns**: Identify polypharmacy, new high-risk medications, or potential adverse drug events
- **Fall risk or safety issues**: Prioritize patients with high fall risk, environmental hazards, or cognitive impairment
- **Cognitive/mental health concerns**: Assess for acute changes in mental status, severe depression, or unmanaged behavioral issues
- **Social determinants and support system**: Consider lack of caregiver support, unstable housing, or food insecurity
- **Discharge planning urgency**: Referrals from acute care settings require quicker response times
- **Insurance/authorization timeline pressures**: Note any deadlines for pre-authorization or benefit expiration
- **Unstructured Clinical Notes (NLP)**: Use advanced text analysis to find hidden risks, critical events, or unaddressed needs in free-text fields, physician notes, discharge summaries, or handwritten comments

REFERRAL DATA (including all extracted information, structured and unstructured):
${JSON.stringify(extractedData, null, 2)}

AI-ASSISTED INITIAL ANALYSIS:
${JSON.stringify(analysisResults, null, 2)}

Provide a detailed priority assessment with clear reasoning and identify specific phrases or keywords from unstructured data that influenced your decision.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"priority":"urgent|high|normal|low","priority_score":0,"urgency_factors":[""],"clinical_risks":[""],"recommended_response_time":"","reasoning":"","critical_actions":[""]}`
        });

        return Response.json({
            success: true,
            priorityAnalysis: parseLLMJson(priorityAnalysis) || {}
        });

    } catch (error) {
        console.error('Error analyzing referral priority:', error);
        return Response.json({ 
            error: error.message,
            success: false
        }, { status: 500 });
    }
});