import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { user_email, error_patterns } = await req.json();

    if (!user_email || !error_patterns || error_patterns.length === 0) {
      return Response.json({ 
        error: 'user_email and error_patterns are required' 
      }, { status: 400 });
    }

    // Generate personalized training content
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a healthcare compliance training expert. Generate a comprehensive, personalized training module for a clinician who has made specific compliance errors.

USER COMPLIANCE ERROR PATTERNS:
${error_patterns.map((pattern, idx) => `
${idx + 1}. Error Pattern: ${pattern.pattern}
   Rule Violated: ${pattern.rule_name}
   Frequency: ${pattern.count} times
   Severity: ${pattern.severity}
   Example Issues: ${pattern.examples?.join('; ') || 'N/A'}
`).join('\n')}

Create a personalized training module that includes:

1. OVERVIEW: Brief explanation of why these compliance issues matter (2-3 paragraphs)
2. LEARNING OBJECTIVES: 3-5 specific, measurable objectives
3. KEY CONCEPTS: Core concepts the user needs to understand for each error pattern
4. BEST PRACTICES: Step-by-step best practices to avoid these errors
5. REAL-WORLD SCENARIOS: 3 realistic clinical scenarios related to their errors
6. INTERACTIVE QUIZ: 8-10 multiple choice questions testing their understanding
7. QUICK REFERENCE: Checklist they can use during documentation

Make the content practical, actionable, and directly relevant to their specific error patterns.`,
      response_json_schema: {
        type: "object",
        properties: {
          module_title: { type: "string" },
          overview: { type: "string" },
          learning_objectives: { type: "array", items: { type: "string" } },
          key_concepts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                concept: { type: "string" },
                explanation: { type: "string" },
                why_it_matters: { type: "string" }
              }
            }
          },
          best_practices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                practice: { type: "string" },
                steps: { type: "array", items: { type: "string" } },
                common_pitfalls: { type: "array", items: { type: "string" } }
              }
            }
          },
          scenarios: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                scenario: { type: "string" },
                correct_approach: { type: "string" },
                why_correct: { type: "string" }
              }
            }
          },
          quiz_questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                options: { type: "array", items: { type: "string" } },
                correct_answer: { type: "string" },
                explanation: { type: "string" }
              }
            }
          },
          quick_reference_checklist: { type: "array", items: { type: "string" } },
          estimated_time_minutes: { type: "number" }
        }
      }
    });

    // Store the training module
    const trainingModule = await base44.entities.TrainingModule.create({
      title: response.module_title,
      category: 'compliance',
      content: JSON.stringify(response),
      estimated_duration: response.estimated_time_minutes,
      is_ai_generated: true,
      target_user_email: user_email,
      error_patterns_addressed: error_patterns.map(p => p.pattern)
    });

    // Create training progress record
    await base44.entities.ComplianceTrainingProgress.create({
      user_email: user_email,
      training_module_id: trainingModule.id,
      module_title: response.module_title,
      error_patterns_addressed: error_patterns.map(p => p.pattern),
      status: 'not_started',
      violations_before_training: error_patterns.reduce((sum, p) => sum + p.count, 0)
    });

    return Response.json({
      success: true,
      training_module: response,
      module_id: trainingModule.id
    });

  } catch (error) {
    console.error('Generate compliance training error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});