import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * AI-powered personalization engine that analyzes provider patterns
 * and generates tailored recommendations
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { providerEmail } = await req.json();

    // Get usage pattern
    const patterns = await base44.asServiceRole.entities.ProviderUsagePattern.filter({
      provider_email: providerEmail
    });
    const pattern = patterns[0];

    if (!pattern) {
      return Response.json({
        success: true,
        insights: {
          templates: [],
          quickActions: [],
          patientInsights: [],
          aiSuggestions: []
        }
      });
    }

    // Get recent notes for analysis
    const recentNotes = await base44.asServiceRole.entities.Visit.filter({
      created_by: providerEmail
    }, '-created_date', 20);

    // Get patients
    const patients = await base44.asServiceRole.entities.Patient.list('-updated_date', 100);

    // Build context for AI
    const analysisContext = {
      provider_type: pattern.provider_type,
      total_notes: pattern.total_notes_generated || 0,
      top_visit_types: pattern.frequent_visit_types?.slice(0, 3) || [],
      top_diagnoses: pattern.frequent_diagnoses?.slice(0, 5) || [],
      feature_usage: pattern.feature_usage || {},
      time_preference: pattern.preferred_time_of_day,
      ai_acceptance_rate: pattern.ai_suggestion_acceptance_rate || 0,
      recent_activity_count: recentNotes.length
    };

    // Use AI to generate personalized insights
    const prompt = `You are a clinical workflow optimization AI. Analyze this provider's usage patterns and generate personalized recommendations.

Provider Context:
- Type: ${analysisContext.provider_type}
- Total Notes: ${analysisContext.total_notes}
- Top Visit Types: ${analysisContext.top_visit_types.map(v => v.visit_type).join(', ')}
- Common Diagnoses: ${analysisContext.top_diagnoses.map(d => d.diagnosis).join(', ')}
- AI Acceptance Rate: ${analysisContext.ai_acceptance_rate}%
- Preferred Time: ${analysisContext.time_preference}

Generate personalized insights in the following format:
1. Template Recommendations (2-3 specific templates they should try)
2. Workflow Optimizations (2-3 quick actions to add to their workflow)
3. Patient Care Insights (2-3 proactive patient care suggestions based on their specialty)
4. AI Feature Suggestions (2-3 AI features they haven't tried or should use more)

Return JSON only with this structure:
{
  "templates": [{"name": "...", "reason": "...", "visit_type": "..."}],
  "quickActions": [{"action": "...", "benefit": "...", "time_saved": "..."}],
  "patientInsights": [{"insight": "...", "action": "...", "priority": "high/medium/low"}],
  "aiSuggestions": [{"feature": "...", "benefit": "...", "usage_tip": "..."}]
}`;

    const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          templates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                reason: { type: 'string' },
                visit_type: { type: 'string' }
              }
            }
          },
          quickActions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                benefit: { type: 'string' },
                time_saved: { type: 'string' }
              }
            }
          },
          patientInsights: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                insight: { type: 'string' },
                action: { type: 'string' },
                priority: { type: 'string' }
              }
            }
          },
          aiSuggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                feature: { type: 'string' },
                benefit: { type: 'string' },
                usage_tip: { type: 'string' }
              }
            }
          }
        }
      }
    });

    return Response.json({
      success: true,
      insights: aiResponse,
      metadata: {
        generated_at: new Date().toISOString(),
        based_on_notes: analysisContext.total_notes
      }
    });

  } catch (error) {
    console.error('Personalization engine error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});