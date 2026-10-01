import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
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
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await withTrustedClaims(base44, await base44.auth.me());
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