/**
 * Referral triage review layer (D234): the PDGM coding review, the Medicare
 * compliance checklist, the missing-items packet with its auto-generated
 * forms, and the PDF content models for the Referral Triage surface.
 *
 * Everything here is pure data transformation over the stored triage
 * `analysis` object — no React, no Base44 SDK, no `@/` imports — so the
 * colocated Node test resolves without Vite, and so the SAME builders feed
 * the on-screen cards and the downloadable PDFs. What is rendered is what
 * is printed; there is no second copy of the review to drift.
 *
 * Invariants this module holds (D233 + D234):
 *  - Nothing here surfaces a document-sourced MRN or an SSN-shaped string.
 *    `sanitizeForDisplay` runs over every model this module returns, the
 *    same rule the backend synthesis applies before the analysis is stored
 *    (legacy stored analyses predate that pass, so it is applied again at
 *    this boundary — the last one before render and PDF).
 *  - Codes are never invented. The deterministic layer reuses
 *    `generateDiagnosisCodes`, which only surfaces codes literally present
 *    in the analysis and routes documented-but-uncoded diagnoses to a human
 *    coder; the AI review's candidates stay candidates until the stated
 *    documentation exists.
 *  - A missing or degraded review never fails the analysis: builders return
 *    explicit "unavailable" shapes and the surface reports the review's own
 *    status instead.
 *  - Generated forms are UNSIGNED. They carry blank signature and date
 *    lines and a generated-by note; nothing here can make a form look
 *    signed, because the signature is the certifying provider's act, not
 *    the analyzer's.
 */

import { generateDiagnosisCodes, formatIcd } from "./diagnosisCodeGenerator.js";
import { validatePrimaryDiagnosis, previewClinicalGroup } from "./intakeDiagnosisValidator.js";

// ---------------------------------------------------------------------------
// Sanitization (D233: no document MRN; never an SSN)
// ---------------------------------------------------------------------------

const SSN_SHAPED = /\b\d{3}-\d{2}-\d{4}\b/g;
const MRN_MENTION = /\bMRN\s*[:#]?\s*\d+\b/gi;

/** Deep-sanitize a value headed for render or PDF (mirrors the backend pass). */
export function sanitizeForDisplay(value) {
  if (typeof value === "string") {
    return value.replace(SSN_SHAPED, "[redacted]").replace(MRN_MENTION, "MRN [not recorded]");
  }
  if (Array.isArray(value)) return value.map(sanitizeForDisplay);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "medical_record_number" || key === "mrn") continue;
      out[key] = sanitizeForDisplay(entry);
    }
    return out;
  }
  return value;
}

const text = (value) => (typeof value === "string" ? value.trim() : "");
const NOT_PROVIDED = "Not provided";

// ---------------------------------------------------------------------------
// Part E — packet labels
// ---------------------------------------------------------------------------

/**
 * The primary label for a packet row: the patient's name once the analysis
 * has one, a processing label while the job is open, and never the uploaded
 * file's name (the file name survives only as secondary metadata, applied by
 * the caller).
 */
export function packetLabel(job) {
  if (!job || typeof job !== "object") return "Referral packet";
  const fromView = text(job.patient_name);
  const fromAnalysis = job.analysis && typeof job.analysis === "object" ? text(job.analysis.patient_name) : "";
  const name = fromView || fromAnalysis;
  if (job.status === "ready") {
    return name && name !== NOT_PROVIDED ? sanitizeForDisplay(name) : "Referral packet";
  }
  if (job.status === "failed") return "Analysis failed";
  return "Analyzing packet…";
}

// ---------------------------------------------------------------------------
// Part D — Medicare compliance checklist (42 CFR 424.22 elements)
// ---------------------------------------------------------------------------

export const COMPLIANCE_ELEMENTS = [
  { key: "homebound_status", label: "Homebound status documented" },
  { key: "skilled_need", label: "Skilled need documented" },
  { key: "face_to_face_documented", label: "Face-to-face encounter documented" },
  { key: "face_to_face_timing", label: "Face-to-face timing valid (90 days before to 30 days after start of care)" },
  { key: "certifying_provider", label: "Certifying provider identified and eligible (MD, DO, NP, PA, CNS, CNM)" },
  { key: "referral_order", label: "Referral order present" },
  { key: "plan_of_care_elements", label: "Plan-of-care elements present" },
  { key: "diagnoses_valid", label: "Diagnoses valid and specific" },
];

