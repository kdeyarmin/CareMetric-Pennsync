import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      enhanced_note,
      provider_type,
      visit_type,
      suggested_suggestions = []
    } = await req.json();

    console.log(`Applying learned preferences for user: ${user.email}`);

    // Fetch user's learned patterns
    const learnedPatterns = await base44.entities.UserLearnedPattern.filter({
      user_email: user.email,
      provider_type: provider_type,
      is_active: true
    });

    if (!learnedPatterns || learnedPatterns.length === 0) {
      console.log('No learned patterns found');
      return Response.json({
        success: true,
        enhanced_note: enhanced_note,
        applied_patterns: [],
        filtered_suggestions: suggested_suggestions
      });
    }

    // Apply text patterns to enhance note
    let refinedNote = enhanced_note;
    const appliedPatterns = [];

    for (const pattern of learnedPatterns) {
      // Only apply high-confidence patterns
      if (pattern.confidence_score >= 65 && pattern.original_text) {
        // Check if pattern's original text exists in the note
        if (refinedNote.includes(pattern.original_text)) {
          refinedNote = refinedNote.replace(new RegExp(escapeRegex(pattern.original_text), 'g'), pattern.user_preferred_text);
          appliedPatterns.push({
            pattern_category: pattern.pattern_category,
            confidence: pattern.confidence_score,
            replacements_made: 1
          });
          console.log(`Applied pattern: ${pattern.pattern_category} (confidence: ${pattern.confidence_score}%)`);
        }
      }
    }

    // Filter suggestions based on user preferences
    const filteredSuggestions = filterSuggestionsBasedOnPreference(
      suggested_suggestions,
      learnedPatterns
    );

    console.log(`Applied ${appliedPatterns.length} patterns, filtered suggestions from ${suggested_suggestions.length} to ${filteredSuggestions.length}`);

    return Response.json({
      success: true,
      enhanced_note: refinedNote,
      applied_patterns: appliedPatterns,
      filtered_suggestions: filteredSuggestions
    });

  } catch (error) {
    console.error('Error applying learned preferences:', error);
    return Response.json({ 
      error: error.message || 'Failed to apply learned preferences',
      details: error.stack 
    }, { status: 500 });
  }
});

function filterSuggestionsBasedOnPreference(suggestions, patterns) {
  if (!suggestions || suggestions.length === 0) return [];

  return suggestions.filter(suggestion => {
    // Check if user has rejected similar suggestions before
    const rejectionPattern = patterns.find(p =>
      p.pattern_type === 'suggestion_preference' &&
      p.pattern_category === suggestion.category &&
      p.suggestions_rejected > p.suggestions_accepted * 2 // 2x more rejections than acceptances
    );

    if (rejectionPattern && rejectionPattern.confidence_score >= 70) {
      console.log(`Filtered out suggestion for ${suggestion.category} (rejected by user before)`);
      return false; // Don't include this suggestion
    }

    return true; // Include this suggestion
  });
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}