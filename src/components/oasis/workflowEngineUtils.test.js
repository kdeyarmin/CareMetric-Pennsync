import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveActionTypes, evaluateRuleTrigger } from './workflowEngineUtils.js';

test('deriveActionTypes prefers action_config.actions when present', () => {
  const actionTypes = deriveActionTypes({
    action_type: 'create_task',
    action_config: { actions: ['create_alert', 'notify_clinician'] }
  });

  assert.deepEqual(actionTypes, ['create_alert', 'notify_clinician']);
});

test('deriveActionTypes falls back to single action_type', () => {
  const actionTypes = deriveActionTypes({ action_type: 'flag_for_review' });
  assert.deepEqual(actionTypes, ['flag_for_review']);
});

test('evaluateRuleTrigger flags compliance issues below threshold', () => {
  const result = evaluateRuleTrigger(
    {
      trigger_type: 'compliance_issue',
      trigger_conditions: { score_value: 90 }
    },
    {
      compliance_score: 81,
      compliance_concerns: ['A', 'B', 'C', 'D']
    }
  );

  assert.equal(result.triggered, true);
  assert.match(result.reason, /Compliance score/);
  assert.equal(result.context.concerns.length, 3);
});

test('evaluateRuleTrigger supports pdgm discrepancy when pdgm data exists', () => {
  const result = evaluateRuleTrigger(
    { trigger_type: 'pdgm_discrepancy' },
    { revenue_tips: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    { clinical_group: 'MMTA' }
  );

  assert.equal(result.triggered, true);
  assert.equal(result.context.clinical_group, 'MMTA');
  assert.equal(result.context.revenue_tips.length, 2);
});

test('deriveActionTypes returns empty array when no actions configured', () => {
  const actionTypes = deriveActionTypes({});
  assert.deepEqual(actionTypes, []);
});

test('evaluateRuleTrigger supports score_threshold greater_than checks', () => {
  const result = evaluateRuleTrigger(
    {
      trigger_type: 'score_threshold',
      trigger_conditions: {
        score_type: 'overall',
        score_operator: 'greater_than',
        score_value: 90
      }
    },
    { overall_score: 95, compliance_score: 80, accuracy_score: 88 }
  );

  assert.equal(result.triggered, true);
  assert.equal(result.context.score, 95);
});
