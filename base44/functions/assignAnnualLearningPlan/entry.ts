import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const normalizeClaimEmail = (value) => String(value || '').trim().toLowerCase();
async function loadTrustedTenantClaim(base44, profileId, email) {
  if (!profileId || !email) return null;
  let membership = null;
  try {
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId, status: 'active' },
      undefined,
      2,
    );
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (row
      && String(row.user_id || '').trim() === profileId
      && String(row.status || '') === 'active'
      && normalizeClaimEmail(row.user_email_normalized) === email
      && typeof row.agency_id === 'string'
      && row.agency_id.trim()) {
      membership = row;
    }
  } catch {
    membership = null;
  }
  if (!membership) return null;
  try {
    const agencyId = membership.agency_id.trim();
    const rows = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    const agencyName = String(agency?.agency_name || '').trim();
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(String(agency.status || ''))
      || !agencyName) {
      return null;
    }
    return { tenantRole: String(membership.tenant_role || ''), agencyId, agencyName };
  } catch {
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Protected built-in admins (the platform owner included) already hold
  // platform-level RLS authority, so their legacy self-scoping claims cannot
  // widen access; leave them exactly as the handler saw them before.
  if (profile.role === 'admin') return profile;
  const email = normalizeClaimEmail(profile.email);
  const profileId = typeof profile.id === 'string' ? profile.id.trim() : '';
  const tenant = await loadTrustedTenantClaim(base44, profileId, email);
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>

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
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { planId, dueDate, userEmails = [], filters = {}, settings = {} } = await req.json();
    if (!planId || !dueDate) {
      return Response.json({ error: 'planId and dueDate are required' }, { status: 400 });
    }

    const [plan] = await base44.asServiceRole.entities.LearningPlan.filter({ id: planId }, undefined, 5000);
    if (!plan) {
      return Response.json({ error: 'Learning plan not found' }, { status: 404 });
    }

    const planItems = await base44.asServiceRole.entities.LearningPlanCourse.filter({ plan_id: planId }, 'order_index', 300);
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    let candidates = allUsers.filter((candidate) => candidate.email && candidate.role !== 'admin');

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

    // Prefetch existing enrollments + assignments once so the loops below are
    // in-memory Set lookups rather than O(users × courses) filter() calls
    // (parity with autoEnrollAnnualPlans — timeouts / rate limits on large orgs).
    const enrolledSet = new Set(); // `${plan_id}|${user_email}`
    const assignedSet = new Set(); // `${plan_id}|${course_id}|${user_email}`
    const [existingEnrollments, existingAssignments] = await Promise.all([
      base44.asServiceRole.entities.PlanEnrollment.filter({ plan_id: planId }, '-created_date', 10000),
      base44.asServiceRole.entities.TrainingAssignment.filter({ plan_id: planId }, '-created_date', 10000),
    ]);
    (existingEnrollments || []).forEach((e) => enrolledSet.add(`${planId}|${e.user_id}`));
    (existingAssignments || []).forEach((a) => assignedSet.add(`${planId}|${a.course_id}|${a.assigned_to_user_id}`));

    // Serial create + post-create re-check shrinks duplicate enrollments /
    // assignments when concurrent admin clicks race the prefetch→create gap.
    for (const candidate of candidates) {
      const enrollKey = `${planId}|${candidate.email}`;
      if (!enrolledSet.has(enrollKey)) {
        enrolledSet.add(enrollKey);
        const createdEnrollment = await base44.asServiceRole.entities.PlanEnrollment.create({
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
        const afterEnroll = await base44.asServiceRole.entities.PlanEnrollment.filter(
          { plan_id: planId, user_id: candidate.email },
          '-created_date',
          10,
        );
        if (afterEnroll.length > 1) {
          const keepId = afterEnroll
            .slice()
            .sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')))[0]?.id;
          if (keepId && createdEnrollment?.id && createdEnrollment.id !== keepId) {
            try {
              await base44.asServiceRole.entities.PlanEnrollment.delete(createdEnrollment.id);
            } catch {
              /* best-effort */
            }
          }
        }
      }

      for (const item of planItems) {
        const assignKey = `${planId}|${item.course_id}|${candidate.email}`;
        if (assignedSet.has(assignKey)) continue;
        assignedSet.add(assignKey);

        // Honor the per-course configuration set in the plan builder: a course's
        // own "Due by" date (specific_due_date) overrides the plan-level due
        // date, and its required flag drives whether the assignment is required.
        const courseDueDate = item.specific_due_date || dueDate;

        const createdAssignment = await base44.asServiceRole.entities.TrainingAssignment.create({
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
        const afterAssign = await base44.asServiceRole.entities.TrainingAssignment.filter(
          { plan_id: planId, course_id: item.course_id, assigned_to_user_id: candidate.email },
          '-created_date',
          10,
        );
        if (afterAssign.length > 1) {
          const keepId = afterAssign
            .slice()
            .sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')))[0]?.id;
          if (keepId && createdAssignment?.id && createdAssignment.id !== keepId) {
            try {
              await base44.asServiceRole.entities.TrainingAssignment.delete(createdAssignment.id);
            } catch {
              /* best-effort */
            }
          }
        }
      }
    }

    return Response.json({ success: true, enrolled_users: candidates.length, learning_plan_items: planItems.length });
  } catch (error) {
    console.error('assignAnnualLearningPlan failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});