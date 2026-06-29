/**
 * commsDashboard.js — pure, dependency-free aggregation helpers for the admin
 * Communications Dashboard.
 *
 * `summarizeComms` takes raw SmsMessage / CallLog / FaxLog rows and produces a
 * compact, PHI-free summary object (counts, rates, a 7-day daily volume series).
 * It is deterministic: pass `now` to pin the "last 7 days" window so tests and
 * SSR don't depend on wall-clock time.
 *
 * The backend function getCommsDashboard inlines an equivalent of this logic
 * (single-file Deno deploy can't import from src/); keep the two shapes in sync.
 */

const round = (n) => Math.round(n);
const MISSED_CALL_STATUSES = new Set(['failed', 'no_answer', 'busy', 'canceled', 'cancelled']);

/** delivered / outbound as a rounded whole-number percent; 0 when no outbound. */
function rate(delivered, outbound) {
  if (!outbound || outbound <= 0) return 0;
  return round((delivered / outbound) * 100);
}

/** Local-day key 'YYYY-MM-DD' for an ISO/date-ish value; null when unparseable. */
function localDayKey(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Build the last-7-days (inclusive of `now`'s local day) date keys, oldest first.
 */
function lastSevenDayKeys(now) {
  const keys = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    keys.push(localDayKey(d));
  }
  return keys;
}

/**
 * @param {{messages?: object[], calls?: object[], faxes?: object[]}} input
 * @param {Date} now
 */
export function summarizeComms({ messages = [], calls = [], faxes = [] } = {}, now = new Date()) {
  const msgs = Array.isArray(messages) ? messages : [];
  const callRows = Array.isArray(calls) ? calls : [];
  const faxRows = Array.isArray(faxes) ? faxes : [];

  // ---- SMS ----
  const smsOutbound = msgs.filter((m) => m.direction === 'outbound');
  const smsInbound = msgs.filter((m) => m.direction === 'inbound');
  const smsDelivered = msgs.filter((m) => m.status === 'delivered');
  const smsFailed = msgs.filter((m) => m.status === 'failed');
  const sms = {
    total: msgs.length,
    inbound: smsInbound.length,
    outbound: smsOutbound.length,
    delivered: smsDelivered.length,
    failed: smsFailed.length,
    delivery_rate: rate(smsDelivered.length, smsOutbound.length),
  };

  // ---- Calls ----
  const callsInbound = callRows.filter((c) => c.direction === 'inbound');
  const callsOutbound = callRows.filter((c) => c.direction === 'outbound');
  const callsCompleted = callRows.filter((c) => c.status === 'completed');
  const callsFailed = callRows.filter((c) => c.status === 'failed');
  // "missed": an inbound call that reached a terminal non-completed outcome, or
  // one that left a voicemail. Active ringing calls are still in progress.
  const callsMissed = callRows.filter(
    (c) =>
      c.direction === 'inbound' &&
      (c.has_voicemail === true || MISSED_CALL_STATUSES.has(c.status)),
  );
  const voicemailBacklog = callRows.filter((c) => c.has_voicemail === true);
  const durations = callRows
    .map((c) => Number(c.duration_seconds))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgDuration = durations.length
    ? round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const callsSummary = {
    total: callRows.length,
    inbound: callsInbound.length,
    outbound: callsOutbound.length,
    completed: callsCompleted.length,
    failed: callsFailed.length,
    missed: callsMissed.length,
    voicemail_backlog: voicemailBacklog.length,
    avg_duration_secs: avgDuration,
  };

  // ---- Fax ----
  const faxDelivered = faxRows.filter((f) => f.status === 'delivered');
  const faxFailed = faxRows.filter((f) => f.status === 'failed');
  // Faxes are all outbound; rate against total attempted.
  const fax = {
    total: faxRows.length,
    delivered: faxDelivered.length,
    failed: faxFailed.length,
    delivery_rate: rate(faxDelivered.length, faxRows.length),
  };

  // ---- Daily 7-day series ----
  const dayKeys = lastSevenDayKeys(now);
  const dayIndex = Object.fromEntries(
    dayKeys.map((k) => [k, { date: k, sms: 0, calls: 0, faxes: 0 }]),
  );
  const bump = (rows, field) => {
    for (const r of rows) {
      const key = localDayKey(r.created_date);
      if (key && dayIndex[key]) dayIndex[key][field] += 1;
    }
  };
  bump(msgs, 'sms');
  bump(callRows, 'calls');
  bump(faxRows, 'faxes');
  const daily = dayKeys.map((k) => dayIndex[k]);

  return { sms, calls: callsSummary, fax, daily };
}

export default summarizeComms;
