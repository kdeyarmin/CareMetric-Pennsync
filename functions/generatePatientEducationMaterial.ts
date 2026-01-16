import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientId, diagnosis, topic, educationLevel, language, treatmentPlan } = await req.json();

    if (!diagnosis || !topic) {
      return Response.json({ error: 'Diagnosis and topic are required' }, { status: 400 });
    }

    // Get patient data if provided
    let patientContext = '';
    if (patientId) {
      const patient = await base44.entities.Patient.get(patientId);
      if (patient) {
        patientContext = `Patient: ${patient.first_name} ${patient.last_name}, Age: ${patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}, Primary Diagnosis: ${patient.primary_diagnosis}`;
      }
    }

    // Build the prompt
    const readingLevelDescription = {
      basic: 'elementary school level (simple words, short sentences)',
      intermediate: 'high school level (standard medical terminology with explanations)',
      advanced: 'college level (technical medical terminology)'
    }[educationLevel] || 'general public';

    const prompt = `Generate personalized patient education material for the following:

Topic: ${topic}
Diagnosis: ${diagnosis}
Reading Level: ${readingLevelDescription}
Language: ${language}
${treatmentPlan ? `Treatment Plan: ${treatmentPlan}` : ''}
${patientContext ? `${patientContext}` : ''}

Create comprehensive, engaging, and medically accurate education material that includes:
1. Overview - A clear, non-technical introduction
2. Key Points - 5-7 essential points about the diagnosis and treatment
3. Daily Tips - 4-5 practical daily tips for managing the condition
4. Warning Signs - Important symptoms that require immediate medical attention
5. Resources - Suggested resources or support options

The material should be:
- Written in clear, accessible language appropriate for the reading level
- Personalized based on the provided context
- Encouraging and positive in tone
- Evidence-based and accurate
- Formatted for easy reading

Return the response as JSON with the following structure:
{
  "title": "Title of the education material",
  "overview": "...",
  "key_points": ["point 1", "point 2", ...],
  "daily_tips": ["tip 1", "tip 2", ...],
  "warning_signs": ["sign 1", "sign 2", ...],
  "resources": ["resource 1", "resource 2", ...],
  "language": "${language}"
}`;

    // Call LLM to generate content
    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          overview: { type: 'string' },
          key_points: { type: 'array', items: { type: 'string' } },
          daily_tips: { type: 'array', items: { type: 'string' } },
          warning_signs: { type: 'array', items: { type: 'string' } },
          resources: { type: 'array', items: { type: 'string' } },
          language: { type: 'string' }
        },
        required: ['title', 'overview', 'key_points', 'daily_tips', 'warning_signs']
      }
    });

    return Response.json({ 
      data: { 
        content: result,
        diagnosis,
        topic,
        language,
        readingLevel: educationLevel
      } 
    });
  } catch (error) {
    console.error('Error generating patient education material:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});