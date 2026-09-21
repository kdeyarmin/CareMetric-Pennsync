// Ported from base44/functions/expandClinicalPhrase.
//
// D53's order with a read contract in front of it, as D58 established: resolve
// the template and what of the patient may go into the prompt, ask the model,
// record the use. Every scoping decision is the contract's; this module holds
// the two prompts and the branch between them, both the original's.
//
// **The body keys are the original's**, for D58's reason:
// `src/components/smartNote/QuickPhraseTextarea.jsx` sends
// `{ phrase, patientId, contextData }` and the SPA is shared between the two
// backends, so a rename would break the capability on the independent path.
import { fail } from './contracts.mjs';

export const PHRASE_MODEL = 'automatic';

/** The original's generic prompt, with its two conditional lines. */
export const buildGenericPrompt = (phrase, patientId, contextData) =>
  `You are a home healthcare documentation assistant. Expand the following clinical phrase into a complete, Medicare-compliant narrative note.

Phrase: "${phrase}"
${patientId ? 'Note: This is for a specific patient, so personalize the documentation.' : ''}
${contextData ? `Context: ${JSON.stringify(contextData)}` : ''}

Generate a clear, professional clinical note that:
- Uses proper medical terminology
- Is Medicare-compliant
- Follows home health documentation standards
- Is specific and measurable
- Includes relevant patient education or interventions

Expanded documentation:`;

/**
 * The original's personalised prompt. `patientContext` is built by the
 * CONTRACT, from the fields `smart_note_context` discloses and no others, so
 * the patient row never reaches this module.
 */
export const buildPersonalPrompt = (template, patientContext, contextData) =>
  `You are a home healthcare documentation assistant. Generate Medicare-compliant documentation based on this template and patient data.

Template Instructions: ${template.ai_prompt_instructions || template.expanded_text}

Patient Information:
${patientContext}

Additional Context: ${contextData ? JSON.stringify(contextData) : 'None'}

Generate a complete, personalized clinical note that:
- Uses the patient's specific information
- Is Medicare-compliant
- Follows home health documentation standards
- Is specific and measurable
- Includes dates, measurements, and observations

Expanded documentation:`;

export async function expandClinicalPhrase({ params, integration, contract }) {
  const phrase = params.phrase;
  const patientId = params.patientId === undefined || params.patientId === null
    || params.patientId === '' ? null : params.patientId;
  const contextData = params.contextData ?? null;
  // The original's own 400: "Phrase is required". An empty string is falsy
  // there and refused here.
  if (typeof phrase !== 'string' || phrase === '') fail(400, 'PHRASE_REQUIRED');
  if (patientId !== null && typeof patientId !== 'string') fail(400, 'INVALID_PARAMS');

  const resolved = await contract('resolveClinicalPhrase',
    { phrase, patient_id: patientId });
  const template = resolved.template;

  // No template of this agency's answers the phrase, so the model writes one
  // from nothing. Nothing is recorded: there is no template to count.
  if (!template) {
    const expandedText = await integration('InvokeLLM', {
      model: PHRASE_MODEL,
      prompt: buildGenericPrompt(phrase, patientId, contextData),
      add_context_from_internet: false,
    });
    return { expandedText, source: 'ai_generated', template: null };
  }

  if (template.template_type === 'generic') {
    await contract('recordClinicalPhraseUse', { template_id: template.id });
    return { expandedText: template.expanded_text, source: 'template', template };
  }

  const expandedText = await integration('InvokeLLM', {
    model: PHRASE_MODEL,
    prompt: buildPersonalPrompt(template, resolved.context ?? '', contextData),
    add_context_from_internet: false,
  });
  await contract('recordClinicalPhraseUse', { template_id: template.id });
  return {
    expandedText,
    source: 'patient_specific_template',
    template,
    patientData: resolved.patient,
    // Divergence 3: a field the template asked for that no read purpose
    // discloses is NAMED, because a template that quietly stopped including a
    // field would read as a model that ignored it.
    refused_fields: resolved.refused_fields ?? [],
  };
}
