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

    const { oasis_data, patient_id } = await req.json();

    if (!oasis_data) {
      return Response.json({ 
        success: false, 
        error: 'OASIS data is required.' 
      }, { status: 400 });
    }

    // Fetch patient info
    let patientInfo = {};
    if (patient_id) {
      try {
        patientInfo = await base44.entities.Patient.get(patient_id);
      } catch (err) {
        console.warn('Could not fetch patient:', err);
      }
    }

    const prompt = `Based on the following OASIS assessment data, generate comprehensive care plan recommendations.

Patient Information:
${JSON.stringify(patientInfo, null, 2)}

OASIS Assessment Data:
${JSON.stringify(oasis_data, null, 2)}

Generate a structured care plan with the following JSON format:

{
  "care_plan_goals": [
    {
      "goal_id": "unique_id",
      "goal_statement": "Patient-centered goal statement",
      "target_date": "estimated date",
      "oasis_indicators": ["M1800", "M1810"],
      "measurable_outcomes": ["specific outcome 1", "specific outcome 2"]
    }
  ],
  "interventions": [
    {
      "intervention_id": "unique_id",
      "discipline": "RN|PT|OT|ST|MSW|HHA",
      "intervention_description": "Detailed intervention",
      "frequency": "visits per week",
      "duration": "weeks",
      "rationale": "OASIS-based justification",
      "related_goals": ["goal_id"],
      "oasis_items_addressed": ["M1800", "M1810"]
    }
  ],
  "safety_interventions": [
    {
      "risk_area": "Falls|Wounds|Medication|Other",
      "intervention": "Specific safety intervention",
      "oasis_support": "Related OASIS items"
    }
  ],
  "education_plan": [
    {
      "topic": "Education topic",
      "target_audience": ["Patient", "Caregiver"],
      "priority": "High|Medium|Low",
      "method": "Demonstration|Written materials|Verbal instruction",
      "oasis_driven": "Why OASIS indicates this need"
    }
  ],
  "equipment_needs": [
    {
      "equipment": "DME item",
      "justification": "Medical necessity based on OASIS",
      "oasis_items": ["M1800"]
    }
  ],
  "monitoring_parameters": [
    {
      "parameter": "What to monitor",
      "frequency": "How often",
      "alert_criteria": "When to escalate",
      "oasis_correlation": "Related OASIS items"
    }
  ],
  "discharge_planning": {
    "estimated_los": "days",
    "discharge_goals": ["goal 1", "goal 2"],
    "anticipated_barriers": ["barrier 1"],
    "transition_plan": "Brief discharge plan"
  }
}

Ensure all recommendations are evidence-based and directly tied to OASIS assessment findings.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert care plan developer specializing in OASIS-driven home health care planning."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 3000
    });

    const result = JSON.parse(completion.choices[0].message.content);

    return Response.json({ success: true, care_plan: result });

  } catch (error) {
    console.error('OASIS care plan generation error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});