import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Analyzes nurse's edits to AI-generated notes to learn their documentation style
 * Uses advanced diff analysis and pattern recognition
 */
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
      diagnosis,
      provider_type 
    } = await req.json();

    if (!original_note || !edited_note) {
      return Response.json({ error: 'Both original and edited notes required' }, { status: 400 });
    }

    // Use AI to deeply analyze the edits
    const analysis = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert at analyzing clinical documentation patterns. Compare these two versions of the same clinical note to extract the provider's preferred documentation style.

ORIGINAL AI-GENERATED NOTE:
${original_note}

PROVIDER'S EDITED VERSION:
${edited_note}

Perform a comprehensive analysis to extract:

1. SENTENCE STRUCTURE PREFERENCES
   - Does provider prefer shorter or longer sentences?
   - Active vs passive voice?
   - Sentence patterns they use repeatedly

2. TERMINOLOGY PREFERENCES
   - What medical terms did they change? (e.g., "patient" → "pt", "blood pressure" → "BP")
   - Preferred abbreviations
   - Terminology they avoid or prefer

3. SECTION ORDER & ORGANIZATION
   - What sections did they add/remove/reorder?
   - Preferred flow of information

4. DETAIL LEVEL BY CATEGORY
   - How verbose are they with vital signs?
   - How much detail for assessments?
   - How do they document interventions?
   - How do they document patient response?

5. FORMATTING PREFERENCES
   - Bullets vs paragraphs
   - Use of headers/subheadings
   - Average paragraph length
   - Spacing and formatting style

6. CONSISTENTLY ADDED ELEMENTS
   - What information do they always add that AI missed?
   - What clinical elements do they emphasize?

7. CONSISTENTLY REMOVED ELEMENTS
   - What AI-generated content do they consistently delete?
   - What do they consider unnecessary?

8. PHRASING EXAMPLES
   - Extract 5-10 example phrases that show their writing style
   - Categorize by type (vital signs, assessment, plan, etc.)

Return detailed JSON with actionable patterns that can be used to personalize future AI outputs.`,
      response_json_schema: {
        type: "object",
        properties: {
          sentence_structure: {
            type: "object",
            properties: {
              avg_sentence_length: { type: "string" },
              voice_preference: { type: "string" },
              patterns: { type: "array", items: { type: "string" } }
            }
          },
          terminology_preferences: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ai_term: { type: "string" },
                preferred_term: { type: "string" },
                frequency: { type: "number" }
              }
            }
          },
          section_order: {
            type: "array",
            items: { type: "string" }
          },
          detail_preferences: {
            type: "object",
            properties: {
              vitals: { type: "string" },
              assessment: { type: "string" },
              interventions: { type: "string" },
              patient_response: { type: "string" }
            }
          },
          formatting_style: {
            type: "object",
            properties: {
              uses_bullets: { type: "boolean" },
              paragraph_length: { type: "string" },
              uses_abbreviations: { type: "boolean" },
              specific_abbreviations: { type: "array", items: { type: "string" } }
            }
          },
          added_elements: {
            type: "array",
            items: { type: "string" }
          },
          removed_elements: {
            type: "array",
            items: { type: "string" }
          },
          phrasing_examples: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                example: { type: "string" }
              }
            }
          },
          overall_style_summary: { type: "string" },
          confidence_score: { type: "number" }
        }
      }
    });

    // Save the learned pattern
    const diagnosisCategory = diagnosis ? diagnosis.split(' ')[0] : 'general';
    
    // Check if pattern already exists
    const existingPatterns = await base44.entities.LearnedFormatPattern.filter({
      provider_email: user.email,
      visit_type: visit_type,
      diagnosis_category: diagnosisCategory
    });

    let savedPattern;
    if (existingPatterns.length > 0) {
      // Update existing pattern - merge with new insights
      const existing = existingPatterns[0];
      savedPattern = await base44.entities.LearnedFormatPattern.update(existing.id, {
        original_ai_note: original_note,
        edited_note: edited_note,
        extracted_patterns: analysis,
        confidence_score: Math.min(100, (existing.confidence_score || 50) + 10),
        usage_count: (existing.usage_count || 1) + 1,
        last_observed: new Date().toISOString()
      });
    } else {
      // Create new pattern
      savedPattern = await base44.entities.LearnedFormatPattern.create({
        provider_email: user.email,
        provider_type: provider_type || 'RN',
        visit_type: visit_type,
        diagnosis_category: diagnosisCategory,
        original_ai_note: original_note,
        edited_note: edited_note,
        extracted_patterns: analysis,
        confidence_score: analysis.confidence_score || 60,
        usage_count: 1,
        last_observed: new Date().toISOString(),
        is_active: true
      });
    }

    return Response.json({ 
      success: true,
      patterns: analysis,
      pattern_id: savedPattern.id,
      message: "Successfully learned your documentation style"
    });

  } catch (error) {
    console.error('Error analyzing edit patterns:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});