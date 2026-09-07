import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import JSON5 from 'json5';

const WORKFLOWS_URL = new URL('./workflows/', import.meta.url);
const FUNCTIONS_URL = new URL('./functions/', import.meta.url);

const EXPECTED = {
  'Auto Retry Failed Faxes.jsonc': {
    target: 'autoRetryFailedFaxes',
    schedule: { mode: 'interval', value: 15, unit: 'minutes' },
    releaseState: 'live',
  },
  'Check Stale Follow-Up Requests.jsonc': {
    target: 'checkStaleFollowUpRequests',
    schedule: { mode: 'recurring', cron: '0 12 * * *' },
    releaseState: 'live',
  },
  'Dispatch Scheduled Signature Reminders.jsonc': {
    target: 'dispatchScheduledSignatureReminders',
    schedule: { mode: 'interval', value: 15, unit: 'minutes' },
    releaseState: 'paused_signature',
  },
  'Nightly Outcome Measure Computation.jsonc': {
    target: 'dispatchNightlyOutcomeMeasures',
    legacyTarget: 'computeOutcomeMeasures',
    schedule: { mode: 'recurring', cron: '0 6 * * *' },
    releaseState: 'paused_outcome_dispatch',
  },
  'Poll Fax Statuses.jsonc': {
    target: 'pollFaxStatuses',
    schedule: { mode: 'interval', value: 5, unit: 'minutes' },
    releaseState: 'live',
  },
  'Process Inbound Referral Faxes.jsonc': {
    target: 'processInboundFaxes',
    schedule: { mode: 'recurring', cron: '*/10 * * * *' },
    releaseState: 'live',
  },
  'Process Scheduled Faxes.jsonc': {
    target: 'processScheduledFaxes',
    schedule: { mode: 'interval', value: 10, unit: 'minutes' },
    releaseState: 'live',
  },
};

function assertSchedule(config, expected, file) {
  assert.equal(config.trigger_type, 'scheduled', `${file} must remain scheduled`);
  assert.equal(config.schedule_mode, expected.mode, `${file} schedule mode drifted`);
  if (expected.mode === 'recurring') {
    assert.equal(config.cron_expression, expected.cron, `${file} cron drifted`);
    assert.equal(config.interval_value, null, `${file} must not mix cron and interval fields`);
    assert.equal(config.interval_unit, null, `${file} must not mix cron and interval fields`);
    return;
  }
  assert.equal(config.cron_expression, null, `${file} must not mix interval and cron fields`);
  assert.equal(config.interval_value, expected.value, `${file} interval drifted`);
  assert.equal(config.interval_unit, expected.unit, `${file} interval unit drifted`);
  assert.ok(
    typeof config.interval_anchor === 'string' && Number.isFinite(Date.parse(config.interval_anchor)),
    `${file} needs a valid interval anchor`,
  );
}

