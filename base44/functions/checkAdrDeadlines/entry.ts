import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
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
  if (providedSecret === expectedSecret) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

// checkAdrDeadlines — scheduled job that reminds ADR case owners of upcoming
// and missed response deadlines. A blown ADR deadline is an automatic denial
// (documentation not received is treated as missing), so open cases get an
// in-app notification at 7 / 3 / 1 / 0 days before the due date and daily
// while overdue, up to 7 days past due.
//
// Plain Deno.serve endpoint like the other scheduled jobs (no in-repo cron:
// register a scheduled trigger on the Base44 dashboard, POST with empty body;
// see docs/LEARNING_CENTER_SCHEDULED_JOBS.md for the registration steps).
// Recommended cadence: daily.
//
// Auth requires either an admin session or the configured `x-internal-secret` scheduler header.
//
// The planner below is a verbatim copy of the canonical, unit-tested module at
// src/components/adr/adrDeadlines.js (Deno functions cannot import from src/;
// keep the two in step when editing).

const OPEN_ADR_STATUSES = [
  'letter_uploaded',
  'checklist_ready',
  'packet_uploaded',
  'packet_verified',
  'packet_generated',
];

const REMINDER_DAYS_BEFORE = [7, 3, 1, 0];
const MAX_OVERDUE_REMINDER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnlyUTC(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return ms;
}

function planAdrDeadlineReminders({ cases = [], todayIso } = {}) {
  const todayMs = parseDateOnlyUTC(todayIso);
  if (todayMs === null) return [];
  const plans = [];
  for (const c of cases) {
    if (!c || !OPEN_ADR_STATUSES.includes(c.status)) continue;
    if (!c.created_by) continue;
    const dueMs = parseDateOnlyUTC(c.response_due_date);
    if (dueMs === null) continue;
    const daysLeft = Math.round((dueMs - todayMs) / DAY_MS);
    const inPreWindow = REMINDER_DAYS_BEFORE.includes(daysLeft);
    const inOverdueWindow = daysLeft < 0 && daysLeft >= -MAX_OVERDUE_REMINDER_DAYS;
    if (!inPreWindow && !inOverdueWindow) continue;
    if (c.deadline_reminders?.last_notified_date === todayIso) continue; // already reminded today
    const name = c.case_name || c.patient_name || 'an ADR case';
    const title =
      daysLeft > 0
        ? `⏰ ADR response due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
        : daysLeft === 0
          ? '⏰ ADR response due TODAY'
          : `🚨 ADR response overdue by ${-daysLeft} day${daysLeft === -1 ? '' : 's'}`;
    const message =
      daysLeft >= 0
        ? `${name}: the documentation response is due ${c.response_due_date}. Documentation not received by the deadline is treated as missing and the claim is denied.`
        : `${name}: the response deadline (${c.response_due_date}) has passed. Submit immediately and contact the contractor — late documentation is treated as missing.`;
    plans.push({
      case_id: c.id,
      user_email: c.created_by,
      days_left: daysLeft,
      priority: daysLeft <= 1 ? 'critical' : 'high',
      title,
      message,
    });
  }
  return plans;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;

    const todayIso = new Date().toISOString().slice(0, 10);
    const cases = await base44.asServiceRole.entities.AdrAuditCase.list('-created_date', 300);
    const plans = planAdrDeadlineReminders({ cases: cases || [], todayIso });

    let notified = 0;
    for (const plan of plans) {
      await base44.asServiceRole.entities.Notification.create({
        user_email: plan.user_email,
        title: plan.title,
        message: plan.message,
        type: 'compliance_alert',
        priority: plan.priority,
        metadata: { related_entity: 'AdrAuditCase', related_entity_id: plan.case_id },
        is_read: false,
        action_url: '/ADRCenter',
        action_label: 'Open ADR Center',
      }).catch(() => {});

      await base44.asServiceRole.entities.AdrAuditCase.update(plan.case_id, {
        deadline_reminders: { last_notified_date: todayIso, last_days_left: plan.days_left },
      }).catch(() => {});
      notified += 1;
    }

    return Response.json({ success: true, notified, checked: (cases || []).length, today: todayIso });
  } catch (error) {
    console.error('checkAdrDeadlines error:', error);
    return Response.json({ error: 'ADR deadline check failed' }, { status: 500 });
  }
});
