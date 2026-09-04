import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_CONTENT_AGREEMENT_VERSION,
  AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
  hasAcceptedAiContentAgreement,
} from './aiContentAgreement.js';

test('hasAcceptedAiContentAgreement is false for null/undefined user', () => {
  assert.equal(hasAcceptedAiContentAgreement(null), false);
  assert.equal(hasAcceptedAiContentAgreement(undefined), false);
});

test('hasAcceptedAiContentAgreement is false when the broker reports no acceptance', () => {
  assert.equal(hasAcceptedAiContentAgreement({ email: 'a@b.com' }), false);
});

test('hasAcceptedAiContentAgreement is false when accepted flag is missing but version matches', () => {
  assert.equal(
    hasAcceptedAiContentAgreement({ agreement_version: AI_CONTENT_AGREEMENT_VERSION }),
    false,
  );
});

test('hasAcceptedAiContentAgreement is false when accepted but for an older version', () => {
  assert.equal(
    hasAcceptedAiContentAgreement({
      accepted: true,
      agreement_version: '0.9',
    }),
    false,
  );
});

test('hasAcceptedAiContentAgreement is true only when accepted for the current version', () => {
  assert.equal(
    hasAcceptedAiContentAgreement({
      accepted: true,
      agreement_version: AI_CONTENT_AGREEMENT_VERSION,
    }),
    true,
  );
});

test('self-mutable legacy User agreement fields cannot satisfy the gate', () => {
  assert.equal(hasAcceptedAiContentAgreement({
    ai_content_agreement_accepted: true,
    ai_content_agreement_accepted_at: '2026-07-01T12:00:00.000Z',
    ai_content_agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  }), false);
});

test('there are acknowledgments covering proofreading and attesting responsibilities', () => {
  assert.ok(AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS.length >= 3);
  const joined = AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS.join(' ').toLowerCase();
  assert.match(joined, /proofread|review|edit/);
  assert.match(joined, /attest|responsible|agree/);
});
