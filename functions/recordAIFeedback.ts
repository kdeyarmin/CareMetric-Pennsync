import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      ai_output,
      user_correction,
      feedback_type = 'correction', // correction, improvement, error
      context = {},
      output_type = 'note', // note, education, compliance, diagnosis
      improvement_category = '' // documentation, accuracy, clarity, compliance, clinical_accuracy
    } = body;

    if (!ai_output || !user_correction) {
      return Response.json({
        error: 'AI output and user correction are required'
      }, { status: 400 });
    }

    // Create AIFeedback record
    const feedback = await base44.asServiceRole.entities.AIFeedback.create({
      user_email: user.email,
      user_name: user.full_name || '',
      original_ai_output: ai_output,
      user_correction: user_correction,
      feedback_type,
      output_type,
      improvement_category,
      context_data: context,
      is_reviewed: false,
      is_applied: false,
      quality_score: null,
      timestamp: new Date().toISOString()
    });

    console.log('[recordAIFeedback] Recorded feedback:', {
      id: feedback.id,
      type: feedback_type,
      output_type,
      user: user.email
    });

    return Response.json({
      success: true,
      feedback_id: feedback.id,
      message: 'Thank you for the feedback! This helps us improve the AI.'
    });

  } catch (error) {
    console.error('[recordAIFeedback] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});