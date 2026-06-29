import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Lets an authenticated user self-enroll in an elective (non-required) published
// course. Required/mandatory and annual-mandatory compliance training stays
// admin-assigned, so those are rejected here. Idempotent: an existing, active
// assignment for the same user/course is returned instead of creating a duplicate.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { courseId } = await req.json();
    if (!courseId) {
      return Response.json({ error: 'courseId is required' }, { status: 400 });
    }

    const [course] = await base44.asServiceRole.entities.TrainingCourse.filter({ id: courseId });
    if (!course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }
    if (course.status !== 'published') {
      return Response.json({ error: 'Course is not available for enrollment' }, { status: 400 });
    }
    if (course.is_mandatory || ['annual_mandatory', 'in_service'].includes(course.training_type)) {
      return Response.json(
        { error: 'Required compliance training is assigned by your administrator and cannot be self-enrolled.' },
        { status: 400 }
      );
    }
    // Honor the course business-line scope: a Home Health user may not self-enroll
    // in a Hospice-only course and vice versa. Users without a set business line
    // (e.g. office/leadership) are not blocked.
    const scope = course.business_line_scope;
    if (scope && scope !== 'all' && user.business_line && user.business_line !== scope) {
      return Response.json(
        { error: `This course is scoped to ${scope.replace(/_/g, ' ')} and is not available for your business line.` },
        { status: 403 }
      );
    }

    // Reuse an existing active assignment rather than duplicating. Scan the full
    // history (not just the latest few) so repeated archive/unarchive cycles
    // can't hide an older active assignment and cause a duplicate.
    const existing = await base44.asServiceRole.entities.TrainingAssignment.filter(
      { course_id: courseId, assigned_to_user_id: user.email },
      '-created_date',
      500
    );
    const active = existing.find((a) => !a.archived_status);
    if (active) {
      return Response.json({ success: true, already_enrolled: true, assignment_id: active.id });
    }

    const created = await base44.asServiceRole.entities.TrainingAssignment.create({
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

    await base44.asServiceRole.entities.TrainingAuditLog.create({
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});