import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  soundex,
  levenshtein,
  similarity,
  normalizeName,
  normalizeAddress,
  digitsOnly,
  parseDob,
  scorePatientPair,
  buildVisitsByPatient,
  relatedEntityScore,
  confidenceFromScore,
  confidencePercent,
  effectiveThreshold,
  findDuplicateGroups,
  findDuplicatesForCandidate,
  REASON,
} from './patientDuplicateUtils.js';

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

test('soundex codes similar-sounding names the same', () => {
  assert.equal(soundex('Robert'), soundex('Rupert'));
  assert.equal(soundex('Smith'), soundex('Smyth'));
  assert.equal(soundex(''), '');
  assert.equal(soundex(null), '');
});

test('soundex applies the standard H/W coalescing rule (reference codes)', () => {
  // Classic reference values. The H/W rule means two consonants with the same
  // code separated only by H or W collapse to one digit, while vowels reset it.
  assert.equal(soundex('Robert'), 'R163');
  assert.equal(soundex('Rupert'), 'R163');
  assert.equal(soundex('Ashcraft'), 'A261'); // sh-c coalesced via H -> not A226
  assert.equal(soundex('Ashcroft'), 'A261');
  assert.equal(soundex('Tymczak'), 'T522');
  assert.equal(soundex('Pfister'), 'P236');
});

