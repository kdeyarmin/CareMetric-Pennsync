import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let user;
  try {
    const base44 = createClientFromRequest(req);
    user = await base44.auth.me();

    if (!user) {
      console.error('[generateProactiveInsights] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { patient_id, user_email } = body;

    // Support both patient_id (from patient pages) and user_email (from dashboard)
    if (!patient_id && !user_email) {
      console.error('[generateProactiveInsights] Missing patient_id or user_email');
      return Response.json({ error: 'patient_id or user_email is required' }, { status: 400 });
    }

    // If user_email provided, generate insights for their recent patients
    if (user_email && !patient_id) {
      console.log('[generateProactiveInsights] Generating insights for user:', user_email);
      
      // Get user's recent patients from visits
      const recentVisits = await base44.entities.Visit.filter(
        { created_by: user_email },
        '-created_date',
        10
      );
      
      const uniquePatientIds = [...new Set(recentVisits.map(v => v.patient_id))].filter(Boolean);
      
      if (uniquePatientIds.length === 0) {
        return Response.json({
          success: true,
          insights: {
            risk_flags: [],
            trending_concerns: [],
            visit_preparation: {
              key_assessment_areas: [],
              suggested_discussion_points: ["No recent patient visits found"],
              recommended_interventions: []
            },
            care_plan_recommendations: [],
            medication_alerts: [],
            preventive_opportunities: []
          },
          generated_at: new Date().toISOString()
        });
      }
      
      // For dashboard, just analyze the most recent patient
      const mostRecentPatientId = uniquePatientIds[0];
      const patient = await base44.entities.Patient.filter({ id: mostRecentPatientId });
      
      if (!patient || patient.length === 0) {
        return Response.json({
          success: true,
          insights: {
            risk_flags: [],
            trending_concerns: [],
            visit_preparation: {
              key_assessment_areas: [],
              suggested_discussion_points: [],
              recommended_interventions: []
            },
            care_plan_recommendations: [],
            medication_alerts: [],
            preventive_opportunities: []
          },
          generated_at: new Date().toISOString()
        });
      }
      
      const patientData = patient[0];
      
      // Generate quick insights for dashboard
      return Response.json({
        success: true,
        insights: {
          risk_flags: [],
          trending_concerns: [{
            concern: `Recent activity with patient: ${patientData.first_name} ${patientData.last_name}`,
            trend_direction: "stable",
            data_points: [`${uniquePatientIds.length} patients in recent visits`],
            clinical_significance: "Continue monitoring patient care"
          }],
          visit_preparation: {
            key_assessment_areas: ["Continue routine assessments"],
            suggested_discussion_points: [`Follow up on ${patientData.primary_diagnosis || 'current condition'}`],
            recommended_interventions: []
          },
          care_plan_recommendations: [],
          medication_alerts: [],
          preventive_opportunities: []
        },
        generated_at: new Date().toISOString()
      });
    }

    console.log('[generateProactiveInsights] Generating insights for patient:', patient_id);

    // Fetch comprehensive patient data
    const patient = await base44.entities.Patient.filter({ id: patient_id });
    if (!patient || patient.length === 0) {
      console.error('[generateProactiveInsights] Patient not found:', patient_id);
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const patientData = patient[0];

    // Fetch related data
    const carePlans = await base44.entities.CarePlan.filter({ 
      patient_id, 
      status: 'active' 
    });

    const recentVisits = (patientData.enhanced_notes_history || [])
      .slice(-5)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    console.log('[generateProactiveInsights] Fetched data - Care Plans:', carePlans.length, 'Recent Visits:', recentVisits.length);

    // Build comprehensive context for AI analysis
    const analysisPrompt = `You are a clinical analytics AI analyzing patient data to provide proactive insights and risk identification.

PATIENT INFORMATION:
Name: ${patientData.first_name} ${patientData.last_name}
Age: ${patientData.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
Primary Diagnosis: ${patientData.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${(patientData.secondary_diagnoses || []).join(', ') || 'None'}
Allergies: ${patientData.allergies || 'None documented'}

CURRENT MEDICATIONS:
${patientData.current_medications ? JSON.stringify(patientData.current_medications, null, 2) : 'No medications documented'}

ACTIVE CARE PLANS (${carePlans.length}):
${carePlans.map(cp => `- ${cp.problem}: Goal - ${cp.goal} (Progress: ${cp.progress_percentage || 0}%)`).join('\n')}

RECENT VISIT NOTES (Last 5):
${recentVisits.map((v, i) => `
Visit ${i + 1} (${v.date}):
Type: ${v.visit_type}
Diagnosis: ${v.diagnosis}
Note excerpt: ${v.enhanced_note?.substring(0, 300)}
Vital Signs: ${v.vital_signs ? JSON.stringify(v.vital_signs) : 'Not recorded'}
`).join('\n')}

FUNCTIONAL STATUS:
${patientData.functional_status ? JSON.stringify(patientData.functional_status, null, 2) : 'Not documented'}

Based on this comprehensive patient data, provide proactive clinical insights in the following JSON structure:

{
  "risk_flags": [
    {
      "risk_type": "<type of risk: deterioration, medication, safety, etc.>",
      "severity": "<low|medium|high|critical>",
      "description": "<what the risk is>",
      "indicators": ["<clinical indicator 1>", "<indicator 2>"],
      "recommended_actions": ["<action 1>", "<action 2>"]
    }
  ],
  "trending_concerns": [
    {
      "concern": "<trending pattern observed>",
      "trend_direction": "<improving|worsening|stable>",
      "data_points": ["<data point 1>", "<data point 2>"],
      "clinical_significance": "<why this matters>"
    }
  ],
  "visit_preparation": {
    "key_assessment_areas": ["<area 1>", "<area 2>"],
    "suggested_discussion_points": ["<point 1>", "<point 2>"],
    "recommended_interventions": ["<intervention 1>", "<intervention 2>"]
  },
  "care_plan_recommendations": [
    {
      "problem": "<identified problem>",
      "rationale": "<why this is needed>",
      "suggested_goal": "<measurable goal>",
      "priority": "<low|medium|high>"
    }
  ],
  "medication_alerts": [
    {
      "alert_type": "<interaction|adherence|dosage>",
      "description": "<alert description>",
      "recommendation": "<what to do>"
    }
  ],
  "preventive_opportunities": [
    {
      "opportunity": "<preventive intervention>",
      "benefit": "<expected benefit>",
      "timing": "<when to implement>"
    }
  ]
}

Focus on actionable, evidence-based insights that help clinicians provide proactive, preventive care.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          risk_flags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                risk_type: { type: "string" },
                severity: { type: "string" },
                description: { type: "string" },
                indicators: { type: "array", items: { type: "string" } },
                recommended_actions: { type: "array", items: { type: "string" } }
              }
            }
          },
          trending_concerns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                concern: { type: "string" },
                trend_direction: { type: "string" },
                data_points: { type: "array", items: { type: "string" } },
                clinical_significance: { type: "string" }
              }
            }
          },
          visit_preparation: {
            type: "object",
            properties: {
              key_assessment_areas: { type: "array", items: { type: "string" } },
              suggested_discussion_points: { type: "array", items: { type: "string" } },
              recommended_interventions: { type: "array", items: { type: "string" } }
            }
          },
          care_plan_recommendations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                problem: { type: "string" },
                rationale: { type: "string" },
                suggested_goal: { type: "string" },
                priority: { type: "string" }
              }
            }
          },
          medication_alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                alert_type: { type: "string" },
                description: { type: "string" },
                recommendation: { type: "string" }
              }
            }
          },
          preventive_opportunities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                opportunity: { type: "string" },
                benefit: { type: "string" },
                timing: { type: "string" }
              }
            }
          }
        }
      }
    });

    console.log('[generateProactiveInsights] Insights generated successfully for patient:', patient_id);

    return Response.json({
      success: true,
      insights: response,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('[generateProactiveInsights] Error:', {
      message: error.message,
      stack: error.stack,
      userEmail: user?.email
    });
    return Response.json({ 
      error: 'Failed to generate proactive insights',
      details: error.message 
    }, { status: 500 });
  }
});