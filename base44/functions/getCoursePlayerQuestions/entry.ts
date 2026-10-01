import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
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
function sanitizeTrainingQuestionOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      return { value: option, label: String(option ?? '') };
    }
    // Older/imported rows may contain editor-only flags such as `correct` or
    // per-option feedback. Allow-list only what the learner renderer needs.
    return { value: option.value, label: option.label };
  });
}

function sanitizeTrainingQuestionForLearner(q) {
  const safe = {
    id: q.id,
    course_id: q.course_id,
    type: q.type,
    prompt: q.prompt,
    options_json: sanitizeTrainingQuestionOptions(q.options_json),
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
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
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

    const questions = (rows || []).map(sanitizeTrainingQuestionForLearner);

    return Response.json({ success: true, questions });
  } catch (error) {
    console.error('getCoursePlayerQuestions error:', error);
    return Response.json({ error: 'Failed to load questions', details: 'Internal server error' }, { status: 500 });
  }
});
