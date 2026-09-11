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
    const outboundGate = handler.indexOf("if (!faxWorkflowDeliveryReleased()) return outboundDeliveryPausedResponse('fax')");
    assert.ok(outboundGate >= 0, `${name} has the dedicated fax workflow delivery gate`);
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
      status: 'failed',
      next_retry_at: '2026-09-06T10:00:00.000Z',
    })),
    [{ id: 'fax-200', status: 'failed', next_retry_at: '2026-09-06T11:00:00.000Z' }],
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
  assert.equal(scheduledQueueStateIsDispatchable({ status: 'pending', dispatch_submission_state: 'ready' }, NOW), true);
  assert.equal(scheduledQueueStateIsDispatchable({
    status: 'deferred', dispatch_submission_state: 'ready', dispatch_retry_count: 1,
    next_dispatch_attempt_at: '2026-09-06T12:00:00.000Z',
  }, NOW), true);
  assert.equal(scheduledQueueStateIsDispatchable({
    status: 'deferred', dispatch_submission_state: 'ready', dispatch_retry_count: 1,
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


async function loadQueueHandler(name, client) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = () => globalThis.__faxQueueClient;');
  const file = join(tmpdir(), `queue_runtime_${crypto.randomUUID()}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  globalThis.__faxQueueClient = client;
  globalThis.Deno = {
    serve: (value) => { handler = value; },
    env: { get: (key) => key === 'INTERNAL_FN_SECRET' ? SECRET :
      ['OUTBOUND_FAX_WORKFLOW_RELEASE', 'WORKFLOW_RELEASE_AUTO_RETRY_FAILED_FAXES',
        'WORKFLOW_RELEASE_PROCESS_SCHEDULED_FAXES'].includes(key) ? 'enabled-v1' : undefined },
  };
  try { await import(pathToFileURL(file).href); }
  finally { await unlink(file); }
  return handler;
}

const queueRequest = () => new Request('https://app.test/worker', {
  method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
});

function queueClient(entities) {
  return { auth: { me: async () => ({ id: 'admin', role: 'admin', is_active: true }) },
    asServiceRole: { entities, functions: { invoke: async () => { throw new Error('Unexpected dispatch'); } } } };
}

test('fax workflow release leaves unrelated delivery closed', async () => {
  const previous = globalThis.Deno;
  globalThis.Deno = { serve() {}, env: { get: (key) => key === 'OUTBOUND_FAX_WORKFLOW_RELEASE' ? 'enabled-v1' : undefined } };
  try {
    const { faxWorkflowDeliveryReleased, outboundDeliveryReleased } = await loadInline(
      '../functions/sendBatchFax/entry.ts', ['faxWorkflowDeliveryReleased', 'outboundDeliveryReleased'],
    );
    assert.equal(faxWorkflowDeliveryReleased(), true);
    assert.equal(outboundDeliveryReleased(), false);
  } finally { globalThis.Deno = previous; }
});

test('scheduled malformed identity never reaches a broad conditional update', async () => {
  const updates = [];
  const handler = await loadQueueHandler('processScheduledFaxes', queueClient({ ScheduledFax: {
    filter: async (query) => query.status === 'pending' ? [{ status: 'pending', updated_date: new Date().toISOString() }] : [],
    updateMany: async (...args) => { updates.push(args); return { success: true, updated: 1, has_more: false }; },
  } }));
  const response = await handler(queueRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).queue_errors, 1);
  assert.equal(updates.length, 0);
});

test('scheduled quarantine write failures fail the workflow instead of disappearing', async () => {
  const handler = await loadQueueHandler('processScheduledFaxes', queueClient({ ScheduledFax: {
    filter: async (query) => query.status === 'pending' ? [{ id: 'schedule-1', status: 'pending', updated_date: new Date().toISOString() }] : [],
    updateMany: async () => { throw new Error('Storage unavailable'); },
  } }));
  const response = await handler(queueRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).queue_errors, 1);
});

test('automatic retry quarantine failures fail the workflow instead of successful skips', async () => {
  const handler = await loadQueueHandler('autoRetryFailedFaxes', queueClient({ FaxLog: {
    filter: async () => [{ id: 'fax-1', status: 'failed', next_retry_at: '2026-01-01T00:00:00.000Z', updated_date: '2026-01-01T00:00:00.000Z' }],
    updateMany: async () => { throw new Error('Storage unavailable'); },
  } }));
  const response = await handler(queueRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).queue_errors, 1);
});

test('empty fax queues finish successfully without provider calls', async () => {
  for (const name of ['processScheduledFaxes', 'autoRetryFailedFaxes']) {
    const handler = await loadQueueHandler(name, queueClient({
      ScheduledFax: { filter: async () => [] }, FaxLog: { filter: async () => [] },
    }));
    const response = await handler(queueRequest());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
  }
});

test('parent submission fence excludes concurrent internal capability replays', async () => {
  const { claimQueueSubmission } = await loadInline('../functions/sendBatchFax/entry.ts', ['claimQueueSubmission']);
  for (const [entityName, stateField, claimField] of [
    ['ScheduledFax', 'dispatch_submission_state', 'claimed_by'],
    ['FaxLog', 'retry_submission_state', 'retry_claimed_by'],
  ]) {
    const row = { id: 'parent', agency_id: 'agency-1', status: 'processing',
      updated_date: '2026-09-01T00:00:00.000Z', [stateField]: 'ready', [claimField]: 'claim-1' };
    const snapshot = structuredClone(row);
    const entities = { [entityName]: {
      updateMany: async (query, update) => {
        const matches = Object.entries(query).every(([key, value]) => row[key] === value);
        if (matches) Object.assign(row, update.$set);
        return { success: true, updated: matches ? 1 : 0, has_more: false };
      },
      filter: async () => [structuredClone(row)],
    } };
    const results = await Promise.all([1, 2].map(() =>
      claimQueueSubmission(entities, entityName, snapshot, stateField, claimField, 'claim-1')));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await claimQueueSubmission(entities, entityName, row, stateField, claimField, 'claim-1'), false);
    delete row[stateField];
    assert.equal(await claimQueueSubmission(entities, entityName, row, stateField, claimField, 'claim-1'), false);
  }
});

test('uncertain parent submission acknowledgement never grants another provider attempt', async () => {
  const { claimQueueSubmission } = await loadInline('../functions/sendBatchFax/entry.ts', ['claimQueueSubmission']);
  const row = { id: 'parent', agency_id: 'agency-1', status: 'processing',
    updated_date: '2026-09-01T00:00:00.000Z', dispatch_submission_state: 'ready', claimed_by: 'claim-1' };
  const entities = { ScheduledFax: {
    updateMany: async (_query, update) => { Object.assign(row, update.$set); return { updated: 1 }; },
    filter: async () => [structuredClone(row)],
  } };
  assert.equal(await claimQueueSubmission(entities, 'ScheduledFax', row, 'dispatch_submission_state', 'claimed_by', 'claim-1'), false);
  assert.equal(row.dispatch_submission_state, 'started');
  assert.equal(await claimQueueSubmission(entities, 'ScheduledFax', row, 'dispatch_submission_state', 'claimed_by', 'claim-1'), false);
});


test('existing Agency reservations serialize new queue records and retain uncertain creates', async () => {
  const { reserveFaxQueueCreation, releaseFaxQueueCreation } = await loadInline(
    '../functions/sendBatchFax/entry.ts', ['reserveFaxQueueCreation', 'releaseFaxQueueCreation'],
  );
  for (const initial of [{}, { fax_workflow_reservations: null }, { fax_workflow_reservations: {} }]) {
    const agency = { id: 'agency-1', status: 'active', updated_date: '2026-09-01T00:00:00.000Z', ...initial };
    let revision = 0;
    const entities = { Agency: {
      filter: async () => [structuredClone(agency)],
      updateMany: async (query, update) => {
        const matches = Object.entries(query).every(([key, value]) => (
          value?.$exists === false ? !Object.hasOwn(agency, key)
            : JSON.stringify(agency[key]) === JSON.stringify(value)
        ));
        if (matches) Object.assign(agency, update.$set, { updated_date: new Date(NOW + ++revision).toISOString() });
        return { success: true, updated: matches ? 1 : 0, has_more: false };
      },
    } };
    const results = await Promise.all([1, 2].map(() => reserveFaxQueueCreation(entities, 'agency-1', 'inbound', 'provider-1')));
    assert.equal(results.filter(Boolean).length, 1);
    const reservation = results.find(Boolean);
    // A lost create response leaves the same key reserved until exact recovery.
    assert.equal(await reserveFaxQueueCreation(entities, 'agency-1', 'inbound', 'provider-1'), null);
    const other = await reserveFaxQueueCreation(entities, 'agency-1', 'inbound', 'provider-2');
    assert.ok(other, 'one uncertain create does not block a different fax');
    assert.equal(await releaseFaxQueueCreation(entities, { ...reservation, token: 'wrong' }), false);
    assert.equal(await releaseFaxQueueCreation(entities, reservation), true);
    assert.equal(agency.fax_workflow_reservations[other.key], other.token);
    assert.ok(await reserveFaxQueueCreation(entities, 'agency-1', 'inbound', 'provider-1'));
  }
});


test('reservation release survives unrelated writes and lost acknowledgements without dropping another key', async () => {
  const { reserveFaxQueueCreation, releaseRecoveredFaxQueueCreation } = await loadInline(
    '../functions/sendBatchFax/entry.ts', ['reserveFaxQueueCreation', 'releaseRecoveredFaxQueueCreation']);
  for (const failure of ['conflict', 'lost_ack']) {
    const agency = { id: 'agency-1', status: 'active', updated_date: new Date(NOW).toISOString() };
    let injected = false;
    let releaseMode = false;
    const entities = { Agency: {
      filter: async () => [structuredClone(agency)],
      updateMany: async (query, update) => {
        if (releaseMode && !injected) {
          injected = true;
          if (failure === 'conflict') {
            agency.fax_workflow_reservations.other_key = 'other-token';
            agency.updated_date = new Date(NOW + 10).toISOString();
            return { success: true, updated: 0, has_more: false };
          }
          Object.assign(agency, update.$set);
          throw new Error('Response lost after commit');
        }
        const matches = Object.entries(query).every(([key, value]) => value?.$exists === false
          ? !Object.hasOwn(agency, key) : JSON.stringify(agency[key]) === JSON.stringify(value));
        if (matches) Object.assign(agency, update.$set);
        return { success: true, updated: matches ? 1 : 0, has_more: false };
      },
    } };
    const held = await reserveFaxQueueCreation(entities, agency.id, 'inbound', 'provider-1');
    releaseMode = true;
    assert.equal(await releaseRecoveredFaxQueueCreation(entities, agency.id, 'inbound', 'provider-1', {
      queue_creation_reservation_token: held.token,
    }), true);
    assert.equal(agency.fax_workflow_reservations[held.key], undefined);
    if (failure === 'conflict') assert.equal(agency.fax_workflow_reservations.other_key, 'other-token');
  }
});

test('scheduled workers reject absent or consumed producer submission permission', async () => {
  const { scheduledQueueStateIsDispatchable } = await loadInline(
    '../functions/processScheduledFaxes/entry.ts', ['scheduledQueueStateIsDispatchable']);
  for (const state of [undefined, null, 'started', 'completed']) {
    assert.equal(scheduledQueueStateIsDispatchable({ status: 'pending', dispatch_submission_state: state }, NOW), false);
  }
});
