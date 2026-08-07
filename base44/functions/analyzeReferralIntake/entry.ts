import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { extractedData, analysisResults } = await req.json();

    // Skip the expensive LLM call when there's nothing to analyze — without
    // this guard, an empty payload still fires a claude_opus call that times
    // out at the 120s proxy limit.
    if (!extractedData || (typeof extractedData === 'object' && Object.keys(extractedData).length === 0)) {
      return Response.json({
        success: true,
        analysis: {
          missing_critical_info: { high_priority: ['No referral data provided — cannot analyze.'] },
          suggested_next_steps: []
        }
      });
    }

    // Use AI to comprehensively analyze the referral
    const analysisPrompt = `You are an expert home health intake coordinator. Analyze this referral data and provide comprehensive insights.

REFERRAL DATA:
${JSON.stringify(extractedData, null, 2)}

EXISTING ANALYSIS:
${JSON.stringify(analysisResults, null, 2)}

Provide a JSON response with the following structure:
{
  "category": {
    "primary": "cardiac|respiratory|wound_care|orthopedic|neurological|diabetes|post_surgical|general_medical|hospice|palliative",
    "secondary": ["list of secondary categories if applicable"],
    "specialty_requirements": ["any special certifications or skills needed"]
  },
  "missing_critical_info": {
    "high_priority": ["critical items missing that block admission"],
    "medium_priority": ["important items missing but admission can proceed"],
    "low_priority": ["nice-to-have items missing"]
  },
  "risk_assessment": {
    "clinical_complexity": "low|medium|high|critical",
    "readmission_risk": "low|medium|high",
    "fall_risk": "low|medium|high",
    "infection_risk": "low|medium|high",
    "key_concerns": ["specific clinical concerns to monitor"]
  },
  "suggested_next_steps": [
    {
      "action": "description of action",
      "priority": "immediate|urgent|high|medium|low",
      "timeframe": "within X hours/days",
      "responsible_role": "nurse|admin|physician|coordinator"
    }
  ],
  "assignment_recommendations": {
    "ideal_nurse_qualifications": ["IV therapy", "wound care certified", etc.],
    "visit_frequency_suggested": "daily|3x_week|2x_week|weekly",
    "estimated_episode_length": "30|60|90 days",
    "requires_specialized_skills": true|false
  },
  "care_coordination_needs": {
    "physician_contact_priority": "immediate|high|routine",
    "dme_orders_needed": ["list of equipment"],
    "therapy_services_recommended": ["PT", "OT", "ST"],
    "other_services": ["home health aide", "social work", etc.]
  },
  "compliance_alerts": [
    "any regulatory or compliance concerns identified"
  ],
  "documentation_gaps": [
    "specific documentation that should be obtained before first visit"
  ]
}

Return ONLY valid JSON matching the structure above, no prose or code fences.`;

    const response = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: analysisPrompt
    });

    return Response.json({
      success: true,
      analysis: parseLLMJson(response) || {}
    });

  } catch (error) {
    console.error('Referral analysis error:', error);
    return Response.json({ 
      error: 'Failed to analyze referral',
      details: 'Internal server error' 
    }, { status: 500 });
  }
});