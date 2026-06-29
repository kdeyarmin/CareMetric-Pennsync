import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determineClinicalGroup, identifyComorbidities } from './pdgmClinicalGroup.js';

test('determineClinicalGroup: maps orthopedic dx to Musculoskeletal Rehab (MMTA-01)', () => {
  const r = determineClinicalGroup('Status post right knee replacement', ['hip fracture']);
  assert.equal(r.group, 'MMTA-01');
  assert.equal(r.name, 'Musculoskeletal Rehabilitation');
  // 2 patterns (knee replacement, fracture) + keyword hits => >=4 => high
  assert.equal(r.confidence, 'high');
  assert.ok(r.matchedPatterns.length > 0);
});

test('determineClinicalGroup: maps stroke to Neuro Rehab (MMTA-02)', () => {
  const r = determineClinicalGroup('CVA with left hemiplegia');
  assert.equal(r.group, 'MMTA-02');
});

test('determineClinicalGroup: maps wound/ulcer to Wounds (MMTA-03)', () => {
  const r = determineClinicalGroup('Stage 3 pressure injury', ['surgical wound dehiscence']);
  assert.equal(r.group, 'MMTA-03');
});

test('determineClinicalGroup: defaults to MMTA-05 with low confidence when nothing matches', () => {
  const r = determineClinicalGroup('Routine wellness visit');
  assert.equal(r.group, 'MMTA-05');
  assert.equal(r.confidence, 'low');
  assert.deepEqual(r.matchedPatterns, []);
});

test('determineClinicalGroup: tolerates empty/undefined inputs', () => {
  const r = determineClinicalGroup(undefined, undefined);
  assert.equal(r.group, 'MMTA-05');
  assert.equal(r.confidence, 'low');
});

test('determineClinicalGroup: a lone keyword (no pattern) match scores 1 -> low confidence', () => {
  // "HTN" is an MMTA-05 keyword with no corresponding regex pattern (the pattern
  // is /hypertension/), so it exercises the keyword-only score=1 branch — proven
  // by the keyword appearing in matchedPatterns rather than the empty default.
  const r = determineClinicalGroup('HTN');
  assert.equal(r.group, 'MMTA-05');
  assert.equal(r.confidence, 'low');
  assert.ok(r.matchedPatterns.includes('HTN'));
});

test('identifyComorbidities: a single high-impact comorbidity yields a high adjustment', () => {
  const r = identifyComorbidities('Congestive heart failure', [], '');
  assert.equal(r.adjustment, 'high');
  assert.equal(r.high.length, 1);
  assert.equal(r.high[0].name, 'Heart Failure');
  assert.equal(r.count, 1);
});

test('identifyComorbidities: two low-impact comorbidities yield a low adjustment', () => {
  const r = identifyComorbidities('Hypertension', ['atrial fibrillation'], '');
  assert.equal(r.adjustment, 'low');
  assert.equal(r.low.length, 2);
  assert.equal(r.high.length, 0);
});

test('identifyComorbidities: a single low-impact comorbidity is not enough (none)', () => {
  const r = identifyComorbidities('Hypertension', [], '');
  assert.equal(r.adjustment, 'none');
  assert.equal(r.low.length, 1);
});

test('identifyComorbidities: bare "OA" shorthand is detected as osteoarthritis', () => {
  // Previously the pattern required a trailing space (/oa /), so a dx of exactly
  // "OA" was missed and under-counted the comorbidity tier.
  const r = identifyComorbidities('Hypertension', ['OA'], '');
  assert.equal(r.low.length, 2);
  assert.equal(r.adjustment, 'low');
  // And it must not over-match "oa" inside other words.
  const r2 = identifyComorbidities('Hypertension', ['Oahu trip noted'], '');
  assert.equal(r2.low.length, 1);
});

test('identifyComorbidities: high adjustment takes precedence over multiple low ones', () => {
  const r = identifyComorbidities('COPD', ['hypertension', 'osteoarthritis'], '');
  assert.equal(r.adjustment, 'high');
  assert.ok(r.high.length >= 1);
});

test('identifyComorbidities: scans the narrative text, not just diagnoses', () => {
  const r = identifyComorbidities('General weakness', [], 'History significant for chronic kidney disease (CKD).');
  assert.equal(r.adjustment, 'high');
  assert.equal(r.high[0].name, 'Chronic Kidney Disease');
});

test('identifyComorbidities: each comorbidity is counted once even with multiple matching patterns', () => {
  // "heart failure" and "chf" both match Heart Failure, but it should count once.
  const r = identifyComorbidities('Congestive heart failure (CHF)', [], '');
  assert.equal(r.high.length, 1);
  assert.equal(r.count, 1);
});

test('identifyComorbidities: complicated diabetes counts once (high), not in both tiers', () => {
  // "Type 2 diabetes mellitus with diabetic neuropathy" matches BOTH the
  // high-tier "Diabetes with Complications" and the low-tier
  // "Diabetes (uncomplicated)". The diabetes family is mutually exclusive, so it
  // must be counted exactly once, in the high tier.
  const r = identifyComorbidities('Type 2 diabetes mellitus with diabetic neuropathy', [], '');
  assert.equal(r.high.length, 1);
  assert.equal(r.high[0].name, 'Diabetes with Complications');
  assert.equal(r.low.length, 0);
  assert.equal(r.count, 1);
  assert.equal(r.adjustment, 'high');
});

test('identifyComorbidities: returns empty result for no matches', () => {
  const r = identifyComorbidities('Routine visit', [], '');
  assert.deepEqual(r, { high: [], low: [], count: 0, adjustment: 'none' });
});