const COMPLIANCE_STATUSES = new Set(["satisfied", "missing", "conflicting"]);

/**
 * The checklist always carries all eight elements: an element the model (or
 * a legacy stored analysis) does not answer reads as missing with the
 * standard evidence line, never as an absent row staff cannot see.
 */
export function normalizeComplianceChecklist(analysis) {
  const source = analysis && typeof analysis === "object" && analysis.medicare_compliance
    && typeof analysis.medicare_compliance === "object"
    ? analysis.medicare_compliance
    : {};
  return COMPLIANCE_ELEMENTS.map(({ key, label }) => {
    const entry = source[key] && typeof source[key] === "object" ? source[key] : {};
    const status = COMPLIANCE_STATUSES.has(entry.status) ? entry.status : "missing";
    const evidence = text(entry.evidence) || "Not documented in the packet notes";
    return { key, label, status, evidence: sanitizeForDisplay(evidence) };
  });
}

// ---------------------------------------------------------------------------
// Part B — PDGM coding review
// ---------------------------------------------------------------------------

function modelCodes(review) {
  const codes = Array.isArray(review.codes) ? review.codes : [];
  return codes
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => ({
      code: text(entry.code),
      description: text(entry.description),
      position: Number.isSafeInteger(entry.position) ? entry.position : index + 1,
      pdgm_role: entry.pdgm_role === "primary_clinical_grouping" ? "primary_clinical_grouping" : "comorbidity_adjustment",
      justification: text(entry.justification),
      documentation_support: text(entry.documentation_support),
      specificity_flag: text(entry.specificity_flag) || null,
      suggested_more_specific: entry.suggested_more_specific && typeof entry.suggested_more_specific === "object"
        ? {
            code: text(entry.suggested_more_specific.code),
            description: text(entry.suggested_more_specific.description),
            basis: text(entry.suggested_more_specific.basis),
          }
        : null,
      conflict: text(entry.conflict) || null,
      deterministic_flag: null,
    }))
    .sort((a, b) => a.position - b.position);
}

function deterministicCodes(generated) {
  return (generated.sequenced || []).map((entry) => ({
    code: entry.displayCode || formatIcd(entry.code || ""),
    description: entry.description || "",
    position: entry.position,
    pdgm_role: entry.role === "primary" ? "primary_clinical_grouping" : "comorbidity_adjustment",
    justification: entry.documentedAsPrimary
      ? "Documented as the primary diagnosis in the packet."
      : "Documented in the packet.",
    documentation_support: (entry.evidence || []).map((e) => e.text).filter(Boolean).join(" "),
    specificity_flag: null,
    suggested_more_specific: null,
    conflict: null,
    deterministic_flag: entry.role === "primary" && entry.acceptablePrimary === false
      ? entry.rtpReason
      : null,
  }));
}

function uncodedCandidates(generated) {
  return (generated.uncoded || []).map((entry) => ({
    condition: entry.description || "",
    candidate_code: "",
    evidence: `Documented in the packet (${entry.path || "referral"}) without an ICD-10 code.`,
    pdgm_relevance: entry.documentedAsPrimary
      ? "Documented as a primary diagnosis; it cannot drive the PDGM clinical grouping until it is coded."
      : "A documented condition that may support comorbidity adjustment once coded.",
    documentation_required:
      "A certified coder must assign the specific ICD-10 code from the documented diagnosis before this condition can be used.",
  }));
}

/**
 * The coding review the surface renders. The AI review (stored on the
 * analysis by the synthesis) is primary; the deterministic layer runs
 * regardless and either annotates it (an unacceptable-as-primary primary is
 * flagged even if the model passed it) or stands in for it when the model
 * returned none — reported as its own availability, never as an analysis
 * failure.
 */
