import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Returns org-wide required-training readiness for educators and admins. Runs
// with the service role and computes the rollups server-side so that non-admin
// educators (whose TrainingAssignment RLS would otherwise limit reads to their
// own rows) get accurate team data. Agency admins are scoped to their agency.

const isAuthorized = (user) =>
  user?.role === 'admin' ||
  user?.account_type === 'agency_admin' ||
  user?.account_type === 'super_admin' ||
  user?.training_role === 'educator' ||
  user?.training_role === 'supervisor';

const isCompleted = (a) => a.status === 'completed' || a.pass_fail_result === 'passed';
const requiredStatusLabel = (a) =>
  isCompleted(a) ? 'Complete' : a.status === 'overdue' ? 'Overdue' : 'Outstanding';

const BUSINESS_LINES = [
  { key: 'home_health', label: 'Home Health' },
  { key: 'hospice', label: 'Hospice' },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAuthorized(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const svc = base44.asServiceRole.entities;
    const [assignments, courses, users] = await Promise.all([
      svc.TrainingAssignment.list('-created_date', 5000),
      svc.TrainingCourse.list('-updated_date', 1000),
      svc.User.list('-created_date', 2000),
    ]);

    const courseById = Object.fromEntries(courses.map((c) => [c.id, c]));

    // Agency admins only see their own agency's staff
    let scopedAssignments = assignments;
    if (user.account_type === 'agency_admin' && user.agency_name) {
      const agencyEmails = new Set(
        users.filter((u) => u.agency_name === user.agency_name).map((u) => u.email)
      );
      scopedAssignments = assignments.filter((a) => agencyEmails.has(a.assigned_to_user_id));
    }

    const required = scopedAssignments.filter(
      (a) =>
        a.required === true ||
        ['annual_mandatory', 'in_service'].includes(courseById[a.course_id]?.training_type)
    );

    const doneCount = required.filter(isCompleted).length;
    const overall = {
      total: required.length,
      done: doneCount,
      overdue: required.filter((a) => a.status === 'overdue').length,
      pct: required.length ? Math.round((doneCount / required.length) * 100) : 100,
      staff: new Set(required.map((a) => a.assigned_to_user_id)).size,
    };

    const byBusinessLine = BUSINESS_LINES.map(({ key, label }) => {
      const subset = required.filter((a) => a.assigned_to_business_line === key);
      const done = subset.filter(isCompleted).length;
      return {
        key,
        label,
        total: subset.length,
        done,
        overdue: subset.filter((a) => a.status === 'overdue').length,
        pct: subset.length ? Math.round((done / subset.length) * 100) : 100,
      };
    }).filter((row) => row.total > 0);

    const roleMap = {};
    required.forEach((a) => {
      const role = a.assigned_to_role || 'Unspecified role';
      if (!roleMap[role]) roleMap[role] = { role, total: 0, done: 0, overdue: 0 };
      roleMap[role].total += 1;
      if (isCompleted(a)) roleMap[role].done += 1;
      if (a.status === 'overdue') roleMap[role].overdue += 1;
    });
    const rolesNeedingAttention = Object.values(roleMap)
      .map((r) => ({ ...r, pct: r.total ? Math.round((r.done / r.total) * 100) : 100 }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 6);

    const rows = required.map((a) => ({
      employee: a.assigned_to_user_id || '',
      role: a.assigned_to_role || '',
      business_line: a.assigned_to_business_line || '',
      course: a.course_title || courseById[a.course_id]?.title || '',
      category: courseById[a.course_id]?.category || '',
      status: requiredStatusLabel(a),
      due_date: a.due_date || '',
      completion_date: a.completion_date || '',
      score: a.score_percentage ?? '',
    }));

    return Response.json({ overall, byBusinessLine, rolesNeedingAttention, rows });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});