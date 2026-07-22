// Pure role-aware queue summarizer for Phase 1 dashboard hardening. The page can
// consume this without backend changes; tests protect the workflow criteria and
// terminology before UI integration expands.

const isOpen = (status) => !['resolved', 'completed', 'closed', 'archived', 'cancelled', 'canceled'].includes(String(status || '').toLowerCase());

export function buildCoreWorkQueues({ role = 'nurse', referrals = [], incidents = [], credentials = [], tasks = [], notes = [] } = {}) {
  const adminLike = ['admin', 'facility_admin', 'super_admin', 'manager', 'qa'].includes(role);
  const nurseQueues = [
    {
      id: 'my-open-tasks',
      label: 'My open tasks',
      count: tasks.filter((t) => isOpen(t.status)).length,
      route: '/Dashboard',
      priority: 'medium',
    },
    {
      id: 'notes-pending-review',
      label: 'Notes pending review',
      count: notes.filter((n) => ['pending_review', 'submitted', 'in_review'].includes(n.status)).length,
      route: '/ClinicalDocumentation',
      priority: 'high',
    },
  ];

  const adminQueues = [
    {
      id: 'referrals-awaiting-info',
      label: 'Referrals awaiting info',
      count: referrals.filter((r) => r.status === 'awaiting_info' || r.requires_manual_review).length,
      route: '/ReferralIntake',
      priority: 'high',
    },
    {
      id: 'incidents-open-review',
      label: 'Incidents needing review',
      count: incidents.filter((i) => isOpen(i.status)).length,
      route: '/IncidentReview',
      priority: 'high',
    },
    {
      id: 'credentials-pending',
      label: 'Credentials pending approval',
      count: credentials.filter((c) => c.status === 'pending_approval').length,
      route: '/CredentialCompliance',
      priority: 'medium',
    },
  ];

  return (adminLike ? [...adminQueues, ...nurseQueues] : nurseQueues)
    .filter((queue) => queue.count > 0)
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || b.count - a.count || a.label.localeCompare(b.label);
    });
}
