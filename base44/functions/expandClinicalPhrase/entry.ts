import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { phrase, patientId, contextData } = await req.json();

    if (!phrase) {
      return Response.json({ error: 'Phrase is required' }, { status: 400 });
    }

    // Find matching template
    const templates = await base44.entities.ClinicalLibraryTemplate.filter({
      phrase: phrase.toLowerCase().trim(),
      is_active: true
    });

    let template = templates.find(t => t.is_agency_wide || t.created_by === user.email);

    if (!template) {
      // No exact match, use AI to generate expansion
      const prompt = `You are a home healthcare documentation assistant. Expand the following clinical phrase into a complete, Medicare-compliant narrative note.

Phrase: "${phrase}"
${patientId ? 'Note: This is for a specific patient, so personalize the documentation.' : ''}
${contextData ? `Context: ${JSON.stringify(contextData)}` : ''}

Generate a clear, professional clinical note that:
- Uses proper medical terminology
- Is Medicare-compliant
- Follows home health documentation standards
- Is specific and measurable
- Includes relevant patient education or interventions

Expanded documentation:`;

      const response = await base44.integrations.Core.InvokeLLM({
        model: "claude_sonnet_4_6",
        prompt,
        add_context_from_internet: false
      });

      return Response.json({
        expandedText: response,
        source: 'ai_generated',
        template: null
      });
    }

    // Template found
    if (template.template_type === 'generic') {
      // Increment usage count
      await base44.asServiceRole.entities.ClinicalLibraryTemplate.update(template.id, {
        usage_count: (template.usage_count || 0) + 1
      });

      return Response.json({
        expandedText: template.expanded_text,
        source: 'template',
        template: template
      });
    }

    // Patient-specific template
    if (!patientId) {
      return Response.json({ 
        error: 'Patient ID required for patient-specific template' 
      }, { status: 400 });
    }

    // Get patient data
    const patient = await base44.entities.Patient.filter({ id: patientId });
    if (!patient || patient.length === 0) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const patientData = patient[0];

    // Build context for AI
    let patientContext = '';
    if (template.patient_data_fields && template.patient_data_fields.length > 0) {
      template.patient_data_fields.forEach(field => {
        if (patientData[field]) {
          patientContext += `${field}: ${JSON.stringify(patientData[field])}\n`;
        }
      });
    }

    // Generate personalized expansion using AI
    const prompt = `You are a home healthcare documentation assistant. Generate Medicare-compliant documentation based on this template and patient data.

Template Instructions: ${template.ai_prompt_instructions || template.expanded_text}

Patient Information:
${patientContext}

Additional Context: ${contextData ? JSON.stringify(contextData) : 'None'}

Generate a complete, personalized clinical note that:
- Uses the patient's specific information
- Is Medicare-compliant
- Follows home health documentation standards
- Is specific and measurable
- Includes dates, measurements, and observations

Expanded documentation:`;

    const expandedText = await base44.integrations.Core.InvokeLLM({
      model: "claude_sonnet_4_6",
      prompt,
      add_context_from_internet: false
    });

    // Increment usage count
    await base44.asServiceRole.entities.ClinicalLibraryTemplate.update(template.id, {
      usage_count: (template.usage_count || 0) + 1
    });

    return Response.json({
      expandedText,
      source: 'patient_specific_template',
      template: template,
      patientData: {
        name: `${patientData.first_name} ${patientData.last_name}`,
        id: patientData.id
      }
    });

  } catch (error) {
    console.error('Error expanding phrase:', error);
    return Response.json({ 
      error: error.message || 'Failed to expand clinical phrase' 
    }, { status: 500 });
  }
});