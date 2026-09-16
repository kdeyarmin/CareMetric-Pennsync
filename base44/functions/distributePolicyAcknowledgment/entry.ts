import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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



const isAdminUser = (user) =>
  user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

// ───────────────────────────────────────────────────────────────────────────
// Relias-style policy distribution: assign a PolicyLibrary version to a cohort
// and require each member to sign off. Creates one PolicyAcknowledgment per
// user (snapshotting the policy version) + a notification.
//
// Version control: re-running for a NEW policy_version creates fresh
// "assigned" rows for that version; prior-version acknowledgments remain as
// history. Idempotent within a version on (policy_id, policy_version, user_id).
// ───────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(me);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!isAdminUser(me)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { policyId, dueDate, userEmails = [], filters = {} } = await req.json();
    if (!policyId) {
      return Response.json({ error: 'policyId is required' }, { status: 400 });
    }

    const svc = base44.asServiceRole.entities;
    const [policy] = await svc.PolicyLibrary.filter({ id: policyId });
    if (!policy) {
      return Response.json({ error: 'Policy not found' }, { status: 404 });
    }
    const version = policy.version || '1';

    const allUsers = await svc.User.list('-created_date', 5000);
    let candidates = allUsers.filter((u) => u.email && u.role !== 'admin' && u.is_approved !== false);
    // Agency admins without agency_name must not distribute to every tenant.
    if (me.account_type !== 'super_admin' && me.agency_name && (me.account_type === 'agency_admin' || me.role === 'admin')) {
      if (!me.agency_name) {
        return Response.json({ error: 'Forbidden: agency_name is required to distribute policies.' }, { status: 403 });
      }
      candidates = candidates.filter((u) => u.agency_name === me.agency_name);
    }
    if (userEmails.length > 0) {
      const set = new Set(userEmails);
      candidates = candidates.filter((u) => set.has(u.email));
    } else {
      if (filters.role && filters.role !== 'all') candidates = candidates.filter((u) => (u.job_title || u.credential_type || u.role) === filters.role);
      if (filters.department && filters.department !== 'all') candidates = candidates.filter((u) => u.department === filters.department);
      if (filters.business_line && filters.business_line !== 'all') candidates = candidates.filter((u) => u.business_line === filters.business_line);
      if (filters.location && filters.location !== 'all') candidates = candidates.filter((u) => u.location === filters.location);
    }

    const today = new Date();
    let created = 0;
    let failed = 0;
    const failures = [];

    // Prefetch existing acks for this (policy, version) once and check membership
    // in memory — avoids an N+1 filter() per candidate that could time out on
    // large cohorts.
    const existingAcks = await svc.PolicyAcknowledgment.filter(
      { policy_id: policyId, policy_version: version },
      '-created_date',
      10000,
    );
    const alreadyAssigned = new Set(existingAcks.map((a) => a.user_id));

    // Wrap each ack create in try/catch and notify the user immediately after
    // their ack succeeds (mirrors deletePatientsMissingFirstName). A single
    // failed create (validation/transient) — or a timeout on a large cohort — no
    // longer aborts the whole distribution with nobody notified and no audit
    // trail: every successfully-assigned user is already notified, and the audit
    // log below records the actual created/failed counts even on partial runs.
    for (const user of candidates) {
      if (alreadyAssigned.has(user.email)) continue;
      alreadyAssigned.add(user.email);

      let createdAck = null;
      try {
        createdAck = await svc.PolicyAcknowledgment.create({
          policy_id: policyId,
          policy_title: policy.title,
          policy_number: policy.policy_number || '',
          policy_version: version,
          doc_url: policy.doc_url || '',
          user_id: user.email,
          user_name: user.full_name,
          distributed_by: me.email,
          assigned_date: today.toISOString(),
          due_date: dueDate || null,
          status: 'assigned',
          acknowledged: false,
        });
      } catch (err) {
        failed++;
        failures.push({ user: user.email, error: err?.message });
        console.error('PolicyAcknowledgment create failed:', err?.message);
        continue;
      }

      // Concurrent distributes can still race the prefetch→create gap — keep
      // the oldest ack and drop our duplicate before notifying.
      const afterCreate = await svc.PolicyAcknowledgment.filter(
        { policy_id: policyId, policy_version: version, user_id: user.email },
        '-created_date',
        10,
      ).catch(() => []);
      if (afterCreate.length > 1) {
        const keepId = afterCreate
          .slice()
          .sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')))[0]?.id;
        if (keepId && createdAck?.id && createdAck.id !== keepId) {
          try {
            await svc.PolicyAcknowledgment.delete(createdAck.id);
          } catch {
            /* best-effort */
          }
          continue;
        }
      }
      created++;

      await svc.Notification.create({
        user_email: user.email,
        title: 'Policy acknowledgment required',
        message: `Please review and acknowledge "${policy.title}" (v${version})${dueDate ? ` by ${new Date(dueDate).toLocaleDateString()}` : ''}.`,
        type: 'compliance_alert',
        priority: 'high',
        action_url: '/LearningCenter?tab=policies',
        action_label: 'Review policy',
        metadata: { policy_id: policyId, policy_version: version },
      }).catch((err) => console.error('Notification failed:', err));
    }

    await svc.TrainingAuditLog.create({
      actor_id: me.email,
      actor_name: me.full_name,
      action: 'assignment_created',
      entity_type: 'PolicyLibrary',
      entity_id: policyId,
      after_json: { policy_title: policy.title, policy_version: version, distributed: created, failed, filters },
      reason: 'policy_distributed',
      severity: 'info',
    }).catch((err) => console.error('Audit log failed:', err));

    return Response.json({ success: true, policy_version: version, distributed: created, failed, failures, candidates: candidates.length });
  } catch (error) {
    console.error('distributePolicyAcknowledgment failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
