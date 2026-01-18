import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      base_prompt,
      visit_type, 
      diagnosis, 
      care_setting,
      category,
      include_examples = true
    } = await req.json();

    // Retrieve relevant knowledge
    const knowledgeResponse = await base44.functions.invoke('retrieveRelevantKnowledge', {
      visit_type,
      diagnosis,
      care_setting,
      category,
      limit: 5
    });

    const { knowledge_base, learned_patterns, global_patterns } = knowledgeResponse.data || knowledgeResponse;

    // Build enhanced prompt
    let enhanced_prompt = base_prompt + '\n\n';

    // Add learned patterns
    if (learned_patterns?.length > 0) {
      enhanced_prompt += '**YOUR LEARNED PREFERENCES:**\n';
      enhanced_prompt += 'Based on your past corrections, you prefer:\n';
      learned_patterns.slice(0, 5).forEach(pattern => {
        enhanced_prompt += `- ${pattern.pattern_rule}\n`;
      });
      enhanced_prompt += '\n';
    }

    // Add agency-wide best practices
    if (global_patterns?.length > 0) {
      enhanced_prompt += '**AGENCY BEST PRACTICES:**\n';
      global_patterns.slice(0, 3).forEach(pattern => {
        enhanced_prompt += `- ${pattern.pattern_rule}\n`;
      });
      enhanced_prompt += '\n';
    }

    // Add knowledge base examples
    if (include_examples && knowledge_base?.length > 0) {
      enhanced_prompt += '**HIGH-QUALITY EXAMPLES FROM YOUR AGENCY:**\n';
      enhanced_prompt += 'Reference these proven documentation examples:\n\n';
      
      knowledge_base.slice(0, 3).forEach((kb, i) => {
        enhanced_prompt += `Example ${i + 1} (Compliance: ${kb.compliance_score}%, Quality: ${kb.quality_score}%):\n`;
        enhanced_prompt += `Context: ${kb.title}\n`;
        if (kb.example_note) {
          enhanced_prompt += `"${kb.example_note.substring(0, 300)}${kb.example_note.length > 300 ? '...' : ''}"\n\n`;
        }
      });
    }

    // Add compliance-specific knowledge
    const complianceKnowledge = knowledge_base?.filter(kb => kb.category === 'compliance');
    if (complianceKnowledge?.length > 0) {
      enhanced_prompt += '**COMPLIANCE REQUIREMENTS:**\n';
      complianceKnowledge.slice(0, 3).forEach(kb => {
        enhanced_prompt += `- ${kb.content}\n`;
      });
      enhanced_prompt += '\n';
    }

    // Add terminology preferences
    const terminologyKnowledge = knowledge_base?.filter(kb => kb.category === 'terminology');
    if (terminologyKnowledge?.length > 0) {
      enhanced_prompt += '**PREFERRED TERMINOLOGY:**\n';
      terminologyKnowledge.forEach(kb => {
        enhanced_prompt += `- ${kb.content}\n`;
      });
      enhanced_prompt += '\n';
    }

    enhanced_prompt += '**IMPORTANT:** Follow the learned preferences and reference the examples above while maintaining clinical accuracy and compliance.\n';

    return Response.json({
      enhanced_prompt,
      knowledge_used: knowledge_base?.length || 0,
      patterns_applied: (learned_patterns?.length || 0) + (global_patterns?.length || 0)
    });

  } catch (error) {
    console.error('Prompt building error:', error);
    return Response.json({ 
      enhanced_prompt: base_prompt, // Fallback to base prompt
      error: error.message 
    }, { status: 200 });
  }
});