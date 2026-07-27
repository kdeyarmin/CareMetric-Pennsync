// ADR document-requirement catalog — the home-health medical-review "what must
// be in the packet" knowledge base, encoded as deterministic data + merge logic.
//
// When a MAC/UPIC/SMRC/CERT/RA contractor sends an Additional Documentation
// Request (ADR) or audit letter, the agency must return a packet that proves the
// claim met Medicare's conditions of payment. This module is the single source
// of truth for WHAT belongs in that packet: each catalog entry carries the CMS
// regulation behind it (citation strings follow the repo convention used by
// referralFollowUpEngine.js — plain strings like "42 CFR 424.22(a)(1)(v);
// Medicare Benefit Policy Manual Ch. 7 §30.5.1.1"), what to include, and the
// specific points a Medicare reviewer checks for accuracy.
//
// buildAdrChecklist() merges the items the LETTER actually requested (extracted
// by adrAnalysis.js) with this CMS baseline, so staff see both what the
// contractor asked for verbatim AND what Medicare requires for payment even
// when the letter words it loosely ("all documentation supporting the claim").
//
// Like the referral engines, this module NEVER invents clinical facts: it only
// says what documentation is required and why. Pure + offline (unit-tested with
// `node --test`); no React, no SDK, no `@/` imports.

export const SEVERITIES = ["critical", "high", "medium"];

export const CATEGORIES = /** @type {const} */ ({
  eligibility: "eligibility",
  physician_orders: "physician_orders",
  assessment: "assessment",
  clinical_notes: "clinical_notes",
  claim_support: "claim_support",
  administrative: "administrative",
});

export const CATEGORY_LABELS = {
  eligibility: "Eligibility & Certification",
  physician_orders: "Physician Orders & Plan of Care",
  assessment: "Assessments (OASIS / Comprehensive)",
  clinical_notes: "Clinical Visit Documentation",
  claim_support: "Claim & Billing Support",
  administrative: "Administrative & Letter Items",
};

/** Review-program metadata. `id` values persist on AdrAuditCase.audit_type. */
export const AUDIT_TYPES = [
  { id: "mac_adr", label: "MAC ADR (prepayment/postpayment medical review)", reviewer: "Medicare Administrative Contractor" },
  { id: "tpe", label: "Targeted Probe & Educate (TPE)", reviewer: "Medicare Administrative Contractor" },
  { id: "rcd", label: "Review Choice Demonstration (RCD)", reviewer: "Medicare Administrative Contractor" },
  { id: "upic", label: "UPIC investigation", reviewer: "Unified Program Integrity Contractor" },
  { id: "smrc", label: "SMRC review", reviewer: "Supplemental Medical Review Contractor" },
  { id: "cert", label: "CERT audit", reviewer: "Comprehensive Error Rate Testing contractor" },
  { id: "ra", label: "Recovery Auditor (RAC)", reviewer: "Recovery Audit Contractor" },
  { id: "managed_care", label: "Medicare Advantage / managed-care audit", reviewer: "MA plan or delegate" },
  { id: "state_survey", label: "State survey / other", reviewer: "State agency or other reviewer" },
  { id: "other", label: "Other documentation request", reviewer: "Unspecified reviewer" },
];

export const AUDIT_TYPE_IDS = AUDIT_TYPES.map((t) => t.id);

/**
 * The catalog. Every entry:
 *   id                  stable rule id (persisted on checklist items)
 *   title               short document name staff recognize
 *   category            CATEGORIES key
 *   severity            critical = condition of payment, its absence alone
 *                       supports full denial; high = strongly expected, absence
 *                       routinely drives denials/downcodes; medium = include
 *                       when applicable
 *   citation            CMS grounding (repo plain-string convention)
 *   what_to_include     plain-English instruction for the office staff
 *   verification_points what the Medicare reviewer checks on the document —
 *                       these drive the packet accuracy review
 *   keywords            lowercase tokens used to match a letter's requested
 *                       item text to this entry
 *   when                "always" = every home-health ADR packet needs it;
 *                       otherwise a short condition ("if therapy is billed")
 */
