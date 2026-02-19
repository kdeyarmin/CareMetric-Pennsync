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
      diagnosis_codes = [],
      care_plan_goals = [],
      reading_level = 'simple',
      max_materials = 5
    } = body;

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    console.log('[smartEducationRecommender] Generating recommendations for diagnoses:', diagnosis_codes);

    const diagnosisText = diagnosis_codes.join(', ');
    const goalsText = care_plan_goals.join('; ');

    const recommendationPrompt = `Based on the following patient information, recommend the most relevant patient education materials:

DIAGNOSES: ${diagnosisText}
CARE PLAN GOALS: ${goalsText}
READING LEVEL: ${reading_level}

Provide ${max_materials} prioritized education material recommendations with:
1. Topic/Title
2. Key learning objectives
3. Estimated time to complete
4. Relevance to patient's specific diagnoses and goals
5. Priority level (high/medium/low)

Format as structured list with clinical rationale for each recommendation.`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content: recommendationPrompt }]
      })
    });

    if (!claudeResponse.ok) {
      throw new Error(`Claude API failed: ${claudeResponse.status}`);
    }

    const claudeResult = await claudeResponse.json();
    const recommendations = claudeResult.content?.[0]?.text || '';

    // Parse recommendations and create education materials
    const educationPromises = [];
    const diagnosisSet = new Set(diagnosis_codes);

    for (const diagnosis of Array.from(diagnosisSet).slice(0, max_materials)) {
      educationPromises.push(
        base44.functions.invoke('generatePatientEducation', {
          patient_id,
          diagnosis: [diagnosis],
          reading_level,
          include_warnings: true,
          include_action_items: true
        })
      );
    }

    const educationResults = await Promise.allSettled(educationPromises);
    const materials = educationResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value?.data || {});

    return Response.json({
      success: true,
      recommendations,
      generated_materials: materials,
      diagnosis_codes,
      care_plan_goals
    });

  } catch (error) {
    console.error('[smartEducationRecommender] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});