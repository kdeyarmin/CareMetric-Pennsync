import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const readEntry = (name) => readFileSync(
  join(process.cwd(), `base44/functions/${name}/entry.ts`),
  'utf8',
);

function userActivityPayloads(source) {
  const marker = '.entities.UserActivity.create(';
  const payloads = [];
  let cursor = 0;

  while ((cursor = source.indexOf(marker, cursor)) !== -1) {
    const start = source.indexOf('{', cursor + marker.length);
    assert.notEqual(start, -1, 'UserActivity.create must receive an object literal');
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    assert.notEqual(end, -1, 'UserActivity payload must have balanced braces');
    payloads.push(source.slice(start, end + 1));
    cursor = end + 1;
  }

  return payloads;
}

const forbiddenDetailKeys = [
  'patient_name',
  'patient_id',
  'mrn',
  'to_number',
  'from_number',
  'destination',
  'displayed_number',
  'phone',
  'phone_e164',
  'e164',
  'work_phone_number',
  'personal_cell_masked',
  'nurse_email',
  'target_user_email',
  'prior_user_email',
  'fax_sid',
  'log_id',
  'provider_message_id',
  'provider_call_id',
  'telnyx_number_id',
  'thread_id',
  'body_length',
  'incident_id',
  'from_patient_id',
  'to_patient_id',
  'changes',
  'before',
  'after',
  'reason',
  'message',
  'body',
  'original_pdf',
  'signed_pdf',
  'annotated_pdf',
  'modified_pdf',
  'prepared_pdf',
  'final_packet',
  'pdf_url',
  'source_pdfs',
  'merged_pdf',
  'document_name',
  'query',
  'filters',
];

function assertNoForbiddenDetails(payload, label) {
  for (const key of forbiddenDetailKeys) {
    assert.doesNotMatch(
      payload,
      new RegExp(`\\b${key}\\s*:`),
      `${label} must not copy ${key} into UserActivity`,
    );
  }
}

