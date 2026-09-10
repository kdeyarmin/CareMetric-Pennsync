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


const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { courseId } = await req.json();
    if (!courseId) {
      return Response.json({ error: 'courseId is required' }, { status: 400 });
    }

    const [course] = await base44.asServiceRole.entities.TrainingCourse.filter({ id: courseId }, undefined, 5000);
    if (!course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }

    const modules = await base44.asServiceRole.entities.TrainingModule.filter({ course_id: courseId }, 'order_index', 500);
    const questions = await base44.asServiceRole.entities.TrainingQuestion.filter({ course_id: courseId }, 'order_index', 500);

    // Strip server-managed fields before re-creating: spreading the source id /
    // created_date / updated_date into create risks colliding with or aliasing
    // the original record (the codebase strips id before create elsewhere).
    const stripMeta = (record) => {
      const copy = { ...record };
      delete copy.id;
      delete copy.created_date;
      delete copy.updated_date;
      return copy;
    };

    const duplicatedCourse = await base44.asServiceRole.entities.TrainingCourse.create({
      ...stripMeta(course),
      title: `${course.title} (Copy)`,
      status: 'draft',
      published_by: null,
      published_date: null,
      archived_status: false
    });

    await Promise.all(modules.map((module, index) =>
      base44.asServiceRole.entities.TrainingModule.create({
        ...stripMeta(module),
        course_id: duplicatedCourse.id,
        order_index: index
      })
    ));

    await Promise.all(questions.map((question, index) =>
      base44.asServiceRole.entities.TrainingQuestion.create({
        ...stripMeta(question),
        course_id: duplicatedCourse.id,
        order_index: index
      })
    ));

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'course_created',
      entity_type: 'TrainingCourse',
      entity_id: duplicatedCourse.id,
      after_json: {
        source_course_id: courseId,
        duplicated_title: duplicatedCourse.title
      },
      severity: 'info'
    });

    return Response.json({ success: true, course_id: duplicatedCourse.id, title: duplicatedCourse.title });
  } catch (error) {
    console.error('duplicateInService failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});