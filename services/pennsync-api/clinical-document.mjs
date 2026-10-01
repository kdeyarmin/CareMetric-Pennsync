// The clinical-document extraction's prompt and response schema.
//
// Both are the original's, copied out of
// `base44/functions/extractClinicalDocument/entry.ts` rather than reworded:
// the prompt is a template a model fills for a medical record, and the schema
// is what the answer is validated against. `pennsyncApiOriginalParity.test.js`
// reads the original's own text and compares, so a reworded line fails the
// build instead of quietly changing what the model is asked about a chart.
//
// The model is `automatic`, as the original names it. The brokered contract
// admits that or the runtime's configured default and nothing else.
export const CLINICAL_DOCUMENT_MODEL = 'automatic';

export const CLINICAL_DOCUMENT_PROMPT = `Extract clinical information from this medical document. Return structured JSON with the following fields (use empty string if not found):

{
  "patient": {
    "first_name": "string",
    "last_name": "string",
    "date_of_birth": "YYYY-MM-DD",
    "medical_record_number": "string",
    "phone": "string",
    "address": "string",
    "email": "string"
  },
  "vitals": {
    "blood_pressure_systolic": "number or null",
    "blood_pressure_diastolic": "number or null",
    "heart_rate": "number or null",
    "respiratory_rate": "number or null",
    "temperature": "number or null",
    "oxygen_saturation": "number or null",
    "weight": "number or null",
    "pain_level": "number or null"
  },
  "clinical": {
    "primary_diagnosis": "string",
    "secondary_diagnoses": ["string"],
    "allergies": "string",
    "current_medications": [
      {
        "name": "string",
        "dosage": "string",
        "frequency": "string"
      }
    ],
    "chief_complaint": "string",
    "assessment": "string",
    "visit_type": "routine_visit|admission|discharge|prn|recertification"
  },
  "document_info": {
    "document_type": "fax|pdf|medical_record|lab_result|imaging",
    "document_date": "YYYY-MM-DD",
    "source_facility": "string",
    "confidence_score": "number (0-100)"
  },
  "extraction_notes": "Any important notes about incomplete or ambiguous data"
}`;

// Frozen because the handler hands a CLONE of it to the runtime on every call;
// a shared schema a caller could mutate would change what the next caller's
// document is read for.
export const CLINICAL_DOCUMENT_SCHEMA = Object.freeze({
    type: "object",
    properties: {
      patient: {
        type: "object",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          date_of_birth: { type: "string" },
          medical_record_number: { type: "string" },
          phone: { type: "string" },
          address: { type: "string" },
          email: { type: "string" }
        }
      },
      // THE ONE NARROWING, and it is forced rather than chosen.
      //
      // The original declares each of the eight vitals `["number", "null"]`,
      // because a document that does not record a blood pressure is the
      // ordinary case and not a failure. The owned runtime's schema contract
      // (`services/integration-runtime/contracts.mjs`) takes a single type
      // name, so the union is refused outright as `UNSUPPORTED_SCHEMA` — and
      // declaring them plain `number` instead would be WORSE than dropping
      // them: the runtime checks the model's answer against this schema with
      // `conforms`, so one null vital would fail the whole extraction with
      // `AI_RESULT_SCHEMA_MISMATCH` and the person would be told the document
      // could not be read.
      //
      // So the eight are not schema-checked here. They are still NAMED, with
      // their nullability, in the prompt above — which is the original's own
      // text and is what the model actually reads. What is lost is a
      // validation of their type on the way back, and a widening of the
      // runtime's contract to carry a union is the runtime's decision, not
      // this port's.
      vitals: { type: "object" },
      clinical: {
        type: "object",
        properties: {
          primary_diagnosis: { type: "string" },
          secondary_diagnoses: { type: "array", items: { type: "string" } },
          allergies: { type: "string" },
          current_medications: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                dosage: { type: "string" },
                frequency: { type: "string" }
              }
            }
          },
          chief_complaint: { type: "string" },
          assessment: { type: "string" },
          visit_type: { type: "string" }
        }
      },
      document_info: {
        type: "object",
        properties: {
          document_type: { type: "string" },
          document_date: { type: "string" },
          source_facility: { type: "string" },
          confidence_score: { type: "number" }
        }
      },
      extraction_notes: { type: "string" }
    }
  });
