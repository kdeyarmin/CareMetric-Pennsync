import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const SECRET = 'fax-queue-hardening-secret-32-bytes-minimum';
globalThis.Deno = {
  serve() {},
  env: { get: (key) => key === 'INTERNAL_FN_SECRET' ? SECRET : undefined },
};

async function loadInline(entryPath, names) {
  let source = await readFile(new URL(entryPath, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = () => ({});',
  );
  const js = transpileTs(source).outputText;
  const tmp = join(tmpdir(), `fax_queue_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${names.join(', ')} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const NOW = Date.parse('2026-09-06T12:00:00.000Z');

test('fax queue workers remain doubly gated before constructing a Base44 client', async () => {
  for (const [name, envName, flag, workflowFile, interval] of [
    [
      'autoRetryFailedFaxes',
      'WORKFLOW_RELEASE_AUTO_RETRY_FAILED_FAXES',
      'AUTO_RETRY_FAILED_FAXES_ENABLED',
      'Auto Retry Failed Faxes.jsonc',
      15,
    ],
    [
      'processScheduledFaxes',
      'WORKFLOW_RELEASE_PROCESS_SCHEDULED_FAXES',
      'PROCESS_SCHEDULED_FAXES_ENABLED',
      'Process Scheduled Faxes.jsonc',
      10,
    ],
  ]) {
    const source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
    const handler = source.slice(source.lastIndexOf('Deno.serve'));
    assert.match(source, /<<<BEGIN SHARED HELPER: outboundDeliveryGate/);
    const outboundGate = handler.indexOf("if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('fax')");
    assert.ok(outboundGate >= 0, `${name} has the application-wide fax delivery gate`);
    assert.ok(outboundGate < handler.indexOf(`if (!${flag})`), `${name} checks the global gate first`);
    assert.match(source, new RegExp(`${envName.replaceAll('_', '\\_')}['"]\\) \\|\\| ''\\)\\.trim\\(\\) === 'enabled-v1'`));
    assert.ok(handler.indexOf(`if (!${flag})`) < handler.indexOf('createClientFromRequest(req)'));
    const workflow = JSON5.parse(await readFile(
      new URL(`../workflows/${workflowFile}`, import.meta.url),
      'utf8',
    ));
    assert.equal(workflow.definition?.do?.[0]?.run_function?.with?.function_name, name);
    assert.deepEqual(workflow.definition?.do?.[0]?.run_function?.with?.args, {});
    assert.equal(workflow.trigger?.config?.trigger_type, 'scheduled');
    assert.equal(workflow.trigger?.config?.schedule_mode, 'interval');
    assert.equal(workflow.trigger?.config?.interval_value, interval);
    assert.equal(workflow.trigger?.config?.interval_unit, 'minutes');
    await assert.rejects(
      readFile(new URL(`../functions/${name}/function.jsonc`, import.meta.url), 'utf8'),
      (error) => error?.code === 'ENOENT',
    );
  }
});

test('fax compatibility brokers gate delivery before invoking a sender or queue worker', async () => {
  for (const [name, invoked] of [
    ['retryFailedFax', 'sendAuthorizedReferralFax'],
    ['processScheduledFaxesByPriority', 'processScheduledFaxes'],
  ]) {
    const source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
    const handler = source.slice(source.lastIndexOf('Deno.serve'));
    assert.match(source, /<<<BEGIN SHARED HELPER: outboundDeliveryGate/);
    const outboundGate = handler.indexOf("if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('fax')");
    const invoke = handler.indexOf(`functions.invoke('${invoked}'`);
    assert.ok(outboundGate >= 0, `${name} has the application-wide fax delivery gate`);
    assert.ok(invoke > outboundGate, `${name} must not invoke ${invoked} while delivery is paused`);
    assert.ok(
      outboundGate > handler.indexOf('auth.me()'),
      `${name} preserves authentication before revealing the environment release state`,
    );
  }
});

test('automatic retry scan pages beyond the first 200 and queue deferrals are bounded', async () => {
  const {
    automaticRetryBackoff,
    deferAutomaticRetry,
    quarantineAutomaticRetry,
    loadDueAutomaticRetryRows,
  } = await loadInline('../functions/autoRetryFailedFaxes/entry.ts', [
    'automaticRetryBackoff',
    'deferAutomaticRetry',
    'quarantineAutomaticRetry',
    'loadDueAutomaticRetryRows',
  ]);

  assert.deepEqual(automaticRetryBackoff({}, NOW), {
    attempts: 1,
    exhausted: false,
    nextRetryAt: '2026-09-06T12:15:00.000Z',
  });
  assert.deepEqual(automaticRetryBackoff({ automatic_retry_queue_attempts: 99 }, NOW), {
    attempts: 12,
    exhausted: true,
    nextRetryAt: null,
  });

  const pages = [
    Array.from({ length: 200 }, (_, index) => ({
      id: `fax-${String(index).padStart(3, '0')}`,
      next_retry_at: '2026-09-06T10:00:00.000Z',
    })),
    [{ id: 'fax-200', next_retry_at: '2026-09-06T11:00:00.000Z' }],
  ];
  const queries = [];
  const scanned = await loadDueAutomaticRetryRows({ FaxLog: {
    filter: async (query) => {
      queries.push(structuredClone(query));
      return pages.shift() || [];
    },
  } }, '2026-09-06T12:00:00.000Z');
  assert.equal(scanned.length, 201);
  assert.deepEqual(queries[1].id, { $gt: 'fax-199' });

  const row = {
    id: 'fax-1',
    status: 'failed',
    next_retry_at: '2026-09-06T11:00:00.000Z',
    updated_date: '2026-09-06T11:30:00.000Z',
  };
  const updates = [];
  const entities = { FaxLog: { updateMany: async (filter, update) => {
    updates.push({ filter, update });
    return { success: true, updated: 1, has_more: false };
  } } };
  assert.equal(await deferAutomaticRetry(entities, row, 'retry_policy_read_failed', NOW), 'deferred');
  assert.equal(updates[0].update.$set.next_retry_at, '2026-09-06T12:15:00.000Z');
  assert.equal(await deferAutomaticRetry(entities, {
    ...row,
    automatic_retry_queue_attempts: 11,
  }, 'retry_policy_read_failed', NOW), 'quarantined');
  assert.equal(updates[1].update.$set.next_retry_at, null);
  assert.equal(updates[1].update.$set.automatic_retry_quarantined_at, '2026-09-06T12:00:00.000Z');
  assert.equal(await quarantineAutomaticRetry(entities, row, 'legacy_or_invalid_retry_provenance', NOW), true);
  assert.equal(updates[2].update.$set.next_retry_at, null);
  assert.equal(updates[2].update.$set.automatic_retry_quarantined_at, '2026-09-06T12:00:00.000Z');
});

test('scheduled queue backoff is bounded and incomplete stale evidence never requeues', async () => {
  const {
    scheduledDispatchBackoff,
    scheduledQueueStateIsDispatchable,
    scheduledOutcomeFromLogs,
    quarantineStaleScheduledClaim,
  } = await loadInline('../functions/processScheduledFaxes/entry.ts', [
    'scheduledDispatchBackoff',
    'scheduledQueueStateIsDispatchable',
    'scheduledOutcomeFromLogs',
    'quarantineStaleScheduledClaim',
  ]);

  assert.deepEqual(scheduledDispatchBackoff({}, NOW), {
    status: 'deferred', accepted: 0, failed: 0, unknown: 0,
    code: 'fax_configuration_unavailable',
    dispatchRetryCount: 1,
    nextDispatchAttemptAt: '2026-09-06T12:10:00.000Z',
  });
  assert.equal(scheduledDispatchBackoff({ dispatch_retry_count: 7 }, NOW).status, 'blocked');
  assert.equal(scheduledQueueStateIsDispatchable({ status: 'pending' }, NOW), true);
  assert.equal(scheduledQueueStateIsDispatchable({
    status: 'deferred', dispatch_retry_count: 1,
    next_dispatch_attempt_at: '2026-09-06T12:00:00.000Z',
  }, NOW), true);
  assert.equal(scheduledQueueStateIsDispatchable({
    status: 'deferred', dispatch_retry_count: 1,
    next_dispatch_attempt_at: '2026-09-06T12:01:00.000Z',
  }, NOW), false);

  const queueRow = { id: 'scheduled-1', to_numbers: ['+12155550111', '+12155550112'] };
  const outcome = await scheduledOutcomeFromLogs({ FaxLog: { filter: async () => [] } }, queueRow);
  assert.deepEqual(outcome, {
    status: 'needs_review', accepted: 0, failed: 0, unknown: 2,
    code: 'incomplete_dispatch_evidence',
  });

  const updates = [];
  assert.equal(await quarantineStaleScheduledClaim({ ScheduledFax: {
    updateMany: async (filter, update) => {
      updates.push({ filter, update });
      return { success: true, updated: 1, has_more: false };
    },
  } }, {
    ...queueRow,
    status: 'processing',
    updated_date: '2026-09-06T11:00:00.000Z',
  }, NOW), true);
  assert.equal(updates[0].update.$set.status, 'needs_review');
  assert.equal(updates[0].update.$set.last_error_code, 'legacy_or_invalid_processing_claim');
  assert.equal(updates[0].update.$set.dispatch_attempt_id, null);
});

test('fax queue schemas declare quarantine and deferred retry state', async () => {
  const faxLog = JSON5.parse(await readFile(new URL('../entities/FaxLog.jsonc', import.meta.url), 'utf8'));
  for (const field of [
    'automatic_retry_queue_attempts',
    'automatic_retry_last_error_code',
    'automatic_retry_quarantined_at',
    'status_poll_last_attempt_at',
    'status_poll_next_attempt_at',
    'status_poll_attempt_count',
    'status_poll_last_error_code',
    'status_poll_quarantined_at',
    'retry_recovery_quarantined_at',
    'retry_recovery_last_error_code',
    'retry_recovery_last_attempt_at',
    'retry_recovery_next_attempt_at',
    'notification_recovery_quarantined_at',
    'notification_recovery_last_error_code',
    'notification_recovery_last_attempt_at',
    'notification_recovery_next_attempt_at',
    'delivery_notify_publication_state',
    'failure_notify_publication_state',
  ]) assert.ok(faxLog.properties[field], field);
  for (const kind of ['delivery', 'failure']) {
    const publication = faxLog.properties[`${kind}_notify_publication_state`];
    assert.deepEqual(publication.enum, ['ready', 'started']);
    assert.equal(Object.hasOwn(publication, 'default'), false, 'legacy rows must never default to ready');
  }

  const scheduled = JSON5.parse(await readFile(
    new URL('../entities/ScheduledFax.jsonc', import.meta.url),
    'utf8',
  ));
  assert.ok(scheduled.properties.status.enum.includes('deferred'));
  for (const field of [
    'dispatch_retry_count',
    'next_dispatch_attempt_at',
    'last_dispatch_attempt_at',
  ]) assert.ok(scheduled.properties[field], field);
});

test('automatic policy lookup failures are isolated to one row and deferred', async () => {
  const source = await readFile(
    new URL('../functions/autoRetryFailedFaxes/entry.ts', import.meta.url),
    'utf8',
  );
  const handler = source.slice(source.lastIndexOf('Deno.serve'));
  assert.match(
    handler,
    /try\s*\{\s*loadedPolicy = await loadAutomaticRetryPolicy\([\s\S]*?\}\s*catch\s*\{[\s\S]*?retry_policy_read_failed/,
  );
});
