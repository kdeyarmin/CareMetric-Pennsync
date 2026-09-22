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
// Three narrowings, each an input the original could not render:
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
  HANDOUT_COLOR_SCHEMES, HANDOUT_FONTS, HANDOUT_LAYOUTS, buildPatientHandout, handoutDate,
  handoutFilename, selectedHandoutSections,
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
  return { condition, patientName, selectedSections, customNotes, styleOptions };
}

export async function generatePatientHandout({ params, config, now = new Date() }) {
  const request = handoutRequest(params);
  const { jsPDF } = await import('jspdf');
  const body = buildPatientHandout(new jsPDF(), request, {
    logoDataUrl: config?.documentLogoDataUrl || null,
    generatedOn: handoutDate(now),
  }).output('arraybuffer');
  const template = HANDOUT_TEMPLATES[request.condition];
  // The original's success answer, less the `success: true` the service's
  // envelope already carries. `diagnostics` is kept because it is part of that
  // answer; its stage can only be `complete` on this path.
  return {
    pdf: Buffer.from(body).toString('base64'),
    filename: handoutFilename(request.condition),
    diagnostics: {
      stage: 'complete',
      sectionsProcessed: selectedHandoutSections(template, request.selectedSections).length,
      totalSections: template.sections?.length || 0,
    },
  };
}
