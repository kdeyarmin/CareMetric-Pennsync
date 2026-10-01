import test from 'node:test';
import assert from 'node:assert/strict';
import { HANDLERS } from './handlers.mjs';
import {
  CLINICAL_DOCUMENT_MODEL, CLINICAL_DOCUMENT_PROMPT, CLINICAL_DOCUMENT_SCHEMA,
} from './clinical-document.mjs';
import { EXTRACTION_MAX_BODY } from './patient-extraction.mjs';

/**
 * The clinical-document port.
 *
 * Same shape as `extractPatientDataFromDocument` and a different integration:
 * the original calls `InvokeLLM` with its own prompt and the document
 * attached. What is compared against the original — the prompt and the schema,
 * text for text — lives in
 * `base44/functionTests/pennsyncApiOriginalParity.test.js` (D60), because a
 * test in this directory may not read a file outside it.
 */
const entry = HANDLERS.extractClinicalDocument;
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
const ANSWER = { patient: { first_name: 'Synthetic' }, vitals: { heart_rate: null } };

const harness = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    params: { base64: PNG, content_type: 'application/pdf', ...overrides.params },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'UploadFile') {
        return 'upload' in overrides ? overrides.upload : { file_uri: 'cmfile:abc', size_bytes: 17, private: true };
      }
      return 'extracted' in overrides ? overrides.extracted : ANSWER;
    },
  };
};
const rejects = async (promise, code) => {
  await assert.rejects(promise, error => { assert.equal(error.code, code); return true; });
};

test('the bytes are uploaded under this service s own subject, then read', async () => {
  const h = harness();
  const answer = await entry.handle(h);
  assert.deepEqual(h.calls.map(call => call.operation), ['UploadFile', 'InvokeLLM']);
  assert.deepEqual(h.calls[0].payload, { base64: PNG, content_type: 'application/pdf' });
  // The handle the read uses is the one the upload returned, never anything a
  // caller named, and it goes under the runtime s key rather than the
  // original s `file_urls`.
  assert.deepEqual(h.calls[1].payload.file_uris, ['cmfile:abc']);
  assert.equal(h.calls[1].payload.model, CLINICAL_DOCUMENT_MODEL);
  assert.equal(h.calls[1].payload.prompt, CLINICAL_DOCUMENT_PROMPT);
  assert.equal(answer.success, true);
  assert.deepEqual(answer.extracted_data, ANSWER);
  assert.ok(!Number.isNaN(Date.parse(answer.timestamp)));
});

test('no caller-supplied locator reaches the runtime, by any key', async () => {
  for (const params of [
    { base64: PNG, content_type: 'application/pdf', file_url: 'https://qtrypzzcjebvfcihiynt.supabase.co/x.pdf' },
    { base64: PNG, content_type: 'application/pdf', file_uris: ['cmfile:someone-elses'] },
    { file_url: 'https://qtrypzzcjebvfcihiynt.supabase.co/x.pdf' },
  ]) {
    const h = harness({ params });
    await rejects(entry.handle({ ...h, params }), 'INVALID_PARAMS');
    assert.equal(h.calls.length, 0, 'and nothing was brokered on the way to the refusal');
  }
});

test('an empty or mistyped body is refused before anything is brokered', async () => {
  for (const params of [
    { base64: '', content_type: 'application/pdf' },
    { base64: PNG, content_type: '' },
    { base64: 42, content_type: 'application/pdf' },
    { base64: PNG, content_type: ['application/pdf'] },
  ]) {
    const h = harness({ params });
    await rejects(entry.handle({ ...h, params }), 'INVALID_PARAMS');
    assert.equal(h.calls.length, 0);
  }
});

test('an upload that answers no handle is a refusal, not a read of nothing', async () => {
  for (const upload of [null, {}, { file_uri: '' }, { file_uri: 7 }, 'cmfile:abc']) {
    const h = harness({ upload });
    await rejects(entry.handle(h), 'DOCUMENT_UPLOAD_FAILED');
    assert.deepEqual(h.calls.map(call => call.operation), ['UploadFile']);
  }
});

test('an answer that is not an object is refused rather than handed to the screen', async () => {
  // The runtime raises on a schema mismatch, so reaching this branch means the
  // shape changed underneath. The original returns whatever it was given; a
  // string reaching `extracted_data` would render as an extraction that found
  // nothing rather than as a failure.
  for (const extracted of [null, 'nothing found', 42, ['a']]) {
    const h = harness({ extracted });
    await rejects(entry.handle(h), 'DOCUMENT_EXTRACTION_FAILED');
  }
});

test('the schema handed over is a clone, so one call cannot change the next', async () => {
  const h = harness();
  await entry.handle(h);
  const sent = h.calls[1].payload.response_json_schema;
  assert.deepEqual(sent, CLINICAL_DOCUMENT_SCHEMA);
  assert.notEqual(sent, CLINICAL_DOCUMENT_SCHEMA);
  sent.properties.extraction_notes.type = 'number';
  const second = harness();
  await entry.handle(second);
  assert.equal(second.calls[1].payload.response_json_schema.properties.extraction_notes.type,
    'string');
});

test('the narrowed vitals are still asked for in the prompt', () => {
  // The schema drops the eight vitals because the runtime s schema contract
  // takes a single type name and the original s is a union — asserted against
  // that contract s own validator in the parity suite, which may read outside
  // this directory (D60). What this file owns is the other half: the vitals
  // are named in the prompt, which is what the model
  // reads, so dropping them from the schema did not drop them from the ask.
  for (const vital of [
    'blood_pressure_systolic', 'blood_pressure_diastolic', 'heart_rate',
    'respiratory_rate', 'temperature', 'oxygen_saturation', 'weight', 'pain_level',
  ]) {
    assert.ok(CLINICAL_DOCUMENT_PROMPT.includes(`"${vital}": "number or null"`), vital);
  }
  assert.deepEqual(CLINICAL_DOCUMENT_SCHEMA.properties.vitals, { type: 'object' });
});

test('the two document capabilities share one ceiling and one runtime flag', () => {
  assert.equal(entry.maxBody, EXTRACTION_MAX_BODY);
  assert.equal(entry.maxBody, HANDLERS.extractPatientDataFromDocument.maxBody);
  assert.equal(entry.needsIntegration, true);
});
