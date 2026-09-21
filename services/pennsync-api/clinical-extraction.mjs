// Ported from base44/functions/extractClinicalEvents.
//
// The shape D58 set: authorize the chart and bind the visit, ask the model,
// then record everything in ONE transaction. What is unusual here is the
// SPLIT: the text anchors are computed in this module, because they are
// `indexOf` over a string the CALLER sent, and reproducing JavaScript's
// `indexOf`, `trim` and `toLowerCase` in SQL would be a transcription with
// nothing to gain. Every decision about what may be STORED stays in the
// contract — the enum coercion, the field set, the task and the alert.
import { parseLLMJson } from './llm-json.mjs';
import { fail } from './contracts.mjs';

export const EXTRACT_MODEL = 'automatic';

/** The original's prompt, verbatim. */
export const buildExtractionPrompt = nurseNotes =>
  `Extract ALL significant clinical events from this nursing note. Be thorough and capture everything that should be tracked.

Visit Note:
${nurseNotes}

Extract events such as:
- Medication changes (started, stopped, dose changed)
- Physician appointments (scheduled, attended, results)
- Hospitalizations or ER visits
- Falls or near-falls
- New wounds or wound changes
- Lab results mentioned
- New symptoms or symptom resolution
- Significant vital sign changes
- Cognitive or functional status changes
- Pain level changes
- Infections or signs of infection
- Surgeries or procedures
- Therapy changes (PT, OT, ST)
- DME (durable medical equipment) ordered or received
- Any other clinically significant events

For each event, provide:
- event_type (use the most specific type from the enum list)
- event_title (brief, clear title)
- event_description (detailed description)
- structured_data (extract specific data like medication names, dosages, dates, physician names, etc.)
- severity (low, medium, high, critical)
- requires_followup (boolean)
- followup_notes (if follow-up is needed)
- source_text (exact quote from note - the specific sentence or paragraph)
- source_section (identify the section: assessment, medications, vital_signs, subjective, objective, plan, intervention, etc.)
- extraction_confidence (0-100)

IMPORTANT: For source_text, provide the EXACT verbatim text from the note, not a paraphrase. This will be used to locate the text in the document.`;

/** The original's response schema, verbatim, both enums included. */
export const EXTRACTION_SCHEMA = Object.freeze({
        type: "object",
        properties: {
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                event_type: {
                  type: "string",
                  enum: [
                    "medication_change",
                    "medication_started",
                    "medication_stopped",
                    "physician_appointment",
                    "hospitalization",
                    "er_visit",
                    "fall",
                    "wound_new",
                    "wound_change",
                    "lab_result",
                    "symptom_new",
                    "symptom_resolved",
                    "vital_change",
                    "cognitive_change",
                    "functional_change",
                    "pain_change",
                    "infection",
                    "surgery",
                    "therapy_change",
                    "dme_ordered",
                    "other"
                  ]
                },
                event_title: { type: "string" },
                event_description: { type: "string" },
                structured_data: { type: "object" },
                severity: {
                  type: "string",
                  enum: ["low", "medium", "high", "critical"]
                },
                requires_followup: { type: "boolean" },
                followup_notes: { type: "string" },
                source_text: { type: "string" },
                source_section: { type: "string" },
                extraction_confidence: { type: "number" }
              }
            }
          }
        }
      });

/**
 * The original's anchor search, character for character: exact `indexOf` of
 * the TRIMMED quote, then a case-insensitive retry, and in both branches the
 * end is the start plus the trimmed length.
 */
export function textAnchors(nurseNotes, sourceText) {
  if (typeof sourceText !== 'string' || !sourceText || !nurseNotes) {
    return { text_anchor_start: null, text_anchor_end: null };
  }
  const quote = sourceText.trim();
  const index = nurseNotes.indexOf(quote);
  if (index !== -1) {
    return { text_anchor_start: index, text_anchor_end: index + quote.length };
  }
  const fuzzy = nurseNotes.toLowerCase().indexOf(quote.toLowerCase());
  return fuzzy === -1
    ? { text_anchor_start: null, text_anchor_end: null }
    : { text_anchor_start: fuzzy, text_anchor_end: fuzzy + quote.length };
}

export async function extractClinicalEvents({ params, integration, contract }) {
  const { visit_id: visitId, patient_id: patientId, nurse_notes: nurseNotes } = params;
  // The original's own 400: "Missing required fields", all three at once.
  if (typeof visitId !== 'string' || visitId === ''
    || typeof patientId !== 'string' || patientId === ''
    || typeof nurseNotes !== 'string' || nurseNotes === '') {
    fail(400, 'EXTRACT_FIELDS_REQUIRED');
  }

  const context = await contract('getClinicalExtractionContext',
    { patient_id: patientId, visit_id: visitId });
  // The original's early return, before a model call is paid for. The write
  // contract re-checks under the lock, which is where it decides anything.
  if (context.already_processed) {
    return { success: true, already_processed: true, events_extracted: 0, events: [],
      tasks_created: 0, alerts_created: 0, skipped: 'events already extracted for visit' };
  }

  const raw = await integration('InvokeLLM', {
    model: EXTRACT_MODEL,
    prompt: buildExtractionPrompt(nurseNotes),
    response_json_schema: EXTRACTION_SCHEMA,
  });
  const result = parseLLMJson(raw) || {};
  const events = (Array.isArray(result?.events) ? result.events : [])
    .map(event => ({ ...event, ...textAnchors(nurseNotes, event?.source_text) }));

  const stored = await contract('recordClinicalEvents',
    { patient_id: patientId, visit_id: visitId, events });
  return {
    success: true,
    events_extracted: stored.events_extracted,
    events_skipped: stored.events_skipped,
    events: stored.events,
    tasks_created: stored.tasks_created,
    alerts_created: stored.alerts_created,
    ...(stored.already_processed
      ? { already_processed: true, skipped: stored.skipped } : {}),
  };
}
