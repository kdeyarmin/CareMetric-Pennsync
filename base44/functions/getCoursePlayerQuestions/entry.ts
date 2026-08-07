import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// Serve the questions for the learner-facing course/quiz player WITHOUT the answer
// key. Fetching TrainingQuestion directly from the browser shipped
// `correct_answer_json` (the correct MCQ option, true/false value, multi-select set,
// and matching left->right map), `rationale`, and `rubric` in the network response,
// so any learner could read the answers in DevTools before submitting — defeating
// the competency assessment that gates compliance/CEU certificates. Grading stays
// entirely server-side (gradeTrainingAttempt), so the player only needs an
// answer-free view. For matching questions we keep ONLY the left prompts (the
// right/answer side is removed); the selectable options come from options_json.
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
    if (!courseId) {
      return Response.json({ error: 'course_id is required' }, { status: 400 });
    }

    const rows = await base44.asServiceRole.entities.TrainingQuestion
      .filter({ course_id: courseId, active: true }, 'order_index', 500);

    const questions = (rows || []).map((q) => {
      const safe = {
        id: q.id,
        course_id: q.course_id,
        type: q.type,
        prompt: q.prompt,
        options_json: q.options_json,
        difficulty: q.difficulty,
        points: q.points,
        order_index: q.order_index,
        active: q.active,
      };
      // Matching questions need the LEFT prompts to render; strip the RIGHT
      // (answer) side so the correct mapping is never sent to the browser.
      if (q.type === 'matching') {
        const pairs = Array.isArray(q.correct_answer_json?.answer?.pairs)
          ? q.correct_answer_json.answer.pairs
          : [];
        safe.correct_answer_json = { answer: { pairs: pairs.map((p) => ({ left: p?.left })) } };
      }
      // Everything else (correct_answer_json for MCQ/true-false/multi-select,
      // rationale, rubric, source_citations_json) is intentionally omitted.
      return safe;
    });

    return Response.json({ success: true, questions });
  } catch (error) {
    console.error('getCoursePlayerQuestions error:', error);
    return Response.json({ error: 'Failed to load questions', details: 'Internal server error' }, { status: 500 });
  }
});
