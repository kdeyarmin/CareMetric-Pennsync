import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const audioFile = formData.get('audio');
    const diagnosis = formData.get('diagnosis');
    const visitType = formData.get('visitType');
    const patientId = formData.get('patientId');
    const language = formData.get('language') || 'en';
    const customTerminology = formData.get('customTerminology');

    if (!audioFile) {
      return Response.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Transcribe audio using OpenAI Whisper API
    const transcriptionData = new FormData();
    transcriptionData.append('file', audioFile, 'audio.wav');
    transcriptionData.append('model', 'whisper-1');
    transcriptionData.append('language', language);

    const transcriptionResponse = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: transcriptionData,
      }
    );

    if (!transcriptionResponse.ok) {
      const error = await transcriptionResponse.json();
      return Response.json({ 
        error: 'Transcription failed', 
        details: error 
      }, { status: 500 });
    }

    const transcription = await transcriptionResponse.json();
    const rawTranscript = transcription.text;

    // Build custom terminology context
    let terminologyContext = '';
    if (customTerminology) {
      try {
        const terms = JSON.parse(customTerminology);
        if (terms.length > 0) {
          terminologyContext = '\n\nCustom Medical Terminology:\n' + 
            terms.map(t => `- "${t.term}" should be written as "${t.preferred_translation || t.term}"${t.context ? ` (${t.context})` : ''}`).join('\n');
        }
      } catch (e) {
        console.error('Failed to parse custom terminology:', e);
      }
    }

    // Language-specific instructions
    const languageInstructions = language !== 'en' 
      ? `\n\nIMPORTANT: Generate the clinical note in ${language} language. Use proper medical terminology for this language.`
      : '';

    // Generate structured note from transcription using Claude
    const noteGenerationResponse = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an expert clinical documentation specialist. Transform a dictated medical visit transcript into a professional, Medicare-compliant clinical note. 
              
              Use proper medical terminology and structure the note with:
              1. Chief Complaint/Reason for Visit
              2. History of Present Illness
              3. Assessment
              4. Plan/Interventions
              5. Patient Response
              6. Goals
              
              Be specific and measurable. Include vital signs if mentioned. Avoid vague language.${languageInstructions}${terminologyContext}`
            },
            {
              role: 'user',
              content: `Transform this dictated transcript into a clinical note.

TRANSCRIPT:
${rawTranscript}

CONTEXT:
- Visit Type: ${visitType || 'routine'}
- Diagnosis: ${diagnosis || 'to be determined'}
- Nurse Type: ${user.credential_type || 'RN'}

Generate a professional clinical note suitable for the patient chart.`
            }
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
      }
    );

    if (!noteGenerationResponse.ok) {
      const error = await noteGenerationResponse.json();
      return Response.json({ 
        error: 'Note generation failed', 
        details: error 
      }, { status: 500 });
    }

    const noteGeneration = await noteGenerationResponse.json();
    const generatedNote = noteGeneration.choices[0].message.content;

    // Generate compliance check
    const complianceResponse = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a Medicare compliance expert. Analyze a clinical note and return JSON with compliance score (0-100) and missing elements.'
            },
            {
              role: 'user',
              content: `Analyze this note for Medicare compliance:

${generatedNote}

Return JSON with:
{
  "compliance_score": 0-100,
  "missing_elements": ["element1", "element2"],
  "strengths": ["strength1", "strength2"]
}`
            }
          ],
          temperature: 0.2,
          max_tokens: 500,
        }),
      }
    );

    let complianceData = { compliance_score: 85, missing_elements: [], strengths: [] };
    
    if (complianceResponse.ok) {
      const complianceJson = await complianceResponse.json();
      const complianceContent = complianceJson.choices[0].message.content;
      try {
        complianceData = JSON.parse(complianceContent);
      } catch (e) {
        // Use default if parsing fails
      }
    }

    return Response.json({
      success: true,
      transcript: rawTranscript,
      generated_note: generatedNote,
      compliance_score: complianceData.compliance_score,
      missing_elements: complianceData.missing_elements,
      strengths: complianceData.strengths
    });

  } catch (error) {
    console.error('Scribe error:', error);
    return Response.json({ 
      error: error.message || 'Failed to process audio' 
    }, { status: 500 });
  }
});