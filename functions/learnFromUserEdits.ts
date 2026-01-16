import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      original_enhanced_note,
      edited_note,
      visit_type,
      provider_type,
      compliance_issues_before,
      compliance_issues_after,
      rejected_suggestions = [],
      accepted_suggestions = []
    } = await req.json();

    console.log(`Learning from edits for user: ${user.email}`);

    // Analyze the differences between original and edited note
    const patterns = [];

    // Extract text patterns from edits
    if (original_enhanced_note && edited_note && original_enhanced_note !== edited_note) {
      patterns.push(...analyzeTextPatterns(original_enhanced_note, edited_note, visit_type));
    }

    // Learn from suggestion acceptance/rejection
    patterns.push(...analyzeSuggestionPreferences(accepted_suggestions, rejected_suggestions, visit_type));

    // Learn from compliance improvements
    if (compliance_issues_before && compliance_issues_after) {
      patterns.push(...analyzeCompliancePatterns(compliance_issues_before, compliance_issues_after, visit_type));
    }

    // Store or update learned patterns
    for (const pattern of patterns) {
      await storeLearnedPattern(base44, user.email, provider_type, pattern);
    }

    console.log(`Learned ${patterns.length} patterns from user edits`);

    return Response.json({
      success: true,
      patterns_learned: patterns.length,
      data: patterns
    });

  } catch (error) {
    console.error('Error learning from edits:', error);
    return Response.json({ 
      error: error.message || 'Failed to learn from edits',
      details: error.stack 
    }, { status: 500 });
  }
});

function analyzeTextPatterns(original, edited, visitType) {
  const patterns = [];
  
  // Split into sentences for comparison
  const originalSentences = original.match(/[^.!?]+[.!?]+/g) || [];
  const editedSentences = edited.match(/[^.!?]+[.!?]+/g) || [];

  for (let i = 0; i < Math.min(originalSentences.length, editedSentences.length); i++) {
    const origSent = originalSentences[i].trim();
    const editSent = editedSentences[i].trim();

    if (origSent !== editSent && origSent.length > 10 && editSent.length > 10) {
      // Extract category from content
      const category = extractPatternCategory(origSent, editSent);
      
      patterns.push({
        pattern_type: 'phrasing',
        pattern_category: category,
        original_text: origSent,
        user_preferred_text: editSent,
        frequency: 1,
        visit_types: [visitType],
        suggestions_accepted: 0,
        suggestions_rejected: 0
      });
    }
  }

  return patterns;
}

function analyzeSuggestionPreferences(accepted, rejected, visitType) {
  const patterns = [];

  // Track accepted suggestions
  accepted.forEach(suggestion => {
    patterns.push({
      pattern_type: 'suggestion_preference',
      pattern_category: suggestion.category || 'general',
      original_text: suggestion.original || '',
      user_preferred_text: suggestion.accepted_text || '',
      frequency: 1,
      visit_types: [visitType],
      suggestions_accepted: 1,
      suggestions_rejected: 0
    });
  });

  // Track rejected suggestions
  rejected.forEach(suggestion => {
    patterns.push({
      pattern_type: 'suggestion_preference',
      pattern_category: suggestion.category || 'general',
      original_text: suggestion.suggestion_text || '',
      user_preferred_text: '', // User didn't want this
      frequency: 1,
      visit_types: [visitType],
      suggestions_accepted: 0,
      suggestions_rejected: 1
    });
  });

  return patterns;
}

function analyzeCompliancePatterns(before, after, visitType) {
  const patterns = [];

  // Identify which compliance issues were fixed
  const fixedIssues = before.filter(issue => 
    !after.some(a => a.element === issue.element)
  );

  fixedIssues.forEach(issue => {
    patterns.push({
      pattern_type: 'compliance_priority',
      pattern_category: issue.element,
      original_text: issue.problem,
      user_preferred_text: issue.suggestion || '',
      frequency: 1,
      visit_types: [visitType],
      suggestions_accepted: 1,
      suggestions_rejected: 0
    });
  });

  return patterns;
}

function extractPatternCategory(original, edited) {
  // Determine what kind of pattern change this is
  const categories = {
    patient_response: /patient|reports|states|expresses|indicates|responds/i,
    vital_signs: /temperature|heart rate|blood pressure|respiratory|oxygen|vital|bp|temp/i,
    pain_description: /pain|discomfort|ache|soreness|tenderness|hurt/i,
    medication: /medication|drug|medicine|prescribed|administered/i,
    wound_care: /wound|dressing|pressure ulcer|healing|infection/i,
    assessment: /assessment|evaluated|examined|observed|noted/i,
    intervention: /intervention|treatment|nursing|care|management|therapy/i
  };

  for (const [category, regex] of Object.entries(categories)) {
    if (regex.test(original) || regex.test(edited)) {
      return category;
    }
  }

  return 'general';
}

async function storeLearnedPattern(base44, userEmail, providerType, pattern) {
  try {
    // Check if similar pattern already exists
    const existing = await base44.entities.UserLearnedPattern.filter({
      user_email: userEmail,
      provider_type: providerType,
      pattern_type: pattern.pattern_type,
      pattern_category: pattern.pattern_category,
      original_text: pattern.original_text
    });

    if (existing.length > 0) {
      // Update existing pattern
      const existingPattern = existing[0];
      await base44.entities.UserLearnedPattern.update(existingPattern.id, {
        frequency: (existingPattern.frequency || 1) + 1,
        suggestions_accepted: (existingPattern.suggestions_accepted || 0) + (pattern.suggestions_accepted || 0),
        suggestions_rejected: (existingPattern.suggestions_rejected || 0) + (pattern.suggestions_rejected || 0),
        visit_types: Array.from(new Set([
          ...(existingPattern.visit_types || []),
          ...(pattern.visit_types || [])
        ])),
        confidence_score: calculateConfidence(
          (existingPattern.frequency || 1) + 1,
          (existingPattern.suggestions_accepted || 0) + (pattern.suggestions_accepted || 0),
          (existingPattern.suggestions_rejected || 0) + (pattern.suggestions_rejected || 0)
        ),
        last_observed: new Date().toISOString()
      });
      console.log(`Updated existing pattern for ${userEmail}`);
    } else {
      // Create new pattern
      await base44.entities.UserLearnedPattern.create({
        user_email: userEmail,
        provider_type: providerType,
        pattern_type: pattern.pattern_type,
        pattern_category: pattern.pattern_category,
        original_text: pattern.original_text,
        user_preferred_text: pattern.user_preferred_text,
        frequency: pattern.frequency || 1,
        visit_types: pattern.visit_types || [],
        suggestions_accepted: pattern.suggestions_accepted || 0,
        suggestions_rejected: pattern.suggestions_rejected || 0,
        confidence_score: calculateConfidence(
          pattern.frequency || 1,
          pattern.suggestions_accepted || 0,
          pattern.suggestions_rejected || 0
        ),
        last_observed: new Date().toISOString(),
        is_active: true
      });
      console.log(`Created new learned pattern for ${userEmail}`);
    }
  } catch (error) {
    console.error('Error storing learned pattern:', error);
    // Don't throw - learning failures shouldn't block the main flow
  }
}

function calculateConfidence(frequency, accepted, rejected) {
  // Confidence based on frequency and acceptance rate
  const acceptanceRate = (accepted + 1) / (accepted + rejected + 2); // +2 for smoothing
  const frequencyFactor = Math.min(frequency / 10, 1); // Cap at 10 observations
  return Math.round(acceptanceRate * frequencyFactor * 100);
}