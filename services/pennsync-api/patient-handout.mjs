// generatePatientHandout, ported from
// base44/functions/generatePatientHandout/entry.ts.
//
// The sixth PARTIAL port (D81): the document action is served and the email
// action is refused by name — the delivery D42, D49, D50, D52, D54 and D73
// each ship paused. The refusal is the answer the original itself gives while
// `OUTBOUND_DELIVERY_RELEASE` is not `enabled-v1` — 503,
// `OUTBOUND_DELIVERY_RELEASE_PAUSED`, not retryable — because releasing a
// send to a patient's address is the owner decision D56 records, not
// something a port may take.
//
// It reads no record. The patient's name is text the caller typed, rendered
// into a document handed back to that caller and stored nowhere, so what it
// requires is what every ported document requires: an active membership in the
// agency the request names. The original required only a signed-in account.
//
// Four narrowings, each an input the original could not render (the fourth,
// a note too tall for the page, is `HandoutNotesTooLong` in the builder, and
// the bounds below explain the rest of what this service must refuse because
// it is shared where the original ran alone):
//
// - `condition` must be a string naming one of the twenty templates as an OWN
//   key. The original indexed a plain object, so `constructor` passed its
//   check and drew a page with no title and no sections.
// - A colour scheme, typeface or layout must be one the client offers. The
//   original had no fallback for an unknown scheme — the first fill threw —
//   and its catch answered `success: true` with a generic "we could not
//   generate the full guide" page, which the client downloads and reports as
//   a success. Typeface and layout it defaulted; refusing all three is one
//   rule instead of three, and the client cannot send anything else.
// - A text field must be text. The original stringified whatever arrived, so
//   an object printed `[object Object]` on a patient's handout.
//
// That generic page is the one behaviour NOT carried. Every input that reached
// it is refused here before a render starts — a failed sign-in and an
// unreadable body by the service itself, the rest above — so all that is left
// to reach it is a render that genuinely fails, and a patient handed a page
// saying "contact your nurse" by a nurse who was told the guide downloaded is
// worse than an error the nurse can see. The failure is the service's opaque
// 503 instead. For the same reason the original's two `SystemLog` writes have
// no successor: both recorded a failure this port either refuses by name or
// does not have.
import { exactObject, fail, isObject } from './contracts.mjs';
import {
  HANDOUT_COLOR_SCHEMES, HANDOUT_FONTS, HANDOUT_LAYOUTS, HandoutNotesTooLong, buildPatientHandout,
  handoutDate, handoutFilename, selectedHandoutSections,
} from './document-patient-handout.mjs';
import { HANDOUT_TEMPLATES } from './patient-handout-templates.mjs';

/**
 * Everything the published client sends (`src/pages/PatientEducationHub.jsx`).
 *
 * `readingLevel` and `format` are accepted and read by nothing, because the
 * original read neither: the client offers a reading-level and a format
 * selector, and neither changes a line of the document. Refusing them would
 * break the only caller; honouring them would invent a behaviour.
 */
export const HANDOUT_FIELDS = Object.freeze(['condition', 'patientName', 'patientEmail', 'action',
  'selectedSections', 'customNotes', 'styleOptions', 'readingLevel', 'format']);
export const HANDOUT_STYLE_FIELDS = Object.freeze(['colorScheme', 'fontFamily', 'layout',
  'customHeader', 'customFooter', 'agencyName', 'agencyPhone']);

const optionalText = (value) => value === undefined || value === null || typeof value === 'string';

/**
 * How much caller text may reach jsPDF's `splitTextToSize`, checked before any
 * render.
 *
 * Only two fields ever reach it — the nurse's note and the footer — and it is
 * worse than quadratic in LINES: measured, 20,000 lines take 0.85 s and 40,000
 * take 5.6 s, and the service's 1 MiB request cap holds 400,000. On Base44 the
 * original ran in an isolated invocation, so that stalled one request; here it
 * runs on a shared Node process whose render is synchronous, so it would stall
 * every caller's. These caps are far above anything that can print: a note
 * that fits on a page is at most about 45 lines, and the footer prints only its
 * first line. Whether a note fits is decided by the render itself
 * (`HandoutNotesTooLong`), because it depends on the layout and the typeface.
 */
export const HANDOUT_TEXT_BOUNDS = Object.freeze({
  customNotes: Object.freeze({ characters: 20_000, lines: 400, code: 'HANDOUT_NOTES_TOO_LONG' }),
  customFooter: Object.freeze({ characters: 2_000, lines: 40, code: 'HANDOUT_FOOTER_TOO_LONG' }),
});
const lineCount = (text) => 1 + (text.match(/\r\n|\r|\n/g)?.length ?? 0);

