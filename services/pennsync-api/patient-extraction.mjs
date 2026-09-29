// Structured patient data extracted from an uploaded document.
//
// The schema is the original's `PATIENT_SCHEMA`
// (`base44/functions/extractPatientDataFromDocument/entry.ts`), copied rather
// than reworded: every `description` is a sentence the model reads, so a
// rephrasing changes what comes back. `pennsyncApiOriginalParity.test.js`
// evaluates the original's own block and compares it field for field.
//
// It is frozen at the leaves because the handler hands a clone of it to the
// runtime on every call, and a schema a caller could mutate would change what
// the next caller's document is read for.
export const PATIENT_EXTRACTION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    first_name: { type: 'string', description: "Patient's first name" },
    middle_name: { type: 'string', description: "Patient's middle name or initial" },
    last_name: { type: 'string', description: "Patient's last name" },
    date_of_birth: { type: 'string', description: 'Date of birth in YYYY-MM-DD format' },
    phone: { type: 'string', description: 'Phone number' },
    email: { type: 'string', description: 'Email address' },
    address: { type: 'string', description: 'Full address' },
    medical_record_number: { type: 'string', description: 'Medical record number (MRN)' },
    primary_diagnosis: { type: 'string', description: 'Primary diagnosis or chief complaint' },
    allergies: { type: 'string', description: 'Known allergies' },
    emergency_contact_name: { type: 'string', description: 'Emergency contact name' },
    emergency_contact_phone: { type: 'string', description: 'Emergency contact phone' },
    emergency_contact_relationship: { type: 'string', description: 'Relationship to patient' },
    physician_name: { type: 'string', description: 'Primary care physician name' },
    physician_phone: { type: 'string', description: 'Physician phone' },
    payor: { type: 'string', description: 'Primary insurance/payor type' },
    insurance_primary: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Insurance provider name' },
        policy_number: { type: 'string', description: 'Policy number' },
        group_number: { type: 'string', description: 'Group number' },
      },
    },
    secondary_diagnoses: {
      type: 'array',
      items: { type: 'string' },
      description: 'Secondary diagnoses',
    },
    past_medical_history: {
      type: 'array',
      items: { type: 'string' },
      description: 'Past medical conditions',
    },
  },
});

/**
 * What the document layer will accept, and why the figure is this one.
 *
 * The original took a `file_url` the browser had already uploaded to Base44's
 * storage, so the document never crossed this service. The port takes the bytes
 * themselves, which means the request carries them base64-encoded — about a
 * third larger than the file.
 *
 * `MAX_FILE` in the integration runtime is 8 MiB and its own socket refuses
 * above 12 MiB, so a document larger than 8 MiB cannot be brokered whatever
 * this service accepts. The ceiling here is therefore the encoded form of that
 * same 8 MiB plus room for the envelope, and NOT a second policy: raising it
 * would buy nothing, because the runtime refuses first.
 *
 * This is a NARROWING against the original, and a real one. The browser
 * validates at 50 MiB (`OCRDocumentExtractor.jsx`), so a document between 8 and
 * 50 MiB is accepted by the SPA today and refused here. It is recorded rather
 * than worked around: widening it means widening `MAX_FILE`, which is the
 * runtime's decision and not this capability's.
 */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const EXTRACTION_MAX_BODY = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 64 * 1024;