function assertHandlerReleaseState(source, expected, file) {
  const clientIndex = source.indexOf('createClientFromRequest(req)');
  if (expected.releaseState === 'live') {
    assert.match(source, /Deno\.serve\s*\(/, `${file} target must expose a handler`);
    assert.notEqual(clientIndex, -1, `${file} target must construct the Base44 client`);
    assert.doesNotMatch(
      source.slice(0, clientIndex),
      /(?:MIGRATION_PAUSED|COMPUTATION_ENABLED)\s*=\s*(?:true|false)/,
      `${file} live target unexpectedly gained a static release pause`,
    );
    return;
  }

  if (expected.releaseState === 'paused_signature') {
    const markerIndex = source.indexOf('const SIGNATURE_REMINDER_DISPATCH_ENABLED = false;');
    const handlerIndex = source.indexOf('Deno.serve(async (req) =>');
    const guardIndex = source.indexOf('if (!SIGNATURE_REMINDER_DISPATCH_ENABLED)', handlerIndex);
    assert.match(source, /Signature reminders are temporarily unavailable/);
    assert.match(source, /status:\s*503/);
    assert.notEqual(markerIndex, -1, `${file} must retain its explicit inactive marker`);
    assert.notEqual(clientIndex, -1, `${file} must retain its dormant reviewed implementation`);
    assert.ok(markerIndex < handlerIndex && handlerIndex < guardIndex && guardIndex < clientIndex,
      `${file} must pause before SDK construction`);
    return;
  }

  const marker = expected.releaseState === 'paused_outcome_dispatch'
    ? 'const OUTCOME_DISPATCH_ENABLED ='
    : 'const FAX_TRANSMISSION_MIGRATION_PAUSED = true;';
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${file} target must retain its fail-closed marker`);
  assert.notEqual(clientIndex, -1, `${file} target must retain its dormant implementation`);
  assert.ok(markerIndex < clientIndex, `${file} target must pause before SDK construction`);
  assert.match(source.slice(markerIndex, clientIndex), /status:\s*503/);
}

test('migrated Base44 workflows preserve exact schedules, targets, and release containment', async () => {
  const files = (await readdir(WORKFLOWS_URL))
    .filter((name) => name.endsWith('.jsonc'))
    .sort();
  assert.deepEqual(files, Object.keys(EXPECTED).sort(), 'every workflow must be reviewed in this contract');

  const workflowNames = new Set();
  const documentNames = new Set();
  for (const file of files) {
    const expected = EXPECTED[file];
    const workflow = JSON5.parse(await readFile(new URL(file, WORKFLOWS_URL), 'utf8'));
    assert.equal(workflow.name, file.replace(/\.jsonc$/, ''), `${file} name must match its filename`);
    assert.equal(workflow.trigger?.condition, null, `${file} must not hide an unreviewed condition`);
    assertSchedule(workflow.trigger?.config || {}, expected.schedule, file);

    assert.ok(!workflowNames.has(workflow.name), `${file} workflow name must be unique`);
    workflowNames.add(workflow.name);

    const documentName = workflow.definition?.document?.name;
    assert.match(documentName || '', /^[a-z][a-z0-9_]*$/, `${file} document name is invalid`);
    assert.ok(!documentNames.has(documentName), `${file} document name must be unique`);
    documentNames.add(documentName);
    assert.equal(workflow.definition?.document?.dsl, '1.0.0');
    assert.equal(workflow.definition?.document?.namespace, 'base44');

    const steps = workflow.definition?.do;
    assert.equal(steps?.length, 1, `${file} must have one reviewed function step`);
    const action = steps[0]?.run_function;
    assert.equal(action?.call, 'invoke_backend_function');
    assert.equal(action?.with?.function_name, expected.target, `${file} target drifted`);
    assert.deepEqual(action?.with?.args, {}, `${file} must not acquire unreviewed static arguments`);
    assert.equal(action?.then, 'end');
    assert.equal(
      workflow['x-base44-migrated-from-automation']?.legacy_payload_function,
      expected.legacyTarget || expected.target,
      `${file} migration provenance must match its target`,
    );

    const entryUrl = new URL(`${expected.target}/entry.ts`, FUNCTIONS_URL);
    await access(entryUrl);
    const source = await readFile(entryUrl, 'utf8');
    assertHandlerReleaseState(source, expected, file);

    if (expected.releaseState === 'paused_outcome_dispatch') {
      assert.equal(
        workflow['x-base44-migrated-from-automation']?.replacement_dispatch_function,
        expected.target,
      );
      assert.equal(
        workflow['x-base44-migrated-from-automation']?.release_state,
        'inactive_pending_hosted_outcome_validation',
      );
      assert.match(source, /loadScheduledAgencyIds/);
      assert.match(source, /createOutcomeDispatchProof/);
      assert.match(source, /idempotency_key:\s*`nightly-outcome-daily:/);
      const workerSource = await readFile(
        new URL(`${expected.legacyTarget}/entry.ts`, FUNCTIONS_URL),
        'utf8',
      );
      assert.match(workerSource, /agency_id is required; platform-wide outcome computation is not supported/);
      assert.match(workerSource, /period_start and period_end/);
      assert.match(workerSource, /idempotency_key is required/);
      assert.match(workerSource, /verifyOutcomeDispatchProof/);
    }
  }
});
