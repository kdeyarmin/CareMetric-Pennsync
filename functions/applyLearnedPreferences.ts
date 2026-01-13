import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Enhances AI prompts with learned provider preferences and feedback patterns
 * This function analyzes provider's past feedback and preferences to customize AI outputs
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      base_prompt, 
      provider_email,
      visit_type,
      diagnosis 
    } = await req.json();

    if (!base_prompt) {
      return Response.json({ error: 'base_prompt is required' }, { status: 400 });
    }

    // Get provider preferences
    const preferences = await base44.entities.ProviderPreferences.filter({ 
      provider_email: provider_email || user.email 
    });
    const pref = preferences[0];

    // Get usage patterns
    const patterns = await base44.entities.ProviderUsagePattern.filter({ 
      provider_email: provider_email || user.email 
    });
    const pattern = patterns[0];

    // Get recent feedback to learn from
    const recentFeedback = await base44.entities.NoteFeedback.filter(
      { created_by: user.email },
      '-created_date',
      20
    );

    // Build personalization additions to prompt
    let personalizedAdditions = "\n\nPERSONALIZED STYLE PREFERENCES:\n";

    if (pref?.ai_personalization) {
      const ai = pref.ai_personalization;
      
      personalizedAdditions += `- Writing Style: ${ai.writing_style || 'clinical'}\n`;
      personalizedAdditions += `- Detail Level: ${ai.detail_level || 'moderate'} - ${
        ai.detail_level === 'minimal' ? 'Keep descriptions brief and focused' :
        ai.detail_level === 'comprehensive' ? 'Provide comprehensive, detailed documentation' :
        'Balance detail with conciseness'
      }\n`;
      personalizedAdditions += `- Tone: ${ai.tone || 'professional'}\n`;

      if (ai.focus_areas && ai.focus_areas.length > 0) {
        personalizedAdditions += `- Priority Focus Areas: ${ai.focus_areas.join(', ')}\n`;
        personalizedAdditions += `  → Emphasize these elements in the documentation\n`;
      }
    }

    // Add learned patterns from feedback
    if (recentFeedback.length > 0) {
      const avgRating = recentFeedback.reduce((sum, f) => sum + (f.rating || 0), 0) / recentFeedback.length;
      
      // Extract common improvement suggestions
      const allSuggestions = recentFeedback.flatMap(f => f.improvement_suggestions || []);
      const commonSuggestions = [...new Set(allSuggestions)].slice(0, 5);

      if (commonSuggestions.length > 0) {
        personalizedAdditions += `\nLEARNED FROM FEEDBACK (avg rating: ${avgRating.toFixed(1)}/5):\n`;
        commonSuggestions.forEach(suggestion => {
          personalizedAdditions += `- ${suggestion}\n`;
        });
      }

      // Extract common missed elements
      const missedElements = recentFeedback
        .filter(f => f.feedback_type === 'missed_elements')
        .flatMap(f => f.missed_elements || []);
      const commonMissed = [...new Set(missedElements)].slice(0, 3);

      if (commonMissed.length > 0) {
        personalizedAdditions += `\nCRITICAL - Provider frequently adds these elements (ensure they're included):\n`;
        commonMissed.forEach(element => {
          personalizedAdditions += `- ${element}\n`;
        });
      }
    }

    // Add preferred phrasing from ProviderPreferences
    if (pref?.preferred_phrasing) {
      personalizedAdditions += `\nPREFERRED PHRASING:\n`;
      if (pref.preferred_phrasing.vital_signs) {
        personalizedAdditions += `- Vital Signs Format: ${pref.preferred_phrasing.vital_signs}\n`;
      }
      if (pref.preferred_phrasing.patient_response) {
        personalizedAdditions += `- Patient Response Format: ${pref.preferred_phrasing.patient_response}\n`;
      }
      if (pref.preferred_phrasing.assessment) {
        personalizedAdditions += `- Assessment Format: ${pref.preferred_phrasing.assessment}\n`;
      }
    }

    // Combine base prompt with personalized additions
    const enhancedPrompt = base_prompt + personalizedAdditions;

    return Response.json({ 
      success: true,
      enhanced_prompt: enhancedPrompt,
      personalization_applied: {
        has_preferences: !!pref,
        feedback_count: recentFeedback.length,
        usage_pattern_exists: !!pattern
      }
    });

  } catch (error) {
    console.error('Error applying learned preferences:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});