test('levenshtein measures edit distance', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('similarity is case-insensitive and 0-100', () => {
  assert.equal(similarity('John', 'JOHN'), 100);
  assert.equal(similarity('', 'John'), 0);
  assert.ok(similarity('Jon', 'John') > 70);
});

test('normalizeName strips punctuation and collapses whitespace', () => {
  assert.equal(normalizeName('  Mary-Jane,  '), 'maryjane');
  assert.equal(normalizeName("O'Brien"), 'obrien');
});

test('normalizeName folds accented letters to ASCII instead of deleting them', () => {
  // Regression: diacritics were stripped (José -> "jos"), so accented spellings
  // failed to match their ASCII equivalents in exact/full-name scoring.
  assert.equal(normalizeName('José'), 'jose');
  assert.equal(normalizeName('Zoë Brontë'), 'zoe bronte');
  assert.equal(normalizeName('José'), normalizeName('Jose'));
});

test('normalizeAddress removes street types and units', () => {
  assert.equal(normalizeAddress('123 Main Street Apt 4'), '123 main');
  assert.equal(normalizeAddress('123 Main St'), '123 main');
});

test('digitsOnly extracts digits', () => {
  assert.equal(digitsOnly('(215) 555-1234'), '2155551234');
  assert.equal(digitsOnly(null), '');
});

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

test('parseDob handles ISO, US and 8-digit formats', () => {
  assert.deepEqual(parseDob('1945-03-07'), { year: '1945', month: '03', day: '07' });
  assert.deepEqual(parseDob('3/7/1945'), { year: '1945', month: '03', day: '07' });
  assert.deepEqual(parseDob('19450307'), { year: '1945', month: '03', day: '07' });
  assert.deepEqual(parseDob('03071945'), { year: '1945', month: '03', day: '07' });
  assert.equal(parseDob(''), null);
  assert.equal(parseDob('garbage'), null);
});

// ---------------------------------------------------------------------------
// Pairwise scoring
// ---------------------------------------------------------------------------

const base = {
  id: 'x',
  first_name: 'John',
  last_name: 'Smith',
  date_of_birth: '1950-01-15',
  medical_record_number: 'MRN-100',
  phone: '(215) 555-1234',
  email: 'john@example.com',
  address: '123 Main Street, Philadelphia 19103',
};

test('identical patients score very high and flag strong identifiers', () => {
  const { score, matches } = scorePatientPair(base, { ...base, id: 'y' });
  assert.ok(score >= 100, `expected high score, got ${score}`);
  assert.ok(matches.includes(REASON.EXACT_NAME));
  assert.ok(matches.includes(REASON.MRN));
  assert.ok(matches.includes(REASON.DOB));
});

test('scoring is symmetric', () => {
  const a = { ...base, id: 'a' };
  const b = { ...base, id: 'b', phone: '215-555-1234', email: 'JOHN@example.com' };
  assert.equal(scorePatientPair(a, b).score, scorePatientPair(b, a).score);
});

test('exact name match is not double-counted by name variations', () => {
  const a = { id: 'a', first_name: 'John', last_name: 'Smith' };
  const b = { id: 'b', first_name: 'John', last_name: 'Smith' };
  const { matches } = scorePatientPair(a, b);
  assert.ok(matches.includes(REASON.EXACT_NAME));
  assert.ok(!matches.includes(REASON.NAME_VARIATION));
});

test('reversed month/day DOB is detected', () => {
  const a = { id: 'a', first_name: 'A', last_name: 'B', date_of_birth: '1950-03-07' };
  const b = { id: 'b', first_name: 'A', last_name: 'B', date_of_birth: '1950-07-03' };
  const { matches } = scorePatientPair(a, b);
  assert.ok(matches.includes(REASON.DOB_SWAPPED));
  assert.ok(!matches.includes(REASON.DOB));
});

test('year-typo DOB is detected', () => {
  const a = { id: 'a', first_name: 'A', last_name: 'B', date_of_birth: '1950-03-07' };
  const b = { id: 'b', first_name: 'A', last_name: 'B', date_of_birth: '1951-03-07' };
  assert.ok(scorePatientPair(a, b).matches.includes(REASON.DOB_YEAR_TYPO));
});

test('phone formats normalize and match exactly', () => {
  const a = { id: 'a', phone: '(215) 555-1234' };
  const b = { id: 'b', phone: '215.555.1234' };
  assert.ok(scorePatientPair(a, b).matches.includes(REASON.PHONE));
});

test('clearly different patients stay below threshold', () => {
  const a = {
    id: 'a',
    first_name: 'Alice',
    last_name: 'Anderson',
    date_of_birth: '1970-05-05',
    medical_record_number: 'AAA-1',
    phone: '215-111-1111',
    email: 'alice@a.com',
    address: '1 First Ave, Pittsburgh 15201',
  };
  const b = {
    id: 'b',
    first_name: 'Robert',
    last_name: 'Zimmerman',
    date_of_birth: '1988-12-30',
    medical_record_number: 'ZZZ-9',
    phone: '412-999-9999',
    email: 'bob@z.com',
    address: '999 Last Blvd, Erie 16501',
  };
  const { score } = scorePatientPair(a, b);
  assert.ok(score < effectiveThreshold([]), `expected no match, got ${score}`);
});

test('MRN match alone clears the (lowered) threshold', () => {
  const a = { id: 'a', first_name: 'John', last_name: 'Smith', medical_record_number: '555' };
  const b = { id: 'b', first_name: 'Jon', last_name: 'Smith', medical_record_number: '555' };
  const { score, matches } = scorePatientPair(a, b);
  assert.ok(matches.includes(REASON.MRN));
  assert.ok(score >= effectiveThreshold(matches));
});

// ---------------------------------------------------------------------------
// Confidence helpers
// ---------------------------------------------------------------------------

test('confidence buckets', () => {
  assert.equal(confidenceFromScore(80), 'high');
  assert.equal(confidenceFromScore(55), 'medium');
  assert.equal(confidenceFromScore(40), 'low');
});

test('confidencePercent never exceeds 100', () => {
  assert.equal(confidencePercent(165), 100);
  assert.equal(confidencePercent(42.6), 43);
  assert.equal(confidencePercent(-5), 0);
});

test('effectiveThreshold drops for strong identifiers', () => {
  assert.equal(effectiveThreshold([]), 35);
  assert.equal(effectiveThreshold([REASON.MRN]), 25);
  assert.equal(effectiveThreshold([REASON.EXACT_NAME]), 25);
  assert.equal(effectiveThreshold([REASON.PARTIAL_NAME]), 35);
});

// ---------------------------------------------------------------------------
// Visit corroboration
// ---------------------------------------------------------------------------

test('buildVisitsByPatient groups visits and ignores invalid entries', () => {
  const map = buildVisitsByPatient([
    { patient_id: 'p1', visit_date: '2024-01-01' },
    { patient_id: 'p1', visit_date: '2024-01-02' },
    { patient_id: 'p2', visit_date: '2024-01-01' },
    null,
    { visit_date: '2024-01-03' },
  ]);
  assert.equal(map.get('p1').length, 2);
  assert.equal(map.get('p2').length, 1);
});

test('relatedEntityScore rewards shared visit dates and nurses', () => {
  const map = buildVisitsByPatient([
    { patient_id: 'p1', visit_date: '2024-01-01', created_by: 'nurse@x.com' },
    { patient_id: 'p2', visit_date: '2024-01-01', created_by: 'nurse@x.com' },
  ]);
  const { score, matches } = relatedEntityScore({ id: 'p1' }, { id: 'p2' }, map);
  assert.ok(score > 0);
  assert.ok(matches.some((m) => m.includes('matching visit date')));
  assert.ok(matches.includes('Same nurse documentation'));
});

test('relatedEntityScore is safe with no visit map', () => {
  assert.deepEqual(relatedEntityScore({ id: 'a' }, { id: 'b' }, null), {
    score: 0,
    matches: [],
  });
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

test('findDuplicateGroups clusters duplicates and claims each patient once', () => {
  const patients = [
    { id: '1', first_name: 'John', last_name: 'Smith', medical_record_number: 'A1' },
    { id: '2', first_name: 'John', last_name: 'Smith', medical_record_number: 'A1' },
    { id: '3', first_name: 'John', last_name: 'Smith', medical_record_number: 'A1' },
    { id: '4', first_name: 'Jane', last_name: 'Doe', medical_record_number: 'B2' },
  ];
  const groups = findDuplicateGroups(patients);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.id, '1');
  assert.equal(groups[0].duplicates.length, 2);

  // No patient appears in more than one place.
  const seen = new Set();
  for (const g of groups) {
    seen.add(g.primary.id);
    for (const d of g.duplicates) {
      assert.ok(!seen.has(d.patient.id));
      seen.add(d.patient.id);
    }
  }
});

test('findDuplicateGroups is deterministic across runs', () => {
  const patients = [
    { id: '1', first_name: 'Bill', last_name: 'Jones', date_of_birth: '1960-02-02', phone: '215-555-0001' },
    { id: '2', first_name: 'Bill', last_name: 'Jones', date_of_birth: '1960-02-02', phone: '215-555-0001' },
    { id: '3', first_name: 'Sue', last_name: 'Park', date_of_birth: '1972-09-09' },
  ];
  const a = JSON.stringify(findDuplicateGroups(patients));
  const b = JSON.stringify(findDuplicateGroups(patients));
  assert.equal(a, b);
});

test('findDuplicateGroups returns [] when there are no duplicates', () => {
  const patients = [
    { id: '1', first_name: 'Alice', last_name: 'Anderson', date_of_birth: '1970-05-05' },
    { id: '2', first_name: 'Robert', last_name: 'Zimmerman', date_of_birth: '1988-12-30' },
  ];
  assert.deepEqual(findDuplicateGroups(patients), []);
});

test('scorePatientPair signals can disable a signal group', () => {
  const a = { id: 'a', first_name: 'John', last_name: 'Smith', medical_record_number: '555' };
  const b = { id: 'b', first_name: 'Different', last_name: 'Person', medical_record_number: '555' };

  // MRN enabled (default) -> matches.
  assert.ok(scorePatientPair(a, b).matches.includes(REASON.MRN));

  // MRN disabled -> the only shared signal is gone, so no match.
  const { score, matches } = scorePatientPair(a, b, { signals: { mrn: false } });
  assert.ok(!matches.includes(REASON.MRN));
  assert.equal(score, 0);
});

test('findDuplicateGroups respects minScore floor and scoreOptions', () => {
  // These two records match ONLY on MRN (names are entirely different).
  const patients = [
    { id: '1', first_name: 'Aaron', last_name: 'Adams', medical_record_number: 'X1' },
    { id: '2', first_name: 'Chloe', last_name: 'Dunn', medical_record_number: 'X1' },
  ];

  // Default: MRN is a strong identifier, so the pair is flagged.
  assert.equal(findDuplicateGroups(patients).length, 1);

  // A high minScore floor overrides the adaptive threshold and suppresses it.
  assert.equal(findDuplicateGroups(patients, { minScore: 95 }).length, 0);

  // Disabling the MRN signal removes the only shared signal -> no match.
  assert.equal(
    findDuplicateGroups(patients, { scoreOptions: { signals: { mrn: false } } }).length,
    0
  );
});

test('a name-only match never clears a high (destructive) minScore floor', () => {
  // Two genuinely different people who happen to share a name. EXACT_NAME alone
  // scores 60, so a 70 floor must not flag them — this guards the backend's
  // auto-delete path from removing distinct same-name patients.
  const patients = [
    { id: '1', first_name: 'John', last_name: 'Smith', date_of_birth: '1950-01-01' },
    { id: '2', first_name: 'John', last_name: 'Smith', date_of_birth: '1988-12-31' },
  ];
  assert.equal(findDuplicateGroups(patients, { minScore: 70 }).length, 0);
  // ...but corroboration (shared DOB) pushes them over the floor.
  const corroborated = [
    { id: '1', first_name: 'John', last_name: 'Smith', date_of_birth: '1950-01-01' },
    { id: '2', first_name: 'John', last_name: 'Smith', date_of_birth: '1950-01-01' },
  ];
  assert.equal(findDuplicateGroups(corroborated, { minScore: 70 }).length, 1);
});

test('findDuplicateGroups clusters transitively-linked duplicates into one group', () => {
  // A↔B share a phone, B↔C share an address, but A and C share nothing — the old
  // greedy pass dropped C entirely. Transitive (union-find) grouping keeps all
  // three together so the bridged duplicate is not missed.
  const patients = [
    { id: 'A', first_name: 'Mary', last_name: 'Johnson', phone: '215-555-7777' },
    { id: 'B', first_name: 'Mary', last_name: 'Johnson', phone: '215-555-7777', address: '88 Oak Lane, Philadelphia 19103' },
    { id: 'C', first_name: 'Mary', last_name: 'Johnson', address: '88 Oak Lane, Philadelphia 19103' },
  ];
  const groups = findDuplicateGroups(patients);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.id, 'A');
  const ids = groups[0].duplicates.map((d) => d.patient.id).sort();
  assert.deepEqual(ids, ['B', 'C']);
  // C is reported with its strongest link (to B), not its (sub-threshold) link to A.
  const c = groups[0].duplicates.find((d) => d.patient.id === 'C');
  assert.ok(c.score > 0);
  assert.ok(c.matches.length > 0);
});

test('findDuplicateGroups keeps unrelated clusters separate', () => {
  const patients = [
    { id: '1', first_name: 'John', last_name: 'Smith', medical_record_number: 'A1' },
    { id: '2', first_name: 'John', last_name: 'Smith', medical_record_number: 'A1' },
    { id: '3', first_name: 'Jane', last_name: 'Doe', medical_record_number: 'B2' },
    { id: '4', first_name: 'Jane', last_name: 'Doe', medical_record_number: 'B2' },
  ];
  const groups = findDuplicateGroups(patients);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].primary.id, '1'); // primary-index order preserved
  assert.equal(groups[1].primary.id, '3');
});

