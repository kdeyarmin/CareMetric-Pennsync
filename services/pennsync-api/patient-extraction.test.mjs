import test from 'node:test';
import assert from 'node:assert/strict';
import { HANDLERS } from './handlers.mjs';
import {
  EXTRACTION_MAX_BODY, MAX_DOCUMENT_BYTES, PATIENT_EXTRACTION_SCHEMA,
} from './patient-extraction.mjs';
import { MAX_BODY } from './contracts.mjs';

/**
 * The document-extraction port.
 *
 * What this file is for: the CALL SHAPE, because the shape is the whole port.
 * The original takes a locator the browser uploaded to Base44's storage; this
 * takes the bytes and mints the handle itself, so that one subject writes the
 * object and reads it. Everything compared against the original — the schema,
 * field for field — lives in
 * `base44/functionTests/pennsyncApiOriginalParity.test.js` (D60).
 */
const entry = HANDLERS.extractPatientDataFromDocument;
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

const harness = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    params: { base64: PNG, content_type: 'image/png', ...overrides.params },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'UploadFile') {
        return 'upload' in overrides ? overrides.upload : { file_uri: 'cmfile:abc', size_bytes: 17, private: true };
      }
      return 'extraction' in overrides
        ? overrides.extraction
        : { status: 'success', output: { first_name: 'Synthetic', last_name: 'Person' } };
    },
  };
};
const rejects = async (promise, code) => {
  await assert.rejects(promise, error => { assert.equal(error.code, code); return true; });
};

test('the bytes are uploaded under this service s own subject, then read', async () => {
  const h = harness();
  const answer = await entry.handle(h);
  // Two brokered calls, in this order: the object has to exist before it is
  // read, and the handle the read uses is the one the upload returned rather
  // than anything the caller named.
  assert.deepEqual(h.calls.map(call => call.operation), ['UploadFile', 'ExtractDataFromUploadedFile']);
  assert.deepEqual(h.calls[0].payload, { base64: PNG, content_type: 'image/png' });
  assert.equal(h.calls[1].payload.file_uri, 'cmfile:abc');
  assert.deepEqual(answer, {
    status: 'success',
    patient_data: { first_name: 'Synthetic', last_name: 'Person' },
    message: 'Patient data extracted successfully',
  });
});

test('no caller-supplied locator reaches the runtime, by any key', async () => {
  // The whole point of the port: a caller cannot name an object to be read.
  // `exactObject` is what enforces it, so the refusal is asserted rather than
  // trusted, for the original's key and for the runtime's alike.
  for (const params of [
    { base64: PNG, content_type: 'image/png', file_url: 'https://qtrypzzcjebvfcihiynt.supabase.co/x.pdf' },
    { base64: PNG, content_type: 'image/png', file_uri: 'cmfile:someone-elses' },
    { file_url: 'https://qtrypzzcjebvfcihiynt.supabase.co/x.pdf' },
  ]) {
    const h = harness({ params });
    await rejects(entry.handle({ ...h, params }), 'INVALID_PARAMS');
    assert.equal(h.calls.length, 0, 'and nothing was brokered on the way to the refusal');
  }
});

test('an empty or mistyped body is refused before anything is brokered', async () => {
  for (const params of [
    { base64: '', content_type: 'image/png' },
    { base64: PNG, content_type: '' },
    { base64: 42, content_type: 'image/png' },
    { base64: PNG, content_type: ['image/png'] },
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
    // The important half: the extraction never ran, so a failed upload cannot
    // turn into a read of some other object.
    assert.deepEqual(h.calls.map(call => call.operation), ['UploadFile']);
  }
});

test('the schema handed over is a clone, so one call cannot change the next', async () => {
  const h = harness();
  await entry.handle(h);
  const sent = h.calls[1].payload.json_schema;
  assert.deepEqual(sent, PATIENT_EXTRACTION_SCHEMA);
  assert.notEqual(sent, PATIENT_EXTRACTION_SCHEMA);
  sent.properties.first_name.description = 'tampered';
  const second = harness();
  await entry.handle(second);
  assert.equal(second.calls[1].payload.json_schema.properties.first_name.description,
    "Patient's first name");
});

test('a provider that answers a failure status is reported without its words', async () => {
  for (const extraction of [
    { status: 'error', details: 'upstream said something with a URL in it' },
    { status: 'success' },
    null,
  ]) {
    const h = harness({ extraction });
    const answer = await entry.handle(h);
    if (extraction && extraction.status === 'success') {
      // No output: the original answers success with an empty object.
      assert.deepEqual(answer, {
        status: 'success', patient_data: {}, message: 'Patient data extracted successfully',
      });
      continue;
    }
    assert.deepEqual(answer, {
      status: 'error',
      details: 'Failed to extract patient data from document',
      patient_data: null,
    });
    assert.ok(!JSON.stringify(answer).includes('upstream'),
      'the runtime s own words never cross back');
  }
});

test('the declared ceiling is the runtime s file limit encoded, not a policy of its own', () => {
  assert.equal(entry.maxBody, EXTRACTION_MAX_BODY);
  assert.ok(EXTRACTION_MAX_BODY > MAX_BODY, 'a document does not fit the service default');
  // base64 is four characters per three bytes, plus room for the envelope.
  assert.equal(EXTRACTION_MAX_BODY, Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 64 * 1024);
  // And it stays under what the integration runtime s own socket accepts, so
  // this service never accepts a request the next hop must refuse.
  assert.ok(EXTRACTION_MAX_BODY < 12 * 1024 * 1024);
});

test('the capability declares the runtime it needs', () => {
  assert.equal(entry.needsIntegration, true);
  // Asserted because the release ladder reads this flag to decide which wave
  // the capability lands in, and a handler brokering two operations without it
  // would be released into a deployment with no runtime configured.
  assert.equal(entry.handle.length, 1);
});
