import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

const normalizeValue = (value) => JSON.stringify(value ?? '').toLowerCase().replace(/\s+/g, '');

const gradeObjectiveQuestion = (question, answer) => {
  const correct = question.correct_answer_json?.answer;
  if (question.type === 'multi_select') {
    // Normalize each element (case/space-insensitive) BEFORE sorting. Sorting
    // raw values then lowercasing is order-unstable across case differences
    // (UTF-16 sorts 'B' before 'a'), which marked correct answers wrong.
    const norm = (arr) =>
      (Array.isArray(arr) ? arr.map((v) => String(v).toLowerCase().replace(/\s+/g, '')) : []).sort();
    return JSON.stringify(norm(answer)) === JSON.stringify(norm(correct));
  }
  if (question.type === 'matching') {
    // The learner submits a { [leftPrompt]: selectedOptionValue } map (see
    // TrainingQuestionRenderer). The correct answer is stored as
    // correct_answer_json.answer.pairs = [{ left, right }] where `right` is the
    // value of the option that correctly matches `left`. Compare per-pair so key
    // order and any extra keys don't matter — a flat stringify comparison here
    // was order-sensitive and compared against the wrong shape entirely.
    const pairs = Array.isArray(correct?.pairs) ? correct.pairs : [];
    if (pairs.length === 0) return false;
    const submitted = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
    return pairs.every((pair) => normalizeValue(submitted[pair.left]) === normalizeValue(pair.right));
  }
  return normalizeValue(answer) === normalizeValue(correct);
};

const parseAssignmentNotes = (value) => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const gradeSubjectiveQuestions = async (base44, subjectiveQuestions) => {
  if (subjectiveQuestions.length === 0) return [];

  const questionsForGrading = subjectiveQuestions.map(q => ({
    questionId: q.questionId,
    question: q.prompt,
    rubric: q.rubric,
    learnerAnswer: q.learnerAnswer,
    maxPoints: q.maxPoints
  }));

  const prompt = `You are an experienced healthcare compliance educator and clinical instructor with expertise in CMS Conditions of Participation, OSHA standards, and evidence-based clinical practice. Patient safety is your top priority. Grade each learner response below and return JSON only.

GRADING CRITERIA:
- Award full points when the response demonstrates correct understanding AND practical application ability
- Award partial points (50-75%) when the response shows understanding but misses key details or clinical specifics
- Award minimal points (25%) when the response shows basic awareness but significant gaps in understanding
- Award zero points when the response is incorrect, dangerously wrong, or shows no understanding
- For clinical/compliance questions: accuracy is paramount — incorrect clinical information must receive zero points regardless of how well-written
- For scenario-based questions: evaluate whether the learner's proposed actions would lead to safe, compliant patient care
- Be strict on safety-critical content (medication errors, patient safety, HIPAA violations) but fair on stylistic differences

FEEDBACK REQUIREMENTS:
- Explain what was correct in the response
- Identify what was missing or incorrect with specific detail
- For incorrect answers: explain the correct approach and why it matters for patient care
- Keep feedback constructive and educational — this is a learning opportunity

Return this exact JSON structure:
{"evaluations":[{"questionId":"","scoreAwarded":0,"maxPoints":1,"confidence":0.0,"feedback":""}]}

Questions to grade:
${JSON.stringify(questionsForGrading)}`;

  // Grade via Base44's standardized InvokeLLM (same path the rest of the app
  // uses) rather than the raw OpenAI SDK. This avoids
  // a hardcoded/invalid model name and a module-level SDK init, and returns a
  // parsed object directly when a response_json_schema is supplied.
  let parsed;
  try {
    parsed = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      model: 'automatic',
      response_json_schema: {
        type: 'object',
        properties: {
          evaluations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                questionId: { type: 'string' },
                scoreAwarded: { type: 'number' },
                maxPoints: { type: 'number' },
                confidence: { type: 'number' },
                feedback: { type: 'string' }
              }
            }
          }
        }
      }
    });
  } catch (e) {
    console.error('AI grading call failed:', e);
    // Don't return [] — that would score every subjective question as 0 while
    // still counting them in the denominator, failing a learner because of an
    // AI hiccup. Surface the error so the attempt is NOT recorded and the
    // learner can retry without consuming an attempt.
    // Tag it so the outer catch relays this text instead of a generic 500 —
    // the learner needs to know the attempt wasn't consumed.
    const unavailable = new Error('AI grading is temporarily unavailable. Your attempt was not recorded — please try again.');
    unavailable.userFacing = true;
    throw unavailable;
  }
  return parsed?.evaluations || [];
};

