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
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    const todayIso = new Date().toISOString().slice(0, 10);
    // Filter to OPEN statuses server-side: an unfiltered newest-300 scan let
    // an older still-open case fall off the window as closed/submitted cases
    // accumulated — and silently stop receiving reminders.
    const cases = await base44.asServiceRole.entities.AdrAuditCase.filter(
      { status: { $in: OPEN_ADR_STATUSES } },
      '-created_date',
      300,
    );
    const plans = planAdrDeadlineReminders({ cases: cases || [], todayIso });
    const runId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `adr-${Date.now()}`;

    let notified = 0;
    for (const plan of plans) {
      // Claim today's reminder before create so overlapping cron runs don't
      // double-notify; release on create failure so a later run can retry.
      const priorReminders = (() => {
        const c = (cases || []).find((row) => row.id === plan.case_id);
        return c?.deadline_reminders && typeof c.deadline_reminders === 'object'
          ? c.deadline_reminders
          : {};
      })();
      const claimPayload = {
        ...priorReminders,
        last_notified_date: todayIso,
        last_days_left: plan.days_left,
        claimed_by: runId,
      };
      try {
        await base44.asServiceRole.entities.AdrAuditCase.update(plan.case_id, {
          deadline_reminders: claimPayload,
        });
      } catch {
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.AdrAuditCase
        .filter({ id: plan.case_id }, '-created_date', 1).catch(() => []);
      const claimed = claimCheck[0]?.deadline_reminders;
      if (!claimed || claimed.claimed_by !== runId) {
        continue;
      }

      try {
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
        });
      } catch (err) {
        console.error('checkAdrDeadlines: notification create failed for case', plan.case_id, err);
        await base44.asServiceRole.entities.AdrAuditCase.update(plan.case_id, {
          deadline_reminders: {
            ...priorReminders,
            claimed_by: '',
          },
        }).catch(() => {});
        continue;
      }

      notified += 1;
    }

    return Response.json({ success: true, notified, checked: (cases || []).length, today: todayIso });
  } catch (error) {
    console.error('checkAdrDeadlines error:', error);
    return Response.json({ error: 'ADR deadline check failed' }, { status: 500 });
  }
});
