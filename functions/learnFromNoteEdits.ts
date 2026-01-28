import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      original_note, 
      edited_note, 
      visit_type, 
      provider_type 
    } = await req.json();

    // Simple diff analysis to identify patterns
    const patterns = [];

    // Check for consistent phrase replacements
    const originalPhrases = original_note.split(/[.!?]/).map(s => s.trim()).filter(Boolean);
    const editedPhrases = edited_note.split(/[.!?]/).map(s => s.trim()).filter(Boolean);

    // Look for additions
    const additions = editedPhrases.filter(phrase => 
      !originalPhrases.some(orig => orig.includes(phrase.substring(0, 30)))
    );

    // Look for removals or simplifications
    const removals = originalPhrases.filter(phrase => 
      !editedPhrases.some(edit => edit.includes(phrase.substring(0, 30)))
    );

    if (additions.length > 0) {
      patterns.push({
        pattern_type: 'preferred_addition',
        context: visit_type,
        example: additions[0],
        frequency: 1
      });
    }

    if (removals.length > 0) {
      patterns.push({
        pattern_type: 'preferred_removal',
        context: visit_type,
        example: removals[0],
        frequency: 1
      });
    }

    // Check for style preferences
    const originalAvgSentenceLength = original_note.split(/[.!?]/).length;
    const editedAvgSentenceLength = edited_note.split(/[.!?]/).length;

    if (Math.abs(originalAvgSentenceLength - editedAvgSentenceLength) > 2) {
      patterns.push({
        pattern_type: editedAvgSentenceLength < originalAvgSentenceLength ? 'prefers_concise' : 'prefers_detailed',
        context: 'general',
        example: `Average sentences: ${editedAvgSentenceLength}`,
        frequency: 1
      });
    }

    // Store or update learned patterns
    const existingPatterns = await base44.asServiceRole.entities.LearnedFormatPattern.filter({
      provider_email: user.email,
      provider_type: provider_type
    });

    for (const pattern of patterns) {
      const existing = existingPatterns.find(p => 
        p.pattern_type === pattern.pattern_type && 
        p.context === pattern.context
      );

      try {
        if (existing) {
          // Update frequency
          await base44.asServiceRole.entities.LearnedFormatPattern.update(existing.id, {
            frequency_count: (existing.frequency_count || 1) + 1,
            examples: [...(existing.examples || []), pattern.example].slice(-5) // Keep last 5
          });
        } else {
          // Create new pattern
          await base44.asServiceRole.entities.LearnedFormatPattern.create({
          provider_email: user.email,
          provider_name: user.full_name,
          provider_type: provider_type,
          pattern_type: pattern.pattern_type,
          context: pattern.context,
          examples: [pattern.example],
          frequency_count: 1,
          last_applied: new Date().toISOString()
          });
          }
          } catch (patternError) {
          console.error(`Failed to save pattern ${pattern.pattern_type}:`, patternError);
          }
          }

    return Response.json({
      success: true,
      patterns_learned: patterns.length,
      message: 'Learning patterns updated'
    });

  } catch (error) {
    console.error('Error learning from edits:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});