export function buildCodingReview(analysis) {
  const safe = analysis && typeof analysis === "object" ? analysis : {};
  const generated = generateDiagnosisCodes(safe);
  const primaryCode = generated.primary?.displayCode || generated.primary?.code || "";
  const primaryCheck = primaryCode ? validatePrimaryDiagnosis(primaryCode) : null;
  const deterministic = {
    clinical_group: primaryCode ? previewClinicalGroup(primaryCode).clinical_group : null,
    primary_code: primaryCode || null,
    primary_acceptable: primaryCheck ? primaryCheck.acceptable : null,
    primary_reason: primaryCheck ? primaryCheck.reason : null,
    warnings: generated.warnings || [],
  };

  const review = safe.diagnosis_coding_review && typeof safe.diagnosis_coding_review === "object"
    ? safe.diagnosis_coding_review
    : null;

  if (!review) {
    const codes = deterministicCodes(generated);
    const orderingAssessment = !generated.hasCodes
      ? "No ICD-10 codes are documented in this packet, so no ordering can be assessed. Codes are never assigned by the analyzer — obtain coded diagnoses from the referral source or a certified coder."
      : deterministic.primary_acceptable === false
        ? `The documented primary (${deterministic.primary_code}) is not acceptable as a PDGM principal diagnosis: ${deterministic.primary_reason} A qualified coding review must resolve the primary; no secondary has been promoted in its place.`
        : `The documented primary (${deterministic.primary_code}) is affirmed as the diagnosis chiefly responsible for the plan of care, as documented in the packet.`;
    return sanitizeForDisplay({
      available: generated.hasCodes,
      source: "deterministic",
      documented_primary: text(safe.primary_diagnosis),
      ordering_assessment: orderingAssessment,
      codes,
      candidates: uncodedCandidates(generated),
      documentation_needs: [],
      deterministic,
    });
  }

  const codes = modelCodes(review);
  // The deterministic RTP screen annotates the model's primary even when
  // the model passed it — that disagreement is exactly what staff must see.
  const primaryEntry = codes.find((entry) => entry.pdgm_role === "primary_clinical_grouping") || codes[0];
  if (primaryEntry && primaryEntry.code) {
    const check = validatePrimaryDiagnosis(primaryEntry.code);
    if (!check.acceptable) {
      primaryEntry.deterministic_flag =
        `Deterministic check: ${check.reason}`;
    }
  }
  const modelCandidates = (Array.isArray(review.candidates) ? review.candidates : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      condition: text(entry.condition),
      candidate_code: text(entry.candidate_code),
      evidence: text(entry.evidence),
      pdgm_relevance: text(entry.pdgm_relevance),
      documentation_required: text(entry.documentation_required),
    }));
  const seen = new Set(modelCandidates.map((c) => c.condition.toLowerCase()).filter(Boolean));
  // A documented-but-uncoded diagnosis the AI review DID code is not a
  // candidate: the harvester reads the free-text diagnosis fields, which
  // carry no codes even when the review coded the same condition.
  const codedDescriptions = codes.map((c) => c.description.toLowerCase()).filter(Boolean);
  const extraCandidates = uncodedCandidates(generated)
    .filter((c) => !seen.has(c.condition.toLowerCase()))
    .filter((c) => {
      const condition = c.condition.toLowerCase();
      return !codedDescriptions.some((d) => d.includes(condition) || condition.includes(d));
    });

  return sanitizeForDisplay({
    available: true,
    source: "ai_review",
    documented_primary: text(review.documented_primary) || text(safe.primary_diagnosis),
    ordering_assessment: text(review.ordering_assessment),
    codes,
    candidates: [...modelCandidates, ...extraCandidates],
    documentation_needs: (Array.isArray(review.documentation_needs) ? review.documentation_needs : [])
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        item: text(entry.item),
        for_code: text(entry.for_code),
        detail: text(entry.detail),
      })),
    deterministic,
  });
}

// ---------------------------------------------------------------------------
// Part D — missing-items packet
// ---------------------------------------------------------------------------

