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

test('a reviewer name alone is not attestation', () => {
  // Regression: reviewer_name is who is ASSIGNED, not proof of review — it
  // used to satisfy the attestation check even with review_status "rejected".
  const checklist = buildOasisReadinessChecklist({
    ...completeAssessment,
    review_status: '',
    reviewer_name: 'Pat Reviewer RN',
  }, { quality_score: 92 });
  assert.ok(checklist.items.some((item) => item.id === 'reviewer-attestation' && item.blocksSubmission));
});

test('a rejected review never passes attestation, even with reviewer_attested set', () => {
  const checklist = buildOasisReadinessChecklist({
    ...completeAssessment,
    review_status: 'rejected',
    reviewer_attested: true,
    reviewer_name: 'Pat Reviewer RN',
  }, { quality_score: 92 });
  assert.ok(checklist.items.some((item) => item.id === 'reviewer-attestation' && item.blocksSubmission));
});

test('explicit reviewer_attested passes attestation without a status', () => {
  const checklist = buildOasisReadinessChecklist({
    ...completeAssessment,
    review_status: '',
    reviewer_attested: true,
  }, { quality_score: 92 });
  assert.ok(checklist.items.some((item) => item.id === 'reviewer-attestation' && item.status === 'complete'));
});

test('non-integer or trailing-garbage functional values fail validation', () => {
  // Regression: parseInt truncated "3.7" → 3 and "6abc" → 6, passing values
  // that are not valid OASIS responses.
  for (const bad of ['3.7', '6abc']) {
    const checklist = buildOasisReadinessChecklist({
      ...completeAssessment,
      functional_scores: { ...completeAssessment.functional_scores, m1830_bathing: bad },
    }, { quality_score: 92 });
    assert.ok(
      checklist.items.some((item) => item.id === 'functional-items-valid' && item.blocksSubmission),
      `expected "${bad}" to fail functional validation`,
    );
  }
});

test('date-only strings compare on local calendar dates (same-day assessment passes)', () => {
  const checklist = buildOasisReadinessChecklist({
    ...completeAssessment,
    soc_date: '2026-07-02',
    assessment_date: '7/2/2026', // US format parses local; ISO used to parse UTC
  }, { quality_score: 92 });
  assert.ok(checklist.items.some((item) => item.id === 'assessment-not-before-soc' && item.status === 'complete'));
});

test('groupReadinessItemsByCategory preserves category buckets', () => {
  const checklist = buildOasisReadinessChecklist(completeAssessment, { quality_score: 92 });
  const groups = groupReadinessItemsByCategory(checklist.items);
  assert.ok(groups.length >= 5);
  assert.ok(groups.some((group) => group.category === 'Functional scoring'));
});
