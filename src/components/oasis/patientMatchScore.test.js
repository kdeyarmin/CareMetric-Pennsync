import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePatientMatchScore } from './patientMatchScore.js';

const patient = {
  first_name: 'Jane',
  last_name: 'Smith',
  date_of_birth: '1950-03-15',
  phone: '(555) 123-4567',
  address: '123 Main Street, Springfield, 62704',
};

test('exact name match scores high and reports the factor', () => {
  const r = calculatePatientMatchScore('Jane Smith', patient);
  // exact-name (+50) plus component (+40), initials (+10) and phonetic (+10)
  // matches saturate the score for a clean two-part name.
  assert.equal(r.confidence, 100);
  assert.ok(r.matchFactors.includes('Exact name match'));
  assert.equal(r.matchQuality, 'excellent');
});

test('a blank patient record does not earn a spurious "Initials match"', () => {
  // Previously initials.includes("") was always true, so any extracted name
  // "matched" an empty patient record.
  const r = calculatePatientMatchScore('Bob Jones', { first_name: '', last_name: '' });
  assert.ok(!r.matchFactors.includes('Initials match'));
});

test('minor typo is tolerated via similarity', () => {
  const r = calculatePatientMatchScore('Jane Smtih', patient);
  assert.ok(r.confidence >= 35, `expected typo tolerance, got ${r.confidence}`);
});

test('"LastName, FirstName" format is recognized', () => {
  const r = calculatePatientMatchScore('Smith, Jane', patient);
  assert.ok(r.matchFactors.some(f => f.includes('Comma-separated')));
  assert.ok(r.confidence >= 35);
});

test('verified DOB adds confidence and sets dobMatch', () => {
  // A weak (single-token) name keeps the base score well below the cap so the
  // DOB contribution is observable.
  const withDob = calculatePatientMatchScore('Jane', patient, '1950-03-15');
  const withoutDob = calculatePatientMatchScore('Jane', patient);
  assert.equal(withDob.dobMatch, true);
  assert.ok(withDob.confidence > withoutDob.confidence);
  assert.ok(withDob.matchFactors.some(f => f.includes('Date of birth verified')));
});

test('DOB verifies across formats (US MM/DD/YYYY document vs ISO record)', () => {
  // The document DOB is typically US-formatted while the record is ISO; the
  // matcher must compare Y/M/D components, not raw digit order.
  const r = calculatePatientMatchScore('Jane', patient, '03/15/1950');
  assert.equal(r.dobMatch, true);
  assert.ok(r.matchFactors.some(f => f.includes('Date of birth verified')));
});

test('DOB verifies when a document uses a 2-digit year', () => {
  const r = calculatePatientMatchScore('Jane', patient, '03/15/50');
  assert.equal(r.dobMatch, true);
  assert.ok(r.matchFactors.some(f => f.includes('Date of birth verified')));
});

test('same year but different month/day does not falsely verify', () => {
  const r = calculatePatientMatchScore('Jane', patient, '11/22/1950');
  assert.equal(r.dobMatch, false);
  assert.ok(r.matchFactors.some(f => f.includes('Birth year matches')));
});

test('a mismatched DOB year subtracts confidence and flags the discrepancy', () => {
  const r = calculatePatientMatchScore('Jane Smith', patient, '1975'); // different year
  assert.ok(r.matchFactors.some(f => f.includes('does NOT match')));
});

test('verified phone adds confidence and sets phoneMatch', () => {
  const r = calculatePatientMatchScore('Jane Smith', patient, undefined, '555-123-4567');
  assert.equal(r.phoneMatch, true);
  assert.ok(r.matchFactors.some(f => f.includes('Phone number verified')));
});

test('exact address match sets addressMatch', () => {
  const r = calculatePatientMatchScore('Jane Smith', patient, undefined, undefined, '123 Main St, Springfield 62704');
  assert.equal(r.addressMatch, true);
});

test('verifiedIdentifiers counts dob + phone + address that matched', () => {
  const r = calculatePatientMatchScore(
    'Jane Smith', patient, '1950-03-15', '555-123-4567', '123 Main St, Springfield 62704'
  );
  assert.equal(r.verifiedIdentifiers, 3);
  assert.equal(r.matchQuality, 'excellent');
  assert.equal(r.confidence, 100); // capped
});

test('an unrelated name yields low confidence and poor quality', () => {
  const r = calculatePatientMatchScore('Robert Johnson', patient);
  assert.ok(r.confidence < 40);
  assert.equal(r.matchQuality, 'poor');
});

test('confidence is always an integer in [0, 100]', () => {
  const r = calculatePatientMatchScore('Jane Smith', patient, '1975'); // includes a -20 penalty
  assert.ok(Number.isInteger(r.confidence));
  assert.ok(r.confidence >= 0 && r.confidence <= 100);
});

test('different streets sharing a directional are not a false address match', () => {
  // "123 N Main St" vs "123 N Oak St": the leading directional must not be
  // mistaken for the street name, which would collapse two distinct streets.
  const p = { first_name: 'Jane', last_name: 'Smith', address: '123 N Oak St, Springfield, 62704' };
  const r = calculatePatientMatchScore('Jane Smith', p, undefined, undefined, '123 N Main St, Springfield 62704');
  assert.ok(!r.matchFactors.includes('✓ Street number and name match'));
});

test('a null extracted name does not throw and yields no name match', () => {
  const r = calculatePatientMatchScore(null, patient);
  assert.ok(Number.isInteger(r.confidence));
  assert.ok(!r.matchFactors.some(f => /name match/i.test(f)));
});

test('a patient missing first_name does not score a spurious "undefined" name match', () => {
  // fullName must not become "undefined smith" and inflate the score.
  const r = calculatePatientMatchScore('undefined Smith', { last_name: 'Smith' });
  assert.ok(!r.matchFactors.includes('Exact name match'));
});