const COMPLIANCE_ITEM_META = {
  referral_order: {
    category: "order",
    label: "Home health order from the certifying provider",
    generatable: "home_health_order",
  },
  face_to_face_documented: {
    category: "face_to_face",
    label: "Face-to-face encounter documentation",
    generatable: "f2f_form",
  },
  face_to_face_timing: {
    category: "face_to_face",
    label: "Face-to-face encounter within the required window (42 CFR 424.22)",
    generatable: "f2f_form",
  },
  homebound_status: {
    category: "documentation",
    label: "Documentation of homebound status",
    generatable: "request_cover",
  },
  skilled_need: {
    category: "documentation",
    label: "Documentation of skilled need",
    generatable: "request_cover",
  },
  certifying_provider: {
    category: "documentation",
    label: "Certifying provider identification (eligible type: MD, DO, NP, PA, CNS, CNM)",
    generatable: "request_cover",
  },
  plan_of_care_elements: {
    category: "documentation",
    label: "Plan-of-care elements (disciplines, frequencies, treatments)",
    generatable: "request_cover",
  },
  diagnoses_valid: {
    category: "diagnosis_documentation",
    label: "Valid, specific diagnoses (see the coding review)",
    generatable: "request_cover",
  },
};

function neededFromFor(analysis, category) {
  if (category === "order" || category === "face_to_face") {
    return text(analysis.certifying_provider)
      || text(analysis.referring_physician)
      || "The certifying provider";
  }
  return text(analysis.referral_source)
    || text(analysis.referring_physician)
    || "The referring facility/provider";
}

/**
 * Every gap the analysis found, as one structured packet: compliance gaps,
 * the analysis's own data gaps, and the coding review's documentation needs
 * (specificity support for used codes + candidate requirements). Each item
 * names what form, if any, the packet auto-generates for it.
 */
export function buildMissingItems(analysis, { codingReview, compliance } = {}) {
  const safe = analysis && typeof analysis === "object" ? analysis : {};
  const checklist = compliance || normalizeComplianceChecklist(safe);
  const review = codingReview || buildCodingReview(safe);
  const items = [];

  for (const entry of checklist) {
    if (entry.status === "satisfied") continue;
    const meta = COMPLIANCE_ITEM_META[entry.key];
    items.push({
      id: `compliance-${entry.key}`,
      category: meta.category,
      label: meta.label,
      detail: entry.evidence,
      status: entry.status,
      needed_from: neededFromFor(safe, meta.category),
      generatable: meta.generatable,
    });
  }

  for (const need of review.documentation_needs || []) {
    if (!need.item) continue;
    items.push({
      id: `coding-need-${items.length}`,
      category: "diagnosis_documentation",
      label: need.for_code ? `${need.item} (for ${need.for_code})` : need.item,
      detail: need.detail || need.item,
      status: "missing",
      needed_from: neededFromFor(safe, "documentation"),
      generatable: "request_cover",
    });
  }

  for (const candidate of review.candidates || []) {
    if (!candidate.documentation_required) continue;
    items.push({
      id: `candidate-${items.length}`,
      category: "diagnosis_documentation",
      label: `Documentation required before ${candidate.candidate_code || "a code"} may be used for: ${candidate.condition}`,
      detail: candidate.documentation_required,
      status: "missing",
      needed_from: neededFromFor(safe, "documentation"),
      generatable: "request_cover",
    });
  }

  for (const gap of Array.isArray(safe.data_gaps) ? safe.data_gaps : []) {
    const label = text(gap);
    if (!label) continue;
    items.push({
      id: `gap-${items.length}`,
      category: "other",
      label,
      detail: label,
      status: "missing",
      needed_from: neededFromFor(safe, "documentation"),
      generatable: "request_cover",
    });
  }

  return sanitizeForDisplay({ items, total: items.length });
}

// ---------------------------------------------------------------------------
// Part D — auto-generated forms (populated, UNSIGNED)
// ---------------------------------------------------------------------------

export const CERTIFICATION_STATEMENTS = [
  "The patient is confined to the home.",
  "The patient needs intermittent skilled nursing care, physical therapy, or speech-language pathology services, or continues to need occupational therapy after receiving such care.",
  "A plan of care has been established and is periodically reviewed by the certifying provider.",
  "The patient is under the care of the certifying provider.",
  "A face-to-face encounter related to the primary reason for home health services occurred within 90 days before, or within 30 days after, the start of care, and was performed by an eligible practitioner (MD, DO, NP, PA, CNS, or CNM).",
];

const UNSIGNED_NOTE =
  "Generated by PennSync from the referral analysis. This document is UNSIGNED — it takes effect only when signed and dated by the certifying provider.";

function patientBlock(analysis) {
  return {
    name: text(analysis.patient_name),
    date_of_birth: text(analysis.date_of_birth),
    address: text(analysis.patient_address),
    phone: text(analysis.patient_phone),
  };
}

