import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * The staff activity trail, read through getUserActivityLog's report mode.
 *
 * The server decides the scope (owner decision, 2026-10-08): the built-in
 * administrator reads platform-wide, a service-owned agency administrator reads
 * only their own agency's members, and everyone else is refused. Details come
 * back with identifying fields removed. No screen reads UserActivity directly
 * for these summaries.
 *
 * A failed or refused read is an ERROR here, never an empty report, so a
 * screen can say "unavailable" instead of showing zero events.
 */

export const ACTIVITY_REPORT_QUERY_KEY = Object.freeze(['userActivities', 'report']);

/** @param {number|null} days  whole days back from now, or null for everything the server keeps */
export async function fetchActivityReport(days = null) {
  const payload = { mode: 'report' };
  if (days !== null && days !== undefined) payload.days = days;
  const response = await base44.functions.invoke('getUserActivityLog', payload);
  const report = response?.data ?? response;
  if (!report || report.success !== true || !Array.isArray(report.activity)) {
    throw new Error(report?.error || 'The activity report is unavailable.');
  }
  return {
    scope: report.scope === 'platform' ? 'platform' : 'agency',
    truncated: report.truncated === true,
    rowLimit: Number.isInteger(report.row_limit) ? report.row_limit : null,
    members: Array.isArray(report.members) ? report.members : [],
    activity: report.activity,
    generatedAt: report.generated_at || null,
  };
}

/** Whole days between `since` (a date or ISO string) and now, at least 1. */
export function daysSince(since, now = Date.now()) {
  const at = since instanceof Date ? since.getTime() : Date.parse(since);
  if (!Number.isFinite(at)) return null;
  return Math.max(1, Math.min(3650, Math.ceil((now - at) / 86_400_000)));
}

export function useActivityReport({ days = null, enabled = true, scopeKey = null, refetchInterval } = {}) {
  return useQuery({
    queryKey: [...ACTIVITY_REPORT_QUERY_KEY, scopeKey, days ?? 'all'],
    queryFn: () => fetchActivityReport(days),
    enabled,
    retry: false,
    refetchInterval,
  });
}
