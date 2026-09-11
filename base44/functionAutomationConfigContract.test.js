import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import JSON5 from 'json5';

const WORKFLOWS_URL = new URL('./workflows/', import.meta.url);
const FUNCTIONS_URL = new URL('./functions/', import.meta.url);

const EXPECTED_TARGETS = {
  'Auto Retry Failed Faxes.jsonc': 'autoRetryFailedFaxes',
  'Check Stale Follow-Up Requests.jsonc': 'checkStaleFollowUpRequests',
  'Dispatch Scheduled Signature Reminders.jsonc': 'dispatchScheduledSignatureReminders',
  'Nightly Outcome Measure Computation.jsonc': 'dispatchNightlyOutcomeMeasures',
  'Poll Fax Statuses.jsonc': 'pollFaxStatuses',
  'Process Inbound Referral Faxes.jsonc': 'processInboundFaxes',
  'Process Scheduled Faxes.jsonc': 'processScheduledFaxes',
};

test('native workflows are the sole schedule authority and legacy function configs stay absent', async () => {
  const files = (await readdir(WORKFLOWS_URL))
    .filter((name) => name.endsWith('.jsonc'))
    .sort();

  assert.deepEqual(files, Object.keys(EXPECTED_TARGETS).sort());

  for (const file of files) {
    const workflow = JSON5.parse(await readFile(new URL(file, WORKFLOWS_URL), 'utf8'));
    const target = workflow.definition?.do?.[0]?.run_function?.with?.function_name;
    assert.equal(target, EXPECTED_TARGETS[file], `${file} target drifted`);
    assert.deepEqual(
      workflow.definition?.do?.[0]?.run_function?.with?.args,
      {},
      `${file} scheduler payload must remain empty`,
    );
    await access(new URL(`${target}/entry.ts`, FUNCTIONS_URL));
    await assert.rejects(
      access(new URL(`${target}/function.jsonc`, FUNCTIONS_URL)),
      (error) => error?.code === 'ENOENT',
      `${file} must not be duplicated by legacy function automation metadata`,
    );
  }
});

test('the per-agency outcome worker explicitly clears its obsolete scheduler', async () => {
  const configUrl = new URL('computeOutcomeMeasures/function.jsonc', FUNCTIONS_URL);
  const config = JSON5.parse(await readFile(configUrl, 'utf8'));
  assert.deepEqual(
    config.automations,
    [],
    'computeOutcomeMeasures must explicitly remove the old unscoped automation during deployment',
  );
});

test('the retired outcome endpoint cannot access the SDK or regain an unscoped schedule', async () => {
  const legacy = await readFile(new URL('computeOutcomeMeasures/entry.ts', FUNCTIONS_URL), 'utf8');
  assert.doesNotMatch(legacy, /createClientFromRequest|\.entities\.|\.functions\.invoke/);
  assert.match(legacy, /status: 503/);
  const config = JSON5.parse(await readFile(new URL('computeOutcomeMeasuresV2/function.jsonc', FUNCTIONS_URL), 'utf8'));
  assert.equal(config.name, 'computeOutcomeMeasuresV2');
  assert.deepEqual(config.automations, []);
});
