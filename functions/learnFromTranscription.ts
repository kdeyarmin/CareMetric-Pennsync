import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { original, corrected, context } = await req.json();

    if (!original || !corrected) {
      return Response.json({ error: 'Missing original or corrected text' }, { status: 400 });
    }

    // Extract custom terms from the correction
    const customTerms = extractCustomTerms(original, corrected);

    // Store the learning data
    await base44.asServiceRole.entities.TranscriptionLearning.create({
      user_email: user.email,
      original_transcription: original,
      corrected_transcription: corrected,
      custom_terms: customTerms,
      context: context || 'general'
    });

    // Get user's learned vocabulary
    const vocabulary = await buildUserVocabulary(base44, user.email);

    return Response.json({ 
      success: true,
      vocabulary_count: vocabulary.length,
      message: 'Learning data stored successfully'
    });
  } catch (error) {
    console.error('Learning error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function extractCustomTerms(original, corrected) {
  const terms = [];
  const originalWords = original.toLowerCase().split(/\s+/);
  const correctedWords = corrected.toLowerCase().split(/\s+/);

  // Find words that were changed
  for (let i = 0; i < Math.min(originalWords.length, correctedWords.length); i++) {
    if (originalWords[i] !== correctedWords[i]) {
      terms.push({
        term: correctedWords[i],
        frequency: 1
      });
    }
  }

  // Add any medical-looking terms (capitalized, technical terms)
  const medicalPattern = /\b[A-Z][a-z]+\b|\b[a-z]+itis\b|\b[a-z]+ology\b/g;
  const matches = corrected.match(medicalPattern) || [];
  
  matches.forEach(term => {
    if (!terms.find(t => t.term === term.toLowerCase())) {
      terms.push({
        term: term,
        frequency: 1
      });
    }
  });

  return terms;
}

async function buildUserVocabulary(base44, userEmail) {
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
}