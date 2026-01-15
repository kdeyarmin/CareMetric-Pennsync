import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'Patient ID is required' }, { status: 400 });
    }

    // Fetch patient data
    const patient = await base44.entities.Patient.list('-updated_date', 1);
    const patientRecord = patient.find(p => p.id === patient_id);

    if (!patientRecord) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Fetch all available templates
    const allTemplates = await base44.entities.DocumentTemplate.list('-created_date', 100);

    // Build patient summary for AI
    const patientSummary = `
Patient: ${patientRecord.first_name} ${patientRecord.last_name}
Age: ${patientRecord.date_of_birth ? Math.floor((new Date() - new Date(patientRecord.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
Primary Diagnosis: ${patientRecord.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${patientRecord.secondary_diagnoses?.join(', ') || 'None'}
Current Medications: ${patientRecord.current_medications?.map(m => m.name).join(', ') || 'None'}
Allergies: ${patientRecord.allergies || 'None'}
Functional Status: ${patientRecord.functional_status?.adl_independence || 'Unknown'}
Care Type: ${patientRecord.care_type || 'Unknown'}
`;

    // Use AI to suggest templates and fields
    const suggestion = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a healthcare documentation expert. Based on the following patient information, suggest the most appropriate document templates from the provided list and pre-fill values for common fields.

Patient Information:
${patientSummary}

Available Templates:
${allTemplates.map((t, i) => `${i + 1}. ${t.template_name} (Type: ${t.template_type})`).join('\n')}

Respond with JSON containing:
{
  "suggested_templates": [
    { "template_id": "template_id", "template_name": "name", "reason": "why this template is relevant", "priority": 1-3 }
  ],
  "pre_filled_fields": {
    "field_name": "value"
  },
  "general_notes": "any clinical notes for the provider"
}

Return ONLY valid JSON, no explanations.`,
      response_json_schema: {
        type: 'object',
        properties: {
          suggested_templates: { type: 'array' },
          pre_filled_fields: { type: 'object' },
          general_notes: { type: 'string' }
        }
      }
    });

    // Match template IDs with actual templates
    const suggestedWithDetails = suggestion.suggested_templates.map(sug => {
      const template = allTemplates.find(t => t.template_name === sug.template_name);
      return {
        ...sug,
        template_id: template?.id,
        template_type: template?.template_type,
        description: template?.description
      };
    }).filter(t => t.template_id); // Only include templates we found

    // Merge pre-filled fields with patient data
    const enrichedFields = {
      patient_name: `${patientRecord.first_name} ${patientRecord.last_name}`,
      patient_dob: patientRecord.date_of_birth,
      patient_email: patientRecord.email,
      diagnosis: patientRecord.primary_diagnosis,
      allergies: patientRecord.allergies,
      current_medications: patientRecord.current_medications?.map(m => `${m.name} ${m.dosage || ''}`).join(', '),
      ...suggestion.pre_filled_fields
    };

    return Response.json({
      success: true,
      suggested_templates: suggestedWithDetails,
      pre_filled_fields: enrichedFields,
      general_notes: suggestion.general_notes,
      patient_info: {
        name: `${patientRecord.first_name} ${patientRecord.last_name}`,
        diagnosis: patientRecord.primary_diagnosis
      }
    });

  } catch (error) {
    console.error('Error suggesting templates:', error);
    return Response.json({ 
      error: 'Failed to suggest templates',
      details: error.message 
    }, { status: 500 });
  }
});