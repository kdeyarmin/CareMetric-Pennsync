import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(stageStatus(connect, steps({ api_secret: 'done' })), 'done');
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
  assert.ok(!defaultExpandedStageIds(connectDone).includes('connect'));
  assert.ok(defaultExpandedStageIds(connectDone).includes('numbers'));
});

test('never collapses the whole page when everything is done', () => {
  // Compliance can't report done, so this is defensive — but a fully collapsed
  // page with no way in would be worse than a redundant open section.
  const all = steps({
    api_secret: 'done', agency_config: 'done', provisioning: 'done',
    webhooks: 'done', live_test: 'done',
  });
  const open = defaultExpandedStageIds(all);
  assert.ok(open.length >= 1);
});
