import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    if (me.account_type === 'agency_admin' && me.agency_name) {
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
    const notifications = [];

    // Prefetch existing acks for this (policy, version) once and check membership
    // in memory — avoids an N+1 filter() per candidate that could time out on
    // large cohorts.
    const existingAcks = await svc.PolicyAcknowledgment.filter(
      { policy_id: policyId, policy_version: version },
      '-created_date',
      10000,
    );
    const alreadyAssigned = new Set(existingAcks.map((a) => a.user_id));

    for (const user of candidates) {
      if (alreadyAssigned.has(user.email)) continue;

      await svc.PolicyAcknowledgment.create({
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
      created++;

      notifications.push({
        user_email: user.email,
        title: 'Policy acknowledgment required',
        message: `Please review and acknowledge "${policy.title}" (v${version})${dueDate ? ` by ${new Date(dueDate).toLocaleDateString()}` : ''}.`,
        type: 'compliance_alert',
        priority: 'high',
        action_url: '/LearningCenter?tab=policies',
        action_label: 'Review policy',
        metadata: { policy_id: policyId, policy_version: version },
      });
    }

    await svc.TrainingAuditLog.create({
      actor_id: me.email,
      actor_name: me.full_name,
      action: 'assignment_created',
      entity_type: 'PolicyLibrary',
      entity_id: policyId,
      after_json: { policy_title: policy.title, policy_version: version, distributed: created, filters },
      reason: 'policy_distributed',
      severity: 'info',
    }).catch((err) => console.error('Audit log failed:', err));

    for (let i = 0; i < notifications.length; i += 50) {
      const batch = notifications.slice(i, i + 50);
      await Promise.all(batch.map((n) => svc.Notification.create(n).catch((err) => console.error('Notification failed:', err))));
    }

    return Response.json({ success: true, policy_version: version, distributed: created, candidates: candidates.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
