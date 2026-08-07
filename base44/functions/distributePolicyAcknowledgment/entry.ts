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
    const me = await base44.auth.me();
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
