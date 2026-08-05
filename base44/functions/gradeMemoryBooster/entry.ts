import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Grade a spaced-repetition "memory booster" review server-side. The learner-facing
// booster used to fetch TrainingQuestion straight from the browser so it could grade
// locally, which shipped `correct_answer_json` and `rationale` to any learner — the
// same leak getCoursePlayerQuestions exists to prevent, and these are the very rows
// reused for graded, certificate-issuing attempts. The booster now renders the
// answer-free payload and posts its answers here; the key never leaves the server.
const normalizeValue = (value) => JSON.stringify(value ?? '').toLowerCase().replace(/\s+/g, '');

const isCorrect = (question, answer) => {
  // An unanswered question is never correct — otherwise undefined vs. a missing
  // answer key would normalize to the same string and inflate the score.
  if (answer == null || (Array.isArray(answer) && answer.length === 0)) return false;
  const correct = question.correct_answer_json?.answer;
  if (correct == null) return false;
  if (question.type === 'multi_select') {
    // Normalize each element before sorting so case/space differences don't make
    // the comparison order-unstable.
    const norm = (arr) =>
      (Array.isArray(arr) ? arr.map((v) => String(v).toLowerCase().replace(/\s+/g, '')) : []).sort();
    return JSON.stringify(norm(answer)) === JSON.stringify(norm(correct));
  }
  return normalizeValue(answer) === normalizeValue(correct);
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const courseId = body?.course_id;
    const responses = Array.isArray(body?.responses) ? body.responses : [];
    if (!courseId) {
      return Response.json({ error: 'course_id is required' }, { status: 400 });
    }
    if (responses.length === 0) {
      return Response.json({ error: 'responses is required' }, { status: 400 });
    }

    // Eligibility gate. The questions below are read with asServiceRole, so RLS
    // does not scope them — without this, any authenticated user could post a
    // guessed course_id and harvest per-question correctness (binary-searchable
    // into the answer key) plus the rationale text, for a course they were never
    // assigned. The booster UI itself only ever offers courses drawn from the
    // learner's own TrainingAssignment rows; enforce that same rule server-side.
    const ownAssignments = await base44.asServiceRole.entities.TrainingAssignment
      .filter({ assigned_to_user_id: user.email, course_id: courseId }, '-created_date', 1)
      .catch(() => []);
    if (!ownAssignments.length) {
      return Response.json({ error: 'This course is not assigned to you.' }, { status: 403 });
    }

    const rows = await base44.asServiceRole.entities.TrainingQuestion
      .filter({ course_id: courseId, active: true }, 'order_index', 500);
    const byId = new Map((rows || []).map((q) => [q.id, q]));

    // Grade only the questions actually served for this booster, and only the
    // objective types the booster can render.
    const graded = responses
      .map((r) => byId.get(r?.question_id))
      .filter((q) => q && ['mcq', 'multi_select', 'true_false'].includes(q.type));

    if (graded.length === 0) {
      return Response.json({ error: 'No gradable questions in this submission' }, { status: 400 });
    }

    const answerFor = (questionId) => responses.find((r) => r?.question_id === questionId)?.answer;
    const results = graded.map((q) => ({
      question_id: q.id,
      correct: isCorrect(q, answerFor(q.id)),
      // Rationale is released only alongside the grade, never before submission.
      rationale: q.rationale || '',
    }));
    const correctCount = results.filter((r) => r.correct).length;
    const score = Math.round((correctCount / graded.length) * 100);

    return Response.json({ success: true, results, correctCount, total: graded.length, score });
  } catch (error) {
    console.error('gradeMemoryBooster error:', error);
    return Response.json({ error: 'Failed to grade review', details: 'Internal server error' }, { status: 500 });
  }
});
