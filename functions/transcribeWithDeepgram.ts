import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const audioFile = formData.get('file');
    
    if (!audioFile) {
      return Response.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const deepgramApiKey = Deno.env.get('DEEPGRAM_API_KEY');
    if (!deepgramApiKey) {
      console.error('DEEPGRAM_API_KEY not set');
      return Response.json({ error: 'Deepgram API key not configured' }, { status: 500 });
    }

    // Convert audio file to ArrayBuffer
    const audioBuffer = await audioFile.arrayBuffer();

    // Call Deepgram API
    const deepgramResponse = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${deepgramApiKey}`,
        'Content-Type': 'audio/webm',
      },
      body: audioBuffer,
    });

    if (!deepgramResponse.ok) {
      const errorText = await deepgramResponse.text();
      console.error('Deepgram API error:', errorText);
      return Response.json({ error: 'Transcription failed' }, { status: 500 });
    }

    const result = await deepgramResponse.json();
    const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    return Response.json({ 
      text: transcript,
      confidence: result.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0
    });
  } catch (error) {
    console.error('Transcription error:', error);
    return Response.json({ error: error.message || 'Transcription failed' }, { status: 500 });
  }
});