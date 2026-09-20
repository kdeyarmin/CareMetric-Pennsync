// Ported from base44/functions/analyzeVisitForSupplyUsage.
//
// D53's order with a read contract in front of it: authorize the chart, ask the
// model, shape the answer, record it. The read comes first because the original
// authorizes before it prompts — spending a model call on a request that is
// about to be refused helps nobody — and because the answer it returns is the
// patient name the caller's UI already holds, so it discloses nothing new.
//
// **Everything the store decides stays in the store.** This module does not
// match a supply, does not decrement inventory, does not choose a severity and
// does not decide whether an alert is already open. It sends the model's
// extraction through, and the record contract does all of it in ONE
// transaction — which is what replaces the original's claim token, its
// read-back of that token, its `runningQuantities` snapshot map and its
// create-then-update of the alert.
//
// **The body keys are the original's, and that is deliberate.** `visitId`,
// `visitNotes` and `patientId` are what `src/pages/SmartNoteAssistant.jsx`
// sends, and the SPA is shared between the two backends: renaming them here
// would break the capability on the independent path the moment it shipped.
// D57 renamed `predictSupplyNeeds`'s `patientId` for the opposite reason —
// nothing in `src/` calls it, so there was no caller to keep in step with.
import { fail } from './contracts.mjs';

export const SUPPLY_MODEL = 'automatic';

/** The original's prompt, verbatim, with the notes interpolated as it does. */
export const buildSupplyPrompt = visitNotes =>
  `You are a clinical documentation analyzer. Extract all medications and medical supplies mentioned as being used or administered during this visit. For each supply/medication, identify:
1. Name of the medication or supply
2. Quantity used (extract the number)
3. Unit of measurement (tablets, ml, boxes, etc.)
4. Indication/purpose of use

Return as JSON array with objects: { name, quantity, unit, purpose }. Only include items actually used/administered, not just mentioned.

Visit Notes: "${visitNotes}"

Return ONLY valid JSON array, no other text.`;

/**
 * The original's response schema, verbatim. It marks no field required, which
 * is why the contract guards every one of them — the original's own comment
 * says so: "an unchecked value would throw on .toLowerCase() or write NaN into
 * the shared SupplyItem inventory."
 */
export const SUPPLY_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    supplies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          purpose: { type: 'string' },
        },
      },
    },
  },
});

export async function analyzeVisitSupplyUsage({ params, integration, contract }) {
  const visitNotes = params.visitNotes;
  const patientId = params.patientId;
  const visitId = params.visitId === undefined || params.visitId === null
    || params.visitId === '' ? null : params.visitId;
  // The original's own 400, in its own words: "visitNotes and patientId are
  // required". An empty string is falsy there and refused here.
  if (typeof visitNotes !== 'string' || visitNotes === ''
    || typeof patientId !== 'string' || patientId === '') {
    fail(400, 'VISIT_NOTES_AND_PATIENT_REQUIRED');
  }
  if (visitId !== null && typeof visitId !== 'string') fail(400, 'INVALID_PARAMS');

  // Authorize before the model call, as the original does, and bind the visit
  // to the chart while we are asking.
  await contract('getVisitSupplyContext', { patient_id: patientId, visit_id: visitId });

  const analysis = await integration('InvokeLLM', {
    prompt: buildSupplyPrompt(visitNotes),
    model: SUPPLY_MODEL,
    response_json_schema: SUPPLY_RESPONSE_SCHEMA,
  });
  // `analysisResult?.supplies || []`, exactly: anything that is not an array
  // is no extraction at all, and the capability still answers.
  const supplies = Array.isArray(analysis?.supplies) ? analysis.supplies : [];

  return contract('recordVisitSupplyUsage', {
    patient_id: patientId, visit_id: visitId, supplies,
  });
}
