import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Enhanced note generation that applies learned provider format preferences
 * This replaces or augments the standard enhanceNoteOptimized
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      roughNote,
      patientId,
      visitType,
      diagnosis,
      vitalSigns,
      nurseType 
    } = await req.json();

    if (!roughNote) {
      return Response.json({ error: 'roughNote is required' }, { status: 400 });
    }

    const diagnosisCategory = diagnosis ? diagnosis.split(' ')[0] : 'general';

    // Retrieve learned patterns for this provider, visit type, and diagnosis
    const learnedPatterns = await base44.entities.LearnedFormatPattern.filter({
      provider_email: user.email,
      visit_type: visitType,
      diagnosis_category: diagnosisCategory,
      is_active: true
    }, '-confidence_score', 1);

    const pattern = learnedPatterns[0];

    // Get provider preferences
    const preferences = await base44.entities.ProviderPreferences.filter({ 
      provider_email: user.email 
    });
    const pref = preferences[0];

    // Build personalized enhancement instructions
    let styleInstructions = "\n\nPERSONALIZED DOCUMENTATION STYLE (learned from your edits):\n";

    if (pattern?.extracted_patterns) {
      const ep = pattern.extracted_patterns;

      // Sentence structure
      if (ep.sentence_structure) {
        styleInstructions += `\nSENTENCE STYLE:\n`;
        styleInstructions += `- Length: ${ep.sentence_structure.avg_sentence_length || 'moderate'}\n`;
        styleInstructions += `- Voice: ${ep.sentence_structure.voice_preference || 'active'}\n`;
        if (ep.sentence_structure.patterns) {
          styleInstructions += `- Patterns: ${ep.sentence_structure.patterns.slice(0, 3).join('; ')}\n`;
        }
      }

      // Terminology preferences
      if (ep.terminology_preferences && ep.terminology_preferences.length > 0) {
        styleInstructions += `\nTERMINOLOGY PREFERENCES:\n`;
        ep.terminology_preferences.slice(0, 10).forEach(term => {
          styleInstructions += `- Use "${term.preferred_term}" instead of "${term.ai_term}"\n`;
        });
      }

      // Section order
      if (ep.section_order && ep.section_order.length > 0) {
        styleInstructions += `\nPREFERRED SECTION ORDER:\n`;
        ep.section_order.forEach((section, idx) => {
          styleInstructions += `${idx + 1}. ${section}\n`;
        });
      }

      // Detail preferences
      if (ep.detail_preferences) {
        styleInstructions += `\nDETAIL LEVEL PREFERENCES:\n`;
        if (ep.detail_preferences.vitals) {
          styleInstructions += `- Vital Signs: ${ep.detail_preferences.vitals}\n`;
        }
        if (ep.detail_preferences.assessment) {
          styleInstructions += `- Assessment: ${ep.detail_preferences.assessment}\n`;
        }
        if (ep.detail_preferences.interventions) {
          styleInstructions += `- Interventions: ${ep.detail_preferences.interventions}\n`;
        }
        if (ep.detail_preferences.patient_response) {
          styleInstructions += `- Patient Response: ${ep.detail_preferences.patient_response}\n`;
        }
      }

      // Formatting
      if (ep.formatting_style) {
        styleInstructions += `\nFORMATTING PREFERENCES:\n`;
        styleInstructions += `- Structure: ${ep.formatting_style.uses_bullets ? 'Use bullet points for lists' : 'Use narrative paragraphs'}\n`;
        styleInstructions += `- Paragraph length: ${ep.formatting_style.paragraph_length || 'moderate'}\n`;
        if (ep.formatting_style.uses_abbreviations && ep.formatting_style.specific_abbreviations) {
          styleInstructions += `- Abbreviations: ${ep.formatting_style.specific_abbreviations.join(', ')}\n`;
        }
      }

      // Always include these elements
      if (ep.added_elements && ep.added_elements.length > 0) {
        styleInstructions += `\nCRITICAL - ALWAYS INCLUDE (provider consistently adds these):\n`;
        ep.added_elements.forEach(element => {
          styleInstructions += `- ${element}\n`;
        });
      }

      // Never include these elements
      if (ep.removed_elements && ep.removed_elements.length > 0) {
        styleInstructions += `\nAVOID (provider consistently removes these):\n`;
        ep.removed_elements.forEach(element => {
          styleInstructions += `- ${element}\n`;
        });
      }

      // Phrasing examples
      if (ep.phrasing_examples && ep.phrasing_examples.length > 0) {
        styleInstructions += `\nPHRASING EXAMPLES (mimic this style):\n`;
        ep.phrasing_examples.forEach(ex => {
          styleInstructions += `- ${ex.category}: "${ex.example}"\n`;
        });
      }

      styleInstructions += `\nCONFIDENCE: ${pattern.confidence_score}% (based on ${pattern.usage_count} observations)\n`;
      styleInstructions += `STYLE SUMMARY: ${ep.overall_style_summary || 'Learning your style...'}\n`;
    }

    // Add explicit AI personalization settings
    if (pref?.ai_personalization) {
      const ai = pref.ai_personalization;
      styleInstructions += `\nEXPLICIT STYLE SETTINGS:\n`;
      styleInstructions += `- Writing Style: ${ai.writing_style || 'clinical'}\n`;
      styleInstructions += `- Detail Level: ${ai.detail_level || 'moderate'}\n`;
      styleInstructions += `- Tone: ${ai.tone || 'professional'}\n`;
      if (ai.focus_areas && ai.focus_areas.length > 0) {
        styleInstructions += `- Focus Areas: ${ai.focus_areas.join(', ')}\n`;
      }
    }

    // Add preferred phrasing
    if (pref?.preferred_phrasing) {
      styleInstructions += `\nPREFERRED PHRASING:\n`;
      Object.entries(pref.preferred_phrasing).forEach(([key, value]) => {
        if (value && typeof value === 'string') {
          styleInstructions += `- ${key.replace(/_/g, ' ')}: ${value}\n`;
        }
      });
    }

    // Now call the standard enhancement with personalized instructions
    const enhancedPrompt = `You are enhancing rough clinical notes into Medicare-compliant documentation for a ${nurseType}.

ROUGH NOTES:
${roughNote}

VISIT TYPE: ${visitType}
DIAGNOSIS: ${diagnosis}
VITAL SIGNS: ${JSON.stringify(vitalSigns)}

STANDARD REQUIREMENTS:
- Medicare compliance
- Homebound justification
- Skilled need documentation
- Patient response
- Objective measurements

${styleInstructions}

CRITICAL: Apply the learned style preferences above while maintaining Medicare compliance. The provider's preferred format takes precedence for style/phrasing, but all required compliance elements must still be present.

Generate the enhanced note following the provider's learned format.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: enhancedPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          enhanced_note: { type: "string" },
          quality_score: { type: "number" },
          style_match_confidence: { type: "number" },
          applied_preferences: { type: "array", items: { type: "string" } }
        }
      }
    });

    return Response.json({ 
      success: true,
      enhanced_note: result.enhanced_note,
      quality_score: result.quality_score,
      style_match_confidence: result.style_match_confidence,
      applied_preferences: result.applied_preferences,
      personalization_data: {
        pattern_found: !!pattern,
        pattern_confidence: pattern?.confidence_score,
        observations: pattern?.usage_count
      }
    });

  } catch (error) {
    console.error('Error enhancing note with learning:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});