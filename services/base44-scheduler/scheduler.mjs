// Runs PennSync's frequent Base44 scheduled functions on Railway's clock.
//
// Every Base44 workflow run bills 0.2 integration credits even when it finds
// no work (measured on the production app 2026-10-10), and nine workflows ran
// every 5 to 60 minutes: about 8,700 credits a month before any of them did
// anything. Base44 bills a direct function call at about 1 credit per 100, so
// this calls the same functions on the same schedule with the scheduler secret
// they already accept (`x-internal-secret`, the schedulerAuth helper in
// base44/_shared/backendHelpers.mjs), in place of those nine workflows, which
// must be paused on Base44 while it runs. The four daily workflows stay there.
//
// EXACTLY ONE scheduler may drive these. dispatchScheduledSms claims a row by
// writing it and reading it back, so two overlapping runs can both win the
// same row and text the patient twice. Never re-enable a Base44 workflow for a
// job listed here while this runs, and never give this a second cron service.
//
// Deployed as a Railway Function (project "CareMetric Train", service
// "base44-scheduler", cron */5 * * * *). Railway runs it as index.tsx under Bun;
// this file is that source, kept here so it is reviewed and tested. Railway
// skips a run while the previous one is still going, and the per-call timeout
// below keeps a run inside its five minutes.

export const FUNCTIONS_BASE = 'https://caremetricai.base44.app/api/apps/694ec16e72e01b60d22f7cbf/functions';
export const TICK_MINUTES = 5;
export const CALL_TIMEOUT_MS = 4 * 60 * 1000;

// Each interval is the one its Base44 workflow used, except Poll Fax Statuses,
// which is the webhook's safety net and moved from 5 to 15 minutes.
export const JOBS = Object.freeze([
  { fn: 'dispatchScheduledSms', everyMinutes: 5 },
  { fn: 'copyInboundSmsMedia', everyMinutes: 5 },
  { fn: 'redriveFailedSms', everyMinutes: 10 },
  { fn: 'processScheduledFaxes', everyMinutes: 10 },
  { fn: 'processInboundFaxes', everyMinutes: 10 },
  { fn: 'pollFaxStatuses', everyMinutes: 15 },
  { fn: 'autoRetryFailedFaxes', everyMinutes: 15 },
  { fn: 'dispatchScheduledSignatureReminders', everyMinutes: 15 },
  { fn: 'checkPendingSignatureRequests', everyMinutes: 60 },
]);

/**
 * The jobs due at this run. The cron fires on the five-minute marks, but a run
 * can start a little after its mark, so the time is rounded to the nearest
 * mark rather than down. Marks count from the epoch, so the 15-minute jobs land
 * on :00/:15/:30/:45 and the hourly one on the hour, all in UTC.
 */
export function dueJobs(now = new Date()) {
  const tick = Math.round(now.getTime() / (TICK_MINUTES * 60_000));
  return JOBS.filter((job) => tick % (job.everyMinutes / TICK_MINUTES) === 0);
}

async function callJob(job, { secret, fetchImpl }) {
  const started = Date.now();
  try {
    const response = await fetchImpl(`${FUNCTIONS_BASE}/${job.fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: '{}',
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    // Only the status and the function's own generic error string are logged:
    // the functions keep identifiers out of `error`, and the rest of a body is
    // never printed.
    const body = await response.json().catch(() => null);
    const error = !response.ok && typeof body?.error === 'string' ? body.error.slice(0, 200) : null;
    return { fn: job.fn, ok: response.ok, status: response.status, ms: Date.now() - started, error };
  } catch (failure) {
    const reason = failure?.name === 'TimeoutError' ? 'timed out' : 'request failed';
    return { fn: job.fn, ok: false, status: null, ms: Date.now() - started, error: reason };
  }
}

/** One scheduler run. Returns the process exit code: 0 only when every due call succeeded. */
export async function main({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  log = console.log,
} = {}) {
  if (env.SCHEDULER_ENABLED !== 'true') {
    log('scheduler disabled (SCHEDULER_ENABLED is not "true"); nothing called');
    return 0;
  }
  const secret = String(env.INTERNAL_FN_SECRET || '').trim();
  if (!secret) {
    log('INTERNAL_FN_SECRET is not set; nothing called');
    return 1;
  }
  const jobs = dueJobs(now);
  const results = await Promise.all(jobs.map((job) => callJob(job, { secret, fetchImpl })));
  for (const result of results) {
    log(`${result.fn} ${result.ok ? 'ok' : 'FAILED'} status=${result.status ?? 'none'} ms=${result.ms}`
      + (result.error ? ` error=${JSON.stringify(result.error)}` : ''));
  }
  return results.every((result) => result.ok) ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
