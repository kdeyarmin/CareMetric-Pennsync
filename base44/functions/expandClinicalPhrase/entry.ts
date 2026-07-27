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

    // Find matching template. Read as service role so a patient-bound phrase
    // authored by a teammate is reachable (RLS on ClinicalLibraryTemplate scopes
    // the CLIENT list to own/agency-wide). Because this bypasses RLS, any
    // patient-bound match MUST be re-authorized against patient access below.
    const templates = await base44.asServiceRole.entities.ClinicalLibraryTemplate.filter({
      phrase: phrase.toLowerCase().trim(),
      is_active: true
    }, undefined, 5000);

    // A phrase bound to THIS patient wins (e.g. that patient's specific wound-care
    // orders). Enforce patient access BEFORE honoring a patient-bound template: the
    // caller must be able to read the patient under their OWN RLS. Without this
    // gate, an authenticated user could supply another patient's id + a known
    // phrase and retrieve that patient's bound order text (the service-role read
    // and the early generic-branch return would otherwise skip any access check).
    const pid = patientId ? String(patientId) : '';
    let patientBound = pid
      ? templates.find(t => t.patient_id && String(t.patient_id) === pid)
      : undefined;
    if (patientBound) {
      const accessiblePatient = await base44.entities.Patient.filter({ id: patientBound.patient_id }, undefined, 5000);
      if (!accessiblePatient || accessiblePatient.length === 0) {
        patientBound = undefined; // caller has no access to this patient — do not leak bound text
      }
    }

    let template =
      patientBound ||
      templates.find(t => !t.patient_id && (t.is_agency_wide || t.created_by === user.email));

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
    const patient = await base44.entities.Patient.filter({ id: patientId }, undefined, 5000);
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
      error: 'Failed to expand clinical phrase' 
    }, { status: 500 });
  }
});