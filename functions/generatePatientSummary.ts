import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      patient_id,
      summary_length = 'medium', // short | medium | long
      focus_areas = [], // e.g., ['cardiac', 'respiratory', 'medications']
      include_vitals = true,
      include_medications = true,
      include_allergies = true,
      include_recent_visits = true
    } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'Patient ID required' }, { status: 400 });
    }

    // Fetch patient data
    const patients = await base44.entities.Patient.filter({ id: patient_id });
    if (patients.length === 0) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const patient = patients[0];

    // Build context from patient data
    let contextParts = [];

    if (include_allergies && patient.allergies) {
      contextParts.push(`**Allergies**: ${patient.allergies.join(', ')}`);
    }

    if (include_medications && patient.current_medications) {
      contextParts.push(`**Current Medications**: ${patient.current_medications.join(', ')}`);
    }

    if (patient.primary_diagnosis) {
      contextParts.push(`**Primary Diagnosis**: ${patient.primary_diagnosis}`);
    }

    if (patient.secondary_diagnoses && patient.secondary_diagnoses.length > 0) {
      contextParts.push(`**Secondary Diagnoses**: ${patient.secondary_diagnoses.join(', ')}`);
    }

    // Include recent notes
    const recentNotes = patient.enhanced_notes_history ? patient.enhanced_notes_history.slice(-5) : [];
    if (include_recent_visits && recentNotes.length > 0) {
      const noteSummaries = recentNotes.map(note => 
        `- ${new Date(note.date).toLocaleDateString()}: ${note.visit_type} (${note.diagnosis})`
      ).join('\n');
      contextParts.push(`**Recent Visits**:\n${noteSummaries}`);
    }

    // Calculate length targets
    const lengthConfig = {
      short: { words: 150, detail: 'bullet points only' },
      medium: { words: 300, detail: 'balanced detail' },
      long: { words: 500, detail: 'comprehensive detail' }
    };

    const config = lengthConfig[summary_length] || lengthConfig.medium;

    // Build focus area instruction
    let focusInstruction = '';
    if (focus_areas.length > 0) {
      focusInstruction = `\n\nPrioritize these focus areas: ${focus_areas.join(', ')}. Give extra attention to these areas in the summary.`;
    }

    // Create prompt
    const prompt = `You are a clinical summary specialist. Generate a concise patient summary for a healthcare provider before a visit.

Patient Information:
${contextParts.join('\n')}

Requirements:
- Keep summary to approximately ${config.words} words with ${config.detail}
- Focus on clinically relevant information
- Use clear, scannable formatting (use ** for bold, - for lists)
- Highlight any critical or trending issues
- Include date context for recent events${focusInstruction}

Generate the summary now:`;

    // Call LLM
    const summaryResponse = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false,
      response_json_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          key_points: { 
            type: 'array',
            items: { type: 'string' }
          },
          concerns: {
            type: 'array',
            items: { type: 'string' }
          },
          recommendations: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['summary']
      }
    });

    // Cache the summary
    try {
      const cache = JSON.parse(localStorage?.getItem('patient_summaries') || '{}');
      cache[patient_id] = {
        summary: summaryResponse.summary,
        key_points: summaryResponse.key_points || [],
        concerns: summaryResponse.concerns || [],
        recommendations: summaryResponse.recommendations || [],
        generated_at: new Date().toISOString(),
        length: summary_length,
        focus_areas
      };
      localStorage?.setItem('patient_summaries', JSON.stringify(cache));
    } catch (e) {
      console.error('Could not cache summary:', e);
    }

    return Response.json({
      patient_name: `${patient.first_name} ${patient.last_name}`,
      mrn: patient.medical_record_number,
      summary: summaryResponse.summary,
      key_points: summaryResponse.key_points || [],
      concerns: summaryResponse.concerns || [],
      recommendations: summaryResponse.recommendations || [],
      generated_at: new Date().toISOString(),
      length: summary_length
    });
  } catch (error) {
    console.error('Error generating patient summary:', error);
    return Response.json({ 
      error: error.message || 'Failed to generate patient summary',
      details: error.toString()
    }, { status: 500 });
  }
});