/** A course with nothing to grade — no ACTIVE questions to score against. */
function hasNoGradableQuestions(questions) {
  return !Array.isArray(questions) || questions.length === 0;
}

/**
 * What to do with an attempt that has NO active questions to grade.
 *
 * `attestation_required` alone does NOT prove a course was authored without an
 * assessment: assignAnnualLearningPlan sets it on every annual-plan assignment
 * (`settings.attestationRequired !== false`), and the seeded annual courses
 * require attestation AND carry graded questions. Keying the auto-pass off it
 * would hand a 100% completion — certificate included — to a learner whose
 * course had simply had its questions deactivated.
 *
 * The honest discriminator is whether the course has any questions AT ALL:
 *   - none authored + attestation required → attestation-only in-service; the
 *     acknowledgement IS the completion, so pass.
 *   - questions exist but none are active → an admin deactivated them; a
 *     misconfiguration, and an unassessed pass must not enter the Medicare
 *     in-service record.
 *   - nothing authored and nothing attested → nothing to record at all.
 * The last two are refused rather than written down, matching the
 * partial-AI-grading guard.
 *
 * @returns {'attestation_only'|'questions_deactivated'|'nothing_to_record'}
 */
function resolveUngradedOutcome({ hasAnyQuestions, attestationRequired }) {
  if (hasAnyQuestions) return 'questions_deactivated';
  if (!attestationRequired) return 'nothing_to_record';
  return 'attestation_only';
}

/**
 * Percentage score for an attempt.
 *
 * A question-less course scores 100, not 0. The arithmetic used to be
 * `earnedPoints / (sum(points) || 1)`, so with no questions it produced
 * 0 / 1 = 0% — which, against the default 80% pass mark, recorded a FAILED
 * attempt (and, at max_attempts: 1, LOCKED the assignment) for a learner who
 * did everything the course asked. Only reached once the caller has confirmed
 * via resolveUngradedOutcome that the empty question set is legitimate.
 */
