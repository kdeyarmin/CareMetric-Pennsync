import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { provider_type, min_occurrences = 3 } = await req.json();

    // Fetch user's note history from patients
    const patients = await base44.entities.Patient.list('-updated_date', 500);
    const userNotes = [];

    // Extract all notes created by this user
    for (const patient of patients) {
      const notes = (patient.enhanced_notes_history || []).filter(
        note => note.nurse_email === user.email
      );
      userNotes.push(...notes.map(n => n.enhanced_note || n.rough_note));
    }

    if (userNotes.length < 5) {
      return Response.json({ 
        suggested_phrases: [],
        message: 'Not enough notes to analyze patterns. Keep documenting!'
      });
    }

    // Use AI to identify frequently used phrases
    const analysisPrompt = `Analyze these clinical notes and identify frequently used phrases, sentence structures, or documentation patterns that appear ${min_occurrences} or more times.

Focus on:
- Assessment phrases (e.g., "Patient reports...", "Patient denies...")
- Intervention descriptions (e.g., "Provided education on...", "Administered...")
- Common documentation patterns specific to this provider type: ${provider_type}
- Skilled nursing justifications
- Patient response patterns
- Safety assessment phrases

Notes to analyze:
${userNotes.slice(0, 20).join('\n\n---\n\n')}

Return ONLY phrases that:
1. Are clinically meaningful (not just "the patient")
2. Appear at least ${min_occurrences} times
3. Are complete thoughts or useful snippets (5-50 words)
4. Would save time if reusable

Format your response as a JSON array of objects with this structure:
{
  "phrase_name": "Brief descriptive name",
  "phrase_content": "The actual phrase text",
  "category": "assessment|intervention|education|homebound|skilled_need|vital_signs|safety|medication|wound_care",
  "occurrences": number,
  "suggested_tags": ["tag1", "tag2"]
}`;

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          phrases: {
            type: "array",
            items: {
              type: "object",
              properties: {
                phrase_name: { type: "string" },
                phrase_content: { type: "string" },
                category: { type: "string" },
                occurrences: { type: "number" },
                suggested_tags: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      }
    });

    const suggestedPhrases = response.phrases || [];

    // Filter out phrases already in library
    const existingPhrases = await base44.entities.SharedPhraseLibrary.list();
    const newPhrases = suggestedPhrases.filter(suggested => 
      !existingPhrases.some(existing => 
        existing.phrase_content?.toLowerCase().includes(suggested.phrase_content?.toLowerCase()) ||
        suggested.phrase_content?.toLowerCase().includes(existing.phrase_content?.toLowerCase())
      )
    );

    return Response.json({
      suggested_phrases: newPhrases,
      total_notes_analyzed: userNotes.length,
      existing_phrases_count: existingPhrases.length
    });

  } catch (error) {
    console.error('Error analyzing phrases:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});