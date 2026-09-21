import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHRASE_MODEL, buildGenericPrompt, buildPersonalPrompt, expandClinicalPhrase,
} from './clinical-phrase.mjs';

/**
 * The model half of the clinical phrase expander.
 *
 * What this file is for: the BRANCH, and the fact that this module holds no
 * scoping. Which template answers, whether the caller may have it, and what of
 * the patient may go into the prompt are all the contract's; the three
 * outcomes — a model expansion with nothing recorded, a stored expansion, and
 * a personalised one — are the original's, and the usage count follows only
 * the last two. Everything read from the original lives in
 * `base44/functionTests/pennsyncApiOriginalParity.test.js` (D60).
 */
const TEMPLATE = Object.freeze({
  id: 'tpl-1', phrase: 'wound care', template_type: 'generic',
  expanded_text: 'Wound assessed and redressed.', ai_prompt_instructions: null,
  patient_data_fields: [], patient_id: null, is_agency_wide: true, usage_count: 3,
});
const harness = (overrides = {}) => {
  const calls = [];
  const contracts = [];
  return {
    calls,
    contracts,
    params: { phrase: 'wound care', patientId: 'patient-1',
      contextData: { visitType: 'SOC' }, ...overrides.params },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      return 'answer' in overrides ? overrides.answer : 'Expanded narrative.';
    },
    contract: async (name, args) => {
      contracts.push({ name, args });
      if (name !== 'resolveClinicalPhrase') return { success: true, usage_count: 4 };
      return {
        success: true,
        template: 'template' in overrides ? overrides.template : TEMPLATE,
        patient: overrides.patient ?? null,
        context: overrides.context ?? null,
        context_fields: [], refused_fields: overrides.refused ?? [],
      };
    },
  };
};

test('no template means the model writes one, and nothing is counted', async () => {
  const h = harness({ template: null });
  const result = await expandClinicalPhrase(h);
  assert.deepEqual(h.contracts.map(c => c.name), ['resolveClinicalPhrase']);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].payload.model, PHRASE_MODEL);
  assert.equal(h.calls[0].payload.add_context_from_internet, false);
  assert.deepEqual(result, { expandedText: 'Expanded narrative.',
    source: 'ai_generated', template: null });
});

test('a generic template answers from the store, with no model call at all', async () => {
  const h = harness();
  const result = await expandClinicalPhrase(h);
  assert.equal(h.calls.length, 0, 'nothing was asked of the model');
  assert.deepEqual(h.contracts.map(c => c.name),
    ['resolveClinicalPhrase', 'recordClinicalPhraseUse']);
  assert.deepEqual(h.contracts[1].args, { template_id: 'tpl-1' });
  assert.deepEqual(result, { expandedText: 'Wound assessed and redressed.',
    source: 'template', template: TEMPLATE });
});

test('a patient-specific template is prompted with the context the store built', async () => {
  const bound = { ...TEMPLATE, template_type: 'patient_specific',
    ai_prompt_instructions: 'Use the wound measurements.' };
  const h = harness({ template: bound, context: 'primary_diagnosis: "CHF"\n',
    patient: { id: 'patient-1', name: 'Ada Lovelace' }, refused: ['address'] });
  const result = await expandClinicalPhrase(h);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].payload.prompt, /Template Instructions: Use the wound measurements\./);
  assert.match(h.calls[0].payload.prompt, /primary_diagnosis: "CHF"/);
  assert.match(h.calls[0].payload.prompt, /Additional Context: \{"visitType":"SOC"\}/);
  assert.deepEqual(h.contracts.map(c => c.name),
    ['resolveClinicalPhrase', 'recordClinicalPhraseUse']);
  assert.equal(result.source, 'patient_specific_template');
  assert.deepEqual(result.patientData, { id: 'patient-1', name: 'Ada Lovelace' });
  // A field the template asked for and no read purpose discloses is named.
  assert.deepEqual(result.refused_fields, ['address']);
});

test('the instructions fall back to the stored text, as the original does', async () => {
  const bound = { ...TEMPLATE, template_type: 'patient_specific',
    ai_prompt_instructions: null, expanded_text: 'Fallback body.' };
  const h = harness({ template: bound, context: '' });
  await expandClinicalPhrase(h);
  assert.match(h.calls[0].payload.prompt, /Template Instructions: Fallback body\./);
});

test('the generic prompt carries the original s two conditional lines', async () => {
  const withBoth = buildGenericPrompt('wound care', 'patient-1', { visitType: 'SOC' });
  assert.match(withBoth, /Note: This is for a specific patient/);
  assert.match(withBoth, /Context: \{"visitType":"SOC"\}/);
  const withNeither = buildGenericPrompt('wound care', null, null);
  assert.equal(withNeither.includes('Note: This is for a specific patient'), false);
  assert.equal(withNeither.includes('Context:'), false);
  assert.match(withNeither, /Phrase: "wound care"/);
  // And the personalised one says so when there is no extra context.
  assert.match(buildPersonalPrompt(TEMPLATE, '', null), /Additional Context: None/);
});

test('an absent phrase never reaches the store', async () => {
  for (const phrase of [undefined, null, '', 42, { text: 'x' }]) {
    const h = harness({ params: { phrase } });
    await assert.rejects(() => expandClinicalPhrase(h),
      error => error?.code === 'PHRASE_REQUIRED');
    assert.equal(h.contracts.length, 0);
    assert.equal(h.calls.length, 0);
  }
  // An absent patient is a null, which the contract reads as no chart named.
  for (const patientId of [undefined, null, '']) {
    const h = harness({ params: { patientId } });
    await expandClinicalPhrase(h);
    assert.equal(h.contracts[0].args.patient_id, null);
  }
});
