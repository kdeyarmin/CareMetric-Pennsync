import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOasisReadinessChecklist, groupReadinessItemsByCategory } from './oasisReadinessChecklist.js';

const completeAssessment = {
  patient_name: 'Jane Patient',
  assessment_type: 'SOC',
  soc_date: '2026-07-01',
  assessment_date: '2026-07-02',
  admission_source: 'institutional',
  episode_timing: 'early',
  primary_diagnosis_code: 'I50.9',
  primary_diagnosis: 'Heart failure',
  functional_scores: {
    m1800_grooming: 1,
    m1810_dress_upper: 1,
    m1820_dress_lower: 2,
    m1830_bathing: 3,
    m1840_toilet_transfer: 1,
    m1850_transferring: 2,
    m1860_ambulation: 3,
  },
  review_status: 'approved',
};

test('buildOasisReadinessChecklist marks a complete reviewed assessment ready', () => {
  const checklist = buildOasisReadinessChecklist(completeAssessment, { quality_score: 92 });
  assert.equal(checklist.summary.status, 'ready');
  assert.equal(checklist.summary.blockingItems, 0);
  assert.equal(checklist.summary.readinessScore, 100);
  assert.ok(checklist.items.every((item) => item.status === 'complete'));
});

test('buildOasisReadinessChecklist blocks submission for missing required OASIS data', () => {
  const checklist = buildOasisReadinessChecklist({ assessment_type: 'SOC' }, { quality_score: 70 });
  assert.equal(checklist.summary.status, 'blocked');
  assert.ok(checklist.summary.blockingItems >= 5);
  assert.ok(checklist.items.some((item) => item.id === 'primary-diagnosis' && item.blocksSubmission));
  assert.ok(checklist.items.some((item) => item.id === 'functional-items-complete' && item.blocksSubmission));
});

test('buildOasisReadinessChecklist catches invalid dates and function scores', () => {
  const checklist = buildOasisReadinessChecklist({
    ...completeAssessment,
    assessment_date: '2026-06-30',
    functional_scores: { ...completeAssessment.functional_scores, m1830_bathing: 8 },
  }, { quality_score: 90 });
  assert.equal(checklist.summary.status, 'blocked');
  assert.ok(checklist.items.some((item) => item.id === 'assessment-not-before-soc' && item.blocksSubmission));
  assert.ok(checklist.items.some((item) => item.id === 'functional-items-valid' && item.blocksSubmission));
});

test('buildOasisReadinessChecklist requires reviewer attestation', () => {
  const checklist = buildOasisReadinessChecklist({
    ...completeAssessment,
    review_status: '',
    reviewer_attested: false,
  }, { quality_score: 92 });
  assert.equal(checklist.summary.status, 'blocked');
  assert.ok(checklist.items.some((item) => item.id === 'reviewer-attestation' && item.blocksSubmission));
});

test('groupReadinessItemsByCategory preserves category buckets', () => {
  const checklist = buildOasisReadinessChecklist(completeAssessment, { quality_score: 92 });
  const groups = groupReadinessItemsByCategory(checklist.items);
  assert.ok(groups.length >= 5);
  assert.ok(groups.some((group) => group.category === 'Functional scoring'));
});
