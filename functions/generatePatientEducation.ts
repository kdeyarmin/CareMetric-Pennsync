import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      patient_id,
      diagnosis = [],
      reading_level = 'simple',
      include_warnings = true,
      include_action_items = true
    } = body;

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      console.error('[generatePatientEducation] ANTHROPIC_API_KEY not configured');
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const diagnosisText = Array.isArray(diagnosis) ? diagnosis.join(', ') : diagnosis;
    const readingLevelDesc = {
      simple: 'simple, easy-to-understand language suitable for a general audience',
      intermediate: 'moderate medical terminology with explanations',
      advanced: 'detailed medical terminology and complex concepts'
    }[reading_level] || 'simple';

    const educationPrompt = `Create personalized patient education material for a patient with the following diagnoses: ${diagnosisText}

Use ${readingLevelDesc}.

Structure the material with:
1. Overview (what is this condition?)
2. Symptoms to watch for
${include_warnings ? '3. Warning signs requiring immediate medical attention\n' : ''}
4. Daily management tips
${include_action_items ? '5. Action items for the patient\n' : ''}
6. When to call the doctor
7. Resources and support

Keep it engaging and encouraging.`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        messages: [{ role: 'user', content: educationPrompt }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('[generatePatientEducation] Claude API error:', errorText);
      throw new Error(`Claude API failed: ${claudeResponse.status}`);
    }

    const claudeResult = await claudeResponse.json();
    const educationContent = claudeResult.content?.[0]?.text || '';

    // Create education material record
    const educationMaterial = await base44.asServiceRole.entities.PatientEducationMaterial.create({
      title: `Education: ${diagnosisText}`,
      topic: diagnosisText,
      category: 'general',
      content: educationContent,
      content_type: 'markdown',
      reading_level: reading_level,
      patient_specific: true,
      target_patient_id: patient_id,
      created_by: user.email,
      is_approved: true
    });

    console.log('[generatePatientEducation] Created education material:', educationMaterial.id);

    return Response.json({
      success: true,
      material_id: educationMaterial.id,
      content: educationContent,
      diagnosis: diagnosisText
    });

  } catch (error) {
    console.error('[generatePatientEducation] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});