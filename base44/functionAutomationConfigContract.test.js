import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import JSON5 from 'json5';

const WORKFLOWS_URL = new URL('./workflows/', import.meta.url);
const FUNCTIONS_URL = new URL('./functions/', import.meta.url);

function assertEquivalentSchedule(legacy, automation, file) {
  assert.equal(automation.type, 'scheduled', `${file} must deploy as a scheduled automation`);
  assert.equal(automation.schedule_mode, 'recurring', `${file} must remain recurring`);
  assert.equal(automation.ends_type, 'never', `${file} must not acquire an unreviewed end date`);

  if (legacy.schedule_mode === 'interval') {
    assert.equal(automation.schedule_type, 'simple', `${file} interval must use a CLI-native simple schedule`);
    assert.equal(automation.repeat_interval, legacy.interval_value, `${file} interval value drifted`);
    assert.equal(automation.repeat_unit, legacy.interval_unit, `${file} interval unit drifted`);
    return;
  }

  if (automation.schedule_type === 'cron') {
    assert.equal(automation.cron_expression, legacy.cron_expression, `${file} cron expression drifted`);
    return;
  }

  const dailyCron = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(legacy.cron_expression || '');
  assert.ok(dailyCron, `${file} non-daily cron must remain a cron deployment schedule`);
  assert.equal(automation.schedule_type, 'simple', `${file} daily schedule type is invalid`);
  assert.equal(automation.repeat_interval, 1, `${file} daily interval drifted`);
  assert.equal(automation.repeat_unit, 'days', `${file} daily unit drifted`);
  const expectedTime = `${dailyCron[2].padStart(2, '0')}:${dailyCron[1].padStart(2, '0')}`;
  assert.equal(automation.start_time, expectedTime, `${file} daily start time drifted`);
}

test('every migrated workflow has an equivalent CLI-deployable function automation', async () => {
  const files = (await readdir(WORKFLOWS_URL))
    .filter((name) => name.endsWith('.jsonc'))
    .sort();

  assert.ok(files.length > 0, 'expected migrated workflow definitions');
  const deployedAutomationNames = new Set();

  for (const file of files) {
    const workflow = JSON5.parse(await readFile(new URL(file, WORKFLOWS_URL), 'utf8'));
    const target = workflow.definition?.do?.[0]?.run_function?.with?.function_name;
    assert.match(target || '', /^[A-Za-z][A-Za-z0-9]*$/, `${file} has an invalid target`);

    const configUrl = new URL(`${target}/function.jsonc`, FUNCTIONS_URL);
    await access(configUrl);
    const config = JSON5.parse(await readFile(configUrl, 'utf8'));
    assert.equal(config.name, target, `${file} deploy config targets the wrong function`);
    assert.equal(config.entry, 'entry.ts', `${file} deploy config must use entry.ts`);

    const matching = (config.automations || []).filter((automation) => automation.name === workflow.name);
    assert.equal(matching.length, 1, `${file} needs exactly one CLI-deployable automation`);
    const automation = matching[0];
    assert.ok(
      !deployedAutomationNames.has(automation.name),
      `${file} duplicates a deployed automation name`,
    );
    deployedAutomationNames.add(automation.name);
    assert.deepEqual(automation.function_args, {}, `${file} scheduler payload must be an explicit empty object`);
    assert.equal(
      automation.is_active,
      false,
      `${file} automation must remain explicitly inactive pending hosted validation`,
    );
    assertEquivalentSchedule(workflow.trigger?.config || {}, automation, file);
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

test('unattended fax dispatch remains explicitly inactive pending hosted single-winner proof', async () => {
  for (const name of ['autoRetryFailedFaxes', 'processScheduledFaxes']) {
    const config = JSON5.parse(await readFile(
      new URL(`${name}/function.jsonc`, FUNCTIONS_URL),
      'utf8',
    ));
    assert.equal(config.automations?.length, 1, `${name} must retain one stable automation identity`);
    assert.deepEqual(config.automations[0].function_args, {}, `${name} must not receive scheduler secrets`);
    assert.equal(config.automations[0].is_active, false, `${name} must remain staged inactive`);
  }
});
