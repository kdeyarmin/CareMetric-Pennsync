import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { nurseEmail, analysisDepth = 'standard' } = await req.json();
    const targetEmail = nurseEmail || user.email;

    // Fetch nurse's recent performance data
    const [noteConversions, complianceAudits, trainingCompletions, trainingRecommendations] = await Promise.all([
      base44.entities.NoteConversion.filter({ nurse_email: targetEmail }, '-created_date', 30),
      base44.entities.ComplianceAudit.filter({ nurse_email: targetEmail }, '-audit_date', 20),
      base44.entities.TrainingCompletion.filter({ nurse_email: targetEmail }),
      base44.entities.TrainingRecommendation.filter({ nurse_email: targetEmail, addressed: false })
    ]);

    // Calculate performance metrics
    const avgQualityScore = noteConversions.length > 0
      ? noteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / noteConversions.length
      : 0;

    const avgComplianceScore = noteConversions.length > 0
      ? noteConversions.reduce((sum, n) => sum + (n.enhanced_note_compliance || 0), 0) / noteConversions.length
      : 0;

    const avgComplianceImprovement = noteConversions.filter(n => n.compliance_improvement).length > 0
      ? noteConversions.filter(n => n.compliance_improvement).reduce((sum, n) => sum + n.compliance_improvement, 0) / noteConversions.filter(n => n.compliance_improvement).length
      : 0;

    const flaggedAudits = complianceAudits.filter(a => a.status === 'flagged' || a.status === 'critical');
    
    const completedTraining = trainingCompletions.filter(t => t.status === 'completed');
    const avgTrainingScore = completedTraining.filter(t => t.score).length > 0
      ? completedTraining.filter(t => t.score).reduce((sum, t) => sum + t.score, 0) / completedTraining.filter(t => t.score).length
      : 0;

    // Analyze common compliance issues
    const complianceIssues = {};
    complianceAudits.forEach(audit => {
      if (audit.issues && Array.isArray(audit.issues)) {
        audit.issues.forEach(issue => {
          const element = issue.element || 'Unknown';
          if (!complianceIssues[element]) {
            complianceIssues[element] = { count: 0, severity: issue.severity, examples: [] };
          }
          complianceIssues[element].count++;
          if (issue.problem && complianceIssues[element].examples.length < 3) {
            complianceIssues[element].examples.push(issue.problem);
          }
        });
      }
    });

    const topIssues = Object.entries(complianceIssues)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .map(([element, data]) => ({
        element,
        frequency: data.count,
        severity: data.severity,
        examples: data.examples
      }));

    // Generate AI coaching insights
    const coachingPrompt = `You are an expert nursing educator and documentation coach. Analyze this nurse's performance and provide personalized, actionable coaching.

NURSE PERFORMANCE DATA:
- Total Note Enhancements: ${noteConversions.length}
- Average Quality Score: ${avgQualityScore.toFixed(1)}%
- Average Compliance Score: ${avgComplianceScore.toFixed(1)}%
- Average Compliance Improvement: ${avgComplianceImprovement.toFixed(1)}%
- Flagged Audits: ${flaggedAudits.length}
- Training Modules Completed: ${completedTraining.length}
- Average Training Score: ${avgTrainingScore.toFixed(1)}%
- Pending Recommendations: ${trainingRecommendations.length}

TOP RECURRING COMPLIANCE ISSUES:
${topIssues.map((issue, idx) => `${idx + 1}. ${issue.element} (${issue.frequency} occurrences, ${issue.severity} severity)
   Examples: ${issue.examples.join('; ')}`).join('\n')}

RECENT TRAINING HISTORY:
${completedTraining.slice(0, 5).map(t => `- ${t.training_module_id}: Score ${t.score}%, ${t.effectiveness_rating ? `Rated ${t.effectiveness_rating}/5` : 'Not rated'}`).join('\n')}

Provide comprehensive coaching including:

1. STRENGTHS: What is this nurse doing well? Specific praise with data points.

2. PRIORITY IMPROVEMENT AREAS: Top 3 areas needing immediate attention with:
   - Specific gap identified
   - Why it matters (compliance, quality, safety impact)
   - Concrete action steps
   - Estimated time to improve

3. PERSONALIZED TRAINING PLAN: 
   - Specific training modules recommended (match to their gaps)
   - Suggested practice scenarios
   - Micro-learning topics for quick wins

4. DOCUMENTATION TIPS: 
   - Quick wins for immediate improvement
   - Common pitfalls to avoid
   - Phrase templates for problem areas

5. GROWTH TRAJECTORY:
   - Where they are now (skill level)
   - Achievable 30-day goals
   - 90-day mastery pathway

6. MOTIVATIONAL INSIGHTS:
   - Progress made so far
   - Comparison to best practices (not other nurses)
   - Encouragement specific to their journey

Be supportive, specific, and actionable. Focus on growth mindset.`;

    const coachingResult = await base44.integrations.Core.InvokeLLM({
      prompt: coachingPrompt,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          strengths: {
            type: "array",
            items: { type: "string" }
          },
          priority_areas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                area: { type: "string" },
                gap: { type: "string" },
                impact: { type: "string" },
                action_steps: { type: "array", items: { type: "string" } },
                time_to_improve: { type: "string" }
              }
            }
          },
          training_plan: {
            type: "object",
            properties: {
              recommended_modules: { type: "array", items: { type: "string" } },
              practice_scenarios: { type: "array", items: { type: "string" } },
              micro_learning_topics: { type: "array", items: { type: "string" } }
            }
          },
          documentation_tips: {
            type: "object",
            properties: {
              quick_wins: { type: "array", items: { type: "string" } },
              common_pitfalls: { type: "array", items: { type: "string" } },
              phrase_templates: { type: "array", items: { type: "string" } }
            }
          },
          growth_trajectory: {
            type: "object",
            properties: {
              current_level: { type: "string" },
              thirty_day_goals: { type: "array", items: { type: "string" } },
              ninety_day_pathway: { type: "string" }
            }
          },
          motivational_insights: {
            type: "array",
            items: { type: "string" }
          },
          overall_coaching_summary: { type: "string" }
        }
      }
    });

    return Response.json({
      success: true,
      coaching: coachingResult,
      metrics: {
        avgQualityScore: avgQualityScore.toFixed(1),
        avgComplianceScore: avgComplianceScore.toFixed(1),
        avgComplianceImprovement: avgComplianceImprovement.toFixed(1),
        totalEnhancements: noteConversions.length,
        flaggedAudits: flaggedAudits.length,
        completedTraining: completedTraining.length,
        avgTrainingScore: avgTrainingScore.toFixed(1),
        topIssues
      }
    });

  } catch (error) {
    console.error('Coaching generation error:', error);
    return Response.json(
      { error: 'Failed to generate coaching', details: error.message },
      { status: 500 }
    );
  }
});