test('referral triage activity records only the non-identifying result category', () => {
  const payloads = userActivityPayloads(readEntry('triageReferralWithAI'));
  assert.equal(payloads.length, 1);
  const [payload] = payloads;

  assert.match(payload, /action:\s*'referral_triage_analysis'/);
  assert.match(payload, /urgency_level:\s*auditUrgencyLevel\(analysis\?\.urgency_level\)/);
  assert.doesNotMatch(payload, /referralData|analysis\?\.patient_name/);
  assertNoForbiddenDetails(payload, 'referral triage activity');

  const source = readEntry('triageReferralWithAI');
  assert.match(source, /TRIAGE_URGENCY_LEVELS\s*=\s*new Set\(\['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'\]\)/);
  assert.match(
    source,
    /TRIAGE_URGENCY_LEVELS\.has\(normalized\)\s*\?\s*normalized\s*:\s*'UNKNOWN'/,
    'an unexpected LLM value must become a fixed category rather than entering the audit log',
  );
  assert.match(source, /console\.error\('Referral triage analysis failed'\)/);
  assert.match(source, /console\.error\('Referral triage activity logging failed'\)/);
  assert.doesNotMatch(
    source,
    /console\.error\([^\n]*,\s*(?:err|error)\b/,
    'provider/SDK errors may echo referral prompt fragments and must not enter logs',
  );
});

test('fax activity records delivery metadata without endpoints or raw identifiers', () => {
  const payloads = userActivityPayloads(readEntry('sendFax'));
  assert.equal(payloads.length, 1);
  const [payload] = payloads;

  assert.match(payload, /action:\s*'fax_sent'/);
  assert.match(payload, /provider:\s*'telnyx'/);
  assert.match(payload, /direction:\s*'outbound'/);
  assert.match(payload, /status:\s*'accepted'/);
  assert.doesNotMatch(payload, /to_number|fromNumber|faxId/);
  assert.match(payload, /entity_type:\s*'FaxLog'/);
  assert.match(payload, /entity_id:\s*faxLog\.id/);
  assert.equal((payload.match(/\bentity_id\s*:/g) || []).length, 1);
  assertNoForbiddenDetails(payload, 'fax activity');
});

test('incident activities keep categories and one necessary entity link but no clinical values', () => {
  const payloads = userActivityPayloads(readEntry('updateIncident'));
  assert.equal(payloads.length, 3);

  const byAction = (action) => payloads.find((payload) => payload.includes(`action: '${action}'`));
  const patched = byAction('incident_patched');
  const transitioned = byAction('incident_status_changed');
  const reassigned = byAction('incident_patient_reassigned');
  assert.ok(patched && transitioned && reassigned, 'all three incident audit events must remain present');

  assert.match(patched, /updated_fields:\s*Object\.keys\(patch\)/);
  assert.doesNotMatch(patched, /patch\[|incident\[/);
  assert.match(transitioned, /from_status:\s*fromStatus/);
  assert.match(transitioned, /to_status:\s*toStatus/);
  assert.match(transitioned, /required_corrective_action:/);
  assert.doesNotMatch(transitioned, /capPlan|notes|corrective_action_plan|resolution_notes/);

  for (const [label, payload] of [
    ['incident patch activity', patched],
    ['incident transition activity', transitioned],
    ['incident reassignment activity', reassigned],
  ]) {
    assert.match(payload, /entity_type:\s*'Incident'/, `${label} must identify the record type`);
    assert.match(payload, /entity_id:\s*incident\.id/, `${label} must keep its single audit correlation key`);
    assert.equal(
      (payload.match(/\bentity_id\s*:/g) || []).length,
      1,
      `${label} must not duplicate its correlation key`,
    );
    assertNoForbiddenDetails(payload, label);
  }

  assert.doesNotMatch(reassigned, /patientId|patient_id/);
});

test('communications and phone activities retain correlation/outcomes without PHI endpoints', () => {
  const names = [
    'cancelScheduledSms',
    'dispatchScheduledSms',
    'handleTelnyxStatusWebhook',
    'managePhoneNumberPool',
    'provisionNurseWorkNumber',
    'recordSmsConsent',
    'redriveFailedSms',
    'scheduleSms',
    'searchPurchaseTelnyxNumbers',
    'sendSms',
    'sendTestSms',
    'startMaskedCall',
  ];

  for (const name of names) {
    const payloads = userActivityPayloads(readEntry(name));
    assert.ok(payloads.length > 0, `${name} must retain its activity event`);
    for (const [index, payload] of payloads.entries()) {
      assertNoForbiddenDetails(payload, `${name} activity ${index + 1}`);
    }
  }
});

test('patient merge audit keeps only opaque recovery ids, never MRNs or demographics', () => {
  const [payload] = userActivityPayloads(readEntry('deduplicatePatients'));
  assert.match(payload, /action:\s*'patients_deduplicated'/);
  assert.match(payload, /kept_id:\s*d\.kept\.id/);
  assert.match(payload, /removed_ids:\s*d\.removed\.map\(\(r\)\s*=>\s*r\.id\)/);
  assert.doesNotMatch(payload, /\bmrn\b|match_score|patient_name|date_of_birth/i);
});

test('PDF and ADR activities never copy PHI, search text, or storage capabilities', () => {
  const expectedActions = new Map([
    ['preparePDFWithPatientInfo', 'pdf_prepared'],
    ['saveAnnotatedPDF', 'pdf_annotated'],
    ['reorderDeletePDFPages', 'pdf_pages_modified'],
    ['searchPDFs', 'pdf_search'],
    ['embedAnnotationsToPDF', 'document_signed'],
    ['generateAdrPacket', 'adr_packet_generated'],
    ['indexPDF', 'pdf_indexed'],
    ['mergePDFs', 'pdfs_merged'],
  ]);

  for (const [name, action] of expectedActions) {
    const payloads = userActivityPayloads(readEntry(name));
    assert.equal(payloads.length, 1, `${name} must retain one activity event`);
    assert.match(payloads[0], new RegExp(`action:\\s*'${action}'`));
    assertNoForbiddenDetails(payloads[0], `${name} activity`);
    assert.doesNotMatch(
      payloads[0],
      /file_url|uploadResult|patient_info|scopedPdfUrl|scopedDocumentName|searchQuery/,
      `${name} must not copy a capability URL or source clinical value`,
    );
  }

  const [adr] = userActivityPayloads(readEntry('generateAdrPacket'));
  assert.match(adr, /entity_type:\s*'AdrAuditCase'/);
  assert.match(adr, /entity_id:\s*case_id/);

  const [index] = userActivityPayloads(readEntry('indexPDF'));
  assert.match(index, /entity_type:\s*'PDFIndex'/);
  assert.match(index, /entity_id:\s*indexId/);
});

test('workforce lifecycle activity never copies free-text reasons or duplicate target identity', () => {
  const payloads = userActivityPayloads(readEntry('offboardUser'));
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.doesNotMatch(payload, /target_user_email|target_user_id|reactivated_by_user_id/);
    assertNoForbiddenDetails(payload, 'workforce lifecycle activity');
  }
  assert.match(payloads[0], /reason_recorded:\s*Boolean\(note\)/);
});
