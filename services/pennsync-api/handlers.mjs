// Ported handler registry.
//
// A handler appears here only after its Base44 original has been read and its
// behavior reproduced. Presence is not release: `runtime.mjs` requires each
// name to be listed in PENNSYNC_API_FUNCTIONS before it can be reached, and the
// list is empty unless an operator sets it.
//
// Every handler receives the caller's already-resolved current authority. A
// handler never resolves its own authority and never widens it.
import { exactObject, fail, isObject } from './contracts.mjs';
import {
  BAG_TECHNIQUE_FILENAME, SMART_NOTE_GUIDE_FILENAME, USER_MANUAL_FILENAME,
  buildBagTechniqueChecklist, buildSmartNoteGuide, buildUserManual, documentDate,
} from './documents.mjs';
import { analyzeReferralPriority as runReferralPriority } from './referral-priority.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const validateEmail = (email) => {
  if (!email) return null;
  return EMAIL.test(email) ? null : 'Invalid email format. Must be in format: user@domain.com';
};

const validatePhone = (phone) => {
  if (!phone) return null;
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length !== 10 && cleaned.length !== 11) return 'Phone number must be 10 digits (or 11 with country code)';
  if (cleaned.length === 11 && cleaned[0] !== '1') return '11-digit phone numbers must start with 1';
  return null;
};

const validateDate = (value, fieldName = 'date') => {
  if (!value) return null;
  if (!DATE.test(value)) return `${fieldName} must be in YYYY-MM-DD format (e.g., 2024-12-18)`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `Invalid ${fieldName}`;
  if (fieldName === 'date_of_birth' && parsed > new Date()) return 'Date of birth cannot be in the future';
  return null;
};

/**
 * Field-level validation ported from base44/functions/validatePatientData.
 *
 * The rules, messages and field names are preserved exactly so a migrated
 * caller sees the same result. The function reads no record and writes
 * nothing, which is why it is the first port: it exercises the transport,
 * release gate and authority path without moving clinical data.
 */
export function validatePatientData(patient) {
  const errors = [];
  const required = (field, message) => {
    const value = patient[field];
    if (!value || String(value).trim() === '') errors.push({ field, message });
  };
  required('first_name', 'First name is required');
  required('last_name', 'Last name is required');

  if (!patient.date_of_birth) {
    errors.push({ field: 'date_of_birth', message: 'Date of birth is required' });
  } else {
    const message = validateDate(patient.date_of_birth, 'date_of_birth');
    if (message) errors.push({ field: 'date_of_birth', message });
  }

  for (const [field, check, prefix] of [
    ['email', validateEmail, ''],
    ['phone', validatePhone, ''],
    ['emergency_contact_phone', validatePhone, 'Emergency contact phone: '],
    ['physician_email', validateEmail, 'Physician email: '],
    ['physician_phone', validatePhone, 'Physician phone: '],
    ['caregiver_email', validateEmail, 'Caregiver email: '],
    ['caregiver_phone', validatePhone, 'Caregiver phone: '],
  ]) {
    if (!patient[field]) continue;
    const message = check(patient[field]);
    if (message) errors.push({ field, message: prefix + message });
  }

  if (patient.admission_date) {
    const message = validateDate(patient.admission_date, 'admission_date');
    if (message) errors.push({ field: 'admission_date', message });
  }
  return errors;
}

/**
 * Each entry declares the shape it accepts. Unknown parameters are refused
 * rather than ignored, so a caller cannot smuggle an unreviewed field past a
 * handler that happens not to read it.
 */
/**
 * Renders a ported document. The builder is pure and parity-tested against its
 * Base44 original; this is the only place that needs a PDF library, and it is
 * loaded on first use so a deployment that never releases a document handler
 * never loads it.
 */
async function renderDocument(build, config) {
  const { jsPDF } = await import('jspdf');
  return build(new jsPDF(), {
    logoDataUrl: config?.documentLogoDataUrl || null,
    generatedOn: documentDate(),
  }).output('arraybuffer');
}

/** Answers with the bytes, as `generateBagTechniquePDF` and `generateUserManual` did. */
async function pdfResponse(build, filename, config) {
  return { binary: true, body: await renderDocument(build, config), contentType: 'application/pdf', filename };
}

/**
 * Answers with base64 inside the envelope, as `generateSmartNoteGuide` did.
 *
 * The original chunked the bytes through `String.fromCharCode` and `btoa` to
 * avoid blowing the argument limit on a large document; `Buffer` produces the
 * same string without the dance.
 */
async function pdfBase64Response(build, filename, config) {
  return { pdf: Buffer.from(await renderDocument(build, config)).toString('base64'), filename };
}

export const HANDLERS = Object.freeze({
  // Each original took no parameters and rendered the same document for any
  // authenticated caller. That is kept, with the membership this service
  // requires added, since it has no global scope.
  generateBagTechniquePDF: Object.freeze({
    binary: true,
    handle({ params, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return pdfResponse(buildBagTechniqueChecklist, BAG_TECHNIQUE_FILENAME, config);
    },
  }),
  generateSmartNoteGuide: Object.freeze({
    // Not a binary handler: this original answered with JSON carrying base64,
    // and a port answers the way its original did.
    handle({ params, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return pdfBase64Response(buildSmartNoteGuide, SMART_NOTE_GUIDE_FILENAME, config);
    },
  }),
  generateUserManual: Object.freeze({
    binary: true,
    handle({ params, config }) {
      exactObject(params, [], 'INVALID_PARAMS');
      return pdfResponse(buildUserManual, USER_MANUAL_FILENAME, config);
    },
  }),
  analyzeReferralPriority: Object.freeze({
    // The first port that reaches outside the service. `integration` is bound
    // to this caller by `app.mjs`; the handler never sees the credential that
    // authorizes the brokered call.
    handle({ params, integration }) {
      exactObject(params, ['extractedData', 'analysisResults'], 'INVALID_PARAMS');
      return runReferralPriority({ params, integration });
    },
  }),
  validatePatientData: Object.freeze({
    // Reproduces the original's authenticated-caller requirement, tightened to
    // a current agency membership because this service has no global scope.
    handle({ params }) {
      exactObject(params, ['patient'], 'INVALID_PARAMS');
      if (!isObject(params.patient)) fail(400, 'PATIENT_REQUIRED');
      const errors = validatePatientData(params.patient);
      return errors.length
        ? { valid: false, errors }
        : { valid: true, message: 'Patient data is valid' };
    },
  }),
});

export const HANDLER_NAMES = Object.freeze(Object.keys(HANDLERS).sort());
