import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      action, // 'populate_fields' | 'suggest_codes' | 'generate_education' | 'check_compliance'
      patient_id,
      visit_type,
      diagnosis,
      clinical_notes,
      extracted_data
    } = await req.json();

    if (!action) {
      return Response.json({ error: 'Action required' }, { status: 400 });
    }

    // Get patient context
    let patientContext = null;
    if (patient_id) {
      const patients = await base44.entities.Patient.filter({ id: patient_id });
      if (patients.length > 0) {
        patientContext = patients[0];
      }
    }

    switch (action) {
      case 'populate_fields': {
        return await populateFields(base44, patientContext, visit_type, diagnosis, extracted_data);
      }

      case 'suggest_codes': {
        return await suggestICD10Codes(base44, clinical_notes, diagnosis, patientContext);
      }

      case 'generate_education': {
        return await generateEducationMaterial(base44, patientContext, diagnosis, clinical_notes);
      }

      case 'check_compliance': {
        return await checkCompliance(base44, clinical_notes, visit_type, diagnosis, user.credential_type);
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Documentation assistant error:', error);
    return Response.json(
      { error: error.message || 'Documentation assistant error' },
      { status: 500 }
    );
  }
});

async function populateFields(base44, patientContext, visitType, diagnosis, extractedData) {
  if (!patientContext) {
    return Response.json({ fields: {} });
  }

  const prompt = `Based on the patient's medical history and visit context, populate these clinical documentation fields:

Patient: ${patientContext.first_name} ${patientContext.last_name}
Age: ${patientContext.date_of_birth ? Math.floor((new Date() - new Date(patientContext.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
Primary Diagnosis: ${patientContext.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${patientContext.secondary_diagnoses?.join(', ') || 'None'}
Current Medications: ${patientContext.current_medications?.join(', ') || 'None'}
Allergies: ${patientContext.allergies?.join(', ') || 'None'}
Visit Type: ${visitType}
Current Diagnosis: ${diagnosis}

Provide auto-populated field suggestions for:
1. Assessment (based on patient history and diagnosis)
2. Plan (evidence-based next steps)
3. Patient Instructions (specific to diagnosis)
4. Follow-up Schedule (appropriate for condition)
5. Red Flags to Watch (warning signs specific to diagnosis)

Format as JSON with these keys.`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        assessment: { type: 'string' },
        plan: { type: 'string' },
        patient_instructions: { type: 'string' },
        follow_up_schedule: { type: 'string' },
        red_flags: { type: 'array', items: { type: 'string' } }
      }
    }
  });

  return Response.json({
    action: 'populate_fields',
    fields: response,
    patient_name: `${patientContext.first_name} ${patientContext.last_name}`
  });
}

async function suggestICD10Codes(base44, clinicalNotes, diagnosis, patientContext) {
  if (!clinicalNotes) {
    return Response.json({ codes: [] });
  }

  const prompt = `Based on the clinical notes and diagnosis, suggest the most appropriate ICD-10 codes.

Clinical Notes:
${clinicalNotes}

Primary Diagnosis: ${diagnosis}
Patient History: ${patientContext?.primary_diagnosis || 'Not specified'}

Suggest 3-5 relevant ICD-10 codes with:
1. Code (e.g., E11.9)
2. Description
3. Specificity level (primary, secondary, comorbidity)
4. Confidence (high/medium/low)
5. Justification from the clinical notes

Return as JSON array.`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        codes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              description: { type: 'string' },
              specificity: { type: 'string' },
              confidence: { type: 'string' },
              justification: { type: 'string' }
            }
          }
        }
      }
    }
  });

  return Response.json({
    action: 'suggest_codes',
    codes: response.codes || []
  });
}

async function generateEducationMaterial(base44, patientContext, diagnosis, clinicalNotes) {
  if (!patientContext || !diagnosis) {
    return Response.json({ material: null });
  }

  const patientAge = patientContext.date_of_birth 
    ? Math.floor((new Date() - new Date(patientContext.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  const prompt = `Create patient education material for: ${diagnosis}

Patient: ${patientContext.first_name} ${patientContext.last_name}
Age: ${patientAge || 'Unknown'}
Medical History: ${patientContext.secondary_diagnoses?.join(', ') || 'None'}
Current Medications: ${patientContext.current_medications?.slice(0, 3).join(', ') || 'Standard treatment'}

Create educational material including:
1. Simple explanation of the condition
2. Warning signs to watch for
3. Medication/treatment overview
4. Lifestyle modifications
5. When to contact healthcare provider
6. Key takeaways

Use simple, clear language appropriate for patient understanding.
Format as markdown with sections.`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        key_points: { type: 'array', items: { type: 'string' } },
        warning_signs: { type: 'array', items: { type: 'string' } },
        when_to_contact: { type: 'string' }
      }
    }
  });

  return Response.json({
    action: 'generate_education',
    material: response
  });
}

async function checkCompliance(base44, clinicalNotes, visitType, diagnosis, providerType) {
  if (!clinicalNotes) {
    return Response.json({ issues: [] });
  }

  const prompt = `Review this clinical note for compliance and quality issues.

Clinical Note:
${clinicalNotes}

Visit Type: ${visitType}
Diagnosis: ${diagnosis}
Provider Type: ${providerType}

Check for:
1. Completeness (all required elements present)
2. Specificity (diagnosis specific, not vague)
3. Documentation standards (objective vs subjective data)
4. Medical necessity documentation
5. Timeframes and dates
6. Patient safety concerns

Return issues found with:
- Issue description
- Severity (critical/high/medium/low)
- Section affected
- Recommended fix
- Compliance standard violated

Return as JSON array.`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              severity: { type: 'string' },
              section: { type: 'string' },
              recommendation: { type: 'string' },
              standard: { type: 'string' }
            }
          }
        },
        summary: { type: 'string' },
        compliance_score: { type: 'number' }
      }
    }
  });

  return Response.json({
    action: 'check_compliance',
    issues: response.issues || [],
    summary: response.summary,
    compliance_score: response.compliance_score || 0
  });
}