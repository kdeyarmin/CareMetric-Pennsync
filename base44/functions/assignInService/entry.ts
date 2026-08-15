import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>



const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { courseId, dueDate, userEmails = [], filters = {}, settings = {}, annualCycleYear = null } = await req.json();
    if (!courseId || !dueDate) {
      return Response.json({ error: 'courseId and dueDate are required' }, { status: 400 });
    }

    const courseList = await base44.asServiceRole.entities.TrainingCourse.filter({ id: courseId }, undefined, 5000);
    const course = courseList[0];
    if (!course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }

    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    let candidates = allUsers.filter((candidate) => candidate.email);

    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      if (!user.agency_name) {
        return Response.json({ error: 'Forbidden: agency membership required' }, { status: 403 });
      }
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
    // Dedup must also be scoped to the cycle being assigned: an annual course
    // re-issued for a new year would otherwise match last year's assignment and
    // skip everyone, creating zero assignments. Post-filter (rather than adding
    // the year to the query) so the null / non-annual case behaves as before.
    const candidateEmails = candidates.map((candidate) => candidate.email).filter(Boolean);
    const targetCycleYear = annualCycleYear || course.annual_cycle_year || null;
    let assignedEmails = new Set();
    if (candidateEmails.length > 0) {
      const existingAssignments = await base44.asServiceRole.entities.TrainingAssignment.filter(
        { course_id: courseId, assigned_to_user_id: { $in: candidateEmails } },
        '-created_date',
        Math.max(1000, candidateEmails.length * 3),
      );
      assignedEmails = new Set(
        existingAssignments
          .filter((assignment) => (assignment.annual_cycle_year ?? null) === targetCycleYear)
          .map((assignment) => assignment.assigned_to_user_id),
      );
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
        annual_cycle_year: targetCycleYear,
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
      // Create serially with a fresh existence check per assignee so concurrent
      // admin clicks / cron enrolls shrink the duplicate-assignment race window.
      const created = [];
      for (const assignment of assignmentsToCreate) {
        const existing = await base44.asServiceRole.entities.TrainingAssignment.filter(
          { course_id: courseId, assigned_to_user_id: assignment.assigned_to_user_id },
          '-created_date',
          20,
        ).catch(() => []);
        const already = (existing || []).some(
          (row) => (row.annual_cycle_year ?? null) === targetCycleYear && row.archived_status !== true,
        );
        if (already) continue;
        try {
          const createdRow = await base44.asServiceRole.entities.TrainingAssignment.create(assignment);
          // Concurrent creates can still race past the existence check. Re-read
          // and keep the earliest row for this cycle; skip notify if we lost.
          const afterCreate = await base44.asServiceRole.entities.TrainingAssignment.filter(
            { course_id: courseId, assigned_to_user_id: assignment.assigned_to_user_id },
            '-created_date',
            20,
          ).catch(() => []);
          const activeAfter = (afterCreate || []).filter(
            (row) => (row.annual_cycle_year ?? null) === targetCycleYear && row.archived_status !== true,
          );
          if (activeAfter.length > 1) {
            const keepId = activeAfter
              .slice()
              .sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')))[0]?.id;
            for (const row of activeAfter) {
              if (row.id !== keepId) {
                await base44.asServiceRole.entities.TrainingAssignment.delete(row.id).catch(() => {});
              }
            }
            if (createdRow?.id && keepId && createdRow.id !== keepId) {
              continue;
            }
          }
          created.push(assignment);
        } catch (err) {
          // Don't log the assignee email — retained backend logs stay identifier-
          // free (aggregate/status-only). The error message alone is actionable.
          console.error('assignInService create failed', err?.message || err);
        }
      }
      await Promise.all(created.map((assignment) =>
        base44.asServiceRole.entities.Notification.create({
          user_email: assignment.assigned_to_user_id,
          title: 'New AI Compliance In-Service Assigned',
          message: `You have been assigned "${course.title}" and it is due on ${dueDate}.`,
          type: 'training_due',
          priority: assignment.priority === 'critical' ? 'critical' : 'high',
          action_url: '/MyTraining',
          action_label: 'Open training',
          metadata: { course_id: course.id, due_date: dueDate }
        }).catch((err) => console.error('assignInService notify failed', err?.message || err))
      ));
      // Replace bulk list so response counts reflect what actually landed.
      assignmentsToCreate.length = 0;
      assignmentsToCreate.push(...created);
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
    console.error('assignInService failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});