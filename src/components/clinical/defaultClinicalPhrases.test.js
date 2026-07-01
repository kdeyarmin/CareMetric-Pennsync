import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CLINICAL_PHRASES, phrasesToSeed } from './defaultClinicalPhrases.js';

const CATEGORIES = new Set([
  'education', 'assessment', 'intervention', 'wound_care',
  'medication', 'vital_signs', 'safety', 'communication', 'other',
]);

test('every default phrase is a well-formed, agency-wide generic template', () => {
  assert.ok(DEFAULT_CLINICAL_PHRASES.length > 0);
  for (const p of DEFAULT_CLINICAL_PHRASES) {
    assert.equal(typeof p.phrase, 'string');
    assert.equal(p.phrase, p.phrase.toLowerCase().trim(), `phrase "${p.phrase}" must be normalized`);
    assert.ok(CATEGORIES.has(p.category), `category "${p.category}" must be a valid enum value`);
    assert.equal(p.template_type, 'generic');
    assert.equal(p.is_agency_wide, true);
    assert.ok(p.expanded_text && p.expanded_text.length > 40, `expanded_text for "${p.phrase}" too short`);
  }
});

test('default phrase triggers are unique', () => {
  const keys = DEFAULT_CLINICAL_PHRASES.map((p) => p.phrase);
  assert.equal(new Set(keys).size, keys.length);
});

test('phrasesToSeed returns all defaults when the library is empty', () => {
  assert.equal(phrasesToSeed([]).length, DEFAULT_CLINICAL_PHRASES.length);
  assert.equal(phrasesToSeed().length, DEFAULT_CLINICAL_PHRASES.length);
});

test('phrasesToSeed is idempotent — skips phrases already present (case-insensitive)', () => {
  const existing = [{ phrase: 'Diabetic Education' }, { phrase: 'fall risk assessment' }];
  const missing = phrasesToSeed(existing);
  assert.ok(!missing.some((p) => p.phrase === 'diabetic education'));
  assert.ok(!missing.some((p) => p.phrase === 'fall risk assessment'));
  assert.equal(missing.length, DEFAULT_CLINICAL_PHRASES.length - 2);
  // Seeding again after all are present yields nothing.
  assert.equal(phrasesToSeed(DEFAULT_CLINICAL_PHRASES).length, 0);
});