export const ADR_DOCUMENT_CATALOG = [
  {
    id: "adr_letter_copy",
    title: "Copy of the ADR / audit letter",
    category: "administrative",
    severity: "high",
    citation: "Contractor ADR instructions (Medicare Program Integrity Manual Ch. 3 §3.2.3.2)",
    what_to_include:
      "The complete ADR or audit letter, every page, placed at the front of the packet so the reviewer can match the response to the request (claim number/DCN, beneficiary, dates of service).",
    verification_points: [
      "Letter present and legible",
      "Claim/DCN and beneficiary on the letter match the records submitted",
    ],
    keywords: ["adr letter", "this letter", "copy of letter", "request letter", "cover sheet", "barcode"],
    when: "always",
  },
  {
    id: "physician_certification",
    title: "Physician certification of eligibility (initial)",
    category: "eligibility",
    severity: "critical",
    citation: "42 CFR 424.22(a); Medicare Benefit Policy Manual Ch. 7 §30.5.1",
    what_to_include:
      "The signed and dated initial certification stating the patient is confined to the home, needs intermittent skilled care, is under the care of a physician/allowed practitioner, is under a plan of care, and that a face-to-face encounter occurred.",
    verification_points: [
      "Signed and dated by the certifying physician or allowed practitioner",
      "Certification completed no later than when the claim was submitted",
      "All five certification content elements are present",
      "Certifying practitioner matches the plan of care",
    ],
    keywords: ["certification", "certifying", "cert statement", "initial certification", "attestation of eligibility"],
    when: "always",
  },
  {
    id: "recertification",
    title: "Recertification for subsequent episodes",
    category: "eligibility",
    severity: "critical",
    citation: "42 CFR 424.22(b); Medicare Benefit Policy Manual Ch. 7 §30.5.2",
    what_to_include:
      "The signed, dated recertification for each subsequent 60-day certification period covering the billed dates of service. (The old 'estimate how much longer services are required' element was removed effective 2019 — CMS-1689-FC.)",
    verification_points: [
      "Recertification signed and dated at least every 60 days",
      "Covers the certification period containing the billed dates of service",
      "Indicates the continuing need for skilled services",
    ],
    keywords: ["recertification", "recert", "subsequent episode", "continuing eligibility"],
    when: "if the billed period is a recertification (subsequent) period",
  },
  {
    id: "face_to_face",
    title: "Face-to-face encounter documentation",
    category: "eligibility",
    severity: "critical",
    citation: "42 CFR 424.22(a)(1)(v); Medicare Benefit Policy Manual Ch. 7 §30.5.1.1",
    what_to_include:
      "The actual clinical note from the qualifying face-to-face encounter (hospital discharge summary, physician progress note, etc.) performed by an allowed practitioner within 90 days before or 30 days after the start of care, related to the primary reason home health is needed.",
    verification_points: [
      "Encounter date falls within 90 days before or 30 days after SOC",
      "Performed by a physician or allowed non-physician practitioner",
      "Encounter note is related to the primary reason for home health",
      "The encounter note itself is included — a certification checkbox alone is not sufficient",
    ],
    keywords: ["face to face", "face-to-face", "f2f", "encounter", "encounter note"],
    when: "always",
  },
  {
    id: "plan_of_care",
    title: "Plan of care (CMS-485 or equivalent), signed and dated",
    category: "physician_orders",
    severity: "critical",
    citation: "42 CFR 409.43; 42 CFR 484.60; Medicare Benefit Policy Manual Ch. 7 §30.2",
    what_to_include:
      "The individualized plan of care for every certification period touching the billed dates, containing all required content (diagnoses, mental/functional status, services with frequency and duration, medications, DME, safety measures, measurable goals, rehab potential, discharge plans), signed and dated by the certifying practitioner.",
    verification_points: [
      "Signed and dated by the certifying physician/allowed practitioner before the claim was billed",
      "Covers every billed date of service",
      "Ordered visit frequencies match the visits billed on the claim",
      "All 42 CFR 484.60(a) content elements present",
    ],
    keywords: ["plan of care", "485", "cms-485", "poc", "home health certification and plan"],
    when: "always",
  },
  {
    id: "physician_orders_interim",
    title: "All physician orders, including verbal/interim orders",
    category: "physician_orders",
    severity: "critical",
    citation: "42 CFR 484.60(b); Medicare Benefit Policy Manual Ch. 7 §30.2.5",
    what_to_include:
      "Every supplemental, verbal, and interim order affecting the billed period (frequency changes, added disciplines, medication changes, supply orders), each authenticated (signed and dated) by the ordering practitioner.",
    verification_points: [
      "Each verbal order is recorded, then signed and dated by the practitioner",
      "Orders are signed before the claim was billed",
      "Every change in visit frequency or services has a matching order",
      "Services billed never exceed what was ordered",
    ],
    keywords: ["orders", "verbal order", "interim order", "supplemental order", "telephone order"],
    when: "always",
  },
  {
    id: "oasis_assessment",
    title: "OASIS assessment(s) for the billed period",
    category: "assessment",
    severity: "critical",
    citation: "42 CFR 484.55; Medicare Claims Processing Manual Ch. 10 §10.1.10",
    what_to_include:
      "The complete OASIS (SOC and any recert/resumption/other follow-up) that generated the HIPPS code on the claim, as transmitted to iQIES, plus the clinician's signature page.",
    verification_points: [
      "OASIS matches the HIPPS/payment group on the claim",
      "SOC comprehensive assessment completed within 5 days of the start of care",
      "Assessment signed and dated by the completing clinician",
      "OASIS responses are consistent with the clinical record (functional scores, diagnoses)",
    ],
    keywords: ["oasis", "start of care assessment", "soc assessment", "outcome and assessment", "hipps"],
    when: "always",
  },
  {
    id: "comprehensive_assessment",
    title: "Comprehensive assessment incl. drug regimen review",
    category: "assessment",
    severity: "high",
    citation: "42 CFR 484.55(c); 42 CFR 484.55(c)(5)",
    what_to_include:
      "The comprehensive assessment content beyond the OASIS items — patient history, homebound narrative, and the medication/drug regimen review identifying potential adverse effects, duplications, and non-compliance.",
    verification_points: [
      "Drug regimen review documented",
      "Homebound narrative supports both statutory homebound criteria",
      "Assessment updated per 484.55(d) when condition changed",
    ],
    keywords: ["comprehensive assessment", "drug regimen review", "medication review", "medication profile", "medication list"],
    when: "always",
  },
  {
    id: "skilled_visit_notes",
    title: "Clinical notes for EVERY billed visit",
    category: "clinical_notes",
    severity: "critical",
    citation: "42 CFR 409.44; Medicare Benefit Policy Manual Ch. 7 §40.1–40.2",
    what_to_include:
      "A signed, dated visit note for every visit on the claim — skilled nursing, PT, OT, SLP, MSW, and aide. Each note must show the skilled service actually provided, the patient's response, and progress toward plan-of-care goals.",
    verification_points: [
      "Note count and dates match the visits billed on the claim exactly",
      "Each note documents a skilled service (not just custodial observations)",
      "Each note is signed and dated by the rendering clinician with credentials",
      "Documentation supports medical necessity of the ordered frequency",
    ],
    keywords: ["visit notes", "nursing notes", "clinical notes", "skilled nursing", "progress notes", "all visits"],
    when: "always",
  },
  {
    id: "homebound_support",
    title: "Homebound status documentation",
    category: "clinical_notes",
    severity: "critical",
    citation: "Social Security Act §1835(a); 42 CFR 424.22(a)(1)(ii); Medicare Benefit Policy Manual Ch. 7 §30.1.1",
    what_to_include:
      "Documentation across the record supporting BOTH homebound criteria: (1) the patient needs supportive devices, special transportation, or another person's assistance to leave home (or leaving home is medically contraindicated), AND (2) leaving home requires a considerable and taxing effort.",
    verification_points: [
      "Both statutory criteria are addressed, not just the word 'homebound'",
      "Specific functional limitations are described (device, assistance, taxing effort)",
      "Visit notes do not contradict homebound status (e.g., frequent unassisted outings)",
    ],
    keywords: ["homebound", "confined to home", "taxing effort", "homebound status"],
    when: "always",
  },
  {
    id: "therapy_evals",
    title: "Therapy evaluations, plans, and reassessments",
    category: "clinical_notes",
    severity: "high",
    citation: "42 CFR 409.44(c); Medicare Benefit Policy Manual Ch. 7 §40.2.1",
    what_to_include:
      "Initial therapy evaluations for each billed discipline, measurable goals, and the functional reassessments performed at least every 30 days by the qualified therapist, with objective measurements showing progress, restorative potential, or — for covered maintenance therapy — the continued need for a qualified therapist's skills to carry out a safe and effective maintenance program.",
    verification_points: [
      "Initial evaluation present for each therapy discipline billed",
      "Functional reassessment by the therapist at least every 30 days",
      "Objective measurements and comparison to prior results documented",
    ],
    keywords: ["therapy evaluation", "pt eval", "ot eval", "slp eval", "reassessment", "therapy notes", "30 day"],
    when: "if therapy services are billed",
  },
  {
    id: "aide_plan_supervision",
    title: "Home health aide care plan and supervision visits",
    category: "clinical_notes",
    severity: "high",
    citation: "42 CFR 484.80(g)–(h)",
    what_to_include:
      "The written aide care plan (specific tasks assigned) and the registered nurse (or therapist) supervisory visit notes conducted at least every 14 days while aide services were provided.",
    verification_points: [
      "Aide assignments in the care plan match the aide visit notes",
      "Supervisory visit at least every 14 days is documented",
    ],
    keywords: ["aide", "home health aide", "aide care plan", "supervision", "supervisory visit"],
    when: "if home health aide services are billed",
  },
  {
    id: "wound_care_documentation",
    title: "Wound care documentation with measurements",
    category: "clinical_notes",
    severity: "high",
    citation: "Medicare Benefit Policy Manual Ch. 7 §40.1.2.8",
    what_to_include:
      "Wound assessments with location, stage, measurements (length/width/depth), drainage, and treatment performed at each visit, showing the wound's course and the continued need for skilled care.",
    verification_points: [
      "Serial measurements documented, not just 'wound care performed'",
      "Treatment matches the physician's wound care orders",
    ],
    keywords: ["wound care", "wound measurements", "wound documentation", "wound assessment", "pressure ulcer", "dressing change"],
    when: "if wound care is a billed skilled service",
  },
  {
    id: "institutional_records",
    title: "Hospital / facility records supporting admission source",
    category: "claim_support",
    severity: "high",
    citation: "PDGM admission-source classification (occurrence codes 61/62); Medicare Claims Processing Manual Ch. 10",
    what_to_include:
      "Discharge summary or facility records evidencing the institutional stay that ended within 14 days of the start ('From' date) of the 30-day payment period under review — acute hospital stays (occurrence code 61) count for any period; SNF/IRF/LTCH/IPF stays (occurrence code 62) count for the first period only.",
    verification_points: [
      "Facility discharge date is within 14 days of the 'From' date of the 30-day period under review",
      "Records identify the facility and stay dates",
    ],
    keywords: ["discharge summary", "hospital records", "facility records", "institutional", "inpatient"],
    when: "if the claim was paid with an institutional admission source",
  },
  {
    id: "signature_attestation",
    title: "Signature log / attestation for illegible signatures",
    category: "claim_support",
    severity: "medium",
    citation: "Medicare Program Integrity Manual Ch. 3 §3.3.2.4",
    what_to_include:
      "A signature log or attestation statement for any clinician or practitioner whose signature in the record is illegible or missing printed credentials, so the reviewer can authenticate authorship.",
    verification_points: [
      "Every illegible signature in the packet is covered by the log/attestation",
    ],
    keywords: ["signature log", "signature attestation", "illegible signature", "authentication"],
    when: "if any signatures in the record are illegible",
  },
  {
    id: "claim_copy",
    title: "Claim copy (UB-04/837I) and beneficiary identification",
    category: "claim_support",
    severity: "medium",
    citation: "Clean-claim requirement (CMS-1450/837I); contractor ADR instructions",
    what_to_include:
      "A copy of the billed claim for the dates of service under review plus beneficiary identification (name, MBI, DOB) so the reviewer can reconcile visits, HIPPS, and occurrence codes against the record.",
    verification_points: [
      "Claim dates of service match the letter's request",
      "MBI/beneficiary details match the letter and the clinical record",
    ],
    keywords: ["ub-04", "ub04", "claim", "837", "mbi", "medicare number", "beneficiary"],
    when: "always",
  },
  {
    id: "abn_notices",
    title: "Beneficiary notices (ABN / HHCCN) if issued",
    category: "administrative",
    severity: "medium",
    citation: "Medicare Claims Processing Manual Ch. 30 §50; 42 CFR 411.404",
    what_to_include:
      "Any Advance Beneficiary Notice of Non-coverage or Home Health Change of Care Notice issued during the billed period, signed by the beneficiary.",
    verification_points: [
      "Notice properly executed (signed/dated by the beneficiary) if liability is asserted",
    ],
    keywords: ["abn", "advance beneficiary notice", "hhccn", "notice of non-coverage", "nomnc"],
    when: "if a beneficiary notice was issued during the period",
  },
];