function orderedDiagnoses(codingReview) {
  const codes = (codingReview?.codes || []).filter((entry) => entry.code);
  if (codes.length > 0) {
    return codes.map((entry) => ({
      position: entry.position,
      code: entry.code,
      description: entry.description,
      role: entry.pdgm_role === "primary_clinical_grouping" ? "Primary" : "Secondary",
    }));
  }
  return [];
}

/** A complete home-health order for the certifying provider, ready to sign. */
export function buildOrderFormModel(analysis, codingReview) {
  const safe = analysis && typeof analysis === "object" ? analysis : {};
  const plan = safe.preliminary_care_plan && typeof safe.preliminary_care_plan === "object"
    ? safe.preliminary_care_plan
    : {};
  return sanitizeForDisplay({
    kind: "home_health_order",
    title: "Home Health Order — For Certifying Provider Signature",
    patient: patientBlock(safe),
    payer_name: text(safe.payer_name),
    certifying_provider: text(safe.certifying_provider) || text(safe.referring_physician),
    referral_source: text(safe.referral_source),
    diagnoses: orderedDiagnoses(codingReview || buildCodingReview(safe)),
    disciplines: [
      {
        discipline: "Skilled nursing",
        frequency: text(plan.skilled_nursing_frequency),
        focus_areas: Array.isArray(plan.initial_focus_areas) ? plan.initial_focus_areas.map(text).filter(Boolean) : [],
      },
    ],
    equipment_needed: Array.isArray(plan.equipment_needed) ? plan.equipment_needed.map(text).filter(Boolean) : [],
    medications_to_reconcile: text(plan.medications_to_reconcile),
    certification_statements: [...CERTIFICATION_STATEMENTS],
    signature: { label: "Certifying provider signature", signed: false, date_line: true },
    generated_note: UNSIGNED_NOTE,
  });
}

/** A populated face-to-face encounter form for the provider to complete/sign. */
export function buildF2FFormModel(analysis) {
  const safe = analysis && typeof analysis === "object" ? analysis : {};
  return sanitizeForDisplay({
    kind: "f2f_form",
    title: "Face-to-Face Encounter Documentation — For Provider Completion and Signature",
    patient: patientBlock(safe),
    encounter: {
      date: text(safe.face_to_face_date),
      practitioner: text(safe.face_to_face_practitioner),
      practitioner_type: text(safe.face_to_face_practitioner_type),
      related_condition: text(safe.primary_diagnosis),
    },
    attestation_prompts: [
      "The encounter was related to the primary reason the patient requires home health services.",
      "The patient is confined to the home (homebound).",
      "The patient needs intermittent skilled nursing care and/or therapy as described in the plan of care.",
      "The encounter occurred within 90 days before, or within 30 days after, the start of care (42 CFR 424.22).",
    ],
    clinical_findings_prompt:
      "Clinical findings from the encounter that support homebound status and the skilled need (to be completed by the practitioner):",
    signature: { label: "Practitioner signature", signed: false, date_line: true },
    generated_note: UNSIGNED_NOTE,
  });
}

/** A request cover to the referring facility/provider for non-generatable items. */
export function buildRequestCoverModel(analysis, items) {
  const safe = analysis && typeof analysis === "object" ? analysis : {};
  const requested = (items || []).filter((item) => item.generatable === "request_cover");
  return sanitizeForDisplay({
    kind: "request_cover",
    title: "Documentation Request — Missing Referral Items",
    to: text(safe.referral_source) || text(safe.referring_physician),
    to_contact: text(safe.referring_physician_contact),
    patient: patientBlock(safe),
    intro:
      "To complete this home health referral, Penn Home Health still needs the items below. Please send the requested documentation to the agency office. This request was generated from the referral analysis; each item states exactly what is needed.",
    items: requested.map((item) => ({ label: item.label, detail: item.detail })),
    generated_note:
      "Generated by PennSync from the referral analysis. No signature is required on this request.",
  });
}

// ---------------------------------------------------------------------------
// The bundle the surface consumes
// ---------------------------------------------------------------------------

