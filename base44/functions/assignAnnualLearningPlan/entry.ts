import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { planId, dueDate, userEmails = [], filters = {}, settings = {} } = await req.json();
    if (!planId || !dueDate) {
      return Response.json({ error: 'planId and dueDate are required' }, { status: 400 });
    }

    const [plan] = await base44.asServiceRole.entities.LearningPlan.filter({ id: planId });
    if (!plan) {
      return Response.json({ error: 'Learning plan not found' }, { status: 404 });
    }

    const planItems = await base44.asServiceRole.entities.LearningPlanCourse.filter({ plan_id: planId }, 'order_index', 300);
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    let candidates = allUsers.filter((candidate) => candidate.email && candidate.role !== 'admin');

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
      if (filters.business_line && filters.business_line !== 'all') candidates = candidates.filter((candidate) => candidate.business_line === filters.business_line);
      if (filters.location && filters.location !== 'all') candidates = candidates.filter((candidate) => candidate.location === filters.location);
    }

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'assignment_created',
      entity_type: 'LearningPlan',
      entity_id: plan.id,
      after_json: { plan_name: plan.name, filters, settings, user_count: candidates.length },
      severity: 'info'
    });

    for (const candidate of candidates) {
      const [existingEnrollment] = await base44.asServiceRole.entities.PlanEnrollment.filter({ plan_id: planId, user_id: candidate.email });
      if (!existingEnrollment) {
        await base44.asServiceRole.entities.PlanEnrollment.create({
          plan_id: plan.id,
          plan_name: plan.name,
          user_id: candidate.email,
          user_name: candidate.full_name,
          enrolled_at: new Date().toISOString(),
          enrolled_by: user.email,
          status: 'active',
          progress_percentage: 0,
          courses_completed: 0,
          courses_total: planItems.length,
          due_date: dueDate
        });
      }

      for (const item of planItems) {
        const existingAssignment = await base44.asServiceRole.entities.TrainingAssignment.filter({ plan_id: planId, course_id: item.course_id, assigned_to_user_id: candidate.email }, '-created_date', 5);
        if (existingAssignment.length > 0) continue;

        // Honor the per-course configuration set in the plan builder: a course's
        // own "Due by" date (specific_due_date) overrides the plan-level due
        // date, and its required flag drives whether the assignment is required.
        const courseDueDate = item.specific_due_date || dueDate;

        await base44.asServiceRole.entities.TrainingAssignment.create({
          course_id: item.course_id,
          course_title: item.course_title,
          plan_id: planId,
          assigned_to_user_id: candidate.email,
          assigned_to_role: candidate.job_title || candidate.credential_type || candidate.role,
          assigned_to_department: candidate.department || '',
          assigned_to_location: candidate.location || '',
          assigned_to_business_line: candidate.business_line || '',
          assigned_by: user.email,
          assigned_date: new Date().toISOString(),
          due_date: courseDueDate,
          annual_cycle_year: plan.year,
          priority: settings.priority || 'high',
          status: 'assigned',
          required: item.is_required !== false,
          passing_score_required: settings.passingScoreRequired || 80,
          max_attempts: settings.maxAttempts ?? null,
          waiting_period_hours: settings.waitingPeriodHours || 0,
          regenerate_test_on_retake: settings.regenerateTestOnRetake !== false,
          retake_required: false,
          attestation_required: settings.attestationRequired !== false,
          remediation_message: settings.remediationMessage || 'Please review the lesson content and complete a new retake.',
          progress_percentage: 0,
          notes: JSON.stringify({ show_correct_answers: !!settings.showCorrectAnswers }),
          archived_status: false
        });
      }
    }

    return Response.json({ success: true, enrolled_users: candidates.length, learning_plan_items: planItems.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});