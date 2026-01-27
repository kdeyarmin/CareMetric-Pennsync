import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { topic_type, topic_name, patient_age, reading_level = 'intermediate', format = 'comprehensive' } = await req.json();

    if (!topic_type || !topic_name) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const readingLevelGuidance = {
      simple: 'Use very simple language, short sentences, define all medical terms. Reading level: 5th grade.',
      intermediate: 'Use clear language with some medical terms explained. Reading level: 8th-9th grade.',
      advanced: 'Use standard medical language. Reading level: college level.'
    };

    const formatGuidance = format === 'comprehensive' 
      ? 'Include sections: What is it?, Why it matters, Symptoms/Signs, Treatment/Management, Self-care tips, When to call doctor, Questions to ask doctor'
      : 'Create a concise handout with key points, bullet-point format, visual recommendations, and action items';

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a medical education specialist. Create patient-friendly educational material about a ${topic_type}.

Topic: ${topic_name}
${patient_age ? `Patient Age/Context: ${patient_age}` : ''}
Reading Level: ${readingLevelGuidance[reading_level] || readingLevelGuidance.intermediate}
Format: ${formatGuidance}

Create educational material that:
1. Is easy to understand for a non-medical audience
2. Explains the condition/procedure/medication clearly
3. Includes practical self-management tips
4. Lists warning signs to watch for
5. Encourages questions for healthcare provider
6. Is engaging and supportive in tone
7. Avoids medical jargon or explains it clearly

${format === 'comprehensive' ? 'Organize with clear section headers.' : 'Format as a concise one-page handout.'}

Return as a JSON object with:
- title: Material title
- content: Full educational content (well-formatted with line breaks and sections)
- key_points: Array of 3-5 key takeaways
- warning_signs: Array of symptoms/signs to watch
- action_items: Array of recommended actions/lifestyle changes
- resources: Array of recommended resources or when to seek help`,
      response_json_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          key_points: { 
            type: 'array',
            items: { type: 'string' }
          },
          warning_signs: {
            type: 'array',
            items: { type: 'string' }
          },
          action_items: {
            type: 'array',
            items: { type: 'string' }
          },
          resources: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    });

    return Response.json({
      success: true,
      material: response,
      topic_type,
      topic_name,
      reading_level,
      format,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating patient education:', error);
    return Response.json({ 
      error: error.message,
      success: false
    }, { status: 500 });
  }
});