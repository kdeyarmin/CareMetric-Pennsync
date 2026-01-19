import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      patient_data, 
      medications = [], 
      diagnoses = [], 
      vitals = {},
      provider_type = 'RN',
      care_setting = 'home_health'
    } = await req.json();

    // Build comprehensive CDSS prompt
    const cdssPrompt = buildCDSSPrompt(patient_data, medications, diagnoses, vitals, provider_type, care_setting);

    // Invoke LLM for clinical decision support
    const recommendations = await base44.integrations.Core.InvokeLLM({
      prompt: cdssPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          drug_interactions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                drugs_involved: {
                  type: "array",
                  items: { type: "string" }
                },
                interaction_type: { 
                  type: "string",
                  enum: ["contraindicated", "major", "moderate", "minor"]
                },
                clinical_consequence: { type: "string" },
                management_strategy: { type: "string" },
                severity_score: { type: "number", minimum: 1, maximum: 10 }
              }
            },
            description: "Potential drug-drug and drug-disease interactions"
          },
          risk_assessments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                risk_type: { type: "string" },
                risk_level: {
                  type: "string",
                  enum: ["low", "moderate", "high", "critical"]
                },
                risk_score: { type: "number", minimum: 0, maximum: 100 },
                contributing_factors: {
                  type: "array",
                  items: { type: "string" }
                },
                monitoring_recommendations: {
                  type: "array",
                  items: { type: "string" }
                },
                intervention_suggestions: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            },
            description: "Risk stratification across multiple dimensions"
          },
          treatment_recommendations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                clinical_indication: { type: "string" },
                recommended_approach: { type: "string" },
                evidence_level: {
                  type: "string",
                  enum: ["strong", "moderate", "weak", "insufficient"]
                },
                rationale: { type: "string" },
                alternatives: {
                  type: "array",
                  items: { type: "string" }
                },
                contraindications: {
                  type: "array",
                  items: { type: "string" }
                },
                monitoring_parameters: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            },
            description: "Evidence-based treatment recommendations"
          },
          clinical_alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                alert_type: {
                  type: "string",
                  enum: ["critical", "urgent", "warning", "info"]
                },
                alert_title: { type: "string" },
                alert_description: { type: "string" },
                required_action: { type: "string" },
                timeframe: { type: "string" }
              }
            },
            description: "Critical clinical alerts requiring immediate attention"
          },
          compliance_notes: {
            type: "array",
            items: { type: "string" },
            description: "Documentation and regulatory compliance notes"
          },
          follow_up_recommendations: {
            type: "array",
            items: { type: "string" },
            description: "Follow-up assessment and monitoring recommendations"
          }
        }
      }
    });

    return Response.json({
      success: true,
      cdss_recommendations: recommendations,
      generated_at: new Date().toISOString(),
      provider_type,
      care_setting
    });
  } catch (error) {
    console.error('CDSS Error:', error);
    return Response.json({ 
      error: error.message,
      success: false
    }, { status: 500 });
  }
});

function buildCDSSPrompt(patientData, medications, diagnoses, vitals, providerType, careSetting) {
  const medicationsList = medications.map(m => 
    `${m.name} ${m.dosage ? `(${m.dosage})` : ''} ${m.frequency ? `${m.frequency}` : ''}`
  ).join('\n');

  const diagnosisList = diagnoses.map(d => 
    `${d.diagnosis || d}${d.icd10_code ? ` [${d.icd10_code}]` : ''}`
  ).join('\n');

  const vitalsStr = vitals ? Object.entries(vitals)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n') : 'Not provided';

  return `You are an expert Clinical Decision Support System for a ${providerType} in a ${careSetting.replace(/_/g, ' ')} setting.

PATIENT INFORMATION:
${patientData ? JSON.stringify(patientData, null, 2) : 'Standard adult patient'}

CURRENT MEDICATIONS:
${medicationsList || 'None listed'}

ACTIVE DIAGNOSES:
${diagnosisList || 'None documented'}

VITAL SIGNS / KEY MEASUREMENTS:
${vitalsStr}

CLINICAL DECISION SUPPORT ANALYSIS:

1. DRUG INTERACTION SCREENING
   - Identify all potential drug-drug interactions
   - Flag drug-disease contraindications
   - Assess severity and clinical consequences
   - Suggest management strategies

2. RISK STRATIFICATION
   - Readmission risk assessment
   - Fall risk evaluation
   - Medication-related problems
   - Disease-specific complications
   - Functional decline risk
   - Infection/sepsis risk
   - Adverse medication reaction risk

3. EVIDENCE-BASED TREATMENT RECOMMENDATIONS
   - Align with current clinical guidelines
   - Consider comorbidities and contraindications
   - Suggest therapeutic alternatives
   - Recommend monitoring parameters

4. CLINICAL ALERTS
   - Flag critical findings requiring immediate action
   - Highlight concerning trends
   - Identify potential safety issues

5. COMPLIANCE & DOCUMENTATION
   - Medicare/regulatory documentation requirements
   - OASIS-relevant considerations (if home health)
   - Quality measure considerations

6. FOLLOW-UP PLANNING
   - Recommend assessment frequency
   - Suggest monitoring intervals
   - Identify escalation criteria

Provide actionable, specific recommendations that the ${providerType} can implement immediately. Focus on patient safety and evidence-based care.`;
}