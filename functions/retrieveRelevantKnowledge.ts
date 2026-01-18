import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      visit_type, 
      diagnosis, 
      care_setting, 
      provider_type,
      category,
      limit = 10 
    } = await req.json();

    const providerType = provider_type || user.credential_type || user.provider_type;
    const careSetting = care_setting || user.service_type || 'home_health';

    // Retrieve knowledge base entries with scoring
    const allKnowledge = await base44.entities.AIKnowledgeBase.filter({ 
      is_active: true 
    }, '-effectiveness_score', 500);

    // Score and rank knowledge by relevance
    const scoredKnowledge = allKnowledge.map(kb => {
      let score = 0;
      
      // Exact matches get highest score
      if (kb.provider_type === providerType || kb.provider_type === 'all') score += 30;
      if (kb.care_setting === careSetting || kb.care_setting === 'all') score += 25;
      if (kb.visit_type === visit_type || kb.visit_type === 'all') score += 25;
      if (kb.diagnosis === diagnosis || kb.diagnosis === 'all') score += 20;
      if (category && kb.category === category) score += 20;
      
      // Boost by quality scores
      score += (kb.compliance_score || 0) * 0.1;
      score += (kb.quality_score || 0) * 0.1;
      score += (kb.effectiveness_score || 0) * 0.05;
      
      return { ...kb, relevance_score: score };
    });

    // Sort by relevance and take top results
    const relevantKnowledge = scoredKnowledge
      .filter(kb => kb.relevance_score > 20)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit);

    // Increment usage count for retrieved knowledge
    for (const kb of relevantKnowledge) {
      await base44.asServiceRole.entities.AIKnowledgeBase.update(kb.id, {
        usage_count: (kb.usage_count || 0) + 1
      });
    }

    // Also retrieve learned patterns
    const patterns = await base44.entities.AILearningPattern.filter({
      provider_email: user.email,
      is_active: true
    }, '-confidence', 50);

    const globalPatterns = await base44.entities.AILearningPattern.filter({
      provider_email: 'global',
      is_active: true
    }, '-confidence', 50);

    return Response.json({
      knowledge_base: relevantKnowledge,
      learned_patterns: patterns,
      global_patterns: globalPatterns,
      context: {
        provider_type: providerType,
        care_setting: careSetting,
        visit_type,
        diagnosis
      }
    });

  } catch (error) {
    console.error('Knowledge retrieval error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});