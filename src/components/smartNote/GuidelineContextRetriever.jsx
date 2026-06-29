import { base44 } from "@/api/base44Client";

/**
 * Utility function to retrieve relevant Medicare guidelines for AI context enrichment
 * Used in note generation and compliance checking
 */
export async function retrieveRelevantGuidelines({
  diagnosis,
  visitType,
  noteContent,
  maxGuidelines = 3
}) {
  try {
    // Fetch all active guidelines
    const allGuidelines = await base44.entities.MedicareGuideline.filter({ is_active: true });

    if (!allGuidelines || allGuidelines.length === 0) {
      return [];
    }

    // Build search terms from inputs
    const searchTerms = [
      diagnosis?.toLowerCase(),
      visitType?.toLowerCase().replace(/_/g, ' '),
      ...(noteContent ? extractKeyTerms(noteContent) : [])
    ].filter(Boolean);

    // Score each guideline based on relevance
    const scoredGuidelines = allGuidelines.map(guideline => {
      let score = 0;

      // Check if guideline applies to this visit type
      if (guideline.applies_to_visit_types?.includes(visitType)) {
        score += 10;
      }

      // Check if guideline relates to this diagnosis
      if (diagnosis && guideline.related_diagnoses?.some(dx => 
        diagnosis.toLowerCase().includes(dx.toLowerCase()) ||
        dx.toLowerCase().includes(diagnosis.toLowerCase().split(' ')[0])
      )) {
        score += 15;
      }

      // Check keyword matches
      const keywordMatches = guideline.keywords?.filter(kw =>
        searchTerms.some(term => term?.includes(kw.toLowerCase()) || kw.toLowerCase().includes(term))
      ).length || 0;
      score += keywordMatches * 5;

      // Check title/summary matches
      searchTerms.forEach(term => {
        if (guideline.title?.toLowerCase().includes(term)) score += 8;
        if (guideline.summary?.toLowerCase().includes(term)) score += 5;
      });

      // Boost certain high-priority categories
      if (['medicare_cop', 'clinical_documentation', 'oasis'].includes(guideline.category)) {
        score += 3;
      }

      return { ...guideline, relevance_score: score };
    });

    // Sort by relevance and return top matches
    return scoredGuidelines
      .filter(g => g.relevance_score > 0)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, maxGuidelines);

  } catch (error) {
    console.error('Error retrieving guidelines:', error);
    return [];
  }
}

/**
 * Extract key medical terms from note content
 */
function extractKeyTerms(text) {
  const medicalKeywords = [
    'homebound', 'skilled', 'assessment', 'education', 'wound', 'medication',
    'vital signs', 'chf', 'copd', 'diabetes', 'pain', 'mobility', 'safety',
    'fall risk', 'cognitive', 'functional', 'adl', 'iadl', 'teaching',
    'response', 'plan of care', 'progress', 'goals', 'interventions'
  ];

  const lowerText = text.toLowerCase();
  return medicalKeywords.filter(keyword => lowerText.includes(keyword));
}

/**
 * Format guidelines for AI prompt injection
 */
export function formatGuidelinesForPrompt(guidelines) {
  if (!guidelines || guidelines.length === 0) {
    return "";
  }

  return `

RELEVANT MEDICARE GUIDELINES TO FOLLOW:
${guidelines.map((g, idx) => `
${idx + 1}. ${g.title}
   Category: ${g.category}${g.regulatory_citation ? ` (${g.regulatory_citation})` : ''}
   
   Key Requirements:
   ${g.summary}
   
   Keywords: ${g.keywords?.slice(0, 5).join(', ') || 'N/A'}
`).join('\n')}

CRITICAL: Ensure your documentation adheres to the above Medicare guidelines.`;
}

export default { retrieveRelevantGuidelines, formatGuidelinesForPrompt };