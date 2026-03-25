import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let user;
  try {
    const base44 = createClientFromRequest(req);
    user = await base44.auth.me();

    if (!user) {
      console.error('[generateClinicalInsights] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      enhanced_note,
      diagnoses = [],
      symptoms = [],
      medications = [],
      vital_signs = {},
      visit_type,
      provider_type,
      patient_context = {}
    } = body;

    if (!enhanced_note) {
      console.error('[generateClinicalInsights] Missing enhanced_note');
      return Response.json({ error: 'enhanced_note is required' }, { status: 400 });
    }

    console.log('[generateClinicalInsights] Generating insights for user:', user.email);

    const prompt = `You are an expert clinical decision support system. Analyze the following patient data and provide proactive clinical guidance focused on care gaps, potential contraindications, and evidence-based best practices.

PATIENT DIAGNOSES: ${diagnoses.join(', ') || 'Not specified'}
SYMPTOMS: ${symptoms.join(', ') || 'Not specified'}
CURRENT MEDICATIONS: ${medications.join(', ') || 'None documented'}
VITAL SIGNS: ${JSON.stringify(vital_signs)}
VISIT TYPE: ${visit_type || 'Not specified'}
PROVIDER TYPE: ${provider_type || 'Not specified'}

PATIENT AGE/CONTEXT: ${patient_context.age ? `Age ${patient_context.age}` : 'Age unknown'}, ${patient_context.comorbidities ? `Comorbidities: ${patient_context.comorbidities.join(', ')}` : ''}

CLINICAL NOTE:
${enhanced_note}

Provide comprehensive clinical insights in the following areas:

1. DRUG INTERACTIONS & CONTRAINDICATIONS
   - Check all medications for potential interactions with each other
   - Flag contraindications based on diagnoses (e.g., NSAIDs with CHF, ACE inhibitors with hyperkalemia)
   - For each issue, provide specific clinical concern and recommended action
   - Include severity (critical, significant, minor)

2. CARE GAPS & MISSING ASSESSMENTS
   - Identify clinical assessments or interventions typically expected for these diagnoses that may be missing
   - For each gap, explain why it's important and suggest what should be documented or assessed
   - Consider standard of care guidelines for the diagnosis

3. VITAL SIGNS INTERPRETATION
   - Flag any vital signs that are concerning given the diagnoses
   - Provide clinical context for abnormalities
   - Suggest monitoring frequency or interventions if needed

4. EVIDENCE-BASED BEST PRACTICES
   - For the primary diagnosis, provide key evidence-based management recommendations
   - Reference current clinical guidelines (e.g., AHA, ACC, ACCP)
   - Note if current treatment aligns with guidelines or if gaps exist
   - Include relevant ICD-10 codes that may apply

5. SAFETY ALERTS
   - Flag any high-risk situations (e.g., polypharmacy in elderly, fall risk with certain medications)
   - Provide specific safety considerations
   - Suggest preventive measures

6. PATIENT EDUCATION PRIORITIES
   - Based on diagnoses and current treatment, identify critical patient education topics
   - Rank by urgency and patient readiness
   - Include specific teaching points

Return results in JSON format with clear, actionable recommendations and guideline references.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          drug_interactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                medications_involved: { type: 'array', items: { type: 'string' } },
                interaction_type: { type: 'string' },
                severity: { type: 'string', enum: ['critical', 'significant', 'minor'] },
                clinical_concern: { type: 'string' },
                recommended_action: { type: 'string' },
                guideline_reference: { type: 'string' }
              }
            }
          },
          care_gaps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                gap: { type: 'string' },
                related_diagnosis: { type: 'string' },
                clinical_rationale: { type: 'string' },
                standard_of_care: { type: 'string' },
                suggested_documentation: { type: 'string' },
                priority: { type: 'string', enum: ['high', 'medium', 'low'] }
              }
            }
          },
          vital_sign_alerts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                vital_sign: { type: 'string' },
                value: { type: 'string' },
                clinical_concern: { type: 'string' },
                related_diagnosis: { type: 'string' },
                monitoring_recommendation: { type: 'string' }
              }
            }
          },
          evidence_based_practices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                diagnosis: { type: 'string' },
                recommended_practice: { type: 'string' },
                guideline_source: { type: 'string' },
                icd10_codes: { type: 'array', items: { type: 'string' } },
                alignment_with_current_plan: { type: 'string' }
              }
            }
          },
          safety_alerts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                alert_type: { type: 'string' },
                risk_factor: { type: 'string' },
                potential_harm: { type: 'string' },
                preventive_measures: { type: 'array', items: { type: 'string' } }
              }
            }
          },
          education_priorities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                topic: { type: 'string' },
                urgency: { type: 'string', enum: ['critical', 'high', 'medium'] },
                rationale: { type: 'string' },
                key_teaching_points: { type: 'array', items: { type: 'string' } }
              }
            }
          },
          overall_clinical_summary: {
            type: 'string',
            description: 'Brief summary of the most important clinical considerations'
          }
        }
      }
    });

    console.log('[generateClinicalInsights] Clinical insights generated successfully');

    return Response.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[generateClinicalInsights] Error:', {
      message: error.message,
      stack: error.stack,
      userEmail: user?.email
    });
    return Response.json({
      error: 'Failed to generate clinical insights',
      details: error.message
    }, { status: 500 });
  }
});