/**
 * One call builds everything the triage result renders and prints. The
 * forms are built only when the packet actually calls for them (an order
 * form when the order is missing, an F2F form when the encounter or its
 * timing is missing, a request cover when any non-generatable item exists).
 */
export function buildReviewBundle(analysis) {
  const safe = analysis && typeof analysis === "object" ? sanitizeForDisplay(analysis) : {};
  const codingReview = buildCodingReview(safe);
  const compliance = normalizeComplianceChecklist(safe);
  const missingPacket = buildMissingItems(safe, { codingReview, compliance });
  const items = missingPacket.items;
  const forms = {
    order: items.some((item) => item.generatable === "home_health_order")
      ? buildOrderFormModel(safe, codingReview)
      : null,
    f2f: items.some((item) => item.generatable === "f2f_form")
      ? buildF2FFormModel(safe)
      : null,
    cover: items.some((item) => item.generatable === "request_cover")
      ? buildRequestCoverModel(safe, items)
      : null,
  };
  return { codingReview, compliance, missingPacket, forms };
}

// ---------------------------------------------------------------------------
// Part C — PDF content models (repo pdfExporter content blocks)
// ---------------------------------------------------------------------------

const value = (v) => (text(v) ? text(v) : "Not documented");
const listOrNone = (arr) => (Array.isArray(arr) && arr.filter((x) => text(x)).length > 0
  ? arr.filter((x) => text(x))
  : ["None documented"]);

export function patientInfoRows(analysis) {
  const safe = analysis && typeof analysis === "object" ? analysis : {};
  return [
    ["Patient", value(safe.patient_name)],
    ["Date of Birth", value(safe.date_of_birth)],
    ["Address", value(safe.patient_address)],
    ["Phone", value(safe.patient_phone)],
    ["Referral Source", value(safe.referral_source)],
    ["Referring Physician", value(safe.referring_physician)],
    ["Certifying Provider", value(safe.certifying_provider)],
    ["Payer", value(safe.payer_name)],
    ["Primary Diagnosis", value(safe.primary_diagnosis)],
  ];
}

export function codingReviewPdfContent(review) {
  const content = [{ type: "heading", text: "Diagnosis Coding Review (PDGM)" }];
  if (!review || review.available === false) {
    content.push({
      type: "text",
      text: "The coding review is unavailable for this analysis: no ICD-10 codes are documented in the packet. Codes are never assigned by the analyzer — obtain coded diagnoses from the referral source or a certified coder.",
    });
    return content;
  }
  if (review.source === "deterministic") {
    content.push({
      type: "text",
      text: "The AI coding review was not returned for this analysis; the deterministic documentation check below stands in for it. It lists only codes documented in the packet and never assigns a code.",
    });
  }
  content.push({ type: "text", text: `Documented primary diagnosis: ${value(review.documented_primary)}` });
  content.push({ type: "text", text: `Ordering assessment: ${value(review.ordering_assessment)}` });
  if (review.deterministic?.clinical_group) {
    content.push({ type: "text", text: `PDGM clinical group preview (from the primary code): ${review.deterministic.clinical_group}` });
  }
  for (const entry of review.codes || []) {
    content.push({
      type: "text",
      text: `${entry.position}. ${entry.code} — ${entry.description} (${entry.pdgm_role === "primary_clinical_grouping" ? "Primary — PDGM clinical grouping" : "Secondary — comorbidity adjustment"})`,
    });
    content.push({ type: "text", text: `   Justification: ${value(entry.justification)}` });
    content.push({ type: "text", text: `   Documentation support: ${value(entry.documentation_support)}` });
    if (entry.specificity_flag) {
      content.push({ type: "text", text: `   Specificity flag: ${entry.specificity_flag}` });
    }
    if (entry.suggested_more_specific) {
      content.push({
        type: "text",
        text: `   More specific code supported by the documentation: ${entry.suggested_more_specific.code} — ${entry.suggested_more_specific.description} (basis: ${entry.suggested_more_specific.basis})`,
      });
    }
    if (entry.conflict) content.push({ type: "text", text: `   CONFLICT — requires clarification: ${entry.conflict}` });
    if (entry.deterministic_flag) content.push({ type: "text", text: `   ${entry.deterministic_flag}` });
  }
  if ((review.candidates || []).length > 0) {
    content.push({ type: "heading", text: "Additional Candidate Codes — Not Codable Until Documented" });
    for (const candidate of review.candidates) {
      content.push({
        type: "text",
        text: `${candidate.condition}${candidate.candidate_code ? ` (candidate ${candidate.candidate_code})` : ""} — Evidence: ${candidate.evidence} PDGM relevance: ${candidate.pdgm_relevance} Documentation required before use: ${candidate.documentation_required}`,
      });
    }
  }
  if ((review.documentation_needs || []).length > 0) {
    content.push({ type: "heading", text: "Diagnosis Documentation Needed" });
    for (const need of review.documentation_needs) {
      content.push({ type: "text", text: `${need.item}${need.for_code ? ` (for ${need.for_code})` : ""}: ${need.detail}` });
    }
  }
  return content;
}

