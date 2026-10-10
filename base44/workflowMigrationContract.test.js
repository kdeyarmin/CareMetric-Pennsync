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
    releaseState: 'paused_workflow',
    releaseEnv: 'WORKFLOW_RELEASE_AUTO_RETRY_FAILED_FAXES',
    releaseConst: 'AUTO_RETRY_FAILED_FAXES_ENABLED',
  },
  'Check Stale Follow-Up Requests.jsonc': {
    target: 'checkStaleFollowUpRequests',
    schedule: { mode: 'recurring', cron: '0 12 * * *' },
    releaseState: 'paused_workflow',
    releaseEnv: 'WORKFLOW_RELEASE_CHECK_STALE_FOLLOW_UP_REQUESTS',
    releaseConst: 'STALE_FOLLOW_UP_WORKFLOW_ENABLED',
  },
  // Added 2026-10-08 when the owner released the documentation-compliance
  // monitor. It scans each active agency separately under the scheduler auth
  // helper (built-in admin or INTERNAL_FN_SECRET), writes deduplicated
  // PatientAlert rows and never writes a Patient row or a risk score.
  'Daily Compliance Documentation Monitor.jsonc': {
    target: 'monitorComplianceRisks',
    schedule: { mode: 'recurring', cron: '15 6 * * *' },
    releaseState: 'live',
  },
  // Added 2026-10-08 when the owner released data-quality scoring. It runs
  // each active agency separately under the scheduler auth helper (built-in
  // admin or INTERNAL_FN_SECRET); the legacy "Daily Data Quality Score
  // Update" automation stays quarantined and is not this workflow.
  'Daily Data Quality Scores.jsonc': {
    target: 'calculateDataQualityScores',
    schedule: { mode: 'recurring', cron: '30 5 * * *' },
    releaseState: 'live',
  },
  // Released 2026-10-08 with the e-signature product (owner decision). The
  // dispatcher is gated by the shared OUTBOUND_DELIVERY_RELEASE and by its own
  // scheduler authorization; the hourly housekeeping sweep sends no email.
  'Dispatch Scheduled Signature Reminders.jsonc': {
    target: 'dispatchScheduledSignatureReminders',
    schedule: { mode: 'interval', value: 15, unit: 'minutes' },
    releaseState: 'live',
  },
  'Check Pending Signature Requests.jsonc': {
    target: 'checkPendingSignatureRequests',
    schedule: { mode: 'interval', value: 60, unit: 'minutes' },
    releaseState: 'live',
  },
  // Added 2026-10-08 when the owner released scheduled texting. It has no
  // workflow-specific release key: the dispatcher is gated by the shared
  // OUTBOUND_DELIVERY_RELEASE and by the scheduler auth helper.
  'Dispatch Scheduled SMS.jsonc': {
    target: 'dispatchScheduledSms',
    schedule: { mode: 'interval', value: 5, unit: 'minutes' },
    releaseState: 'live',
  },
  'Nightly Outcome Measure Computation.jsonc': {
    target: 'dispatchNightlyOutcomeMeasures',
    legacyTarget: 'computeOutcomeMeasures',
    schedule: { mode: 'recurring', cron: '0 6 * * *' },
    // Released 2026-10-08: runs by default; OUTCOME_PIPELINE_RELEASE=paused
    // is the operator's kill switch.
    releaseState: 'live_outcome_dispatch',
  },
  // 15 minutes since 2026-10-10 (was 5): every run bills Base44 credits even
  // when idle, and this is only the safety net behind the Telnyx webhook (missed
  // updates, stale retry claims, unpublished terminal notifications).
  'Poll Fax Statuses.jsonc': {
    target: 'pollFaxStatuses',
    schedule: { mode: 'interval', value: 15, unit: 'minutes' },
    releaseState: 'paused_workflow',
    releaseEnv: 'WORKFLOW_RELEASE_POLL_FAX_STATUSES',
    releaseConst: 'FAX_POLL_RELEASE_ENV',
    releaseGuard: 'if (Deno.env.get(FAX_POLL_RELEASE_ENV) !== FAX_POLL_RELEASE_VALUE)',
  },
  'Process Inbound Referral Faxes.jsonc': {
    target: 'processInboundFaxes',
    schedule: { mode: 'recurring', cron: '*/10 * * * *' },
    releaseState: 'paused_workflow',
    releaseEnv: 'WORKFLOW_RELEASE_PROCESS_INBOUND_FAXES',
    releaseConst: 'INBOUND_FAX_WORKFLOW_ENABLED',
  },
  'Process Scheduled Faxes.jsonc': {
    target: 'processScheduledFaxes',
    schedule: { mode: 'interval', value: 10, unit: 'minutes' },
    releaseState: 'paused_workflow',
    releaseEnv: 'WORKFLOW_RELEASE_PROCESS_SCHEDULED_FAXES',
    releaseConst: 'PROCESS_SCHEDULED_FAXES_ENABLED',
  },
  // Added 2026-10-08 when the owner released SMS redrive. Like the scheduled
  // SMS dispatcher it has no workflow-specific release key: it is gated by the
  // shared OUTBOUND_DELIVERY_RELEASE and by the scheduler auth helper, and it
  // re-proves every row's line, sender and consent before a re-send.
  'Redrive Failed SMS.jsonc': {
    target: 'redriveFailedSms',
    schedule: { mode: 'interval', value: 10, unit: 'minutes' },
    releaseState: 'live',
  },
  // Added 2026-10-09 with inbound MMS. The webhook records each attachment as
  // pending (Telnyx retries a webhook not answered in ~2 s, so it downloads
  // nothing); this copies it into private storage under the scheduler auth
  // helper. It sends nothing, so it has no delivery release key.
  'Copy Inbound SMS Media.jsonc': {
    target: 'copyInboundSmsMedia',
    schedule: { mode: 'interval', value: 5, unit: 'minutes' },
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
  const clientIndex = source.indexOf('createClientFromRequest(');
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

  if (expected.releaseState === 'paused_workflow') {
    const envIndex = source.indexOf(expected.releaseEnv);
    const markerIndex = source.indexOf(expected.releaseConst);
    const handlerIndex = source.indexOf('Deno.serve');
    const guardIndex = source.indexOf(
      expected.releaseGuard || `if (!${expected.releaseConst})`,
      handlerIndex,
    );
    assert.notEqual(envIndex, -1, `${file} must retain its reviewed release environment key`);
    assert.notEqual(markerIndex, -1, `${file} must retain its explicit release marker`);
    assert.notEqual(handlerIndex, -1, `${file} target must expose a handler`);
    assert.notEqual(guardIndex, -1, `${file} must guard the handler with its release marker`);
    assert.notEqual(clientIndex, -1, `${file} target must retain its dormant implementation`);
    assert.ok(markerIndex < handlerIndex && handlerIndex < guardIndex && guardIndex < clientIndex,
      `${file} must fail closed before SDK construction`);
    assert.match(source.slice(guardIndex, clientIndex), /status:\s*503/,
      `${file} release guard must return HTTP 503`);
    assert.match(source.slice(markerIndex, handlerIndex), /enabled-v1/,
      `${file} must require the exact reviewed release value`);
    return;
  }

  if (expected.releaseState === 'live_outcome_dispatch') {
    // Live by default: the only gate left is the operator's explicit pause,
    // and it still answers before any SDK construction.
    const gateIndex = source.indexOf('const OUTCOME_DISPATCH_ENABLED =');
    const handlerIndex = source.indexOf('Deno.serve');
    const guardIndex = source.indexOf('if (!OUTCOME_DISPATCH_ENABLED())', handlerIndex);
    assert.notEqual(gateIndex, -1, `${file} must keep its operator kill switch`);
    assert.match(source.slice(gateIndex, gateIndex + 200), /!== 'paused'/,
      `${file} must run unless explicitly paused`);
    assert.ok(gateIndex < handlerIndex && handlerIndex < guardIndex && guardIndex < clientIndex,
      `${file} operator pause must answer before SDK construction`);
    assert.match(source.slice(guardIndex, clientIndex), /status:\s*503/);
    return;
  }

  const marker = 'const FAX_TRANSMISSION_MIGRATION_PAUSED = true;';
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
    await assert.rejects(
      access(new URL(`${expected.target}/function.jsonc`, FUNCTIONS_URL)),
      (error) => error?.code === 'ENOENT',
      `${file} must be authoritative; legacy function automation metadata must stay absent`,
    );
    const source = await readFile(entryUrl, 'utf8');
    assertHandlerReleaseState(source, expected, file);

    if (expected.releaseState === 'live_outcome_dispatch') {
      assert.equal(
        workflow['x-base44-migrated-from-automation']?.replacement_dispatch_function,
        expected.target,
      );
      assert.equal(
        workflow['x-base44-migrated-from-automation']?.release_state,
        'live_operator_pausable',
      );
      assert.match(source, /loadScheduledAgencyIds/);
      assert.match(source, /createOutcomeDispatchProof/);
      assert.match(source, /idempotency_key:\s*`nightly-outcome-daily:/);
      assert.match(source, /functions\.invoke\(\s*'computeOutcomeMeasuresV2'/);
      // The legacy name is now the membership-checked on-demand door to the
      // same worker: it never runs a schedule and never computes itself.
      const legacySource = await readFile(new URL(`${expected.legacyTarget}/entry.ts`, FUNCTIONS_URL), 'utf8');
      assert.match(legacySource, /createOutcomeDispatchProof/);
      assert.match(legacySource, /functions\.invoke\(\s*'computeOutcomeMeasuresV2'/);
      assert.doesNotMatch(legacySource, /PatientOutcomeMetric|AgencyKPI\.(?:create|update)/);
      const workerSource = await readFile(
        new URL('computeOutcomeMeasuresV2/entry.ts', FUNCTIONS_URL),
        'utf8',
      );
      assert.match(workerSource, /agency_id is required; platform-wide outcome computation is not supported/);
      assert.match(workerSource, /period_start and period_end/);
      assert.match(workerSource, /idempotency_key is required/);
      assert.match(workerSource, /verifyOutcomeDispatchProof/);
    }
  }
});
