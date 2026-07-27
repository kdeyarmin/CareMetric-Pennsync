import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIncompleteReferralFromTriage,
  cleanReferralValue,
  referralPatientReadiness,
  splitPatientName,
} from './referralPatientReadiness.js';

test('cleanReferralValue removes placeholder values', () => {
  assert.equal(cleanReferralValue('Not provided on referral'), '');
  assert.equal(cleanReferralValue(' Unknown '), '');
  assert.equal(cleanReferralValue('Jane'), 'Jane');
});

test('splitPatientName requires a usable full name', () => {
  assert.deepEqual(splitPatientName('Jane Mary Doe'), { first_name: 'Jane', last_name: 'Mary Doe', full_name: 'Jane Mary Doe' });
  assert.deepEqual(splitPatientName('Unknown'), { first_name: '', last_name: '', full_name: '' });
});

test('referralPatientReadiness requires full name plus one verifiable identifier/contact', () => {
  assert.equal(referralPatientReadiness({ patient_name: 'Jane Doe', date_of_birth: '1950-05-01' }).ready, true);
  assert.equal(referralPatientReadiness({ patient_name: 'Jane Doe', phone: '(555) 123-4567' }).ready, true);
  const incomplete = referralPatientReadiness({ patient_name: 'Jane Doe', date_of_birth: 'Not provided' });
  assert.equal(incomplete.ready, false);
  assert.deepEqual(incomplete.missing, ['DOB, MRN, phone, or address']);
  assert.deepEqual(referralPatientReadiness({ patient_name: 'Jane' }).missing, ['patient full name', 'DOB, MRN, phone, or address']);
});

test('buildIncompleteReferralFromTriage creates an awaiting-info referral payload with audit note', () => {
  const payload = buildIncompleteReferralFromTriage(
    { patient_name: 'Jane Doe', primary_diagnosis: 'CHF', urgency_level: 'HIGH' },
    { assignedTo: 'intake@example.com', referralDate: '2026-07-22' },
  );
  assert.equal(payload.status, 'awaiting_info');
  assert.equal(payload.requires_manual_review, true);
  assert.equal(payload.assigned_to, 'intake@example.com');
  assert.deepEqual(payload.extracted_data.missing_patient_identity, ['DOB, MRN, phone, or address']);
  assert.match(payload.follow_up_notes[0].note, /Patient chart not created/);
});

// ── Regression: name convention + placeholders (2026-07 review) ─────────────

test("'Last, First' fax convention splits correctly", () => {
  assert.deepEqual(splitPatientName('Doe, Jane'), { first_name: 'Jane', last_name: 'Doe', full_name: 'Jane Doe' });
  assert.equal(splitPatientName('Doe, Jane Marie').first_name, 'Jane');
  assert.equal(splitPatientName('Doe, Jane Marie').last_name, 'Doe');
});

test("the extractor's 'Not documented' filler is treated as empty", () => {
  assert.equal(cleanReferralValue('Not documented in referral'), '');
  assert.equal(cleanReferralValue('Not documented'), '');
});
