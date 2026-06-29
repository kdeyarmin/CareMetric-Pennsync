import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ───────────────────────────────────────────────────────────────────────────
// Auto-enroll active staff into the CURRENT-YEAR annual required in-service
// plan that matches their business line and role tier. This closes the gap
// where processTrainingRenewals only fires off an EXISTING certificate's
// expiry — staff who have never been assigned (new cycle, never-assigned, no
// cert) are picked up here instead of waiting for a manual admin click.
//
// Two entry modes:
//   - scope 'auto'  (default, used by the platform scheduler): only plans the
//                    admin has opted in via auto_enroll=true.
//   - scope 'all'   (the admin "Enroll all staff" button): every active annual
//                    plan for the current year, regardless of the flag.
//
// Each user resolves to EXACTLY ONE plan (their line + nurse/all-staff tier) so
// the shared core in-services are never assigned twice. Idempotent: existing
// PlanEnrollment / TrainingAssignment rows are reused, not duplicated.
// ───────────────────────────────────────────────────────────────────────────

const isLicensedNurse = (u) => {
  const c = `${u?.credential_type || ''} ${u?.credentials || ''} ${u?.job_title || ''}`.toUpperCase();
  return c.includes('RN') || c.includes('LPN') || c.includes('NURSE');
};

const userLine = (u) => {
  const bl = u?.business_line;
  if (bl === 'home_health' || bl === 'hospice') return bl;
  const cs = u?.care_scope;
  if (cs === 'hospice') return 'hospice';
  if (cs === 'home_health') return 'home_health';
  // 'both' / 'all' / unset → default to the agency's primary line; dual-line
  // staff can still be assigned the other line's plan manually.
  return 'home_health';
};

// Pick the single best plan for a user among the candidate plans. Prefer the
// plan whose business line matches; within that, match the nurse vs all-staff
// tier (the seed encodes the tier in the plan name, e.g. "... (Nurses)").
const resolvePlanForUser = (u, plans) => {
  const line = userLine(u);
  const wantNurses = isLicensedNurse(u);
  const linePlans = plans.filter((p) => p.business_line_scope === line);
  const pool = linePlans.length ? linePlans : plans.filter((p) => p.business_line_scope === 'all');
  if (!pool.length) return null;
  return pool.find((p) => /nurse/i.test(p.name || '') === wantNurses) || pool[0];
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (service-role assignment +
    // notification writes, no end user). Same opt-in lockdown pattern as
    // processTrainingRenewals — when INTERNAL_FN_SECRET is set, require an admin
    // OR the internal secret; the no-identity cron path is only allowed when the
    // secret is unset (platform invocation restriction is the control).
    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin' || me?.account_type === 'agency_admin' || me?.account_type === 'super_admin';
    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    if (internalSecret) {
      if (!isAdmin && req.headers.get('x-internal-secret') !== internalSecret) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const scope = body.scope === 'all' ? 'all' : 'auto';
    const svc = base44.asServiceRole.entities;

    const today = new Date();
    const year = today.getUTCFullYear();
    const defaultDueDate = body.dueDate || `${year}-12-31`;

    // Candidate plans: active annual plans for the current cycle year. In 'auto'
    // mode only those the admin opted in (auto_enroll=true).
    let plans = await svc.LearningPlan.filter({ plan_type: 'annual', year, active: true }, '-created_date', 200);
    if (scope === 'auto') plans = plans.filter((p) => p.auto_enroll === true);
    if (!plans.length) {
      return Response.json({ success: true, scope, plans_considered: 0, enrolled_users: 0, assignments_created: 0, note: 'No matching annual plans for the current year.' });
    }

    // Pre-load each plan's required course items once.
    const itemsByPlan = {};
    for (const plan of plans) {
      itemsByPlan[plan.id] = await svc.LearningPlanCourse.filter({ plan_id: plan.id }, 'order_index', 300);
    }

    const allUsers = await svc.User.list('-created_date', 5000);
    let candidates = allUsers.filter((u) => u.email && u.role !== 'admin' && u.is_approved !== false);
    // Agency admins only enroll their own agency's staff.
    if (me?.account_type === 'agency_admin' && me?.agency_name) {
      candidates = candidates.filter((u) => u.agency_name === me.agency_name);
    }

    // Prefetch existing enrollments + assignments for the candidate plans once,
    // so the per-user/per-course existence checks below are in-memory Set lookups
    // rather than O(users × courses) filter() calls (which risk timeouts / rate
    // limits on large orgs in the "Enroll All Staff" path).
    const enrolledSet = new Set();   // `${plan_id}|${user_email}`
    const assignedSet = new Set();   // `${plan_id}|${course_id}|${user_email}`
    for (const plan of plans) {
      const [enrollments, planAssignments] = await Promise.all([
        svc.PlanEnrollment.filter({ plan_id: plan.id }, '-created_date', 10000),
        svc.TrainingAssignment.filter({ plan_id: plan.id, annual_cycle_year: year }, '-created_date', 10000),
      ]);
      enrollments.forEach((e) => enrolledSet.add(`${plan.id}|${e.user_id}`));
      planAssignments.forEach((x) => assignedSet.add(`${plan.id}|${x.course_id}|${x.assigned_to_user_id}`));
    }

    let enrolledUsers = 0;
    let assignmentsCreated = 0;

    for (const user of candidates) {
      const plan = resolvePlanForUser(user, plans);
      if (!plan) continue;
      const planItems = itemsByPlan[plan.id] || [];

      const enrollKey = `${plan.id}|${user.email}`;
      if (!enrolledSet.has(enrollKey)) {
        enrolledSet.add(enrollKey);
        await svc.PlanEnrollment.create({
          plan_id: plan.id,
          plan_name: plan.name,
          user_id: user.email,
          user_name: user.full_name,
          enrolled_at: today.toISOString(),
          enrolled_by: 'system-auto-enroll',
          status: 'active',
          progress_percentage: 0,
          courses_completed: 0,
          courses_total: planItems.length,
          due_date: defaultDueDate,
        });
        enrolledUsers++;
      }

      for (const item of planItems) {
        const assignKey = `${plan.id}|${item.course_id}|${user.email}`;
        if (assignedSet.has(assignKey)) continue;
        assignedSet.add(assignKey);

        await svc.TrainingAssignment.create({
          course_id: item.course_id,
          course_title: item.course_title,
          plan_id: plan.id,
          assigned_to_user_id: user.email,
          assigned_to_role: user.job_title || user.credential_type || user.role,
          assigned_to_business_line: user.business_line || '',
          assigned_by: 'system-auto-enroll',
          assigned_date: today.toISOString(),
          due_date: item.specific_due_date || defaultDueDate,
          annual_cycle_year: year,
          priority: 'high',
          status: 'assigned',
          required: item.is_required !== false,
          passing_score_required: 80,
          waiting_period_hours: 0,
          regenerate_test_on_retake: true,
          retake_required: false,
          renewal_frequency: 'annual',
          attestation_required: false,
          remediation_message: 'Please review the lesson content and complete a new retake.',
          progress_percentage: 0,
          notes: 'Automatically enrolled in current-year required in-services.',
          archived_status: false,
        });
        assignmentsCreated++;
      }
    }

    return Response.json({
      success: true,
      scope,
      year,
      plans_considered: plans.length,
      candidates: candidates.length,
      enrolled_users: enrolledUsers,
      assignments_created: assignmentsCreated,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
