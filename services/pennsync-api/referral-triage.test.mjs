import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIAGE_MODEL, TRIAGE_URGENCY_LEVELS, auditUrgencyLevel, buildTriagePrompt, triageReferral,
} from './referral-triage.mjs';

/**
 * The first port to sequence a brokered model call and a write.
 *
 * Two properties carry it. The trail entry may contain the urgency CATEGORY and
 * nothing else — the original's own containment rule, because "The analysis
 * contains patient identity and clinical detail; UserActivity is a broad
 * operational audit surface, not a second copy of the referral record." And
 * `audit_recorded` returns here without reversing D37: that flag was deleted
 * from the incident port because one transaction made the change and its record
 * inseparable, and this handler has no transaction to offer.
 */
const ANALYSIS = {
  patient_name: 'Ada Lovelace', date_of_birth: '1815-12-10',
  primary_diagnosis: 'CHF exacerbation', urgency_level: 'HIGH',
  urgency_reason: 'Recent hospitalisation with weight gain',
  clinical_summary: 'Short of breath on exertion; daughter reports confusion.',
};
const harness = (overrides = {}) => {
  const calls = [];
  const audits = [];
  return {
    calls,
    audits,
    params: { referralData: 'Referral from Dr Hopper for Ada Lovelace, DOB 1815-12-10.' },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      return overrides.answer === undefined ? JSON.stringify(ANALYSIS) : overrides.answer;
    },
    audit: async (action, options) => {
      audits.push({ action, options });
      if (overrides.auditThrows) throw new Error('trail unavailable');
      return { audit_event_id: 'evt-1' };
    },
  };
};

test('the trail entry carries the category and nothing else', async () => {
  const h = harness();
  const result = await triageReferral(h);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].action, 'referral_triage_analysis');
  assert.deepEqual(h.audits[0].options, { detail: { urgency_level: 'HIGH' } });
  // The whole point: nothing from the analysis reaches the trail but the
  // category.
  const recorded = JSON.stringify(h.audits[0]);
  for (const leak of ['Ada', 'Lovelace', '1815-12-10', 'CHF', 'confusion', 'Referral from']) {
    assert.equal(recorded.includes(leak), false, `the trail must not carry ${leak}`);
  }
  // And the caller still gets all of it.
  assert.equal(result.analysis.patient_name, 'Ada Lovelace');
  assert.equal(result.success, true);
  assert.equal(result.audit_recorded, true);
  assert.match(result.processedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('an unexpected urgency is recorded as UNKNOWN, not as itself', async () => {
  assert.deepEqual([...TRIAGE_URGENCY_LEVELS], ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
  for (const [sent, recorded] of [['critical', 'CRITICAL'], ['  High  ', 'HIGH'],
    ['EXTREMELY URGENT — patient is Ada Lovelace', 'UNKNOWN'], [null, 'UNKNOWN'],
    [undefined, 'UNKNOWN'], [{ level: 'HIGH' }, 'UNKNOWN']]) {
    assert.equal(auditUrgencyLevel(sent), recorded);
  }
  // Which matters because a model can answer with prose, and that prose would
  // otherwise be written into the trail.
  const h = harness({ answer: JSON.stringify({ urgency_level: 'urgent, see Ada Lovelace' }) });
  await triageReferral(h);
  assert.deepEqual(h.audits[0].options.detail, { urgency_level: 'UNKNOWN' });
});

test('a model answer wrapped in markdown is still parsed', async () => {
  const h = harness({ answer: '```json\n{"urgency_level":"LOW"}\n```' });
  const result = await triageReferral(h);
  assert.equal(result.analysis.urgency_level, 'LOW');
  // And an unparseable one is an empty analysis rather than a failure, which
  // is the original's `parseLLMJson(raw) || {}`.
  const bad = harness({ answer: 'I cannot help with that.' });
  const answer = await triageReferral(bad);
  assert.deepEqual(answer.analysis, {});
  assert.deepEqual(bad.audits[0].options.detail, { urgency_level: 'UNKNOWN' });
});

test('a failed trail append does not lose the analysis, and is reported', async () => {
  // D37 deleted `audit_recorded` from the incident port because ONE
  // TRANSACTION made the change and its record inseparable. Here the model
  // call and the append are two round trips, so the state the flag describes
  // can really happen — and the analysis has already been paid for.
  const h = harness({ auditThrows: true });
  const result = await triageReferral(h);
  assert.equal(result.success, true);
  assert.equal(result.audit_recorded, false);
  assert.equal(result.analysis.urgency_level, 'HIGH');
  assert.equal(h.audits.length, 1, 'it was attempted');
});

test('an absent or empty referral never reaches the model', async () => {
  for (const referralData of [undefined, null, '', '   ', 42, { text: 'x' }]) {
    const h = { ...harness(), params: { referralData } };
    await assert.rejects(() => triageReferral(h),
      error => error?.code === 'REFERRAL_DATA_REQUIRED');
    assert.equal(h.calls.length, 0, 'nothing was asked');
    assert.equal(h.audits.length, 0, 'and nothing was recorded');
  }
});