function computeAttemptScore(questions, earnedPoints) {
  if (hasNoGradableQuestions(questions)) return 100;
  const totalPossible = questions.reduce((sum, question) => sum + (question.points || 1), 0) || 1;
  return Math.round((earnedPoints / totalPossible) * 100);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assignmentId, responses = [], attestation = {}, startedAt, timeSpentMinutes = 0, randomizedQuestionOrder = [] } = await req.json();
    if (!assignmentId) {
      return Response.json({ error: 'assignmentId is required' }, { status: 400 });
    }

    const [assignment] = await base44.asServiceRole.entities.TrainingAssignment.filter({ id: assignmentId }, undefined, 5000);
    if (!assignment) {
      return Response.json({ error: 'Assignment not found' }, { status: 404 });
    }

    if (!isAdminUser(user) && assignment.assigned_to_user_id !== user.email) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [course] = await base44.asServiceRole.entities.TrainingCourse.filter({ id: assignment.course_id }, undefined, 5000);
    // Grade only ACTIVE questions — the player (getCoursePlayerQuestions) serves
    // only active:true, so including inactive ones here made the "all questions
    // answered" check below reject every submission the moment an admin
    // deactivated any question in the course.
    const questions = await base44.asServiceRole.entities.TrainingQuestion.filter({ course_id: assignment.course_id, active: true }, 'order_index', 500);
    const attempts = await base44.asServiceRole.entities.TrainingAttempt.filter({ assignment_id: assignmentId, user_id: assignment.assigned_to_user_id }, '-created_date', 100);
    const assignmentNotes = parseAssignmentNotes(assignment.notes);

    // Competency gates must come from the ADMIN-OWNED course, not solely from
    // the TrainingAssignment row. TrainingAssignment write RLS grants the
    // assignee (the learner) full row write, so trusting the assignment's
    // passing_score_required / max_attempts / waiting_period_hours for gating
    // let a learner POST { passing_score_required: 1 } to their own assignment,
    // answer one question, and have the passing TrainingAttempt drive
    // issueCertificate into minting a compliance/CEU certificate. A
    // learner-writable value may only make a gate STRICTER than the course
    // baseline (raise the pass mark, lower the attempt cap, lengthen the
    // cooldown), never weaker.
    const courseRetake = (course && typeof course.retake_settings_json === 'object' && course.retake_settings_json) || {};

    const attemptCaps = [assignment.max_attempts, courseRetake.max_attempts]
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    const effectiveMaxAttempts = attemptCaps.length ? Math.min(...attemptCaps) : null;
    if (effectiveMaxAttempts && attempts.length >= effectiveMaxAttempts) {
      return Response.json({ error: 'Maximum attempts reached for this in-service' }, { status: 400 });
    }

    const effectiveWaitHours = Math.max(
      Number(assignment.waiting_period_hours) || 0,
      Number(courseRetake.waiting_period_hours) || 0,
    );
    if (effectiveWaitHours && attempts.length > 0) {
      const lastAttempt = attempts[0];
      const submittedAt = lastAttempt.submitted_at ? new Date(lastAttempt.submitted_at).getTime() : 0;
      const hoursSince = (Date.now() - submittedAt) / (1000 * 60 * 60);
      if (lastAttempt.passed === false && hoursSince < effectiveWaitHours) {
        return Response.json({ error: `Retake available in ${Math.ceil(effectiveWaitHours - hoursSince)} hour(s)` }, { status: 400 });
      }
    }

    const attestationRequired = !!(assignment.attestation_required || course?.requires_attestation);
    if (attestationRequired && (!attestation.acknowledged || !attestation.signedName)) {
      return Response.json({ error: 'Attestation is required before submitting the test' }, { status: 400 });
    }

    // Nothing to grade: work out WHY before deciding, because
    // `attestation_required` is set on every annual-plan assignment and so
    // cannot stand in for "authored without an assessment" (see
    // resolveUngradedOutcome). The extra read only happens on this rare path.
    if (hasNoGradableQuestions(questions)) {
      const anyQuestion = await base44.asServiceRole.entities.TrainingQuestion
        .filter({ course_id: assignment.course_id }, undefined, 1)
        .catch(() => null);
      // A failed lookup must not be read as "no questions authored" — that is
      // the branch that auto-passes. Fail closed.
      if (anyQuestion === null) {
        return Response.json({
          error: 'Could not verify this in-service before scoring it. Your attempt was not recorded — please try again.',
        }, { status: 503 });
      }
      const outcome = resolveUngradedOutcome({
        hasAnyQuestions: anyQuestion.length > 0,
        attestationRequired,
      });
      if (outcome === 'questions_deactivated') {
        return Response.json({
          error: 'This in-service has no active questions, so it cannot be scored. Your attempt was not recorded — ask your administrator to restore its questions.',
        }, { status: 409 });
      }
      if (outcome === 'nothing_to_record') {
        return Response.json({
          error: 'This in-service has no test and no attestation, so there is nothing to record. Ask your administrator to finish setting it up.',
        }, { status: 409 });
      }
    }

    const responseMap = new Map(responses.map((response) => [response.questionId, response.answer]));
    const questionResults = [];
    let earnedPoints = 0;
    let objectiveScore = 0;
    let shortAnswerScore = 0;

    const subjectivePayload = [];

    for (const question of questions) {
      const answer = responseMap.get(question.id);
      if (answer === undefined || answer === null || answer === '' || (Array.isArray(answer) && answer.length === 0)) {
        return Response.json({ error: 'All questions must be answered before submission' }, { status: 400 });
      }

      // A matching answer is a { [left]: value } map; require a selection for
      // every pair, otherwise a partially-filled map slips past the check above
      // and is silently graded wrong.
      if (question.type === 'matching') {
        const pairs = Array.isArray(question.correct_answer_json?.answer?.pairs)
          ? question.correct_answer_json.answer.pairs
          : [];
        const answered = answer && typeof answer === 'object' && !Array.isArray(answer)
          ? pairs.every((pair) => answer[pair.left] !== undefined && answer[pair.left] !== '')
          : false;
        if (!answered) {
          return Response.json({ error: 'All questions must be answered before submission' }, { status: 400 });
        }
      }

      if (question.type === 'short_answer' || question.type === 'scenario_based') {
        subjectivePayload.push({
          questionId: question.id,
          prompt: question.prompt,
          rubric: question.rubric || question.rationale || '',
          learnerAnswer: answer,
          maxPoints: question.points || 1
        });
        continue;
      }

      const isCorrect = gradeObjectiveQuestion(question, answer);
      const pointsEarned = isCorrect ? (question.points || 1) : 0;
      earnedPoints += pointsEarned;
      objectiveScore += pointsEarned;
      questionResults.push({
        question_id: question.id,
        question_type: question.type,
        prompt: question.prompt,
        answer,
        correct: isCorrect,
        points_earned: pointsEarned,
        points_possible: question.points || 1,
        rationale: question.rationale || ''
      });
    }

    const subjectiveEvaluations = await gradeSubjectiveQuestions(base44, subjectivePayload);

    // Every subjective question must receive an evaluation; otherwise the
    // missing ones silently score 0 yet stay in the denominator, producing a
    // false failing score. Reject so the attempt isn't recorded on a partial
    // AI result (the learner can retry).
    if (subjectivePayload.length > 0) {
      const gradedIds = new Set(subjectiveEvaluations.map((e) => e.questionId));
      const ungraded = subjectivePayload.filter((q) => !gradedIds.has(q.questionId));
      if (ungraded.length > 0) {
        const partial = new Error('AI grading did not return results for all questions. Your attempt was not recorded — please try again.');
        partial.userFacing = true;
        throw partial;
      }
    }

    for (const evaluation of subjectiveEvaluations) {
      const question = questions.find((item) => item.id === evaluation.questionId);
      const maxPoints = question?.points || 1;
      const awarded = Math.max(0, Math.min(Number(evaluation.scoreAwarded || 0), maxPoints));
      earnedPoints += awarded;
      shortAnswerScore += awarded;
      questionResults.push({
        question_id: evaluation.questionId,
        question_type: question?.type || 'short_answer',
        prompt: question?.prompt || '',
        answer: responseMap.get(evaluation.questionId),
        correct: awarded >= maxPoints,
        points_earned: awarded,
        points_possible: maxPoints,
        ai_feedback: evaluation.feedback || '',
        ai_confidence: evaluation.confidence || 0
      });
    }

    const score = computeAttemptScore(questions, earnedPoints);
    // Floor the pass mark at the admin-owned course value (see the competency-gate
    // note above). The learner-writable assignment.passing_score_required may only
    // RAISE the bar, never drop it below the course floor — otherwise a learner
    // sets passing_score_required:1, answers one question, and mints a certificate.
    const courseFloorScore = Number(course?.passing_score ?? courseRetake.passing_threshold) || 80;
    const passingScore = Math.max(courseFloorScore, Number(assignment.passing_score_required) || 0);
    const passed = score >= passingScore;
    const attemptNumber = attempts.length + 1;
    const submittedAt = new Date().toISOString();

    if (attestation.acknowledged && attestation.signedName) {
      await base44.asServiceRole.entities.TrainingAttestation.create({
        assignment_id: assignmentId,
        course_id: assignment.course_id,
        user_id: assignment.assigned_to_user_id,
        statement: attestation.statement || course?.attestation_text || 'I have reviewed and understand this training.',
        acknowledged: true,
        signed_name: attestation.signedName,
        attestation_timestamp: submittedAt,
        device_metadata: attestation.deviceMetadata || {},
        ip_address: req.headers.get('x-forwarded-for') || ''
      });
    }

    const attempt = await base44.asServiceRole.entities.TrainingAttempt.create({
      assignment_id: assignmentId,
      course_id: assignment.course_id,
      user_id: assignment.assigned_to_user_id,
      started_at: startedAt || new Date().toISOString(),
      submitted_at: submittedAt,
      score,
      objective_score: objectiveScore,
      short_answer_score: shortAnswerScore,
      passed,
      pass_fail_result: passed ? 'passed' : 'failed',
      answers_json: questionResults,
      grading_method: subjectivePayload.length > 0 ? 'ai_assisted' : 'automatic',
      ai_grading_confidence: subjectiveEvaluations.length > 0 ? Number(subjectiveEvaluations[0]?.confidence || 0) : null,
      randomized_question_order: randomizedQuestionOrder,
      time_spent_minutes: timeSpentMinutes,
      attempt_number: attemptNumber,
      remediation_message: passed ? '' : (assignment.remediation_message || 'Review the in-service content and retake the competency test.'),
      ip_address: req.headers.get('x-forwarded-for') || ''
    });

    let certificate = null;
    let expirationDate = null;
    if (passed && course?.enable_certificate) {
      // Issue certificate via dedicated function
      try {
        const certResult = await base44.asServiceRole.functions.invoke('issueCertificate', {
          assignment_id: assignmentId,
          user_id: assignment.assigned_to_user_id,
          course_id: assignment.course_id,
          score,
          internal_secret: Deno.env.get('INTERNAL_FN_SECRET') || '',
        });
        
        if (certResult.data?.certificate) {
          certificate = certResult.data.certificate;
          expirationDate = certificate.expiration_date;
        }
      } catch (certError) {
        console.error('Certificate issuance failed:', certError);
        // Continue without certificate rather than failing the grading
      }
    }

    // Use the EFFECTIVE cap (course ∩ assignment), the same value the attempt
    // gate above enforces. Using the learner-writable assignment.max_attempts
    // here would leave the assignment 'failed' with retake_required:true even
    // when the stricter course cap is already reached, so the UI would offer a
    // retake that the gate then always rejects (a dead end).
    const maxAttemptsReached = !!effectiveMaxAttempts && attemptNumber >= effectiveMaxAttempts && !passed;
    await base44.asServiceRole.entities.TrainingAssignment.update(assignmentId, {
      status: passed ? 'completed' : maxAttemptsReached ? 'locked' : 'failed',
      latest_attempt_number: attemptNumber,
      score_percentage: score,
      pass_fail_result: passed ? 'passed' : 'failed',
      retake_required: !passed && !maxAttemptsReached,
      progress_percentage: 100,
      completion_date: passed ? submittedAt : assignment.completion_date,
      last_accessed: submittedAt,
      certificate_id: certificate?.certificate_id || assignment.certificate_id,
      acknowledgement_completed: !!attestation.acknowledged,
      renewal_due_date: expirationDate || assignment.renewal_due_date
    });

    if (assignment.plan_id) {
      const planAssignments = await base44.asServiceRole.entities.TrainingAssignment.filter({ plan_id: assignment.plan_id, assigned_to_user_id: assignment.assigned_to_user_id }, '-created_date', 500);
      // Plan completion is gated by REQUIRED courses only — optional courses
      // (assigned with required: false) are tracked but never block reaching
      // 100% / "completed". Plans where every course is required are unaffected.
      const requiredAssignments = planAssignments.filter((item) => item.required !== false);
      const completedCount = requiredAssignments.filter((item) => item.id === assignmentId ? passed : item.status === 'completed').length;
      const progressPercentage = Math.round((completedCount / Math.max(requiredAssignments.length, 1)) * 100);
      const [existingEnrollment] = await base44.asServiceRole.entities.PlanEnrollment.filter({ plan_id: assignment.plan_id, user_id: assignment.assigned_to_user_id }, undefined, 5000);
      if (existingEnrollment) {
        await base44.asServiceRole.entities.PlanEnrollment.update(existingEnrollment.id, {
          courses_completed: completedCount,
          courses_total: requiredAssignments.length,
          progress_percentage: progressPercentage,
          status: progressPercentage === 100 ? 'completed' : 'in_progress',
          completion_date: progressPercentage === 100 ? submittedAt : existingEnrollment.completion_date
        });
      }
    }

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: assignment.assigned_to_user_id,
      actor_name: user.full_name,
      action: 'assignment_modified',
      entity_type: 'TrainingAssignment',
      entity_id: assignmentId,
      reason: attemptNumber > 1 ? 'retaken' : (passed ? 'completed' : 'failed'),
      after_json: { score, passed, attempt_number: attemptNumber, certificate_id: certificate?.certificate_id || null },
      severity: passed ? 'info' : 'warning'
    });

    if (certificate) {
      await base44.asServiceRole.entities.TrainingAuditLog.create({
        actor_id: assignment.assigned_to_user_id,
        actor_name: user.full_name,
        action: 'certificate_issued',
        entity_type: 'TrainingCertificate',
        entity_id: certificate.id,
        after_json: { certificate_id: certificate.certificate_id, course_id: certificate.course_id, annual_cycle_year: certificate.annual_cycle_year || null },
        reason: 'certificate issued',
        severity: 'info'
      });

      await base44.asServiceRole.entities.Notification.create({
        user_email: assignment.assigned_to_user_id,
        title: 'Certificate available',
        message: `You passed "${assignment.course_title}" with a score of ${score}%. Your certificate is now available.`,
        type: 'info',
        priority: 'medium',
        action_url: '/MyTraining',
        action_label: 'View transcript',
        metadata: { assignment_id: assignmentId, certificate_id: certificate.certificate_id }
      });
    }

    if (!passed && maxAttemptsReached) {
      const admins = await base44.asServiceRole.entities.User.list('-created_date', 200);
      const adminEmails = admins.filter((candidate) => isAdminUser(candidate)).map((candidate) => candidate.email);
      await Promise.all(adminEmails.map((email) =>
        base44.asServiceRole.entities.Notification.create({
          user_email: email,
          title: 'Final failed in-service attempt',
          message: `${user.full_name || assignment.assigned_to_user_id} has exhausted all attempts for "${assignment.course_title}".`,
          type: 'critical_alert',
          priority: 'critical',
          action_url: '/AIComplianceInServices',
          action_label: 'Review learner',
          metadata: { assignment_id: assignmentId, user_id: assignment.assigned_to_user_id }
        })
      ));
    }

    return Response.json({
      success: true,
      attempt_id: attempt.id,
      score,
      passing_score: passingScore,
      passed,
      certificate,
      retake_required: !passed && !maxAttemptsReached,
      locked: !!maxAttemptsReached,
      show_correct_answers: !!assignmentNotes.show_correct_answers,
      graded_answers: !!assignmentNotes.show_correct_answers ? questionResults : [],
      remediation_message: !passed ? (assignment.remediation_message || 'Review the lesson content and retry.') : ''
    });
  } catch (error) {
    console.error('gradeTrainingAttempt failed:', error);
    // Relay the purpose-written "attempt was NOT recorded" messages; a generic
    // 500 left the learner unsure whether a retry costs them an attempt.
    if (error?.userFacing) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});