import test from 'node:test';
import assert from 'node:assert/strict';
import { HANDLERS } from './handlers.mjs';
import {
  REFERRAL_SPLIT_MODEL, REFERRAL_SPLIT_PROMPT, REFERRAL_SPLIT_SCHEMA,
} from './referral-split.mjs';
import { EXTRACTION_MAX_BODY } from './patient-extraction.mjs';

/**
 * The referral-split port — the third on the byte-through-handler shape.
 *
 * What is compared against the original lives in
 * `base44/functionTests/pennsyncApiOriginalParity.test.js` (D60). What is here
 * is the call shape, which is the whole of the port.
 */
const entry = HANDLERS.splitReferralPDF;
const PDF = 'JVBERi0xLjQK';
const ANALYSIS = { is_multiple_referrals: true, referral_count: 2, referrals: [], notes: '' };

const harness = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    params: { base64: PDF, content_type: 'application/pdf', ...overrides.params },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'UploadFile') {
        return 'upload' in overrides ? overrides.upload : { file_uri: 'cmfile:abc', size_bytes: 12, private: true };
      }
      return 'analysis' in overrides ? overrides.analysis : ANALYSIS;
    },
  };
};
const rejects = async (promise, code) => {
  await assert.rejects(promise, error => { assert.equal(error.code, code); return true; });
};

test('the packet is uploaded under this service s own subject, then read', async () => {
  const h = harness();
  const answer = await entry.handle(h);
  assert.deepEqual(h.calls.map(call => call.operation), ['UploadFile', 'InvokeLLM']);
  assert.deepEqual(h.calls[0].payload, { base64: PDF, content_type: 'application/pdf' });
  assert.deepEqual(h.calls[1].payload.file_uris, ['cmfile:abc']);
  assert.equal(h.calls[1].payload.model, REFERRAL_SPLIT_MODEL);
  assert.equal(h.calls[1].payload.prompt, REFERRAL_SPLIT_PROMPT);
  assert.deepEqual(answer, { analysis: ANALYSIS, success: true });
});

test('no caller-supplied locator reaches the runtime, by any key', async () => {
  // The original's key is `fileUrl` rather than `file_url`, so both spellings
  // are refused here along with the runtime's own.
  for (const params of [
    { base64: PDF, content_type: 'application/pdf', fileUrl: 'https://qtrypzzcjebvfcihiynt.supabase.co/x.pdf' },
    { base64: PDF, content_type: 'application/pdf', file_url: 'https://qtrypzzcjebvfcihiynt.supabase.co/x.pdf' },
    { base64: PDF, content_type: 'application/pdf', file_uris: ['cmfile:someone-elses'] },
    { fileUrl: 'https://qtrypzzcjebvfcihiynt.supabase.co/x.pdf' },
  ]) {
    const h = harness({ params });
    await rejects(entry.handle({ ...h, params }), 'INVALID_PARAMS');
    assert.equal(h.calls.length, 0, 'and nothing was brokered on the way to the refusal');
  }
});

test('an empty or mistyped body is refused before anything is brokered', async () => {
  for (const params of [
    { base64: '', content_type: 'application/pdf' },
    { base64: PDF, content_type: '' },
    { base64: 42, content_type: 'application/pdf' },
  ]) {
    const h = harness({ params });
    await rejects(entry.handle({ ...h, params }), 'INVALID_PARAMS');
    assert.equal(h.calls.length, 0);
  }
});

test('an upload that answers no handle is a refusal, not a read of nothing', async () => {
  for (const upload of [null, {}, { file_uri: '' }, { file_uri: 7 }]) {
    const h = harness({ upload });
    await rejects(entry.handle(h), 'DOCUMENT_UPLOAD_FAILED');
    assert.deepEqual(h.calls.map(call => call.operation), ['UploadFile']);
  }
});

test('an answer that is not an object is refused, not shown as no referrals found', async () => {
  // The screen renders `analysis.referrals` and pre-selects from it, so a
  // non-object answer would read on the page as a packet holding one referral
  // rather than as a failure.
  for (const analysis of [null, 'none', 7, ['a']]) {
    await rejects(entry.handle(harness({ analysis })), 'REFERRAL_SPLIT_FAILED');
  }
});

test('the schema handed over is a clone, so one call cannot change the next', async () => {
  const h = harness();
  await entry.handle(h);
  const sent = h.calls[1].payload.response_json_schema;
  assert.deepEqual(sent, REFERRAL_SPLIT_SCHEMA);
  assert.notEqual(sent, REFERRAL_SPLIT_SCHEMA);
  sent.properties.notes.description = 'tampered';
  const second = harness();
  await entry.handle(second);
  assert.notEqual(second.calls[1].payload.response_json_schema.properties.notes.description,
    'tampered');
});

test('the three document capabilities share one ceiling', () => {
  assert.equal(entry.maxBody, EXTRACTION_MAX_BODY);
  assert.equal(entry.maxBody, HANDLERS.extractClinicalDocument.maxBody);
  assert.equal(entry.maxBody, HANDLERS.extractPatientDataFromDocument.maxBody);
  assert.equal(entry.needsIntegration, true);
});
