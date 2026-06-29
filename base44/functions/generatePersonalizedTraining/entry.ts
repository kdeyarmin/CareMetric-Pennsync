import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { skill_gap, nurse_email } = await req.json();
    // Only admins may build training from another nurse's PHI/performance data.
    // Mirrors the guard in generatePersonalizedLearningPath; without it any
    // authenticated user could read another nurse's ComplianceAudit /
    // TrainingRecommendation / UserActivity via the service-role reads below.
    if (nurse_email && nurse_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const targetEmail = nurse_email || user.email;

    // Fetch nurse performance data
    const [recommendations, audits, activities] = await Promise.all([
      base44.asServiceRole.entities.TrainingRecommendation.filter({ 
        nurse_email: targetEmail,
        addressed: false 
      }),
      base44.asServiceRole.entities.ComplianceAudit.filter({ nurse_email: targetEmail }),
      base44.asServiceRole.entities.UserActivity.filter({ user_email: targetEmail })
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
      model: "claude_opus_4_8",
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
      error: error.message,
    }, { status: 500 });
  }
});