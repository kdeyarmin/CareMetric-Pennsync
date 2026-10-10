import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import JSON5 from 'json5';
import { CALL_TIMEOUT_MS, FUNCTIONS_BASE, JOBS, TICK_MINUTES, dueJobs, main } from './scheduler.mjs';

const at = (iso) => new Date(iso);

function fakeFetch(statusFor = () => 200, bodyFor = () => ({ success: true })) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const fn = url.slice(FUNCTIONS_BASE.length + 1);
    return new Response(JSON.stringify(bodyFor(fn)), {
      status: statusFor(fn),
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, impl };
}

test('every job keeps its interval over a whole UTC day', () => {
  const counts = new Map(JOBS.map((job) => [job.fn, 0]));
  const start = Date.parse('2026-10-10T00:00:00Z');
  for (let minute = 0; minute < 24 * 60; minute += TICK_MINUTES) {
    for (const job of dueJobs(new Date(start + minute * 60_000))) counts.set(job.fn, counts.get(job.fn) + 1);
  }
  for (const job of JOBS) {
    assert.equal(counts.get(job.fn), (24 * 60) / job.everyMinutes, job.fn);
  }
});

test('intervals land on UTC marks and a late start keeps its mark', () => {
  const names = (iso) => dueJobs(at(iso)).map((job) => job.fn).sort();
  assert.deepEqual(names('2026-10-10T14:00:00Z'), JOBS.map((job) => job.fn).sort());
  assert.deepEqual(names('2026-10-10T14:05:00Z'), ['copyInboundSmsMedia', 'dispatchScheduledSms']);
  assert.deepEqual(names('2026-10-10T14:10:00Z'), [
    'copyInboundSmsMedia', 'dispatchScheduledSms', 'processInboundFaxes', 'processScheduledFaxes', 'redriveFailedSms',
  ]);
  assert.deepEqual(names('2026-10-10T14:15:00Z'), [
    'autoRetryFailedFaxes', 'copyInboundSmsMedia', 'dispatchScheduledSignatureReminders', 'dispatchScheduledSms',
    'pollFaxStatuses',
  ]);
  // Ninety seconds late is still the 14:10 run, not a run with no mark.
  assert.deepEqual(names('2026-10-10T14:11:30Z'), names('2026-10-10T14:10:00Z'));
});

test('every interval is a whole number of ticks and every target is a real Base44 function', async () => {
  for (const job of JOBS) {
    assert.ok(Number.isInteger(job.everyMinutes / TICK_MINUTES) && job.everyMinutes >= TICK_MINUTES, job.fn);
    await readFile(new URL(`../../base44/functions/${job.fn}/entry.ts`, import.meta.url), 'utf8');
  }
  assert.equal(new Set(JOBS.map((job) => job.fn)).size, JOBS.length);
});

test('every job is driven by a Base44 workflow definition the platform must keep paused', async () => {
  // The workflow files stay in base44/workflows (the platform keeps their
  // pause); this pins that each job here replaces exactly one of them, so a
  // job added here without pausing its workflow has a name to look for.
  const dir = new URL('../../base44/workflows/', import.meta.url);
  const targets = [];
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.jsonc')) continue;
    const workflow = JSON5.parse(await readFile(new URL(file, dir), 'utf8'));
    targets.push(workflow.definition?.do?.[0]?.run_function?.with?.function_name);
  }
  for (const job of JOBS) assert.equal(targets.filter((fn) => fn === job.fn).length, 1, job.fn);
});

test('a run calls each due function once, with the scheduler secret and an empty body', async () => {
  const fetch = fakeFetch();
  const lines = [];
  const code = await main({
    env: { SCHEDULER_ENABLED: 'true', INTERNAL_FN_SECRET: ' scheduler-secret ' },
    fetchImpl: fetch.impl,
    now: at('2026-10-10T14:15:00Z'),
    log: (line) => lines.push(line),
  });
  assert.equal(code, 0);
  assert.deepEqual(
    fetch.calls.map((call) => call.url).sort(),
    dueJobs(at('2026-10-10T14:15:00Z')).map((job) => `${FUNCTIONS_BASE}/${job.fn}`).sort(),
  );
  for (const { init } of fetch.calls) {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-internal-secret'], 'scheduler-secret');
    assert.equal(init.headers['content-type'], 'application/json');
    assert.equal(init.body, '{}');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.ok(CALL_TIMEOUT_MS < TICK_MINUTES * 60_000, 'a run must end before the next one is due');
  assert.ok(lines.every((line) => !line.includes('scheduler-secret')));
});

test('disabled or unconfigured runs call nothing', async () => {
  for (const env of [{}, { SCHEDULER_ENABLED: 'false', INTERNAL_FN_SECRET: 'x' }, { SCHEDULER_ENABLED: 'TRUE', INTERNAL_FN_SECRET: 'x' }]) {
    const fetch = fakeFetch();
    assert.equal(await main({ env, fetchImpl: fetch.impl, log: () => {} }), 0);
    assert.equal(fetch.calls.length, 0);
  }
  const fetch = fakeFetch();
  assert.equal(await main({ env: { SCHEDULER_ENABLED: 'true', INTERNAL_FN_SECRET: '  ' }, fetchImpl: fetch.impl, log: () => {} }), 1);
  assert.equal(fetch.calls.length, 0);
});

test('a failed call fails the run without stopping its siblings or logging the body', async () => {
  const fetch = fakeFetch(
    (fn) => (fn === 'processInboundFaxes' ? 500 : 200),
    (fn) => (fn === 'processInboundFaxes'
      ? { success: false, error: 'One or more inbound faxes could not be processed safely', patient: 'Jane Patient' }
      : { success: true, detail: 'Jane Patient' }),
  );
  const lines = [];
  const code = await main({
    env: { SCHEDULER_ENABLED: 'true', INTERNAL_FN_SECRET: 's' },
    fetchImpl: fetch.impl,
    now: at('2026-10-10T14:10:00Z'),
    log: (line) => lines.push(line),
  });
  assert.equal(code, 1);
  assert.equal(fetch.calls.length, dueJobs(at('2026-10-10T14:10:00Z')).length);
  assert.ok(lines.some((line) => line.startsWith('processInboundFaxes FAILED status=500')));
  assert.ok(lines.every((line) => !line.includes('Jane Patient')));
});

test('a thrown or timed-out request fails the run', async () => {
  for (const failure of [new TypeError('fetch failed'), Object.assign(new Error('t'), { name: 'TimeoutError' })]) {
    const lines = [];
    const code = await main({
      env: { SCHEDULER_ENABLED: 'true', INTERNAL_FN_SECRET: 's' },
      fetchImpl: async () => { throw failure; },
      now: at('2026-10-10T14:05:00Z'),
      log: (line) => lines.push(line),
    });
    assert.equal(code, 1);
    assert.ok(lines.every((line) => line.includes('FAILED status=none')));
  }
});
