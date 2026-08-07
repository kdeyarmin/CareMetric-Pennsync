import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    const { skill_gap, nurse_email } = await req.json();
    // Only admin-like callers may build training from another nurse's
    // PHI/performance data, and only within their agency.
    if (nurse_email && nurse_email !== user.email) {
      const isAdminLike = user.role === 'admin'
        || user.account_type === 'agency_admin'
        || user.account_type === 'super_admin';
      if (!isAdminLike) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (user.account_type !== 'super_admin' && user.agency_name) {
        const [target] = await base44.asServiceRole.entities.User
          .filter({ email: nurse_email }, '-created_date', 1).catch(() => []);
        if (!target?.agency_name || target.agency_name !== user.agency_name) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }
    const targetEmail = nurse_email || user.email;

    // Fetch nurse performance data
    const [recommendations, audits, activities] = await Promise.all([
      // Fetch ALL recommendations (not just addressed:false) so the acceptance
      // rate below is real — filtering to addressed:false first made
      // `filter(r => r.addressed)` always empty, pinning the rate at 0%.
      base44.asServiceRole.entities.TrainingRecommendation.filter({
        nurse_email: targetEmail
      }, undefined, 5000),
      base44.asServiceRole.entities.ComplianceAudit.filter({ nurse_email: targetEmail }, undefined, 5000),
      base44.asServiceRole.entities.UserActivity.filter({ user_email: targetEmail }, undefined, 5000)
    ]);

    // Calculate specific deficits
    const avgComplianceScore = audits.length > 0
      ? audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length
      : 0;

    const suggestionAcceptance = recommendations.length > 0
      ? (recommendations.filter(r => r.addressed).length / recommendations.length) * 100
      : 0;

    // Generate training content using AI
    const trainingPrompt = `You are an expert nursing educator and training content creator. Generate comprehensive, interactive training content for a home health/hospice nurse.

SKILL GAP: ${skill_gap}

NURSE PERFORMANCE CONTEXT:
- Average Compliance Score: ${Math.round(avgComplianceScore)}%
- AI Suggestion Acceptance Rate: ${Math.round(suggestionAcceptance)}%
- Recent Recommendations (sample): ${recommendations.slice(0, 5).map(r => r.recommendation_text).join('; ')}

COMPLIANCE ISSUES IDENTIFIED:
${audits.slice(0, 5).map(a => `- Issues: ${JSON.stringify(a.issues)}`).join('\n')}

Generate a complete training module with the following components:

1. LESSON CONTENT: 
   - Clear learning objectives (3-5)
   - Key concepts explained in simple terms
   - Real-world examples from home health
   - Best practices and tips
   - Common mistakes to avoid

2. INTERACTIVE SCENARIO:
   - A realistic patient case study
   - Clinical decision points
   - Multiple choice questions with rationales
   - Correct actions and consequences

3. PRACTICE QUIZ (5-7 questions):
   - Multiple choice questions
   - Each with 4 options
   - Clear correct answer
   - Detailed explanation for why each answer is right or wrong

4. KEY TAKEAWAYS:
   - 3-5 bullet points summarizing the most critical information

Make content specific, practical, and immediately applicable to home health nursing.`;

    const trainingContent = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: trainingPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          learning_objectives: {
            type: 'array',
            items: { type: 'string' }
          },
          lesson_content: {
            type: 'object',
            properties: {
              introduction: { type: 'string' },
              key_concepts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    concept: { type: 'string' },
                    explanation: { type: 'string' }
                  }
                }
              },
              best_practices: {
                type: 'array',
                items: { type: 'string' }
              },
              common_mistakes: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          },
          scenario: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              patient_background: { type: 'string' },
              situation: { type: 'string' },
              decision_points: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    question: { type: 'string' },
                    options: {
                      type: 'array',
                      items: { type: 'string' }
                    },
                    correct_answer: { type: 'number' },
                    rationale: { type: 'string' }
                  }
                }
              }
            }
          },
          quiz: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: {
                  type: 'array',
                  items: { type: 'string' }
                },
                correct_answer: { type: 'number' },
                explanation: { type: 'string' }
              }
            }
          },
          key_takeaways: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    });

    return Response.json({
      success: true,
      skill_gap,
      training_content: trainingContent,
      nurse_email: targetEmail,
      estimated_duration: 20 + (trainingContent.quiz?.length || 0) * 2
    });

  } catch (error) {
    console.error('Error generating training:', error);
    return Response.json({ 
      error: 'Internal server error',
    }, { status: 500 });
  }
});