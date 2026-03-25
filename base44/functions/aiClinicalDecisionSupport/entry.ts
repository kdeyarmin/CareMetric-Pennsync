import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { action, clinicalNotes, medications, patientData } = await req.json();

    if (action === 'suggestICD10') {
      return await suggestICD10Codes(base44, clinicalNotes);
    } else if (action === 'checkDrugInteractions') {
      return await checkDrugInteractions(base44, medications);
    } else if (action === 'predictReadmissionRisk') {
      return await predictReadmissionRisk(base44, patientData);
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (error) {
    console.error('CDS Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

async function suggestICD10Codes(base44, clinicalNotes) {
  const response = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a medical coding expert. Analyze the following clinical documentation and suggest the most appropriate ICD-10 diagnostic codes.

Clinical Notes:
${clinicalNotes}

Provide suggestions in JSON format with:
- code: ICD-10 code
- description: Full description
- confidence: Confidence level (high/medium/low)
- rationale: Why this code applies
- billing_impact: Expected impact on reimbursement

Suggest top 5 most relevant codes.`,
    response_json_schema: {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              description: { type: 'string' },
              confidence: { type: 'string' },
              rationale: { type: 'string' },
              billing_impact: { type: 'string' }
            }
          }
        }
      }
    }
  });

  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function checkDrugInteractions(base44, medications) {
  const medicationList = medications
    .map(m => `${m.name} (${m.dosage}, ${m.frequency})`)
    .join(', ');

  const response = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a clinical pharmacist. Check for drug interactions in the following medication list:

Medications:
${medicationList}

Provide analysis in JSON format with:
- interactions: Array of detected interactions
  - drug1: First medication
  - drug2: Second medication
  - severity: Critical/Major/Moderate/Minor
  - mechanism: How interaction occurs
  - recommendation: Clinical recommendation
  - monitoring: What to monitor

Only include actual interactions found.`,
    response_json_schema: {
      type: 'object',
      properties: {
        interactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              drug1: { type: 'string' },
              drug2: { type: 'string' },
              severity: { type: 'string' },
              mechanism: { type: 'string' },
              recommendation: { type: 'string' },
              monitoring: { type: 'string' }
            }
          }
        },
        summary: { type: 'string' }
      }
    }
  });

  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function predictReadmissionRisk(base44, patientData) {
  const prompt = `You are a clinical risk prediction specialist. Analyze the following patient data and predict readmission risk:

Patient Demographics:
- Age: ${patientData.age}
- Primary Diagnosis: ${patientData.primaryDiagnosis}
- Hospital Stays (past year): ${patientData.hospitalizationCount}

Clinical Factors:
- Functional Status: ${patientData.functionalStatus}
- Cognitive Status: ${patientData.cognitiveStatus}
- Fall Risk: ${patientData.fallRisk}
- Mental Health: ${patientData.mentalHealth}

Social Factors:
- Living Situation: ${patientData.livingSituation}
- Caregiver Support: ${patientData.caregiverSupport}
- Transportation: ${patientData.transportation}

Medications: ${patientData.medicationCount} active medications
Recent Vital Changes: ${patientData.vitalChanges}

Provide analysis in JSON format with:
- riskScore: 0-100 readmission risk percentage
- riskLevel: Critical/High/Moderate/Low
- keyRiskFactors: Array of primary drivers
- protectiveFactors: Array of positive factors
- interventions: Array of specific, actionable recommendations
  - intervention: What to do
  - priority: High/Medium/Low
  - expectedImpact: Estimated impact on risk reduction
  - responsibleTeam: Who should execute
- monitoringPlan: What metrics to track`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        riskScore: { type: 'number' },
        riskLevel: { type: 'string' },
        keyRiskFactors: {
          type: 'array',
          items: { type: 'string' }
        },
        protectiveFactors: {
          type: 'array',
          items: { type: 'string' }
        },
        interventions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              intervention: { type: 'string' },
              priority: { type: 'string' },
              expectedImpact: { type: 'string' },
              responsibleTeam: { type: 'string' }
            }
          }
        },
        monitoringPlan: { type: 'string' }
      }
    }
  });

  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' }
  });
}