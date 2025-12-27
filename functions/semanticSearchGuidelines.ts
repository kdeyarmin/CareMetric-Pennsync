import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { query } = await req.json();

    if (!query || query.trim().length === 0) {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }

    // Fetch all active guidelines
    const guidelines = await base44.asServiceRole.entities.MedicareGuideline.filter({
      is_active: true
    });

    if (guidelines.length === 0) {
      return Response.json({ results: [] });
    }

    // Use AI to find semantically relevant guidelines
    const guidelinesSummary = guidelines.map(g => ({
      id: g.id,
      title: g.title,
      summary: g.summary || '',
      keywords: g.keywords || [],
      category: g.category
    }));

    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `A user is searching for Medicare/CMS Home Health guidelines with this query: "${query}"

Here are the available guidelines:
${JSON.stringify(guidelinesSummary, null, 2)}

Analyze the user's query and return the IDs of the most relevant guidelines, ranked by relevance. Consider:
- Semantic meaning and intent of the query
- Related concepts and synonyms
- Clinical context and nursing workflows
- Regulatory and compliance aspects

Return up to 10 most relevant guideline IDs, ordered by relevance (most relevant first).`,
      response_json_schema: {
        type: "object",
        properties: {
          relevant_guideline_ids: {
            type: "array",
            items: { type: "string" }
          },
          search_interpretation: {
            type: "string",
            description: "Brief explanation of how the query was interpreted"
          }
        }
      }
    });

    // Get full guideline objects in ranked order
    const rankedGuidelines = aiResponse.relevant_guideline_ids
      .map(id => guidelines.find(g => g.id === id))
      .filter(Boolean);

    return Response.json({
      results: rankedGuidelines,
      interpretation: aiResponse.search_interpretation,
      total_searched: guidelines.length
    });

  } catch (error) {
    console.error('Semantic search error:', error);
    return Response.json(
      { error: 'Failed to perform semantic search', details: error.message },
      { status: 500 }
    );
  }
});