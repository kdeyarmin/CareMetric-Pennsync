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

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const ACTION_RULES = {
  course_created: { status: 'draft', reason: 'created' },
  course_published: { status: 'published', reason: 'published' },
  course_archived: { status: 'archived', reason: 'archived' },
  content_rejected: { status: 'draft', reason: 'sme_changes_requested' },
};

function plainString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function courseMatchesAction(course, action, actorEmail) {
  const rule = ACTION_RULES[action];
  if (!course || !rule || course.status !== rule.status) return false;
  if (action === 'course_created') {
    return normalizeEmail(course.created_by) === normalizeEmail(actorEmail);
  }
  if (action === 'course_published') {
    return normalizeEmail(course.published_by) === normalizeEmail(actorEmail);
  }
  if (action === 'content_rejected') {
    return course.needs_sme_review === true;
  }
  return true;
}

function canonicalAfter(course, action, note) {
  return {
    title: course.title || '',
    status: course.status,
    training_type: course.training_type || 'course',
    annual_cycle_year: course.annual_cycle_year || null,
    needs_sme_review: course.needs_sme_review === true,
    published_by: course.published_by || null,
    approved_by: course.approved_by || null,
    ...(action === 'content_rejected' && note ? { review_note: note } : {}),
  };
}

// The client may request a narrow course-audit action, but cannot choose the
// actor, entity type, severity, canonical state, or reason. The stored course is
// re-read after the UI mutation and must match the requested transition before
// this function writes through the service role.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // TrainingCourse mutations are protected by Base44's built-in role. Do not
    // accept mutable account_type/agency fields as an authorization input.
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const courseId = plainString(body.courseId, 200);
    const action = plainString(body.action, 40);
    const note = body.note === undefined || body.note === null || body.note === ''
      ? ''
      : plainString(body.note, 2000);
    if (!courseId || !action || !Object.prototype.hasOwnProperty.call(ACTION_RULES, action)) {
      return Response.json({ error: 'Invalid courseId or action' }, { status: 400 });
    }
    if (body.note && note === null) {
      return Response.json({ error: 'Invalid note' }, { status: 400 });
    }

    const candidates = await base44.asServiceRole.entities.TrainingCourse
      .filter({ id: courseId }, '-updated_date', 5);
    const course = (candidates || []).find((row) => row?.id === courseId);
    if (!course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }
    if (!courseMatchesAction(course, action, user.email)) {
      return Response.json({ error: 'Course state does not match the audit action' }, { status: 409 });
    }

    const reason = action === 'course_published' && normalizeEmail(course.approved_by) === normalizeEmail(user.email)
      ? 'sme_approved'
      : ACTION_RULES[action].reason;
    const event = await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: normalizeEmail(user.email),
      actor_name: user.full_name || user.email,
      action,
      entity_type: 'TrainingCourse',
      entity_id: course.id,
      after_json: canonicalAfter(course, action, note || ''),
      reason,
      severity: 'info',
    });

    return Response.json({ success: true, event_id: event?.id || null });
  } catch (error) {
    console.error('recordTrainingAuditEvent failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