export function compliancePdfContent(compliance) {
  return [
    { type: "heading", text: "Medicare Compliance Checklist (42 CFR 424.22)" },
    {
      type: "table",
      headers: ["Element", "Status", "Evidence"],
      rows: (compliance || []).map((entry) => [entry.label, entry.status, entry.evidence]),
    },
  ];
}

export function missingItemsPdfContent(packet) {
  const content = [{ type: "heading", text: "Missing Items — Still Needed for This Referral" }];
  if (!packet || packet.total === 0) {
    content.push({ type: "text", text: "Nothing is missing: every compliance element is satisfied and the analysis found no data gaps." });
    return content;
  }
  content.push({
    type: "table",
    headers: ["Item Needed", "Detail", "Needed From", "Generated Document"],
    rows: packet.items.map((item) => [
      item.label,
      item.detail,
      item.needed_from,
      item.generatable === "home_health_order"
        ? "Home health order (attached in the missing-items packet)"
        : item.generatable === "f2f_form"
          ? "Face-to-face form (attached in the missing-items packet)"
          : "Request cover (attached in the missing-items packet)",
    ]),
  });
  return content;
}

/** One generated form as PDF content blocks. Signature lines stay blank. */
export function formPdfContent(model) {
  if (!model) return [];
  const content = [{ type: "heading", text: model.title }];
  const patient = model.patient || {};
  content.push({
    type: "table",
    headers: ["Patient", "Detail"],
    rows: [
      ["Name", value(patient.name)],
      ["Date of Birth", value(patient.date_of_birth)],
      ["Address", value(patient.address)],
      ["Phone", value(patient.phone)],
    ],
  });

  if (model.kind === "home_health_order") {
    if (model.payer_name) content.push({ type: "text", text: `Payer: ${model.payer_name}` });
    content.push({ type: "text", text: `Certifying provider: ${value(model.certifying_provider)}` });
    content.push({ type: "heading", text: "Ordered Diagnoses (PDGM order)" });
    content.push({
      type: "table",
      headers: ["#", "Code", "Diagnosis", "Role"],
      rows: (model.diagnoses || []).map((d) => [String(d.position), d.code, d.description, d.role]),
    });
    content.push({ type: "heading", text: "Orders" });
    for (const discipline of model.disciplines || []) {
      content.push({
        type: "text",
        text: `${discipline.discipline}: ${value(discipline.frequency)}${discipline.focus_areas?.length ? ` — focus: ${discipline.focus_areas.join("; ")}` : ""}`,
      });
    }
    if (model.equipment_needed?.length) {
      content.push({ type: "text", text: `Equipment needed: ${model.equipment_needed.join("; ")}` });
    }
    if (model.medications_to_reconcile) {
      content.push({ type: "text", text: `Medications to reconcile: ${model.medications_to_reconcile}` });
    }
    content.push({ type: "heading", text: "Certification (42 CFR 424.22)" });
    content.push({
      type: "text",
      text: "By signing below, the certifying provider certifies that:",
    });
    for (const statement of model.certification_statements || []) {
      content.push({ type: "text", text: `• ${statement}` });
    }
  }

  if (model.kind === "f2f_form") {
    const encounter = model.encounter || {};
    content.push({
      type: "table",
      headers: ["Encounter", "Detail"],
      rows: [
        ["Encounter date", value(encounter.date)],
        ["Practitioner", value(encounter.practitioner)],
        ["Practitioner type", value(encounter.practitioner_type)],
        ["Related condition (primary reason for home health)", value(encounter.related_condition)],
      ],
    });
    content.push({ type: "heading", text: "Attestations (to be confirmed by the practitioner)" });
    for (const prompt of model.attestation_prompts || []) {
      content.push({ type: "text", text: `☐ ${prompt}` });
    }
    content.push({ type: "text", text: model.clinical_findings_prompt || "" });
    content.push({ type: "text", text: "________________________________________________________________________" });
    content.push({ type: "text", text: "________________________________________________________________________" });
  }

  if (model.kind === "request_cover") {
    content.push({ type: "text", text: `To: ${value(model.to)}${model.to_contact ? ` (${model.to_contact})` : ""}` });
    content.push({ type: "text", text: model.intro || "" });
    content.push({ type: "heading", text: "Items Requested" });
    for (const item of model.items || []) {
      content.push({ type: "text", text: `• ${item.label} — ${item.detail}` });
    }
  }

  if (model.signature) {
    content.push({ type: "spacer" });
    content.push({ type: "text", text: `${model.signature.label}: ________________________________________` });
    content.push({ type: "text", text: "Date: ________________________________________" });
  }
  content.push({ type: "spacer" });
  content.push({ type: "text", text: model.generated_note || "" });
  return content;
}

