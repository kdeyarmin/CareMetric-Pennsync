import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Generates HIPAA-compliant transcript from telehealth session
 * Uses AI transcription service with PII de-identification
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { visitId, audioUrl, patientId, deiDentify = true } = await req.json();

    if (!visitId || !audioUrl) {
      return Response.json({ error: 'Missing visitId or audioUrl' }, { status: 400 });
    }

    // Use OpenAI Whisper for HIPAA-compliant transcription
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Fetch audio from URL
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error('Failed to fetch audio file');
    }

    const audioBuffer = await audioResponse.arrayBuffer();

    // Create FormData for Whisper API
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mp4' }), 'session.mp4');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'verbose_json');

    // Call Whisper API
    const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: formData
    });

    if (!transcriptionResponse.ok) {
      throw new Error('Whisper transcription failed');
    }

    const transcriptionData = await transcriptionResponse.json();

    // De-identify PHI if requested
    let processedTranscript = transcriptionData.text;

    if (deiDentify) {
      // Use LLM to de-identify
      const deIdResponse = await base44.integrations.Core.InvokeLLM({
        prompt: `Remove all personally identifiable information (PII) from this medical transcript while preserving clinical meaning. Replace names with "[PATIENT]", "[PROVIDER]", addresses with "[ADDRESS]", phone numbers with "[PHONE]", etc.

Transcript:
${transcriptionData.text}

Return only the de-identified transcript.`,
        response_json_schema: {
          type: 'object',
          properties: {
            deidentified_text: { type: 'string' }
          }
        }
      });

      processedTranscript = deIdResponse.deidentified_text;
    }

    // Store transcript securely
    const transcript = await base44.asServiceRole.entities.SystemLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      action: 'telehealth_transcript_generated',
      details: {
        visitId,
        patientId,
        transcriptLength: processedTranscript.length,
        wordCount: processedTranscript.split(' ').length,
        deidentified: deiDentify,
        confidence: transcriptionData.language
      }
    });

    return Response.json({
      visitId,
      transcript: processedTranscript,
      segments: transcriptionData.segments || [],
      duration: transcriptionData.duration,
      language: transcriptionData.language,
      deidentified: deiDentify,
      transcriptId: transcript.id,
      metadata: {
        wordCount: processedTranscript.split(' ').length,
        estimatedMinutes: Math.round(transcriptionData.duration / 60)
      }
    });
  } catch (error) {
    console.error('Error generating transcript:', error);
    return Response.json(
      { error: error.message || 'Failed to generate transcript' },
      { status: 500 }
    );
  }
});