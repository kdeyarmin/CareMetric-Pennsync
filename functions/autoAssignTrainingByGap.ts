import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { providerEmail, gapArea } = await req.json();
    const targetEmail = providerEmail || user.email;

    // Get provider info
    const targetUser = await base44.asServiceRole.entities.User.filter(
      { email: targetEmail }
    );
    
    if (!targetUser || targetUser.length === 0) {
      return Response.json({ error: 'Provider not found' }, { status: 404 });
    }

    const provider = targetUser[0];

    // Find relevant training modules
    const allModules = await base44.entities.TrainingModule.list();
    
    // Use AI to match modules to the skill gap
    const matchPrompt = `Match training modules to the identified skill gap:

SKILL GAP: ${gapArea}

AVAILABLE MODULES:
${allModules.map((m, i) => `${i + 1}. ${m.title} - ${m.description} (Tags: ${m.tags?.join(', ')})`).join('\n')}

Select the top 3 most relevant modules for addressing this gap.
Return JSON: {"moduleIds": ["id1", "id2", "id3"], "reasoning": "why these modules"}`;

    const matchResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: matchPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          moduleIds: {
            type: "array",
            items: { type: "string" }
          },
          reasoning: { type: "string" }
        }
      }
    });

    // Create training recommendations
    const recommendations = [];
    for (const moduleId of matchResult.moduleIds || []) {
      const module = allModules.find(m => m.id === moduleId);
      if (module) {
        const rec = await base44.asServiceRole.entities.TrainingRecommendation.create({
          provider_email: targetEmail,
          provider_type: provider.provider_type,
          module_id: moduleId,
          module_name: module.title,
          reason: `Personalized recommendation to address skill gap: ${gapArea}`,
          priority: 'high',
          auto_assigned: true,
          skill_gap_area: gapArea,
          assignment_reasoning: matchResult.reasoning
        });
        recommendations.push(rec);
      }
    }

    return Response.json({
      success: true,
      recommendationsCreated: recommendations.length,
      recommendations
    });
  } catch (error) {
    console.error('Error auto-assigning training:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});