/**
 * The largest answer this handler sends, and the one bound its original did
 * not have.
 *
 * The published client reaches this service through `services/authority-client`,
 * which refuses a JSON answer over 1 MiB with an opaque
 * `INVALID_AUTHORITY_RESPONSE`, and the handout is the one ported JSON answer
 * whose size the CALLER decides: the guide carries the nurse's notes, and about
 * 300 KB of them renders a document the client cannot receive. Measured, the
 * render itself stays under a second even at the service's 1 MiB request cap,
 * so what goes wrong is not the work but where it fails — after it, on the
 * client, under a name that says nothing. It is refused by name here instead.
 *
 * Measured on the rendered answer rather than bounded on the inputs, because a
 * character limit is not a size limit: a note of blank lines renders a text
 * operator per line. The 16 KiB below the client's ceiling is room for the
 * service's envelope, and `services/authority-client/ported-api.test.mjs`
 * proves the two fit by sending this ceiling's answer through the real client.
 */
export const HANDOUT_ANSWER_CEILING = 1024 * 1024 - 16 * 1024;

/** Refuses what the original could not render, in the original's order. */
export function handoutRequest(params) {
  exactObject(params, HANDOUT_FIELDS, 'INVALID_PARAMS');
  const { condition, patientName, patientEmail, action, selectedSections, customNotes, styleOptions } = params;
  if (!condition) fail(400, 'CONDITION_REQUIRED');
  if (typeof condition !== 'string' || !Object.hasOwn(HANDOUT_TEMPLATES, condition)) fail(400, 'INVALID_CONDITION');
  if (action === 'email') {
    if (!patientEmail) fail(400, 'PATIENT_EMAIL_REQUIRED');
    fail(503, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
  }
  for (const value of [patientName, patientEmail, customNotes, params.readingLevel, params.format]) {
    if (!optionalText(value)) fail(400, 'INVALID_PARAMS');
  }
  if (!(selectedSections === undefined || selectedSections === null || isObject(selectedSections))) {
    fail(400, 'INVALID_PARAMS');
  }
  if (styleOptions !== undefined && styleOptions !== null) {
    exactObject(styleOptions, HANDOUT_STYLE_FIELDS, 'INVALID_STYLE_OPTIONS');
    if (HANDOUT_STYLE_FIELDS.some(field => !optionalText(styleOptions[field]))) fail(400, 'INVALID_STYLE_OPTIONS');
    const { colorScheme, fontFamily, layout } = styleOptions;
    if ((colorScheme && !Object.hasOwn(HANDOUT_COLOR_SCHEMES, colorScheme))
      || (fontFamily && !HANDOUT_FONTS.includes(fontFamily))
      || (layout && !Object.hasOwn(HANDOUT_LAYOUTS, layout))) fail(400, 'INVALID_STYLE_OPTIONS');
  }
  for (const [field, value] of [['customNotes', customNotes], ['customFooter', styleOptions?.customFooter]]) {
    const bound = HANDOUT_TEXT_BOUNDS[field];
    if (typeof value === 'string' && (value.length > bound.characters || lineCount(value) > bound.lines)) {
      fail(400, bound.code);
    }
  }
  return { condition, patientName, selectedSections, customNotes, styleOptions };
}

export async function generatePatientHandout({ params, config, now = new Date() }) {
  const request = handoutRequest(params);
  const { jsPDF } = await import('jspdf');
  let body;
  try {
    body = buildPatientHandout(new jsPDF(), request, {
      logoDataUrl: config?.documentLogoDataUrl || null,
      generatedOn: handoutDate(now),
    }).output('arraybuffer');
  } catch (error) {
    if (error instanceof HandoutNotesTooLong) fail(400, 'HANDOUT_NOTES_TOO_LONG');
    throw error;
  }
  const template = HANDOUT_TEMPLATES[request.condition];
  // The original's success answer, less the `success: true` the service's
  // envelope already carries. `diagnostics` is kept because it is part of that
  // answer; its stage can only be `complete` on this path.
  const answer = {
    pdf: Buffer.from(body).toString('base64'),
    filename: handoutFilename(request.condition),
    diagnostics: {
      stage: 'complete',
      sectionsProcessed: selectedHandoutSections(template, request.selectedSections).length,
      totalSections: template.sections?.length || 0,
    },
  };
  if (Buffer.byteLength(JSON.stringify(answer), 'utf8') > HANDOUT_ANSWER_CEILING) fail(413, 'HANDOUT_TOO_LARGE');
  return answer;
}
