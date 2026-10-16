import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIAGE_MODEL, buildTriagePrompt, triageReferral,
} from './referral-triage.mjs';

/**
 * The first port to sequence a brokered model call and a write.
 *
 * Two properties carry it. The trail entry may contain NO analysis detail —
 * the original's own containment rule, because "The analysis contains patient
 * identity and clinical detail; UserActivity is a broad operational audit
 * surface, not a second copy of the referral record." The entry once carried
 * the urgency category and nothing else; D234 removed the urgency level from
 * referrals entirely, so the payload is empty and the containment is total.
 * And `audit_recorded` returns here without reversing D37: that flag was
 * deleted from the incident port because one transaction made the change and
 * its record inseparable, and this handler has no transaction to offer.
 */
const ANALYSIS = {
  patient_name: 'Ada Lovelace', date_of_birth: '1815-12-10',
  primary_diagnosis: 'CHF exacerbation',
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

test('the trail entry carries no analysis detail at all', async () => {
  const h = harness();
  const result = await triageReferral(h);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].action, 'referral_triage_analysis');
  assert.deepEqual(h.audits[0].options, { detail: {} });
  // The whole point: nothing from the analysis reaches the trail.
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

test('the prompt asks for no urgency level, and a model answer offering one has it dropped', async () => {
  assert.equal(buildTriagePrompt('REFERRAL').includes('urgency'), false,
    'the prompt must not ask for an urgency level (D234)');
  // A model can still answer with the removed fields — from an older prompt
  // in its context, or by habit — and they must not reach the caller or the
  // trail, because callers used to map them onto Referral.priority.
  const h = harness({
    answer: JSON.stringify({
      ...ANALYSIS,
      urgency_level: 'HIGH',
      urgency_reason: 'Recent hospitalisation with weight gain',
    }),
  });
  const result = await triageReferral(h);
  assert.equal('urgency_level' in result.analysis, false);
  assert.equal('urgency_reason' in result.analysis, false);
  assert.deepEqual(h.audits[0].options, { detail: {} });
  assert.equal(result.analysis.patient_name, 'Ada Lovelace');
});

test('a model answer wrapped in markdown is still parsed', async () => {
  const h = harness({ answer: '```json\n{"patient_name":"Ada Lovelace"}\n```' });
  const result = await triageReferral(h);
  assert.equal(result.analysis.patient_name, 'Ada Lovelace');
  // And an unparseable one is an empty analysis rather than a failure, which
  // is the original's `parseLLMJson(raw) || {}`.
  const bad = harness({ answer: 'I cannot help with that.' });
  const answer = await triageReferral(bad);
  assert.deepEqual(answer.analysis, {});
  assert.deepEqual(bad.audits[0].options.detail, {});
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
  assert.equal(result.analysis.patient_name, 'Ada Lovelace');
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

test('the model is the one the port names', async () => {
  const h = harness();
  await triageReferral(h);
  assert.equal(h.calls[0].payload.model, TRIAGE_MODEL);
});
