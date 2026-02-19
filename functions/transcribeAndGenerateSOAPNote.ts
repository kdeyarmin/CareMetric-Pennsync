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
      audio_file_url,
      patient_id,
      visit_type,
      diagnosis,
      context_data = {},
      nurse_type = 'RN'
    } = body;

    if (!audio_file_url) {
      return Response.json({ error: 'Audio file URL is required' }, { status: 400 });
    }

    const deepgramApiKey = Deno.env.get('DEEPGRAM_API_KEY');
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');

    if (!deepgramApiKey || !anthropicApiKey) {
      console.error('[transcribeAndGenerateSOAPNote] Missing API keys');
      throw new Error('Required API keys not configured');
    }

    console.log('[transcribeAndGenerateSOAPNote] Transcribing audio:', audio_file_url);

    // Fetch audio file
    const audioResponse = await fetch(audio_file_url);
    if (!audioResponse.ok) {
      throw new Error('Failed to fetch audio file');
    }
    const audioBuffer = await audioResponse.arrayBuffer();

    // Transcribe with Deepgram
    const transcriptResponse = await fetch('https://api.deepgram.com/v1/listen', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${deepgramApiKey}`,
        'Content-Type': 'audio/wav'
      },
      body: audioBuffer
    });

    if (!transcriptResponse.ok) {
      const error = await transcriptResponse.text();
      console.error('[transcribeAndGenerateSOAPNote] Deepgram error:', error);
      throw new Error(`Transcription failed: ${transcriptResponse.status}`);
    }

    const transcriptData = await transcriptResponse.json();
    const transcribedText = transcriptData.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    if (!transcribedText) {
      throw new Error('No speech detected in audio');
    }

    console.log('[transcribeAndGenerateSOAPNote] Transcription complete, generating SOAP note');

    // Generate SOAP note from transcription
    const soapPrompt = `You are an expert medical documentation assistant. Convert this voice transcription into a properly formatted SOAP note.

VISIT DETAILS:
- Visit Type: ${visit_type}
- Primary Diagnosis: ${diagnosis}
- Provider Type: ${nurse_type}
${context_data?.patient_name ? `- Patient: ${context_data.patient_name}` : ''}

VOICE TRANSCRIPTION:
${transcribedText}

Create a professional SOAP note with:
1. SUBJECTIVE - Patient's reported symptoms, concerns, history
2. OBJECTIVE - Vital signs, assessments, measurements, observations
3. ASSESSMENT - Clinical interpretation, diagnoses, problem list
4. PLAN - Treatment recommendations, medications, follow-up, patient education

Format it professionally with proper medical terminology and Medicare compliance.`;

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
        messages: [{ role: 'user', content: soapPrompt }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('[transcribeAndGenerateSOAPNote] Claude error:', errorText);
      throw new Error(`SOAP generation failed: ${claudeResponse.status}`);
    }

    const claudeResult = await claudeResponse.json();
    const soapNote = claudeResult.content?.[0]?.text || '';

    return Response.json({
      success: true,
      transcription: transcribedText,
      soap_note: soapNote,
      visit_type,
      diagnosis,
      confidence: transcriptData.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0
    });

  } catch (error) {
    console.error('[transcribeAndGenerateSOAPNote] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});