import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { nurse_email } = await req.json();
    // Only admins may build a path from another nurse's PHI/performance data.
    if (nurse_email && nurse_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const targetEmail = nurse_email || user.email;

    // Fetch nurse performance data
    const [assignments, recommendations, audits, visits, skills] = await Promise.all([
      base44.asServiceRole.entities.TrainingAssignment.filter({ assigned_to_user_id: targetEmail }),
      base44.asServiceRole.entities.TrainingRecommendation.filter({ nurse_email: targetEmail }),
      base44.asServiceRole.entities.ComplianceAudit.filter({ nurse_email: targetEmail }),
      base44.asServiceRole.entities.Visit.filter({ created_by: targetEmail }),
      base44.asServiceRole.entities.NurseSkill.filter({ nurse_email: targetEmail })
    ]);

    // Analyze performance and gaps
    const recentAudits = audits.slice(0, 10);
    const avgComplianceScore = recentAudits.length > 0
      ? recentAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / recentAudits.length
      : 0;

    const completedTrainingCount = assignments.filter(a => a.status === 'completed' || a.pass_fail_result === 'passed').length;
    const unaddressedRecs = recommendations.filter(r => !r.addressed);
    const weakAreas = {};
    
    unaddressedRecs.forEach(rec => {
      weakAreas[rec.recommendation_type] = (weakAreas[rec.recommendation_type] || 0) + 1;
    });

    recentAudits.forEach(audit => {
      audit.issues?.forEach(issue => {
        weakAreas[issue.element] = (weakAreas[issue.element] || 0) + 1;
      });
    });

    // Get all available training modules
    const allModules = await base44.asServiceRole.entities.TrainingModule.filter({});

    // Use AI to generate personalized learning path
    const prompt = `
You are an expert nursing education specialist. Analyze this nurse's performance data and create a personalized learning path.

Performance Data:
- Compliance Score: ${avgComplianceScore.toFixed(1)}%
- Completed Training: ${completedTrainingCount}
- Unaddressed Recommendations: ${unaddressedRecs.length}
- Weak Areas: ${Object.entries(weakAreas).map(([area, count]) => `${area} (${count} issues)`).join(', ')}
- Documented Skills: ${skills.length}

Available Training Modules:
${allModules.map(m => `- ${m.title} (${m.category}, ${m.difficulty_level}, ${m.module_type})`).join('\n')}

Create a personalized learning path with:
1. Priority ranking (critical/high/medium/low)
2. Recommended sequence of modules
3. Estimated completion timeline
4. Specific learning objectives for each module
5. Personalized motivation message

Return JSON format.
`;

    const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          learning_path: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                module_id: { type: 'string' },
                priority: { type: 'string' },
                sequence: { type: 'number' },
                estimated_days: { type: 'number' },
                learning_objectives: { type: 'array', items: { type: 'string' } },
                why_recommended: { type: 'string' }
              }
            }
          },
          motivation_message: { type: 'string' },
          overall_goal: { type: 'string' },
          estimated_completion_weeks: { type: 'number' }
        }
      }
    });

    // Enrich with module details
    const enrichedPath = (aiResponse?.learning_path || []).map(item => {
      const module = allModules.find(m => m.id === item.module_id || m.title === item.module_id);
      return {
        ...item,
        module: module || null
      };
    });

    return Response.json({
      learning_path: enrichedPath,
      motivation_message: aiResponse.motivation_message,
      overall_goal: aiResponse.overall_goal,
      estimated_completion_weeks: aiResponse.estimated_completion_weeks,
      performance_summary: {
        compliance_score: avgComplianceScore,
        completed_training: completedTrainingCount,
        identified_gaps: Object.keys(weakAreas).length
      }
    });

  } catch (error) {
    console.error('Error generating learning path:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});