test('findDuplicatesForCandidate flags a matching existing record', () => {
  const candidate = {
    first_name: 'John',
    last_name: 'Smith',
    date_of_birth: '1950-01-15',
    medical_record_number: 'MRN-100',
  };
  const roster = [
    { id: 'p1', first_name: 'Jane', last_name: 'Doe', date_of_birth: '1944-02-02' },
    { id: 'p2', first_name: 'John', last_name: 'Smith', date_of_birth: '1950-01-15', medical_record_number: 'MRN-100' },
  ];
  const matches = findDuplicatesForCandidate(candidate, roster);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patient.id, 'p2');
  assert.ok(matches[0].matches.includes(REASON.EXACT_NAME));
  assert.ok(matches[0].matches.includes(REASON.DOB));
});

test('findDuplicatesForCandidate returns nothing for a genuinely new patient', () => {
  const candidate = { first_name: 'Zelda', last_name: 'Nightingale', date_of_birth: '1991-11-11' };
  const roster = [
    { id: 'p1', first_name: 'John', last_name: 'Smith', date_of_birth: '1950-01-15' },
  ];
  assert.deepEqual(findDuplicatesForCandidate(candidate, roster), []);
});

test('findDuplicatesForCandidate can exclude the record being edited', () => {
  const candidate = { id: 'self', first_name: 'John', last_name: 'Smith', medical_record_number: 'MRN-100' };
  const roster = [
    { id: 'self', first_name: 'John', last_name: 'Smith', medical_record_number: 'MRN-100' },
    { id: 'other', first_name: 'John', last_name: 'Smith', medical_record_number: 'MRN-100' },
  ];
  const matches = findDuplicatesForCandidate(candidate, roster, { excludeId: 'self' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patient.id, 'other');
});

test('findDuplicatesForCandidate sorts strongest match first and respects limit', () => {
  const candidate = { first_name: 'John', last_name: 'Smith', date_of_birth: '1950-01-15', medical_record_number: 'MRN-100' };
  const roster = [
    { id: 'weak', first_name: 'Jon', last_name: 'Smith' }, // name-ish only
    { id: 'strong', first_name: 'John', last_name: 'Smith', date_of_birth: '1950-01-15', medical_record_number: 'MRN-100' },
  ];
  const all = findDuplicatesForCandidate(candidate, roster);
  assert.equal(all[0].patient.id, 'strong');
  const limited = findDuplicatesForCandidate(candidate, roster, { limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].patient.id, 'strong');
});

test('findDuplicateGroups attaches capped confidence percentages', () => {
  const patients = [
    { ...base, id: '1' },
    { ...base, id: '2' },
  ];
  const groups = findDuplicateGroups(patients);
  assert.equal(groups[0].duplicates[0].confidencePercent, 100);
  assert.equal(groups[0].duplicates[0].confidenceLevel, 'high');
});

// ── Regression tests for audit fixes ────────────────────────────────────────

test('parseDob handles 2-digit-year US dates, pivoting into the past', () => {
  assert.deepEqual(parseDob('04/15/45'), { year: '1945', month: '04', day: '15' });
  assert.deepEqual(parseDob('3/7/50'), { year: '1950', month: '03', day: '07' });
});

test('same DOB written in different formats is an exact DOB match', () => {
  const a = { id: 'a', first_name: 'A', last_name: 'B', date_of_birth: '1945-04-15' };
  const b = { id: 'b', first_name: 'A', last_name: 'B', date_of_birth: '04/15/1945' };
  const { matches } = scorePatientPair(a, b);
  assert.ok(matches.includes(REASON.DOB));
});

test('different streets sharing a number and direction do NOT score a street-address match', () => {
  const a = { id: 'a', first_name: 'A', last_name: 'A', address: '100 N Main St' };
  const b = { id: 'b', first_name: 'B', last_name: 'B', address: '100 N Oak St' };
  const { matches } = scorePatientPair(a, b);
  assert.ok(!matches.includes(REASON.STREET_ADDRESS));
  assert.ok(matches.includes(REASON.STREET_NUMBER));
});

test('same street name with different directionals is NOT a street-address match', () => {
  // "100 W Main St" vs "100 E Main St": the directional must stay part of the
  // street key so these aren't collapsed into a strong-identifier match.
  const a = { id: 'a', first_name: 'A', last_name: 'A', address: '100 W Main St' };
  const b = { id: 'b', first_name: 'B', last_name: 'B', address: '100 E Main St' };
  const { matches } = scorePatientPair(a, b);
  assert.ok(!matches.includes(REASON.STREET_ADDRESS));
  assert.ok(matches.includes(REASON.STREET_NUMBER));
});

test('identical directional street addresses still score a street-address match', () => {
  const a = { id: 'a', first_name: 'A', last_name: 'A', address: '100 W Main St' };
  const b = { id: 'b', first_name: 'B', last_name: 'B', address: '100 W Main St' };
  const { matches } = scorePatientPair(a, b);
  assert.ok(matches.includes(REASON.STREET_ADDRESS));
});
