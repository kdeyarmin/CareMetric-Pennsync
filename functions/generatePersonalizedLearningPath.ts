import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { provider_email, provider_type } = await req.json();

    if (!provider_email || !provider_type) {
      return Response.json(
        { error: 'Missing provider_email or provider_type' },
        { status: 400 }
      );
    }

    // Fetch provider's usage patterns, training history, and compliance data
    const [completions, badges, visits] = await Promise.all([
      base44.entities.TrainingCompletion.filter({ nurse_email: provider_email }),
      base44.entities.ProviderBadge.filter({ provider_email: provider_email }),
      base44.entities.Visit.filter({ created_by: provider_email }, '-created_date', 20)
    ]);

    // Determine skill gaps based on usage
    const skillGaps = [];
    const recommendedFeatures = [];

    // Analyze visit patterns
    const recentVisits = visits.slice(0, 10);
    const hasUsedSmartNotes = recentVisits.some(v => v.ai_tags?.includes('smart_notes'));
    const hasUsedScribe = recentVisits.some(v => v.ai_tags?.includes('scribe'));
    const avgNoteLength = recentVisits.reduce((sum, v) => sum + (v.nurse_notes?.length || 0), 0) / (recentVisits.length || 1);

    if (!hasUsedSmartNotes) {
      skillGaps.push('Smart Notes Fundamentals');
      recommendedFeatures.push('SmartNoteAssistant');
    }

    if (!hasUsedScribe) {
      skillGaps.push('Voice-Powered Documentation');
      recommendedFeatures.push('MedicalScribe');
    }

    if (avgNoteLength < 500) {
      skillGaps.push('Comprehensive Documentation');
    }

    // Role-based learning path
    const roleModules = {
      RN: ['smart-notes-101', 'ai-scribe-mastery', 'care-plan-optimization', 'oasis-compliance-pro'],
      LPN: ['smart-notes-101', 'ai-scribe-mastery', 'documentation-best-practices'],
      PT: ['smart-notes-101', 'telehealth-guidance', 'care-plan-optimization'],
      OT: ['smart-notes-101', 'telehealth-guidance', 'care-plan-optimization'],
      MD: ['smart-notes-101', 'ai-scribe-mastery', 'care-plan-optimization']
    };

    const modules = (roleModules[provider_type] || roleModules.RN).map((moduleId, idx) => ({
      module_id: moduleId,
      sequence: idx,
      status: completions.some(c => c.training_module_id === moduleId) ? 'completed' : 'not_started',
      score: completions.find(c => c.training_module_id === moduleId)?.score
    }));

    const completedCount = modules.filter(m => m.status === 'completed').length;
    const completionPercentage = Math.round((completedCount / modules.length) * 100);

    // Create or update learning path
    const existingPath = await base44.entities.PersonalizedLearningPath.filter({
      provider_email: provider_email
    });

    const pathData = {
      provider_email: provider_email,
      provider_type: provider_type,
      path_name: `${provider_type} Mastery Path`,
      path_description: `Personalized learning path for ${provider_type} providers to master advanced features`,
      modules: modules,
      skill_gaps: skillGaps,
      recommended_features: recommendedFeatures,
      completion_percentage: completionPercentage,
      estimated_hours: modules.length * 0.5,
      next_recommended_module: modules.find(m => m.status === 'not_started')?.module_id,
      based_on: {
        usage_patterns: true,
        role: true,
        skill_gaps: skillGaps.length > 0,
        compliance_needs: provider_type === 'RN'
      }
    };

    let path;
    if (existingPath.length > 0) {
      await base44.entities.PersonalizedLearningPath.update(existingPath[0].id, pathData);
      path = { ...existingPath[0], ...pathData };
    } else {
      path = await base44.entities.PersonalizedLearningPath.create(pathData);
    }

    return Response.json({
      success: true,
      path: path,
      skill_gaps: skillGaps,
      recommended_features: recommendedFeatures
    });
  } catch (error) {
    console.error('Error generating learning path:', error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
});