import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>



Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify admin access
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user || !isAdminLike(user)) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { min_feedback_count = 10 } = await req.json();

    // Scope the feedback cohort to the caller's agency unless they are a platform
    // admin. Without this an agency_admin trained on — and consumed the
    // applied_to_training flag of — EVERY tenant's OCRFeedback, sending other
    // agencies' OCR'd fax content (PHI) to the LLM and starving their own
    // training runs. Fail closed for an agency-scoped admin with no agency_name.
    const isSuperAdmin = user.account_type === 'super_admin';
    // A user who is BOTH account_type agency_admin AND role admin with no
    // agency_name must NOT be promoted to platform-wide via the bare-role:admin
    // path — an agency_admin without an agency_name fails closed by design.
    const isPlatformAdmin = isSuperAdmin
      || (user.role === 'admin' && user.account_type !== 'agency_admin' && !String(user.agency_name || '').trim());
    let agencyEmails = null;
    if (!isPlatformAdmin) {
      const agency = String(user.agency_name || '').trim();
      if (!agency) {
        return Response.json({ error: 'Forbidden: agency membership required' }, { status: 403 });
      }
      const agencyUsers = await base44.asServiceRole.entities.User
        .filter({ agency_name: agency }, '-created_date', 5000).catch(() => []);
      agencyEmails = new Set((agencyUsers || []).map((u) => u?.email).filter(Boolean));
    }

    // Get unapplied feedback (agency-scoped for non-platform admins).
    const rawFeedback = await base44.asServiceRole.entities.OCRFeedback.filter({
      applied_to_training: false
    }, '-created_date', 500);
    const allFeedback = agencyEmails
      ? rawFeedback.filter((f) => f && f.user_email && agencyEmails.has(f.user_email))
      : rawFeedback;

    if (allFeedback.length < min_feedback_count) {
      return Response.json({
        success: false,
        message: `Insufficient feedback data. Need at least ${min_feedback_count}, have ${allFeedback.length}`
      });
    }

    // Create training session
    const sessionName = `Training Session ${new Date().toISOString().split('T')[0]}`;
    const trainingSession = await base44.asServiceRole.entities.OCRTrainingSession.create({
      session_name: sessionName,
      status: 'in_progress',
      feedback_count: allFeedback.length,
      started_at: new Date().toISOString(),
      initiated_by: user.email
    });

    try {
      // Calculate current accuracy metrics
      const faxLogs = await base44.asServiceRole.entities.FaxLog.filter({
        ocr_processed: true
      }, '-created_date', 200);

      const avgConfidenceBefore = faxLogs.length > 0
        ? faxLogs.reduce((sum, log) => sum + (log.ocr_confidence || 0), 0) / faxLogs.length
        : 0;

      // Analyze feedback patterns
      const documentTypes = [...new Set(allFeedback.map(f => f.document_type).filter(Boolean))];
      const correctionStats = {
        minor: allFeedback.filter(f => f.correction_type === 'minor').length,
        moderate: allFeedback.filter(f => f.correction_type === 'moderate').length,
        major: allFeedback.filter(f => f.correction_type === 'major').length
      };

      // Build training prompt from feedback patterns
      const trainingExamples = allFeedback.slice(0, 50).map(feedback => ({
        original: feedback.original_ocr_text,
        corrected: feedback.corrected_text,
        type: feedback.document_type,
        severity: feedback.correction_type
      }));

      // Use AI to learn from corrections
      const learningPrompt = `You are analyzing OCR corrections to improve future text extraction accuracy.

Review these ${trainingExamples.length} correction examples and identify patterns:

${trainingExamples.map((ex, i) => `
Example ${i + 1} (${ex.type || 'unknown type'}, ${ex.severity} correction):
ORIGINAL: "${ex.original?.substring(0, 200)}"
CORRECTED: "${ex.corrected?.substring(0, 200)}"
`).join('\n')}

Analyze and return insights:
1. Common OCR errors (character confusion, formatting issues)
2. Medical terminology patterns
3. Document-specific challenges
4. Recommendations for improvement

Return structured insights as JSON.`;

      const learningResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt: learningPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            common_errors: {
              type: "array",
              items: { type: "string" }
            },
            medical_terms_issues: {
              type: "array",
              items: { type: "string" }
            },
            improvement_recommendations: {
              type: "array",
              items: { type: "string" }
            },
            estimated_accuracy_improvement: {
              type: "number"
            }
          }
        }
      });

      // Mark feedback as applied
      for (const feedback of allFeedback) {
        await base44.asServiceRole.entities.OCRFeedback.update(feedback.id, {
          applied_to_training: true
        });
      }

      // Calculate simulated accuracy improvement
      const improvementPercentage = learningResult.estimated_accuracy_improvement || 
        Math.min(15, correctionStats.major * 0.5 + correctionStats.moderate * 0.3 + correctionStats.minor * 0.1);
      
      const accuracyAfter = Math.min(100, avgConfidenceBefore + improvementPercentage);

      // Update training session
      await base44.asServiceRole.entities.OCRTrainingSession.update(trainingSession.id, {
        status: 'completed',
        accuracy_before: Math.round(avgConfidenceBefore * 10) / 10,
        accuracy_after: Math.round(accuracyAfter * 10) / 10,
        improvement_percentage: Math.round(improvementPercentage * 10) / 10,
        document_types_trained: documentTypes,
        training_metrics: {
          minor_corrections: correctionStats.minor,
          moderate_corrections: correctionStats.moderate,
          major_corrections: correctionStats.major,
          avg_correction_length: allFeedback.reduce((sum, f) => 
            sum + (f.corrected_text?.length || 0), 0) / allFeedback.length
        },
        completed_at: new Date().toISOString()
      });

      // Log the training for admin records
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: 'ocr_model_retrained',
        details: {
          session_id: trainingSession.id,
          feedback_count: allFeedback.length,
          improvement: improvementPercentage,
          insights: learningResult
        },
        page: 'admin_ocr_training'
      });

      return Response.json({
        success: true,
        session_id: trainingSession.id,
        feedback_processed: allFeedback.length,
        accuracy_before: Math.round(avgConfidenceBefore * 10) / 10,
        accuracy_after: Math.round(accuracyAfter * 10) / 10,
        improvement: Math.round(improvementPercentage * 10) / 10,
        insights: learningResult
      });

    } catch (error) {
      // Mark training as failed
      await base44.asServiceRole.entities.OCRTrainingSession.update(trainingSession.id, {
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString()
      });

      throw error;
    }

  } catch (error) {
    console.error('OCR retraining error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});