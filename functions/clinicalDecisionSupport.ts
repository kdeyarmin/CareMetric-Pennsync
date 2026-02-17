import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      action, // 'suggest_tests' | 'treatment_protocol' | 'drug_interactions'
      symptoms,
      findings,
      diagnosis,
      patient_age,
      patient_conditions,
      current_medications,
      patient_id
    } = await req.json();

    if (!action) {
      return Response.json({ error: 'Action required' }, { status: 400 });
    }

    // Get patient history if needed
    let patientContext = null;
    if (patient_id && patient_id !== 'no_patient') {
      const patients = await base44.entities.Patient.filter({ id: patient_id });
      if (patients.length > 0) {
        patientContext = patients[0];
      }
    }

    switch (action) {
      case 'suggest_tests': {
        return await suggestDiagnosticTests(base44, symptoms, findings, diagnosis, patient_age, patientContext);
      }

      case 'treatment_protocol': {
        return await recommendTreatmentProtocol(base44, diagnosis, patient_age, patient_conditions, patientContext);
      }

      case 'drug_interactions': {
        return await checkDrugInteractions(base44, current_medications, diagnosis);
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Clinical decision support error:', error);
    return Response.json(
      { error: error.message || 'Clinical decision support error' },
      { status: 500 }
    );
  }
});

async function suggestDiagnosticTests(base44, symptoms, findings, diagnosis, patientAge, patientContext) {
  const prompt = `Based on clinical presentation, suggest relevant diagnostic tests.

Symptoms: ${symptoms}
Clinical Findings: ${findings}
Diagnosis: ${diagnosis}
Patient Age: ${patientAge}
Patient History: ${patientContext?.primary_diagnosis || 'Not specified'}

Suggest 5-8 diagnostic tests with:
1. Test name
2. Type (lab/imaging/other)
3. Clinical rationale
4. Priority (urgent/high/standard)
5. Expected turnaround time
6. Cost estimate (low/moderate/high)
7. Patient preparation needed

Return as JSON array ordered by priority.`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        tests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              rationale: { type: 'string' },
              priority: { type: 'string' },
              turnaround_time: { type: 'string' },
              cost: { type: 'string' },
              preparation: { type: 'string' }
            }
          }
        }
      }
    }
  });

  return Response.json({
    action: 'suggest_tests',
    tests: response.tests || []
  });
}

async function recommendTreatmentProtocol(base44, diagnosis, patientAge, patientConditions, patientContext) {
  const prompt = `Recommend evidence-based treatment protocol for patient care.

Diagnosis: ${diagnosis}
Patient Age: ${patientAge}
Comorbidities: ${patientConditions?.join(', ') || 'None reported'}
Medical History: ${patientContext?.secondary_diagnoses?.join(', ') || 'None'}

Provide comprehensive treatment protocol including:
1. First-line treatment (medication/therapy)
2. Dosing recommendations (adjusted for age/conditions)
3. Alternative treatments if first-line contraindicated
4. Monitoring parameters and frequency
5. Duration of treatment
6. Lifestyle modifications
7. Patient education points
8. Red flags requiring hospitalization
9. Follow-up timeline
10. Evidence base (clinical guidelines referenced)

Format as structured JSON with detailed recommendations.`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        first_line: {
          type: 'object',
          properties: {
            medication: { type: 'string' },
            dosing: { type: 'string' },
            frequency: { type: 'string' },
            duration: { type: 'string' }
          }
        },
        alternatives: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              medication: { type: 'string' },
              rationale: { type: 'string' }
            }
          }
        },
        monitoring: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              parameter: { type: 'string' },
              frequency: { type: 'string' },
              method: { type: 'string' }
            }
          }
        },
        lifestyle_modifications: { type: 'array', items: { type: 'string' } },
        red_flags: { type: 'array', items: { type: 'string' } },
        follow_up: { type: 'string' },
        evidence_base: { type: 'string' }
      }
    }
  });

  return Response.json({
    action: 'treatment_protocol',
    protocol: response
  });
}

async function checkDrugInteractions(base44, currentMedications, diagnosis) {
  if (!currentMedications || currentMedications.length === 0) {
    return Response.json({
      action: 'drug_interactions',
      interactions: [],
      summary: 'No medications reported'
    });
  }

  const medListString = currentMedications.map(med => {
    if (typeof med === 'string') return med;
    return `${med.name || med} ${med.dosage ? '(' + med.dosage + ')' : ''}`;
  }).join(', ');

  const prompt = `Analyze medication interactions and contraindications.

Current Medications: ${medListString}
Diagnosis: ${diagnosis}

Check for:
1. Drug-drug interactions between current medications
2. Contraindications with the diagnosis
3. Medications that may worsen the condition
4. Dosing concerns for elderly or kidney/liver disease
5. Hypersensitivity or allergy considerations

Return detailed interactions with:
- Interacting drugs
- Type of interaction (pharmacokinetic/pharmacodynamic)
- Severity (critical/major/moderate/minor)
- Clinical significance
- Management recommendation
- Alternative medications if needed

Return as JSON array.`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        interactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              drugs: { type: 'array', items: { type: 'string' } },
              type: { type: 'string' },
              severity: { type: 'string' },
              clinical_significance: { type: 'string' },
              recommendation: { type: 'string' },
              alternative: { type: 'string' }
            }
          }
        },
        contraindications: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' }
      }
    }
  });

  return Response.json({
    action: 'drug_interactions',
    interactions: response.interactions || [],
    contraindications: response.contraindications || [],
    summary: response.summary
  });
}