/** Map for O(1) catalog lookups by id. */
export const CATALOG_BY_ID = Object.fromEntries(ADR_DOCUMENT_CATALOG.map((d) => [d.id, d]));

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Match one letter-requested item's free text to a catalog entry.
 * Longest-keyword match wins (so "aide care plan" beats "plan of care" for an
 * aide request, and "plan of care" beats "orders" for a 485 request).
 *
 * @param {string} letterText requested-item text as extracted from the letter
 * @returns {{ id: string, score: number } | null}
 */
export function matchCatalogItem(letterText) {
  const text = ` ${normalize(letterText)} `;
  if (!text.trim()) return null;
  let best = null;
  for (const doc of ADR_DOCUMENT_CATALOG) {
    for (const kw of doc.keywords) {
      const needle = ` ${normalize(kw)} `;
      // Keep the space padding on BOTH sides — trimming the needle defeated
      // the word-boundary check it exists for: 'abn' matched inside
      // "abnormal", 'claim' inside "disclaimer", merging unrelated letter
      // items into the wrong catalog row (and out of the checklist).
      if (needle.trim() && text.includes(needle)) {
        const score = needle.trim().length;
        if (!best || score > best.score) best = { id: doc.id, score };
      }
    }
  }
  return best;
}

/**
 * Merge the letter's requested items with the CMS baseline catalog into the
 * working checklist for the case.
 *
 * Every letter item appears exactly once: matched items adopt the catalog's
 * citation/verification points (source "letter+cms"); unmatched items are kept
 * verbatim as letter-only requirements (source "letter", severity high — the
 * contractor asked for it, so it must go in). Catalog items the letter did not
 * name are appended as CMS-baseline recommendations (source "cms_baseline"),
 * because a request for "all records supporting the claim" implicitly includes
 * them and their absence is what actually drives denials.
 *
 * @param {{ letterItems?: Array<{ text?: string, details?: string }>, auditType?: string }} opts
 * @returns {Array<object>} checklist items, ordered: letter items first (letter
 *   order preserved), then baseline items in catalog order
 */