/** The complete analysis PDF (part C): every section, review included. */
export function buildAnalysisPdfContent(analysis, bundle) {
  const safe = analysis && typeof analysis === "object" ? sanitizeForDisplay(analysis) : {};
  const review = bundle || buildReviewBundle(safe);
  const plan = safe.preliminary_care_plan && typeof safe.preliminary_care_plan === "object"
    ? safe.preliminary_care_plan
    : {};
  const content = [
    { type: "heading", text: "Patient Information" },
    { type: "table", headers: ["Field", "Value"], rows: patientInfoRows(safe) },
    { type: "heading", text: "Clinical Summary" },
    { type: "text", text: value(safe.clinical_summary) },
    { type: "heading", text: "Key Risk Factors" },
    ...listOrNone(safe.key_risk_factors).map((item) => ({ type: "text", text: `• ${item}` })),
    { type: "heading", text: "Preliminary Care Plan" },
    {
      type: "table",
      headers: ["Element", "Plan"],
      rows: [
        ["Skilled nursing frequency", value(plan.skilled_nursing_frequency)],
        ["Initial focus areas", listOrNone(plan.initial_focus_areas).join("; ")],
        ["Medications to reconcile", value(plan.medications_to_reconcile)],
        ["Equipment needed", listOrNone(plan.equipment_needed).join("; ")],
        ["Safety concerns", listOrNone(plan.safety_concerns).join("; ")],
        ["Discharge readiness", value(plan.discharge_readiness)],
      ],
    },
    { type: "heading", text: "Admission Notes" },
    { type: "text", text: value(safe.admission_notes) },
    ...codingReviewPdfContent(review.codingReview),
    ...compliancePdfContent(review.compliance),
    ...missingItemsPdfContent(review.missingPacket),
    { type: "heading", text: "Data Gaps Identified by the Analysis" },
    ...listOrNone(safe.data_gaps).map((item) => ({ type: "text", text: `• ${item}` })),
  ];
  return content;
}

/** The missing-items packet PDF (part D): cover summary + generated forms. */
export function buildPacketPdfContent(analysis, bundle) {
  const safe = analysis && typeof analysis === "object" ? sanitizeForDisplay(analysis) : {};
  const review = bundle || buildReviewBundle(safe);
  const content = [
    { type: "heading", text: "Missing-Items Packet" },
    {
      type: "text",
      text: "This packet lists everything still needed to complete this referral and attaches the documents PennSync generated for the items it can generate: a populated home health order and face-to-face form for the certifying provider's signature, and a request cover for the remaining documentation. Generated forms are UNSIGNED — they take effect only when signed by the provider.",
    },
    { type: "table", headers: ["Field", "Value"], rows: patientInfoRows(safe) },
    ...missingItemsPdfContent(review.missingPacket),
  ];
  for (const form of [review.forms.order, review.forms.f2f, review.forms.cover]) {
    if (!form) continue;
    content.push({ type: "pageBreak" });
    content.push(...formPdfContent(form));
  }
  return content;
}
