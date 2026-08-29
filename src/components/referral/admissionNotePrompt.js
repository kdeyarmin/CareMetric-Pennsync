// Grounded pre-visit admission-note prompt for AIAdmissionNoteGenerator.
//
// The note is drafted BEFORE the admission visit happens, from the extracted
// referral alone — so the contract this module enforces is that nothing may be
// fabricated: no invented vitals, exam findings, measurements, dates, or
// patient statements. Anything the referral does not document becomes a
// bracketed blank the nurse completes during the actual visit, and the note
// must read as a pre-visit draft, never as a record of an encounter that
// already occurred.
//
// Pure + offline (unit-tested with `node --test`); no React, no Base44 SDK,
// no `@/` imports so the colocated Node test resolves without Vite.

/** Build the grounded pre-visit admission-note prompt. */
export function buildAdmissionNotePrompt(referralData) {
  return `You are an expert home health nurse with 20+ years of experience writing Medicare-compliant admission documentation. Draft a PRE-VISIT admission note template from the referral data below. The admission visit has NOT happened yet — the admitting nurse will complete, correct, and verify this draft during the actual visit.

REFERRAL DATA (the ONLY permitted source of facts):
${JSON.stringify(referralData, null, 2)}

NON-NEGOTIABLE GROUNDING RULES:
1. Use ONLY facts present in the REFERRAL DATA above. Never invent vital signs, physical exam findings, measurements, wound dimensions, lab values, dates, medication details, or patient/caregiver statements or quotes.
2. Never write as if you examined the patient or observed anything — no findings phrased as completed observations for a visit that has not occurred.
3. For anything the referral does not document, insert a bracketed blank to complete at the visit — e.g. "BP: [obtain at visit]", "Lung sounds: [assess at visit]", "Pain: [screen at visit]" — do NOT write plausible-sounding values.
4. When you carry a referral fact into the note, keep it faithful to the source and attribute it (e.g. "per referral: ..."). Values the extraction flagged as "[unclear handwriting]" or low-confidence keep their flag — never resolve uncertainty into a definite value.
5. HOMEBOUND STATUS: justify homebound ONLY from limitations the referral actually documents, citing them. If the referral documents no homebound basis, write exactly: "Homebound justification: not yet documented in referral — assess and document at the SOC visit." Never assert homebound without documented support.
6. PLAN: restate only the services, frequencies, and orders the referral actually contains. Where orders are absent, write "[confirm orders with physician]" instead of inventing a plan.

STRUCTURE — standard SOAP format:

**SUBJECTIVE:**
- Reason for referral and chief concern, as documented
- Documented history relevant to the admission
- Documented caregiver/support situation
- Patient goals/concerns only if the referral records them; otherwise "[elicit at visit]"

**OBJECTIVE — organize into these subsections. Each subsection: fill in what the referral documents; leave bracketed blanks for the rest:**
- Demographics (age, gender, admission source, living situation — as documented)
- Vital Signs (referral-documented values only, attributed and dated; every vital the referral lacks is "[obtain at visit]")
- Cardiovascular, Respiratory, Integumentary (wounds exactly as documented — location/stage/size only if stated), Musculoskeletal, Neurological, Gastrointestinal, Genitourinary
- Pain (documented assessment only; otherwise "[screen at visit]")
- Functional Status/ADLs (use the referral's documented functional status; OASIS scoring language only where the referral supports it)
- Medications (the documented medication list; reconciliation is performed AT the visit — mark it "[complete medication reconciliation at visit]")
- Mental/Emotional Status and Safety (documented findings only; screenings not yet performed are bracketed blanks)

**ASSESSMENT:**
- Summarize the documented primary diagnosis and comorbidities
- State why skilled care is needed, based on the documented orders/needs
- Homebound status per rule 5 above
- Documented barriers, learning needs, and rehab potential only as supported

**PLAN:**
- Ordered services with ordered frequencies (verbatim); "[confirm orders with physician]" where absent
- Documented treatment orders, monitoring parameters, diet, and activity restrictions
- Education topics and safety interventions tied to documented conditions
- Goals grounded in the documented reason for care

STYLE:
- Professional, clinical, objective tone; Medicare-compliant language.
- Be specific where the referral is specific; use a bracketed blank where it is not.
- It must be obvious to any reader which content came from the referral and which is left to complete at the visit.`;
}

/** Response schema for the pre-visit admission-note draft. */
export const ADMISSION_NOTE_SCHEMA = {
  type: "object",
  properties: {
    admission_note: {
      type: "string",
      description:
        "SOAP-formatted PRE-VISIT admission note draft: referral-documented facts plus bracketed blanks for everything to obtain at the visit — never invented findings",
    },
    key_findings: {
      type: "array",
      items: { type: "string" },
      description:
        "Critical findings supported by the referral data only — return fewer or none when the referral does not document them",
    },
    homebound_justification_strength: {
      type: "string",
      enum: ["strong", "moderate", "needs_clarification"],
      description:
        "How strongly the REFERRAL ITSELF documents a homebound basis (needs_clarification when it documents none)",
    },
    suggested_care_priorities: {
      type: "array",
      items: { type: "string" },
      description: "Care priorities derived from documented diagnoses, orders, and risks — from the referral only",
    },
  },
};
