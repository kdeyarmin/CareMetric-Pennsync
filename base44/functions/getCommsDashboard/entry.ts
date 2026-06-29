import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getCommsDashboard — admin-only aggregation for the Communications Dashboard.
 *
 * Reads recent SmsMessage / CallLog / FaxLog rows via asServiceRole, computes a
 * compact, PHI-free summary (the same shape as the src/components/admin/
 * commsDashboard.js `summarizeComms` util — kept in sync, inlined here because a
 * single-file Deno deploy can't import from src/), plus a short recent-failures
 * list and per-number outbound activity.
 *
 * Never returns message bodies or any PHI — only counts, statuses, numbers,
 * failure reasons, and timestamps.
 */

const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || '').trim().toLowerCase() || null;

const isAdminLike = (u) =>
  !!u &&
  (u.role === 'admin' ||
    u.account_type === 'agency_admin' ||
    u.account_type === 'super_admin' ||
    u.email === SUPER_ADMIN_EMAIL);

const round = (n) => Math.round(n);
const MISSED_CALL_STATUSES = new Set(['failed', 'no_answer', 'busy', 'canceled', 'cancelled']);

function rate(delivered, outbound) {
  if (!outbound || outbound <= 0) return 0;
  return round((delivered / outbound) * 100);
}

function localDayKey(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lastSevenDayKeys(now) {
  const keys = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    keys.push(localDayKey(d));
  }
  return keys;
}

function summarize(messages, calls, faxes, now) {
  const msgs = Array.isArray(messages) ? messages : [];
  const callRows = Array.isArray(calls) ? calls : [];
  const faxRows = Array.isArray(faxes) ? faxes : [];

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

  const callsInbound = callRows.filter((c) => c.direction === 'inbound');
  const callsOutbound = callRows.filter((c) => c.direction === 'outbound');
  const callsCompleted = callRows.filter((c) => c.status === 'completed');
  const callsFailed = callRows.filter((c) => c.status === 'failed');
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

  const faxDelivered = faxRows.filter((f) => f.status === 'delivered');
  const faxFailed = faxRows.filter((f) => f.status === 'failed');
  const fax = {
    total: faxRows.length,
    delivered: faxDelivered.length,
    failed: faxFailed.length,
    delivery_rate: rate(faxDelivered.length, faxRows.length),
  };

  const dayKeys = lastSevenDayKeys(now);
  const dayIndex = {};
  for (const k of dayKeys) dayIndex[k] = { date: k, sms: 0, calls: 0, faxes: 0 };
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }
    // (TypeScript annotations stripped below for plain-JS Deno compliance.)

    // Pull recent rows (newest first), then restrict to the last ~30 days.
    const [messages, calls, faxes, users] = await Promise.all([
      base44.asServiceRole.entities.SmsMessage.list('-created_date', 1000).catch(() => []),
      base44.asServiceRole.entities.CallLog.list('-created_date', 1000).catch(() => []),
      base44.asServiceRole.entities.FaxLog.list('-created_date', 1000).catch(() => []),
      base44.asServiceRole.entities.User.list('-created_date', 1000).catch(() => []),
    ]);

    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).getTime();
    const inWindow = (row) => {
      const t = new Date(row.created_date).getTime();
      return Number.isFinite(t) ? t >= cutoff : true;
    };
    const recentMessages = (messages || []).filter(inWindow);
    const recentCalls = (calls || []).filter(inWindow);
    const recentFaxes = (faxes || []).filter(inWindow);

    const summary = summarize(recentMessages, recentCalls, recentFaxes, now);

    // Map work numbers -> user full names (digits-only, last 10 for matching).
    const last10 = (v) => String(v || '').replace(/[^\d]/g, '').slice(-10);
    const nameByNumber = {};
    const nameByEmail = {};
    for (const u of users || []) {
      if (u.email) nameByEmail[u.email] = u.full_name || u.email;
      const key = last10(u.work_phone_number);
      if (key.length === 10) nameByNumber[key] = u.full_name || u.email || '';
    }

    // ---- Recent failures (no message bodies) ----
    const failures = [];
    for (const m of recentMessages) {
      if (m.status === 'failed') {
        failures.push({
          type: 'sms',
          to: m.to_number || '',
          reason: m.failure_reason || 'Unknown',
          created_date: m.created_date,
        });
      }
    }
    for (const c of recentCalls) {
      if (c.status === 'failed') {
        failures.push({
          type: 'call',
          to: c.to_number || '',
          reason: 'Call failed',
          created_date: c.created_date,
        });
      }
    }
    for (const f of recentFaxes) {
      if (f.status === 'failed') {
        failures.push({
          type: 'fax',
          to: f.to_number || '',
          reason: f.failure_reason || 'Unknown',
          created_date: f.created_date,
        });
      }
    }
    failures.sort(
      (a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime(),
    );
    const failuresCapped = failures.slice(0, 25);

    // ---- Per-number outbound activity ----
    const perNumberMap = {};
    const ensure = (num) => {
      if (!perNumberMap[num]) perNumberMap[num] = { number: num, sms: 0, calls: 0 };
      return perNumberMap[num];
    };
    for (const m of recentMessages) {
      if (m.direction === 'outbound' && m.from_number) ensure(m.from_number).sms += 1;
    }
    for (const c of recentCalls) {
      if (c.direction === 'outbound' && c.from_number) ensure(c.from_number).calls += 1;
    }
    const per_number = Object.values(perNumberMap)
      .map((row) => ({
        ...row,
        user_full_name: nameByNumber[last10(row.number)] || '',
      }))
      .sort((a, b) => b.sms + b.calls - (a.sms + a.calls))
      .slice(0, 20);

    return Response.json({
      success: true,
      summary,
      failures: failuresCapped,
      per_number,
      generated_at: now.toISOString(),
    });
  } catch (error) {
    console.error('getCommsDashboard error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});