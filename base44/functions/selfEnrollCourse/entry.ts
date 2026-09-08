import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_COURSE_LIMIT = 2;
const ASSIGNMENT_SCAN_LIMIT = 500;

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value: unknown) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$')
    && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

async function loadExactCourse(entities: Record<string, any>, courseId: string) {
  const rows = requireRows(
    await entities.TrainingCourse.filter({ id: courseId }, undefined, EXACT_COURSE_LIMIT),
    'TrainingCourse.filter',
  );
  if (rows.length === 0) throw new PublicError(404, 'Course not found');
  if (rows.length >= EXACT_COURSE_LIMIT
    || rows.length !== 1
    || rows[0]?.id !== courseId) {
    throw new PublicError(409, 'Course identity is ambiguous');
  }
  return rows[0];
}

async function loadUniqueActiveAssignment(
  entities: Record<string, any>,
  courseId: string,
  userEmail: string,
) {
  const rows = requireRows(
    await entities.TrainingAssignment.filter(
      { course_id: courseId, assigned_to_user_id: userEmail },
      '-created_date',
      ASSIGNMENT_SCAN_LIMIT,
    ),
    'TrainingAssignment.filter',
  );
  if (rows.length >= ASSIGNMENT_SCAN_LIMIT
    || rows.some((row) => (
      row?.course_id !== courseId || row?.assigned_to_user_id !== userEmail
    ))) {
    throw new PublicError(409, 'Training assignment history is ambiguous');
  }
  const active = rows.filter((row) => !row?.archived_status);
  if (active.length > 1) {
    throw new PublicError(409, 'Multiple active training assignments require review');
  }
  return active[0] || null;
}


// Resolves an authenticated user's existing active assignment, or self-enrolls
// them in an elective (non-required) published course. Required/mandatory and
// annual-mandatory compliance training stays admin-assigned, so a user without
// an existing assignment is rejected. Idempotent: an existing active assignment
// is returned instead of creating a duplicate.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const courseId = exactIdentifier(body?.courseId);
    if (!courseId) throw new PublicError(400, 'courseId must be an exact identifier');

    const entities = base44.asServiceRole.entities;
    const course = await loadExactCourse(entities, courseId);
    if (course.status !== 'published') {
      return Response.json({ error: 'Course is not available for enrollment' }, { status: 400 });
    }
    // Reuse an existing active assignment rather than duplicating. Scan the full
    // history (not just the latest few) so repeated archive/unarchive cycles
    // can't hide an older active assignment and cause a duplicate. Resolve this
    // before self-enrollment eligibility: a valid admin-issued mandatory or
    // cross-business-line assignment is itself the learner's authorization.
    const active = await loadUniqueActiveAssignment(entities, courseId, user.email);
    if (active) {
      return Response.json({ success: true, already_enrolled: true, assignment_id: active.id });
    }

    if (course.is_mandatory || ['annual_mandatory', 'in_service'].includes(course.training_type)) {
      return Response.json(
        { error: 'Required compliance training is assigned by your administrator and cannot be self-enrolled.' },
        { status: 400 }
      );
    }
    // Honor the course business-line scope for a new self-enrollment: a Home
    // Health user may not self-enroll in a Hospice-only course and vice versa.
    // Users without a set business line (e.g. office/leadership) are not blocked.
    const scope = course.business_line_scope;
    if (scope && scope !== 'all' && user.business_line && user.business_line !== scope) {
      return Response.json(
        { error: `This course is scoped to ${scope.replace(/_/g, ' ')} and is not available for your business line.` },
        { status: 403 }
      );
    }

    // Fresh re-check immediately before create — concurrent double-clicks can
    // still race the filter→create gap (no unique index / CAS).
    const recheckActive = await loadUniqueActiveAssignment(entities, courseId, user.email);
    if (recheckActive) {
      return Response.json({ success: true, already_enrolled: true, assignment_id: recheckActive.id });
    }

    const created = await entities.TrainingAssignment.create({
      course_id: course.id,
      course_title: course.title,
      assigned_to_user_id: user.email,
      assigned_to_role: user.job_title || user.credential_type || user.role || '',
      assigned_to_department: user.department || '',
      assigned_to_location: user.location || '',
      assigned_to_business_line: user.business_line || '',
      assigned_by: user.email,
      assigned_date: new Date().toISOString(),
      due_date: null,
      priority: 'low',
      status: 'assigned',
      required: false,
      passing_score_required: course.passing_score || 80,
      regenerate_test_on_retake: true,
      retake_required: false,
      renewal_frequency: course.recurrence_rule || 'none',
      attestation_required: course.requires_attestation ?? false,
      progress_percentage: 0,
      notes: JSON.stringify({ self_enrolled: true }),
      archived_status: false,
    });

    try {
      await loadUniqueActiveAssignment(entities, courseId, user.email);
    } catch (error) {
      if (created?.id) {
        try {
          await entities.TrainingAssignment.delete(created.id);
        } catch {
          /* best-effort rollback; the ambiguous state still fails closed */
        }
      }
      throw error;
    }

    await entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'assignment_created',
      entity_type: 'TrainingCourse',
      entity_id: course.id,
      after_json: { course_title: course.title, assigned_to_user_id: user.email, self_enrolled: true },
      reason: 'self enrollment',
      severity: 'info',
    });

    return Response.json({ success: true, already_enrolled: false, assignment_id: created.id });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('selfEnrollCourse failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
