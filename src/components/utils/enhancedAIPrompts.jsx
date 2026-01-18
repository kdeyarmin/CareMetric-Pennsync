import { base44 } from '@/api/base44Client';

/**
 * Builds an AI prompt enhanced with learned patterns and knowledge base
 */
export async function buildEnhancedPrompt({
  basePrompt,
  visitType,
  diagnosis,
  careSetting,
  category,
  includeExamples = true
}) {
  try {
    const response = await base44.functions.invoke('buildEnhancedAIPrompt', {
      base_prompt: basePrompt,
      visit_type: visitType,
      diagnosis,
      care_setting: careSetting,
      category,
      include_examples: includeExamples
    });

    return response.data?.enhanced_prompt || response.enhanced_prompt || basePrompt;
  } catch (error) {
    console.error('Failed to enhance prompt:', error);
    return basePrompt; // Fallback to base prompt
  }
}

/**
 * Records user edits to improve AI learning
 */
export async function recordEditForLearning({
  originalText,
  editedText,
  context
}) {
  try {
    await base44.functions.invoke('enhancedLearnFromEdits', {
      original_text: originalText,
      edited_text: editedText,
      context
    });
  } catch (error) {
    console.error('Failed to record learning:', error);
  }
}

/**
 * Retrieves relevant knowledge for a given context
 */
export async function getRelevantKnowledge({
  visitType,
  diagnosis,
  careSetting,
  providerType,
  category,
  limit = 10
}) {
  try {
    const response = await base44.functions.invoke('retrieveRelevantKnowledge', {
      visit_type: visitType,
      diagnosis,
      care_setting: careSetting,
      provider_type: providerType,
      category,
      limit
    });

    return response.data || response;
  } catch (error) {
    console.error('Failed to retrieve knowledge:', error);
    return { knowledge_base: [], learned_patterns: [], global_patterns: [] };
  }
}