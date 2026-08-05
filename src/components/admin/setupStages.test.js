import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SETUP_STAGES,
  stageStatus,
  stageIdForAnchor,
  defaultExpandedStageIds,
} from './setupStages.js';

const steps = (map) => Object.entries(map).map(([id, status]) => ({ id, status }));

test('a stage is done only when every one of its steps is done', () => {
  const numbers = SETUP_STAGES.find((s) => s.id === 'numbers');
  const allDone = steps({ agency_config: 'done', provisioning: 'done', webhooks: 'done', live_test: 'done' });
  assert.equal(stageStatus(numbers, allDone), 'done');

  const oneTodo = steps({ agency_config: 'done', provisioning: 'todo', webhooks: 'done', live_test: 'done' });
  assert.equal(stageStatus(numbers, oneTodo), 'todo');
});

test('attention on any step wins over the rest being done', () => {
  const numbers = SETUP_STAGES.find((s) => s.id === 'numbers');
  const mixed = steps({ agency_config: 'attention', provisioning: 'done', webhooks: 'done', live_test: 'done' });
  assert.equal(stageStatus(numbers, mixed), 'attention');
});

test('a stage with no measurable steps is never reported done', () => {
  // Compliance has no automated check. Claiming "done" would tell the admin
  // A2P registration is handled when nothing verified it.
  const compliance = SETUP_STAGES.find((s) => s.id === 'compliance');
  assert.deepEqual(compliance.stepIds, []);
  assert.equal(stageStatus(compliance, steps({ api_secret: 'done' })), 'todo');
  assert.equal(stageStatus(compliance, []), 'todo');
});

test('unknown or missing steps do not fabricate completion', () => {
  const connect = SETUP_STAGES.find((s) => s.id === 'connect');
  assert.equal(stageStatus(connect, []), 'todo');
  assert.equal(stageStatus(connect, undefined), 'todo');
  assert.equal(stageStatus(connect, steps({ something_else: 'done' })), 'todo');
});

// The connect stage owns credential fields the checklist has no step for. The
// API key alone is not a working telephony setup: startMaskedCall refuses to
// dial without voice_connection_id, sendFax refuses to send without
// fax_connection_id, and inbound webhooks fail closed without the public key.
// Reporting "done" off api_secret alone would collapse the section and tell the
// admin telephony was configured while calls and faxes still could not go out.
const allConnectFlags = (value) =>
  Object.fromEntries(SETUP_STAGES.find((s) => s.id === 'connect').secretFlags.map((f) => [f, value]));

test('the connect stage stays open until its unstepped credentials are set too', () => {
  const connect = SETUP_STAGES.find((s) => s.id === 'connect');
  const apiKeyDone = steps({ api_secret: 'done' });

  assert.ok(connect.secretFlags.length > 0, 'connect must declare the fields it owns beyond api_secret');

  // API key stored, nothing else — the stage is not finished.
  assert.equal(stageStatus(connect, apiKeyDone, {}), 'attention');
  assert.equal(stageStatus(connect, apiKeyDone, undefined), 'attention');
  assert.equal(stageStatus(connect, apiKeyDone, allConnectFlags(false)), 'attention');

  // Every owned field set — now it may collapse.
  assert.equal(stageStatus(connect, apiKeyDone, allConnectFlags(true)), 'done');
});

test('a single missing connect credential is enough to hold the stage open', () => {
  const connect = SETUP_STAGES.find((s) => s.id === 'connect');
  const apiKeyDone = steps({ api_secret: 'done' });
  for (const flag of connect.secretFlags) {
    const status = { ...allConnectFlags(true), [flag]: false };
    assert.equal(stageStatus(connect, apiKeyDone, status), 'attention', `${flag} missing must not read as done`);
  }
});

test('every connect secretFlag is a field getTelnyxSecretStatus actually returns', () => {
  // The tests above build their fixture FROM secretFlags, so they pass for any
  // spelling — which is how the stage ended up reading `*_set` (saveTelnyxSecret's
  // save response) while TelnyxSetupProgress feeds it getTelnyxSecretStatus, whose
  // fields are `*_configured`. Every flag was undefined and the stage could never
  // reach "done". Pin the names to the endpoint that actually supplies them.
  const source = readFileSync(
    new URL('../../../base44/functions/getTelnyxSecretStatus/entry.ts', import.meta.url),
    'utf8',
  );
  const connect = SETUP_STAGES.find((s) => s.id === 'connect');
  for (const flag of connect.secretFlags) {
    assert.match(
      source,
      new RegExp(`\\b${flag}\\s*:`),
      `getTelnyxSecretStatus does not return "${flag}" — stageStatus would read undefined`,
    );
  }
});

test('secretFlags never override an unfinished step', () => {
  // Credentials present but the step itself not done still means not done —
  // the flags are an additional requirement, never a substitute.
  const connect = SETUP_STAGES.find((s) => s.id === 'connect');
  assert.equal(stageStatus(connect, steps({ api_secret: 'todo' }), allConnectFlags(true)), 'todo');
  assert.equal(stageStatus(connect, steps({ api_secret: 'attention' }), allConnectFlags(true)), 'attention');
});

test('a stage without secretFlags is unaffected by secretStatus', () => {
  const numbers = SETUP_STAGES.find((s) => s.id === 'numbers');
  assert.equal(numbers.secretFlags, undefined);
  const allDone = steps({ agency_config: 'done', provisioning: 'done', webhooks: 'done', live_test: 'done' });
  assert.equal(stageStatus(numbers, allDone, undefined), 'done');
  assert.equal(stageStatus(numbers, allDone, {}), 'done');
});

test('every anchor resolves to exactly one stage', () => {
  const seen = new Map();
  for (const stage of SETUP_STAGES) {
    for (const anchor of stage.anchors) {
      assert.ok(!seen.has(anchor), `anchor ${anchor} is claimed by two stages`);
      seen.set(anchor, stage.id);
      assert.equal(stageIdForAnchor(anchor), stage.id);
    }
  }
  assert.equal(stageIdForAnchor('not-a-real-anchor'), null);
  assert.equal(stageIdForAnchor(''), null);
  assert.equal(stageIdForAnchor(undefined), null);
});

test('every step id a stage claims is unique across stages', () => {
  const seen = new Set();
  for (const stage of SETUP_STAGES) {
    for (const id of stage.stepIds) {
      assert.ok(!seen.has(id), `step ${id} is claimed by two stages`);
      seen.add(id);
    }
  }
});

test('expanded-by-default opens the unfinished stages', () => {
  const nothingDone = [];
  assert.deepEqual(defaultExpandedStageIds(nothingDone), SETUP_STAGES.map((s) => s.id));

  const connectDone = steps({ api_secret: 'done' });
  // Only once the connection ids are stored as well does connect collapse.
  assert.ok(defaultExpandedStageIds(connectDone, allConnectFlags(false)).includes('connect'));
  assert.ok(!defaultExpandedStageIds(connectDone, allConnectFlags(true)).includes('connect'));
  assert.ok(defaultExpandedStageIds(connectDone, allConnectFlags(true)).includes('numbers'));
});

test('never collapses the whole page when everything is done', () => {
  // Compliance can't report done, so this is defensive — but a fully collapsed
  // page with no way in would be worse than a redundant open section.
  const all = steps({
    api_secret: 'done', agency_config: 'done', provisioning: 'done',
    webhooks: 'done', live_test: 'done',
  });
  const open = defaultExpandedStageIds(all, allConnectFlags(true));
  assert.ok(open.length >= 1);
});
