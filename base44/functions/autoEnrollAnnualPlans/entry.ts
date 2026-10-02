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

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

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
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    // Authorization: privileged scheduled job (service-role assignment +
    // notification writes, no end user). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await withTrustedClaims(base44, await base44.auth.me().catch(() => null));
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    // Hub cutover guard: once learning is released to the Support Hub, this job
    // must not create assignments or reminders against Base44 course data.
    if (Deno.env.get('CENTRAL_LEARNING_RELEASE') === 'hub-runtime-v1') {
      return Response.json({ success: true, skipped: true, reason: 'central_learning' });
    }
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(me);
      if (_agencyAdminGate) return _agencyAdminGate;
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
    if (me && me.account_type !== 'super_admin' && me.agency_name && (me.account_type === 'agency_admin' || me.role === 'admin')) {
      if (!me.agency_name) {
        return Response.json({ error: 'Forbidden: agency membership required' }, { status: 403 });
      }
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
        // Create then re-read: overlapping cron/admin enroll runs can still race
        // the prefetch→create gap (no unique index / CAS).
        const createdEnrollment = await svc.PlanEnrollment.create({
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
        const afterEnroll = await svc.PlanEnrollment.filter({
          plan_id: plan.id,
          user_id: user.email,
        }, '-created_date', 10);
        if (afterEnroll.length > 1) {
          const keepId = afterEnroll
            .slice()
            .sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')))[0]?.id;
          if (keepId && createdEnrollment?.id && createdEnrollment.id !== keepId) {
            try {
              await svc.PlanEnrollment.delete(createdEnrollment.id);
            } catch {
              /* best-effort */
            }
          } else {
            enrolledUsers++;
          }
        } else {
          enrolledUsers++;
        }
      }

      for (const item of planItems) {
        const assignKey = `${plan.id}|${item.course_id}|${user.email}`;
        if (assignedSet.has(assignKey)) continue;
        assignedSet.add(assignKey);

        const createdAssignment = await svc.TrainingAssignment.create({
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
        const afterAssign = await svc.TrainingAssignment.filter({
          plan_id: plan.id,
          course_id: item.course_id,
          assigned_to_user_id: user.email,
          annual_cycle_year: year,
        }, '-created_date', 10);
        if (afterAssign.length > 1) {
          const keepId = afterAssign
            .slice()
            .sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')))[0]?.id;
          if (keepId && createdAssignment?.id && createdAssignment.id !== keepId) {
            try {
              await svc.TrainingAssignment.delete(createdAssignment.id);
            } catch {
              /* best-effort */
            }
            continue;
          }
        }
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
    console.error('autoEnrollAnnualPlans failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