export function buildAdrChecklist({ letterItems = [], auditType = "other" } = {}) {
  const items = [];
  const matchedRows = new Map(); // catalog id -> the checklist row already pushed
  let seq = 0;

  for (const raw of letterItems) {
    const text = String(raw?.text || "").trim();
    if (!text) continue;
    const match = matchCatalogItem(text);
    const doc = match ? CATALOG_BY_ID[match.id] : null;
    if (doc && matchedRows.has(doc.id)) {
      // Second letter line for the same physical document (letters often word
      // one requirement several ways). Keep the extra wording on the existing
      // row instead of creating a duplicate id — duplicate ids double-count in
      // the verification summary and break per-id React keys downstream.
      const row = matchedRows.get(doc.id);
      row.letter_text = `${row.letter_text}; ${text}`;
      const details = String(raw?.details || "").trim();
      if (details) row.letter_details = row.letter_details ? `${row.letter_details}; ${details}` : details;
      continue;
    }
    seq += 1;
    const item = {
      id: doc ? doc.id : `letter_${seq}`,
      seq,
      source: doc ? "letter+cms" : "letter",
      title: doc ? doc.title : text.slice(0, 140),
      letter_text: text,
      letter_details: String(raw?.details || "").trim() || undefined,
      category: doc ? doc.category : "administrative",
      // A letter-only item is always at least "high" — the contractor asked
      // for it by name; an (off-schema) AI severity field must not downgrade it.
      severity: doc ? doc.severity : "high",
      citation: doc ? doc.citation : "Requested by the reviewing contractor in this letter",
      what_to_include: doc ? doc.what_to_include : text,
      verification_points: doc ? doc.verification_points : ["Document present and legible as requested by the letter"],
      when: doc ? doc.when : "requested by this letter",
    };
    items.push(item);
    if (doc) matchedRows.set(doc.id, item);
  }

  for (const doc of ADR_DOCUMENT_CATALOG) {
    if (matchedRows.has(doc.id)) continue;
    seq += 1;
    items.push({
      id: doc.id,
      seq,
      source: "cms_baseline",
      title: doc.title,
      category: doc.category,
      severity: doc.severity,
      citation: doc.citation,
      what_to_include: doc.what_to_include,
      verification_points: doc.verification_points,
      when: doc.when,
    });
  }

  return items.map((it) => ({ ...it, audit_type: AUDIT_TYPE_IDS.includes(auditType) ? auditType : "other" }));
}

/**
 * Order + group a checklist for display/print: letter-requested items first
 * within each category, categories in the CATEGORY_LABELS order.
 *
 * @param {Array<object>} checklist from buildAdrChecklist
 * @returns {Array<{ category: string, label: string, items: Array<object> }>}
 */
export function groupChecklistByCategory(checklist = []) {
  const order = Object.keys(CATEGORY_LABELS);
  const known = new Set(order);
  const byLetterFirst = (a, b) => {
    const aLetter = a.source !== "cms_baseline" ? 0 : 1;
    const bLetter = b.source !== "cms_baseline" ? 0 : 1;
    return aLetter - bLetter || a.seq - b.seq;
  };
  const groups = order.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: checklist.filter((it) => it.category === category).sort(byLetterFirst),
  }));
  // A persisted row whose category has drifted must still be shown — silently
  // dropping it removes a requirement from both the panel and the print.
  const strays = checklist.filter((it) => !known.has(it.category)).sort(byLetterFirst);
  if (strays.length) groups.push({ category: "other", label: "Other requirements", items: strays });
  return groups.filter((g) => g.items.length > 0);
}
