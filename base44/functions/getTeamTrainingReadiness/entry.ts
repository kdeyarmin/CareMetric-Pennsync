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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
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

    // Only platform admins (super_admin, or bare role:admin with no agency_name
    // — platform-wide by design) see every tenant's staff. Everyone else,
    // INCLUDING educator/supervisor training_roles who aren't admins, is scoped
    // to their own agency. The old condition only scoped admin account types, so
    // a plain educator/supervisor passed authorization and received the unscoped
    // list — a cross-tenant staff roster + training-compliance dump. Fail closed
    // when an agency-scoped caller lacks an agency_name.
    const isSuperAdmin = user.account_type === 'super_admin';
    // A user who is BOTH account_type agency_admin AND role admin with no
    // agency_name must NOT be promoted to platform-wide via the bare-role:admin
    // path — an agency_admin without an agency_name fails closed by design.
    const isPlatformAdmin = isSuperAdmin
      || (user.role === 'admin' && user.account_type !== 'agency_admin' && !String(user.agency_name || '').trim());
    let scopedAssignments = assignments;
    if (!isPlatformAdmin) {
      const agency = String(user.agency_name || '').trim();
      if (!agency) {
        return Response.json({ error: 'Forbidden: agency membership required' }, { status: 403 });
      }
      const agencyEmails = new Set(
        users.filter((u) => u.agency_name === agency).map((u) => u.email)
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
    console.error('getTeamTrainingReadiness failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});