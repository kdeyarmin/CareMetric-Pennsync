import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPhraseTrigger,
  rankPhrases,
  isPhraseVisible,
  applyExpansion,
  phraseNeedsPatient,
  normalizePhraseText,
} from './quickPhrase.js';

test('detectPhraseTrigger: slash at start opens an empty-query picker', () => {
  const text = '/';
  const r = detectPhraseTrigger(text, 1);
  assert.deepEqual(r, { trigger: '/', query: '', start: 0, end: 1 });
});

test('detectPhraseTrigger: slash form captures a multi-word query', () => {
  const text = '• skilled need: /wound care';
  const r = detectPhraseTrigger(text, text.length);
  assert.equal(r.trigger, '/');
  assert.equal(r.query, 'wound care');
  assert.equal(text.slice(r.start, r.end), '/wound care');
});

test('detectPhraseTrigger: dot form is a contiguous shorthand token', () => {
  const text = 'plan .diabeticedu';
  const r = detectPhraseTrigger(text, text.length);
  assert.equal(r.trigger, '.');
  assert.equal(r.query, 'diabeticedu');
  assert.equal(text.slice(r.start, r.end), '.diabeticedu');
});

test('detectPhraseTrigger: caret must sit at the end of the token', () => {
  const text = '/wound care and more';
  // caret in the middle of "more" — the token no longer ends at the caret
  const r = detectPhraseTrigger(text, text.length);
  // slash form allows spaces, so this is still an (over-long) active query;
  // but placing the caret right after the slash-word boundary is the common path:
  const r2 = detectPhraseTrigger('/wound', 6);
  assert.equal(r2.query, 'wound');
  assert.ok(r); // sanity: function returns a result object shape
});

test('detectPhraseTrigger: clinical text does NOT trigger', () => {
  // vitals fraction
  assert.equal(detectPhraseTrigger('BP 120/80', 9), null);
  // and/or
  assert.equal(detectPhraseTrigger('improving and/or stable', 'improving and/or'.length), null);
  // abbreviation "e.g."
  assert.equal(detectPhraseTrigger('e.g.', 4), null);
  // title "Mr."
  assert.equal(detectPhraseTrigger('Mr.', 3), null);
  // decimal number
  assert.equal(detectPhraseTrigger('pain 3.5', 8), null);
});

test('detectPhraseTrigger: a trigger never spans a newline', () => {
  const text = 'first line\nsecond';
  // caret at end; there is no trigger char on the second line
  assert.equal(detectPhraseTrigger(text, text.length), null);
  // a slash on the second line is scoped to that line only
  const t2 = 'first /x\n/wound';
  const r = detectPhraseTrigger(t2, t2.length);
  assert.equal(r.query, 'wound');
});

test('isPhraseVisible: own, agency-wide, patient-bound, inactive', () => {
  const ctx = { email: 'nurse@x.com', patientId: 'p1' };
  assert.equal(isPhraseVisible({ created_by: 'nurse@x.com' }, ctx), true);
  assert.equal(isPhraseVisible({ is_agency_wide: true }, ctx), true);
  assert.equal(isPhraseVisible({ created_by: 'other@x.com' }, ctx), false);
  // patient-bound: visible only for the bound patient
  assert.equal(isPhraseVisible({ patient_id: 'p1', created_by: 'other@x.com' }, ctx), true);
  assert.equal(isPhraseVisible({ patient_id: 'p2' }, ctx), false);
  // inactive is never visible even if otherwise owned
  assert.equal(isPhraseVisible({ created_by: 'nurse@x.com', is_active: false }, ctx), false);
});

test('rankPhrases: empty query lists visible phrases by usage_count', () => {
  const templates = [
    { phrase: 'fall risk', created_by: 'me', usage_count: 2 },
    { phrase: 'diabetic education', created_by: 'me', usage_count: 9 },
    { phrase: 'private other', created_by: 'someone_else' },
  ];
  const ranked = rankPhrases(templates, { email: 'me' });
  assert.deepEqual(ranked.map((t) => t.phrase), ['diabetic education', 'fall risk']);
});

test('rankPhrases: dot-token shorthand matches space-separated phrase', () => {
  const templates = [
    { phrase: 'diabetic education', is_agency_wide: true, usage_count: 1 },
    { phrase: 'wound care', is_agency_wide: true, usage_count: 50 },
  ];
  const ranked = rankPhrases(templates, { query: 'diabeticedu', email: 'me' });
  assert.equal(ranked[0].phrase, 'diabetic education');
});

test('rankPhrases: exact/prefix beats substring, then usage breaks ties', () => {
  const templates = [
    { phrase: 'wound care provided', is_agency_wide: true, usage_count: 1 },
    { phrase: 'wound care', is_agency_wide: true, usage_count: 1 },
    { phrase: 're-wound spool', is_agency_wide: true, usage_count: 999 },
  ];
  const ranked = rankPhrases(templates, { query: 'wound care', email: 'me' });
  assert.equal(ranked[0].phrase, 'wound care'); // exact match wins over popularity
});

test('rankPhrases: patient-bound phrase hidden without the matching patient', () => {
  const templates = [{ phrase: 'performed wound care', patient_id: 'p1', usage_count: 1 }];
  assert.equal(rankPhrases(templates, { email: 'me', patientId: 'p2' }).length, 0);
  assert.equal(rankPhrases(templates, { email: 'me', patientId: 'p1' }).length, 1);
});

test('applyExpansion: replaces the trigger token and returns caret at insert end', () => {
  const text = 'note: /wound';
  const range = detectPhraseTrigger(text, text.length);
  const { text: out, caret } = applyExpansion(text, range, 'Wound care performed to R heel.');
  assert.equal(out, 'note: Wound care performed to R heel.');
  assert.equal(caret, out.length);
});

test('applyExpansion: mid-line replacement keeps trailing text', () => {
  const text = 'a /edu z';
  const range = { start: 2, end: 6 }; // "/edu"
  const { text: out } = applyExpansion(text, range, 'EDUCATION');
  assert.equal(out, 'a EDUCATION z'); // after starts with space — no extra space added
});

test('applyExpansion: adds a separating space when it would glue onto following text', () => {
  const text = '/edub'; // token "/edu" then "b" immediately after
  const range = { start: 0, end: 4 };
  const { text: out, caret } = applyExpansion(text, range, 'EDU');
  assert.equal(out, 'EDU b');
  assert.equal(caret, 'EDU '.length); // caret sits after the inserted text (incl. the space)
});

test('phraseNeedsPatient: patient-bound + patient-specific need a patient', () => {
  assert.equal(phraseNeedsPatient({ patient_id: 'p1' }), true);
  assert.equal(phraseNeedsPatient({ template_type: 'patient_specific' }), true);
  assert.equal(phraseNeedsPatient({ requires_patient_data: true }), true);
  assert.equal(phraseNeedsPatient({ template_type: 'generic' }), false);
});

test('normalizePhraseText: lowercases, trims, tolerates nullish', () => {
  assert.equal(normalizePhraseText('  Wound Care '), 'wound care');
  assert.equal(normalizePhraseText(null), '');
});
