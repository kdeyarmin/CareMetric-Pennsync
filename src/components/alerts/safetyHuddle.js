const DEFAULT_SLA_MINUTES = {
  critical: 60,
  high: 240,
  medium: 1440,
  low: 2880,
};

const SEVERITY_WEIGHT = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const OPEN_STATUSES = new Set(['active', 'acknowledged', 'in_progress', 'under_review']);

const toDate = (value, fallback = null) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const minutesBetween = (start, end) => Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));

export function isOpenSafetyAlert(alert = {}) {
  return OPEN_STATUSES.has(alert.status || 'active');
}

export function buildSafetyHuddleItem(alert = {}, now = new Date(), options = {}) {
  const slaMinutesBySeverity = { ...DEFAULT_SLA_MINUTES, ...(options.slaMinutesBySeverity || {}) };
  const severity = alert.severity || 'medium';
  const createdAt = toDate(alert.created_date, now);
  const acknowledgedAt = toDate(alert.acknowledged_at);
  const ageMinutes = minutesBetween(createdAt, now);
  const slaMinutes = slaMinutesBySeverity[severity] || DEFAULT_SLA_MINUTES.medium;
  const minutesUntilDue = slaMinutes - ageMinutes;
  const isOverdue = minutesUntilDue < 0;
  const owner = alert.assigned_to || alert.owner || alert.acknowledged_by || '';
  const needsOwner = !owner;
  const isAcknowledged = Boolean(acknowledgedAt) || ['acknowledged', 'in_progress', 'under_review'].includes(alert.status);
  const recommendedActions = Array.isArray(alert.recommended_actions) ? alert.recommended_actions : [];
  const nextAction = recommendedActions[0]
    || (needsOwner ? 'Assign a clinician owner and confirm patient contact plan.'
      : isOverdue ? 'Escalate to supervisor/on-call clinician and document outcome.'
        : 'Document intervention, follow-up time, and resolution criteria.');

  return {
    id: alert.id,
    patientId: alert.patient_id,
    patientName: alert.patient_name,
    title: alert.title || 'Patient safety alert',
    severity,
    status: alert.status || 'active',
    owner,
    needsOwner,
    isAcknowledged,
    isOverdue,
    flaggedUrgent: Boolean(alert.flagged_urgent),
    ageMinutes,
    slaMinutes,
    minutesUntilDue,
    nextAction,
    riskScore: Number(alert.risk_score || 0),
    sortScore: (SEVERITY_WEIGHT[severity] || 0) * 100000
      + (alert.flagged_urgent ? 50000 : 0)
      + (isOverdue ? 25000 : 0)
      + (needsOwner ? 10000 : 0)
      + Number(alert.risk_score || 0),
  };
}

export function buildSafetyHuddle(alerts = [], now = new Date(), options = {}) {
  const items = alerts
    .filter(isOpenSafetyAlert)
    .map((alert) => buildSafetyHuddleItem(alert, now, options))
    .sort((a, b) => b.sortScore - a.sortScore || b.ageMinutes - a.ageMinutes);

  const overdueItems = items.filter((item) => item.isOverdue);
  const unassignedItems = items.filter((item) => item.needsOwner);
  const urgentItems = items.filter((item) => item.flaggedUrgent || item.severity === 'critical');
  const unacknowledgedItems = items.filter((item) => !item.isAcknowledged);

  return {
    items,
    topItems: items.slice(0, options.limit || 5),
    summary: {
      openCount: items.length,
      urgentCount: urgentItems.length,
      overdueCount: overdueItems.length,
      unassignedCount: unassignedItems.length,
      unacknowledgedCount: unacknowledgedItems.length,
      status: overdueItems.length > 0 || urgentItems.length > 0
        ? 'escalate'
        : unassignedItems.length > 0 || unacknowledgedItems.length > 0
          ? 'needs_huddle'
          : 'stable',
    },
  };
}

export function formatSlaTime(minutes) {
  if (minutes < 0) {
    const overdueMinutes = Math.abs(minutes);
    if (overdueMinutes < 60) return `${overdueMinutes}m overdue`;
    return `${Math.ceil(overdueMinutes / 60)}h overdue`;
  }
  if (minutes < 60) return `${minutes}m left`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h left`;
  return `${Math.floor(minutes / 1440)}d left`;
}
