import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { courseId, dueDate, userEmails = [], filters = {}, settings = {}, annualCycleYear = null } = await req.json();
    if (!courseId || !dueDate) {
      return Response.json({ error: 'courseId and dueDate are required' }, { status: 400 });
    }

    const courseList = await base44.asServiceRole.entities.TrainingCourse.filter({ id: courseId });
    const course = courseList[0];
    if (!course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }

    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    let candidates = allUsers.filter((candidate) => candidate.email);

    if (user.account_type === 'agency_admin' && user.agency_name) {
      candidates = candidates.filter((candidate) => candidate.agency_name === user.agency_name);
    }

    if (userEmails.length > 0) {
      const emailSet = new Set(userEmails);
      candidates = candidates.filter((candidate) => emailSet.has(candidate.email));
    } else {
      if (filters.role && filters.role !== 'all') candidates = candidates.filter((candidate) => (candidate.job_title || candidate.credential_type || candidate.role) === filters.role);
      if (filters.discipline && filters.discipline !== 'all') candidates = candidates.filter((candidate) => (candidate.discipline || candidate.credential_type) === filters.discipline);
      if (filters.department && filters.department !== 'all') candidates = candidates.filter((candidate) => candidate.department === filters.department);
      if (filters.job_title && filters.job_title !== 'all') candidates = candidates.filter((candidate) => candidate.job_title === filters.job_title);
      if (filters.business_line && filters.business_line !== 'all') candidates = candidates.filter((candidate) => candidate.business_line === filters.business_line);
      if (filters.location && filters.location !== 'all') candidates = candidates.filter((candidate) => candidate.location === filters.location);
      if (filters.credential_type && filters.credential_type !== 'all') candidates = candidates.filter((candidate) => candidate.credential_type === filters.credential_type);
      if (filters.employment_type && filters.employment_type !== 'all') candidates = candidates.filter((candidate) => candidate.employment_type === filters.employment_type);
    }

    // Dedup against existing assignments scoped to THESE candidates (via $in)
    // rather than the newest 1000 for the course — a course with >1000 prior
    // assignees would otherwise re-assign + re-notify older ones.
    const candidateEmails = candidates.map((candidate) => candidate.email).filter(Boolean);
    let assignedEmails = new Set();
    if (candidateEmails.length > 0) {
      const existingAssignments = await base44.asServiceRole.entities.TrainingAssignment.filter(
        { course_id: courseId, assigned_to_user_id: { $in: candidateEmails } },
        '-created_date',
        Math.max(1000, candidateEmails.length * 3),
      );
      assignedEmails = new Set(existingAssignments.map((assignment) => assignment.assigned_to_user_id));
    }

    const assignmentsToCreate = candidates
      .filter((candidate) => !assignedEmails.has(candidate.email))
      .map((candidate) => ({
        course_id: course.id,
        course_title: course.title,
        assigned_to_user_id: candidate.email,
        assigned_to_role: candidate.job_title || candidate.credential_type || candidate.role,
        assigned_to_department: candidate.department || '',
        assigned_to_location: candidate.location || '',
        assigned_to_business_line: candidate.business_line || '',
        assigned_by: user.email,
        assigned_date: new Date().toISOString(),
        due_date: dueDate,
        annual_cycle_year: annualCycleYear || course.annual_cycle_year || null,
        priority: settings.priority || 'high',
        status: 'assigned',
        required: settings.required !== false,
        passing_score_required: settings.passingScoreRequired || course.passing_score || 80,
        max_attempts: settings.maxAttempts ?? null,
        waiting_period_hours: settings.waitingPeriodHours || 0,
        regenerate_test_on_retake: settings.regenerateTestOnRetake !== false,
        retake_required: false,
        renewal_frequency: settings.renewalFrequency || course.recurrence_rule || 'none',
        renewal_due_date: settings.renewalDueDate || null,
        attestation_required: settings.attestationRequired ?? course.requires_attestation ?? false,
        remediation_message: settings.remediationMessage || 'Please review the lesson content and complete a retake.',
        progress_percentage: 0,
        notes: JSON.stringify({
          admin_notes: settings.notes || '',
          show_correct_answers: !!settings.showCorrectAnswers
        }),
        archived_status: false
      }));

    if (assignmentsToCreate.length > 0) {
      await Promise.all(assignmentsToCreate.map((assignment) => base44.asServiceRole.entities.TrainingAssignment.create(assignment)));
      await Promise.all(assignmentsToCreate.map((assignment) =>
        base44.asServiceRole.entities.Notification.create({
          user_email: assignment.assigned_to_user_id,
          title: 'New AI Compliance In-Service Assigned',
          message: `You have been assigned "${course.title}" and it is due on ${dueDate}.`,
          type: 'training_due',
          priority: assignment.priority === 'critical' ? 'critical' : 'high',
          action_url: '/MyTraining',
          action_label: 'Open training',
          metadata: { course_id: course.id, due_date: dueDate }
        })
      ));
    }

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'assignment_created',
      entity_type: 'TrainingCourse',
      entity_id: course.id,
      after_json: {
        course_title: course.title,
        assignments_created: assignmentsToCreate.length,
        filters,
        settings
      },
      severity: 'info'
    });

    return Response.json({
      success: true,
      assigned_count: assignmentsToCreate.length,
      skipped_existing: candidates.length - assignmentsToCreate.length,
      assigned_users: assignmentsToCreate.map((assignment) => assignment.assigned_to_user_id)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});