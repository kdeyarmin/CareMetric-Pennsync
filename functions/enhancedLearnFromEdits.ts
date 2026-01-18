import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { original_text, edited_text, context } = await req.json();

    // Extract patterns from the edit
    const patterns = await extractPatterns(original_text, edited_text, context);
    
    const createdPatterns = [];
    
    for (const pattern of patterns) {
      // Check if similar pattern exists
      const existing = await base44.asServiceRole.entities.AILearningPattern.filter({
        provider_email: user.email,
        pattern_type: pattern.type,
        'context.visit_type': context.visit_type || null,
        'context.diagnosis': context.diagnosis || null
      });

      if (existing.length > 0) {
        // Update existing pattern
        const existingPattern = existing[0];
        await base44.asServiceRole.entities.AILearningPattern.update(existingPattern.id, {
          occurrences: (existingPattern.occurrences || 1) + 1,
          confidence: Math.min(100, (existingPattern.confidence || 50) + 10),
          corrected_text: edited_text,
          original_text: original_text
        });
        createdPatterns.push({ ...existingPattern, updated: true });
      } else {
        // Create new pattern
        const newPattern = await base44.asServiceRole.entities.AILearningPattern.create({
          pattern_type: pattern.type,
          provider_email: user.email,
          provider_type: user.credential_type || user.provider_type,
          context: {
            visit_type: context.visit_type,
            diagnosis: context.diagnosis,
            care_setting: context.care_setting || user.service_type,
            documentation_section: context.section
          },
          original_text: original_text.substring(0, 500),
          corrected_text: edited_text.substring(0, 500),
          pattern_rule: pattern.rule,
          confidence: 60
        });
        createdPatterns.push(newPattern);
      }
    }

    // If this is high-quality content, add to knowledge base
    if (context.compliance_score > 85 && context.quality_score > 85) {
      await base44.asServiceRole.entities.AIKnowledgeBase.create({
        title: `High-Quality ${context.visit_type || 'Documentation'} Example`,
        category: 'clinical_documentation',
        provider_type: user.credential_type || user.provider_type || 'all',
        care_setting: context.care_setting || user.service_type || 'all',
        visit_type: context.visit_type || 'all',
        diagnosis: context.diagnosis || 'all',
        content: `Learned from ${user.full_name}'s documentation`,
        example_note: edited_text,
        compliance_score: context.compliance_score,
        quality_score: context.quality_score,
        tags: [context.visit_type, context.diagnosis, 'high_quality'].filter(Boolean),
        source: 'high_quality_note'
      });
    }

    return Response.json({ 
      success: true, 
      patterns_learned: createdPatterns.length,
      patterns: createdPatterns 
    });

  } catch (error) {
    console.error('Enhanced learning error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function extractPatterns(original, edited, context) {
  const patterns = [];

  // Detect phrase replacements
  const words_original = original.toLowerCase().split(/\s+/);
  const words_edited = edited.toLowerCase().split(/\s+/);
  
  // Simple diff detection
  if (edited.length > original.length * 1.2) {
    patterns.push({
      type: 'edit_correction',
      rule: 'User prefers more detailed documentation in this context'
    });
  }

  // Detect terminology changes
  const medicalTerms = ['pt', 'patient', 'hx', 'history', 'dx', 'diagnosis', 'tx', 'treatment'];
  for (const term of medicalTerms) {
    if (original.toLowerCase().includes(term) && !edited.toLowerCase().includes(term)) {
      patterns.push({
        type: 'terminology',
        rule: `Avoid abbreviation "${term}" in ${context.section || 'documentation'}`
      });
    }
  }

  // Detect structural changes (bullets vs paragraphs)
  if (original.includes('\n-') && !edited.includes('\n-')) {
    patterns.push({
      type: 'structure',
      rule: 'User prefers paragraph format over bullet points'
    });
  } else if (!original.includes('\n-') && edited.includes('\n-')) {
    patterns.push({
      type: 'structure',
      rule: 'User prefers bullet points over paragraphs'
    });
  }

  // Detect compliance-related additions
  const complianceKeywords = ['homebound', 'skilled', 'medically necessary', 'orders', 'physician'];
  for (const keyword of complianceKeywords) {
    if (!original.toLowerCase().includes(keyword) && edited.toLowerCase().includes(keyword)) {
      patterns.push({
        type: 'compliance_fix',
        rule: `Add "${keyword}" reference in ${context.section || 'documentation'}`
      });
    }
  }

  return patterns;
}