import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retainAudioAuthorityWhileNoteHistoryRechecks } from './audioAuthority.js';

const tenantScope = {
  user_id: 'user-a',
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'clinician',
};

const authority = {
  patient_id: 'patient-a',
  visit_id: 'visit-a',
  visit_type: 'routine_visit',
  request_id: 4,
  ...tenantScope,
};

const recheck = {
  previous: authority,
  patientId: 'patient-a',
  visitId: 'visit-a',
  tenantScope,
  exactPatientReady: true,
  noteHistorySucceeded: true,
  noteHistoryFailed: false,
  noteHistoryIdle: false,
  patientAuthorizationFailed: false,
  visitAuthorizationFailed: false,
};

test('a note-history refetch keeps the verified audio binding for the same chart', () => {
  assert.equal(retainAudioAuthorityWhileNoteHistoryRechecks(recheck), authority);
});

test('a different patient clears the audio binding during a refetch', () => {
  assert.equal(
    retainAudioAuthorityWhileNoteHistoryRechecks({ ...recheck, patientId: 'patient-b' }),
    null,
  );
});

test('a failed note-history authorization clears the audio binding', () => {
  assert.equal(
    retainAudioAuthorityWhileNoteHistoryRechecks({
      ...recheck,
      noteHistoryFailed: true,
      noteHistorySucceeded: false,
    }),
    null,
  );
});

test('a settled chart that is not ready does not keep a stale binding', () => {
  assert.equal(
    retainAudioAuthorityWhileNoteHistoryRechecks({ ...recheck, noteHistoryIdle: true }),
    null,
  );
});
