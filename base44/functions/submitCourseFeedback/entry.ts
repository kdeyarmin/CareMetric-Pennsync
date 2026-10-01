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


// Records (or updates) the current user's rating for a published course.
// One feedback record per user/course — re-submitting updates the existing row.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { courseId, rating, comment = '', wouldRecommend = null, difficulty = null } = await req.json();
    if (!courseId) {
      return Response.json({ error: 'courseId is required' }, { status: 400 });
    }
    const numericRating = Number(rating);
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      return Response.json({ error: 'rating must be between 1 and 5' }, { status: 400 });
    }

    const [course] = await base44.asServiceRole.entities.TrainingCourse.filter({ id: courseId }, undefined, 5000);
    if (!course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }
    if (course.status !== 'published') {
      return Response.json({ error: 'Course is not available for feedback' }, { status: 400 });
    }

    // Only learners who actually completed the course may rate it, so catalog
    // averages can't be corrupted by callers who never took the course.
    const userAssignments = await base44.asServiceRole.entities.TrainingAssignment.filter(
      { course_id: courseId, assigned_to_user_id: user.email },
      '-created_date',
      25
    );
    let hasCompleted = userAssignments.some(
      (a) => a.status === 'completed' || a.pass_fail_result === 'passed'
    );
    if (!hasCompleted) {
      const certs = await base44.asServiceRole.entities.TrainingCertificate.filter(
        { course_id: courseId, user_id: user.email },
        '-issued_at',
        5
      );
      hasCompleted = certs.length > 0;
    }
    if (!hasCompleted) {
      return Response.json(
        { error: 'You can only rate courses you have completed.' },
        { status: 403 }
      );
    }

    const payload = {
      course_id: courseId,
      course_title: course.title,
      user_id: user.email,
      user_name: user.full_name || user.email,
      rating: Math.round(numericRating),
      comment: String(comment || '').slice(0, 2000),
      ...(wouldRecommend !== null ? { would_recommend: !!wouldRecommend } : {}),
      ...(difficulty ? { difficulty } : {}),
    };

    const existing = await base44.asServiceRole.entities.TrainingFeedback.filter(
      { course_id: courseId, user_id: user.email },
      '-created_date',
      5
    );

    let record;
    if (existing[0]) {
      record = await base44.asServiceRole.entities.TrainingFeedback.update(existing[0].id, payload);
    } else {
      record = await base44.asServiceRole.entities.TrainingFeedback.create(payload);
    }

    return Response.json({ success: true, feedback_id: record.id, updated: !!existing[0] });
  } catch (error) {
    console.error('submitCourseFeedback failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});