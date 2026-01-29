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

    // Get user's custom vocabulary
    const vocabulary = await getUserVocabulary(base44, user.email);

    // Convert audio file to ArrayBuffer
    const audioBuffer = await audioFile.arrayBuffer();

    // Build Deepgram URL with custom parameters
    let deepgramUrl = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true';
    
    // Add custom vocabulary if available
    if (vocabulary.length > 0) {
      const keywords = vocabulary.slice(0, 100).join(','); // Deepgram supports up to 100 keywords
      deepgramUrl += `&keywords=${encodeURIComponent(keywords)}`;
    }

    // Call Deepgram API
    const deepgramResponse = await fetch(deepgramUrl, {
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

async function getUserVocabulary(base44, userEmail) {
  try {
    const learningData = await base44.asServiceRole.entities.TranscriptionLearning.filter({
      user_email: userEmail
    });

    const vocabulary = new Map();

    learningData.forEach(entry => {
      entry.custom_terms?.forEach(term => {
        const current = vocabulary.get(term.term) || 0;
        vocabulary.set(term.term, current + term.frequency);
      });
    });

    return Array.from(vocabulary.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([term]) => term);
  } catch (error) {
    console.error('Error getting vocabulary:', error);
    return [];
  }
}