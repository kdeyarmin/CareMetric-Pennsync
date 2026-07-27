// Referral follow-up engine — the "30-year home-health coder + QA nurse"
// review, encoded as deterministic rules.
//
// Reads the extracted referral data (referralExtraction.js shape) plus the
// deterministic diagnosis coding (diagnosisCodeGenerator.js) and Face-to-Face
// validation (faceToFaceValidator.js), and emits the list of things the
// PROVIDER still needs to supply for the agency to (a) bill the maximum
// supportable PDGM case-mix and (b) meet CMS home-health conditions of
// payment/participation. Every item carries a plain-English "why", the
// regulation or PDGM mechanism behind it, and a ready-to-send provider
// request — so intake staff know exactly what is needed and the provider can
// answer without a phone tag cycle.
//
// Like the rest of the referral pipeline this module NEVER invents clinical
// facts: it only flags what is absent, ambiguous, or non-compliant in the
// referral itself. Pure + offline (unit-tested with `node --test`); no React,
// no SDK, no `@/` imports.

import { generateDiagnosisCodes, codeLabel } from "./diagnosisCodeGenerator.js";
import { referralToF2FInput, validateFaceToFace } from "./faceToFaceValidator.js";

export const CATEGORIES = /** @type {const} */ ({
  compliance: "compliance",
  reimbursement: "reimbursement",
});

export const SEVERITIES = ["critical", "high", "medium"];

/** Catalog of the built-in rules — drives the admin "review settings" UI
 *  (enable/disable + severity override per rule). Keep ids in sync with the
 *  item(...) calls in buildFollowUpPlan. */
export const FOLLOW_UP_RULES = [
  { id: "f2f_missing", label: "Face-to-Face documentation missing", category: "compliance", defaultSeverity: "critical" },
  { id: "f2f_invalid", label: "Face-to-Face non-compliant / needs clarification", category: "compliance", defaultSeverity: "critical" },
  { id: "orders_missing", label: "No physician orders / ordered services", category: "compliance", defaultSeverity: "critical" },
  { id: "frequency_missing", label: "Visit frequency and duration not specified", category: "compliance", defaultSeverity: "high" },
  { id: "homebound_undocumented", label: "Homebound status not supported", category: "compliance", defaultSeverity: "high" },
  { id: "certifier_missing", label: "Certifying practitioner not identified", category: "compliance", defaultSeverity: "critical" },
  { id: "medications_missing", label: "No medication list", category: "compliance", defaultSeverity: "medium" },
  { id: "insurance_missing", label: "Insurance / Medicare number missing", category: "compliance", defaultSeverity: "high" },
  { id: "no_icd_codes", label: "No ICD-10 codes documented", category: "reimbursement", defaultSeverity: "critical" },
  { id: "no_acceptable_primary", label: "No PDGM-acceptable principal diagnosis", category: "reimbursement", defaultSeverity: "critical" },
  { id: "uncoded_diagnoses", label: "Documented diagnoses without ICD-10 codes", category: "reimbursement", defaultSeverity: "high" },
  { id: "unspecified_primary", label: "Principal diagnosis coded 'unspecified'", category: "reimbursement", defaultSeverity: "medium" },
  { id: "institutional_dates_missing", label: "Institutional stay not verifiable", category: "reimbursement", defaultSeverity: "high" },
  { id: "comorbidities_uncaptured", label: "Chronic conditions without coded comorbidities", category: "reimbursement", defaultSeverity: "medium" },
  { id: "functional_detail_missing", label: "Functional status detail is thin", category: "reimbursement", defaultSeverity: "medium" },
];

/**
 * Apply the agency's saved rule configuration (FollowUpRuleConfig entity) to a
 * generated item list: drop disabled rules, override severities, and append
 * agency-defined custom items. Custom items get source "agency" and stable
 * `custom_<n>` ids. Unknown/invalid overrides are ignored (never widen).
 */
export function applyRuleConfig(items, ruleConfig) {
  if (!ruleConfig || typeof ruleConfig !== "object") return items;
  const disabled = new Set(ruleConfig.disabled_rules || []);
  const overrides = ruleConfig.severity_overrides || {};
  const out = items
    .filter((it) => !disabled.has(it.id))
    .map((it) =>
      SEVERITIES.includes(overrides[it.id]) ? { ...it, severity: overrides[it.id] } : it
    );
  (ruleConfig.custom_items || []).forEach((c, idx) => {
    if (!c || !c.title || !c.question) return;
    out.push({
      id: `custom_${idx}`,
      seq: 5000 + idx, // after built-in rules, before AI additions
      source: "agency",
      category: c.category === "reimbursement" ? "reimbursement" : "compliance",
      severity: SEVERITIES.includes(c.severity) ? c.severity : "medium",
      title: c.title,
      needed: c.needed || c.question,
      why: c.why || "Agency-defined intake requirement.",
      citation: c.citation || "Agency policy",
      impact: c.impact || "Required by agency policy",
      provider_request: { question: c.question, response_type: c.response_type === "document" ? "document" : "text", hint: c.hint || "" },
    });
  });
  return out;
}

const text = (v) => (typeof v === "string" ? v : "");
const hasText = (v) => text(v).trim().length > 0 && !/^not documented/i.test(text(v).trim());

/** Collect the referral's free-text surfaces that could evidence homebound status. */
function homeboundCorpus(data) {
  const parts = [
    data?.admission_details?.referral_reason,
    data?.functional_status?.ambulation,
    data?.functional_status?.adl_status,
    data?.functional_status?.mobility,
    data?.oasis_relevant_notes,
    data?.clinical_info?.vital_signs,
    ...(data?.orders_treatments?.physician_orders || []),
    ...(data?.skilled_needs?.services_ordered || []),
  ];
  return parts.map(text).join(" \n ").toLowerCase();
}

const HOMEBOUND_EVIDENCE =
  /homebound|taxing effort|bed\s*bound|bedbound|chair\s*bound|unable to leave home|requires (?:\w+ ){0,3}assist(?:ance)? to leave|leave home only|non-?ambulatory|maximum assist|confined to/;

/** True when the institutional-stay evidence (dates) backs the admission source. */
function hasInstitutionalDates(data) {
  const stays = data?.diagnoses?.recent_hospitalizations || [];
  return stays.some((s) => hasText(s?.date) || hasText(s?.length_of_stay));
}

let itemSeq = 0;
function item(fields) {
  itemSeq += 1;
  return {
    id: fields.rule, // stable rule id (one item per rule per referral)
    seq: itemSeq,
    source: "rules",
    ...fields,
  };
}

/**
 * Run the full coder/QA review of an extracted referral.
 *
 * @param {object} extractedData referral extraction (referralExtraction.js shape)
 * @param {object} [opts]
 * @param {object} [opts.rates]      saved PDGMRateConfig.rates
 * @param {object} [opts.icdGroups]  saved PDGMRateConfig.icd10_clinical_groups
 * @param {string} [opts.socDate]    anticipated SOC date (improves F2F window check)
 * @param {object} [opts.ruleConfig] saved FollowUpRuleConfig (disabled_rules,
 *                                   severity_overrides, custom_items)
 * @returns {{
 *   items: Array<{id, source, category, severity, title, needed, why, citation,
 *                 impact, provider_request:{question, response_type, hint}}>,
 *   counts: {critical:number, high:number, medium:number,
 *            compliance:number, reimbursement:number, total:number},
 *   coding: object, f2f: object|null,
 * }}
 */
export function buildFollowUpPlan(extractedData, opts = {}) {
  const data = extractedData || {};
  const items = [];
  itemSeq = 0;

  const coding = generateDiagnosisCodes(data, {
    rates: opts.rates,
    icdGroups: opts.icdGroups,
  });
  const f2fInput = referralToF2FInput({ extracted_data: data, estimated_start_date: opts.socDate });
  const f2f = f2fInput ? validateFaceToFace(f2fInput) : null;

  // ── Compliance: conditions of payment / participation ─────────────────────

  if (!f2f) {
    items.push(item({
      rule: "f2f_missing",
      category: "compliance",
      severity: "critical",
      title: "Face-to-Face encounter documentation missing",
      needed: "The certifying practitioner's Face-to-Face encounter note: encounter date, practitioner name and credential, and the clinical findings related to the primary reason for home health.",
      why: "Medicare will not pay for home health without a documented F2F encounter performed within 90 days before or 30 days after the start of care by an allowed practitioner, and it must relate to the primary reason home care is needed. Claims without it are denied outright, not just delayed.",
      citation: "42 CFR 424.22(a)(1)(v)",
      impact: "Claim denial — condition of payment",
      provider_request: {
        question: "Please attach the Face-to-Face encounter note (or complete below): encounter date, practitioner name/credential (MD/DO/NP/PA/CNS), and clinical findings supporting the need for home health.",
        response_type: "document",
        hint: "Encounter must be within 90 days before or 30 days after start of care and relate to the primary diagnosis.",
      },
    }));
  } else if (f2f.status !== "valid") {
    items.push(item({
      rule: "f2f_invalid",
      category: "compliance",
      severity: f2f.status === "invalid" ? "critical" : "high",
      title: f2f.status === "invalid" ? "Face-to-Face encounter is non-compliant" : "Face-to-Face encounter needs clarification",
      needed: `A corrected/clarified F2F encounter record. Issues found: ${(f2f.reasons || []).join(" ")}`,
      why: "An F2F that fails on timing, practitioner eligibility, or diagnosis linkage is treated the same as a missing one — the claim is denied. Fixing it before start of care is far easier than appealing a denial.",
      citation: "42 CFR 424.22(a)(1)(v)",
      impact: "Claim denial risk — condition of payment",
      provider_request: {
        question: "The Face-to-Face documentation received does not fully meet Medicare requirements (details listed on this form). Please provide a corrected encounter note or the missing element(s).",
        response_type: "document",
        hint: (f2f.reasons || []).join(" "),
      },
    }));
  }

  const services = data?.skilled_needs?.services_ordered || [];
  const orders = data?.orders_treatments?.physician_orders || [];
  if (services.length === 0 && orders.length === 0) {
    items.push(item({
      rule: "orders_missing",
      category: "compliance",
      severity: "critical",
      title: "No physician orders / ordered services on the referral",
      needed: "Signed orders identifying the skilled services ordered (SN, PT, OT, ST, MSW, aide) and specific interventions.",
      why: "Home health requires a physician-established plan of care; services furnished without orders are not billable at all. This is the single most common reason an admission stalls.",
      citation: "42 CFR 409.43; 42 CFR 484.60",
      impact: "Cannot admit or bill — condition of payment",
      provider_request: {
        question: "Please provide signed home health orders listing each discipline ordered (SN/PT/OT/ST/MSW/aide) and the specific services or interventions requested.",
        response_type: "document",
        hint: "Orders must be signed and dated by the certifying practitioner.",
      },
    }));
  } else if (!hasText(data?.skilled_needs?.frequency_duration)) {
    items.push(item({
      rule: "frequency_missing",
      category: "compliance",
      severity: "high",
      title: "Visit frequency and duration not specified",
      needed: "Ordered visit frequency and duration for each discipline (e.g., SN 2wk9, PT 3wk4 then 2wk4).",
      why: "The plan of care must specify frequency and duration for every ordered discipline. Auditors deny visits furnished beyond or without a stated frequency, and vague orders ('PT to evaluate and treat' with no frequency) are a recurring ADR takeback.",
      citation: "42 CFR 409.43(b)",
      impact: "Visit-level denials on medical review",
      provider_request: {
        question: "Please specify visit frequency and duration for each ordered discipline (e.g., 'SN 2x/week for 9 weeks; PT 3x/week for 4 weeks').",
        response_type: "text",
        hint: "One line per discipline.",
      },
    }));
  }

  if (!HOMEBOUND_EVIDENCE.test(homeboundCorpus(data))) {
    items.push(item({
      rule: "homebound_undocumented",
      category: "compliance",
      severity: "high",
      title: "Homebound status not supported in the referral",
      needed: "A statement of why leaving home is medically contraindicated or requires taxing effort/assistance (both homebound criteria).",
      why: "Medicare pays home health only for confined-to-home patients. The record must show (1) the patient needs supportive devices, special transportation, or another person's assistance to leave home — or that leaving is medically contraindicated — AND (2) that leaving home requires a considerable and taxing effort. Reviewers deny entire episodes when neither criterion is documented.",
      citation: "42 CFR 424.22(a)(1)(ii); Medicare Benefit Policy Manual Ch. 7 §30.1",
      impact: "Full-episode denial on medical review",
      provider_request: {
        question: "Please describe why this patient is confined to the home (assistive device/person required to leave, medically contraindicated, and/or leaving requires taxing effort).",
        response_type: "text",
        hint: "Example: 'Requires rolling walker and standby assist; dyspnea on exertion after <100 ft; leaving home requires taxing effort.'",
      },
    }));
  }

  if (!hasText(data?.demographics?.referring_physician) && !hasText(data?.demographics?.primary_care_physician)) {
    items.push(item({
      rule: "certifier_missing",
      category: "compliance",
      severity: "critical",
      title: "Certifying practitioner not identified",
      needed: "Name, credential, NPI, and contact information for the practitioner who will certify home health and sign the plan of care.",
      why: "Someone must certify eligibility and sign the plan of care — without an identified certifying practitioner there is no one to execute the certification, orders, or F2F, and nothing downstream can be billed.",
      citation: "42 CFR 424.22(a)",
      impact: "Cannot certify or bill",
      provider_request: {
        question: "Please identify the certifying practitioner: name, credential, NPI, phone, and fax.",
        response_type: "text",
        hint: "MD/DO, or NP/PA/CNS working in accordance with state law.",
      },
    }));
  }

  if (!Array.isArray(data?.medications) || data.medications.length === 0) {
    items.push(item({
      rule: "medications_missing",
      category: "compliance",
      severity: "medium",
      title: "No medication list on the referral",
      needed: "The current reconciled medication list (name, dose, route, frequency).",
      why: "The comprehensive assessment must include a review of all medications the patient is using, and the admitting nurse cannot safely reconcile or catch high-risk drug issues without the discharge/current list. Missing med lists also delay the drug-regimen-review OASIS items.",
      citation: "42 CFR 484.55(c)(5)",
      impact: "Delays safe admission; OASIS drug-regimen items incomplete",
      provider_request: {
        question: "Please attach the current medication list (or discharge medication reconciliation).",
        response_type: "document",
        hint: "Include dose, route, and frequency.",
      },
    }));
  }

  if (!hasText(data?.demographics?.insurance_primary) && !hasText(data?.demographics?.policy_numbers)) {
    items.push(item({
      rule: "insurance_missing",
      category: "compliance",
      severity: "high",
      title: "Insurance / Medicare number missing",
      needed: "Primary payer and member/Medicare Beneficiary Identifier (MBI), plus any secondary coverage.",
      why: "Eligibility cannot be verified and no claim can be submitted without the payer identifiers. Verifying before SOC also catches Medicare Advantage enrollment, which changes authorization requirements entirely.",
      citation: "Clean-claim requirement (CMS-1450/837I)",
      impact: "Cannot verify eligibility or bill",
      provider_request: {
        question: "Please provide the patient's primary insurance and ID number (and secondary, if any).",
        response_type: "text",
        hint: "A copy of the insurance card face is ideal.",
      },
    }));
  }

  // ── Reimbursement: PDGM case-mix accuracy ──────────────────────────────────

  if (!coding.hasCodes) {
    items.push(item({
      rule: "no_icd_codes",
      category: "reimbursement",
      severity: "critical",
      title: "No ICD-10 codes documented anywhere in the referral",
      needed: "A coded diagnosis list: principal diagnosis plus all active comorbidities with ICD-10-CM codes.",
      why: "The PDGM clinical group — the largest single driver of the 30-day payment — comes from the principal diagnosis code. The agency cannot assign codes that aren't supported by provider documentation, so until the provider supplies coded (or codeable, fully specified) diagnoses, the claim cannot be grouped or billed.",
      citation: "PDGM clinical grouping (CY final rule); ICD-10-CM Official Guidelines",
      impact: "Cannot group or bill the period",
      provider_request: {
        question: "Please provide the diagnosis list with ICD-10-CM codes: principal diagnosis first, then all active comorbidities.",
        response_type: "document",
        hint: "The most recent problem list or discharge summary diagnosis section works.",
      },
    }));
  } else if (!coding.primary && !coding.sequenced.some((d) => d.acceptablePrimary)) {
    // Only a PROVIDER problem when no RTP-acceptable candidate exists at all.
    // An acceptable-but-unmapped/unweighted candidate is an AGENCY table gap
    // (PDGM Rate Settings), reported via internal_notes below instead.
    const rtpCodes = coding.sequenced.filter((d) => !d.acceptablePrimary);
    items.push(item({
      rule: "no_acceptable_primary",
      category: "reimbursement",
      severity: "critical",
      title: "No PDGM-acceptable principal diagnosis",
      needed: `A definitive principal diagnosis. Codes on the referral that cannot serve as principal: ${rtpCodes.map((d) => d.displayCode).join(", ") || "(none listed)"}.`,
      why: "Symptom (R-chapter), status (Z-chapter), and other 'unacceptable principal' codes cause the claim to be Returned to Provider unpaid. The underlying definitive condition (the disease causing the symptom, or the condition treated by the surgery) must be documented by the provider so it can be coded as principal.",
      citation: "PDGM unacceptable-principal edit; ICD-10-CM Official Guidelines §II",
      impact: "Zero-pay RTP claim",
      provider_request: {
        question: "The referral lists only symptom/status codes. What definitive condition is the primary reason for home health? Please state the diagnosis (with ICD-10 code if available).",
        response_type: "text",
        hint: "Example: instead of R26.9 (gait abnormality), the underlying cause — e.g., I69.351 late effect of CVA.",
      },
    }));
  }

  if (coding.uncoded.length > 0) {
    items.push(item({
      rule: "uncoded_diagnoses",
      category: "reimbursement",
      severity: "high",
      title: `${coding.uncoded.length} documented diagnosis(es) have no ICD-10 code`,
      needed: `ICD-10-CM codes (or full specificity to code from) for: ${coding.uncoded.map((u) => u.description).join("; ")}.`,
      why: "Each uncoded condition is a comorbidity the claim cannot capture. Secondary diagnoses drive the PDGM comorbidity adjustment (none → low → high), so conditions left uncoded systematically underpay the period — and understate the patient's risk profile in quality measures.",
      citation: "PDGM comorbidity adjustment subgroups",
      impact: "Understated case-mix (missed comorbidity adjustment)",
      provider_request: {
        question: "Please provide ICD-10 codes (or enough clinical specificity to code) for the diagnoses listed on this form.",
        response_type: "text",
        hint: "Type/stage/laterality/acuity matter — e.g., 'E11.42 T2DM with polyneuropathy', not 'diabetes'.",
      },
    }));
  }

  const unspecifiedPrimary =
    coding.primary && /unspecified/i.test(coding.primary.description || "");
  if (unspecifiedPrimary) {
    items.push(item({
      rule: "unspecified_primary",
      category: "reimbursement",
      severity: "medium",
      title: "Principal diagnosis is coded 'unspecified'",
      needed: `Greater specificity for ${codeLabel(coding.primary)} — type, stage, laterality, or causal linkage as clinically appropriate.`,
      why: "Unspecified codes survive billing but are the first target of medical review, and a more specific code frequently lands in a better-paying clinical group or adds a comorbidity subgroup. Thirty years of ADRs say: get the specificity now, while the provider remembers the patient.",
      citation: "ICD-10-CM Official Guidelines §I.B (specificity)",
      impact: "Audit exposure; possible case-mix understatement",
      provider_request: {
        question: "Can you provide more specificity for the primary diagnosis (type, stage, laterality, underlying cause)?",
        response_type: "text",
        hint: "",
      },
    }));
  }

  if (coding.scenario.admissionSource === "institutional" && !hasInstitutionalDates(data)) {
    items.push(item({
      rule: "institutional_dates_missing",
      category: "reimbursement",
      severity: "high",
      title: "Institutional stay not verifiable (no admission/discharge dates)",
      needed: "The facility discharge summary or admission and discharge dates for the qualifying inpatient/SNF stay.",
      why: "An institutional admission source pays a meaningfully higher case-mix weight than community, but it must be supported by an acute or post-acute stay within 14 days of the home health admission. Without dates, the claim defaults to (or is downgraded to) community on review — money left on the table for care actually delivered post-discharge.",
      citation: "PDGM admission-source classification (occurrence code 61/62)",
      impact: "Case-mix downgrade to community source",
      provider_request: {
        question: "Please provide the inpatient/SNF admission and discharge dates (or attach the discharge summary).",
        response_type: "text",
        hint: "Facility name, admit date, discharge date.",
      },
    }));
  }

  const secondaries = coding.sequenced.filter((d) => d.role === "secondary");
  const pmh = data?.diagnoses?.past_medical_history || [];
  if (coding.hasCodes && secondaries.length === 0 && pmh.length > 0) {
    items.push(item({
      rule: "comorbidities_uncaptured",
      category: "reimbursement",
      severity: "medium",
      title: "Chronic conditions documented but no coded comorbidities",
      needed: `Confirmation and ICD-10 codes for the active comorbidities in the medical history (${pmh.slice(0, 5).map((p) => text(p?.condition)).filter(Boolean).join("; ")}${pmh.length > 5 ? "; …" : ""}).`,
      why: "The comorbidity adjustment only counts coded secondary diagnoses. A rich past-medical-history narrative with an empty secondary code list is the classic pattern of an underpaid PDGM period.",
      citation: "PDGM comorbidity adjustment subgroups",
      impact: "Missed low/high comorbidity adjustment",
      provider_request: {
        question: "Please confirm which listed chronic conditions are active and provide ICD-10 codes for each.",
        response_type: "text",
        hint: "",
      },
    }));
  }

  const fs = data?.functional_status || {};
  const functionalDocumented = [fs.ambulation, fs.adl_status, fs.cognitive_status, fs.continence]
    .filter(hasText).length;
  if (functionalDocumented < 2) {
    items.push(item({
      rule: "functional_detail_missing",
      category: "reimbursement",
      severity: "medium",
      title: "Functional status detail is thin",
      needed: "Recent therapy notes or a functional description: ambulation device/distance, ADL assistance levels, transfers, bathing/dressing ability.",
      why: "PDGM's functional-impairment level (low/medium/high) is scored from the OASIS M1800-series items. When the referral carries no functional detail, the admitting clinician has nothing to corroborate against, responses get conservatively understated, and the period scores a lower functional level than the patient's real burden supports.",
      citation: "PDGM functional-impairment level (OASIS M1800–M1860)",
      impact: "Understated functional level → lower case-mix weight",
      provider_request: {
        question: "Please describe current functional status: ambulation (device/distance/assist), transfers, bathing, dressing, toileting — or attach the latest PT/OT note.",
        response_type: "text",
        hint: "Discharge therapy notes are ideal.",
      },
    }));
  }

  // Agency-side notes: real gaps, but NOT provider requests — they never go on
  // the provider form. Currently: an RTP-acceptable principal candidate that
  // the sequencer couldn't weight because the agency's ICD→clinical-group map
  // or weight table doesn't cover it.
  const internalNotes = [];
  if (!coding.primary) {
    const unweightedAcceptable = coding.sequenced.filter((d) => d.acceptablePrimary);
    if (unweightedAcceptable.length > 0) {
      internalNotes.push(
        `Acceptable principal candidate(s) ${unweightedAcceptable.map((d) => d.displayCode).join(", ")} could not be weighted — missing from the agency's ICD-10 → clinical-group map or weight table. Fix on the PDGM Rate Settings page; no provider action needed.`
      );
    }
  }

  const configured = applyRuleConfig(items, opts.ruleConfig);
  return { items: configured, counts: countFollowUpItems(configured), coding, f2f, internal_notes: internalNotes };
}

/** Severity/category tallies for any item set (also used for user-selected subsets). */
export function countFollowUpItems(items = []) {
  return {
    critical: items.filter((i) => i.severity === "critical").length,
    high: items.filter((i) => i.severity === "high").length,
    medium: items.filter((i) => i.severity === "medium").length,
    compliance: items.filter((i) => i.category === "compliance").length,
    reimbursement: items.filter((i) => i.category === "reimbursement").length,
    total: items.length,
  };
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2 };

/** Items sorted for display/form: severity first, then compliance before
 *  reimbursement. Items without a `seq` (e.g. AI-suggested additions) sort
 *  AFTER rule items of the same severity/category, keeping numbering stable. */
export function sortFollowUpItems(items) {
  return [...(items || [])].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      (a.category === b.category ? 0 : a.category === "compliance" ? -1 : 1) ||
      (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER)
  );
}

/**
 * Build the provider-facing request form as plain data (used for the PDF
 * export, print view, and copy-to-clipboard text). Pure: the request date and
 * agency identity are passed in.
 *
 * @param {{patientName?:string, patientDob?:string, referralDate?:string,
 *          providerName?:string, agencyName?:string, requestDate?:string,
 *          contactBackFax?:string, contactBackPhone?:string}} header
 * @param {Array} items follow-up items (any order; will be sorted)
 * @returns {{title:string, intro:string, sections:Array, signatureBlock:string[]}}
 */
export function buildProviderForm(header = {}, items = []) {
  const sorted = sortFollowUpItems(items);
  const sections = sorted.map((it, idx) => ({
    number: idx + 1,
    severity: it.severity,
    category: it.category,
    title: it.title,
    request: it.provider_request?.question || it.needed,
    why: it.why,
    citation: it.citation,
    hint: it.provider_request?.hint || "",
    response_type: it.provider_request?.response_type || "text",
  }));
  return {
    title: "Home Health Referral — Additional Information Request",
    intro:
      `Re: ${header.patientName || "(patient)"}${header.patientDob ? `, DOB ${header.patientDob}` : ""}. ` +
      `Thank you for your referral${header.referralDate ? ` dated ${header.referralDate}` : ""}. ` +
      `To admit this patient promptly and meet Medicare's documentation requirements, ${header.agencyName || "our agency"} needs the items below. ` +
      `Each item lists exactly what is needed and why. Please complete the response lines or attach the noted documents and return by fax${header.contactBackFax ? ` to ${header.contactBackFax}` : ""}${header.contactBackPhone ? ` (questions: ${header.contactBackPhone})` : ""}.` +
      (header.portalLink
        ? ` PREFER TO RESPOND ONLINE? Complete this request securely in a few minutes at: ${header.portalLink}`
        : ""),
    sections,
    signatureBlock: [
      "Provider/designee completing this form: ______________________________",
      "Credential: ____________  Date: ____________",
      "Practitioner signature (where orders/certification are supplied): ______________________________",
    ],
  };
}

/** Plain-text rendering of the provider form (for clipboard / fax cover). */
export function providerFormToText(form) {
  const lines = [form.title, "", form.intro, ""];
  for (const s of form.sections) {
    lines.push(`${s.number}. [${s.severity.toUpperCase()}] ${s.title}`);
    lines.push(`   REQUEST: ${s.request}`);
    if (s.hint) lines.push(`   NOTE: ${s.hint}`);
    lines.push(`   WHY WE NEED IT: ${s.why} (${s.citation})`);
    lines.push(
      s.response_type === "document"
        ? "   RESPONSE: [ ] Document attached    [ ] See below:"
        : "   RESPONSE:"
    );
    lines.push("   ________________________________________________________________");
    lines.push("   ________________________________________________________________");
    lines.push("");
  }
  lines.push(...form.signatureBlock);
  return lines.join("\n");
}

/**
 * Lean shape persisted to the top-level `Referral.follow_up_requests` field.
 * Kept OFF extracted_data for the same isolation reason as diagnosis_coding
 * (coding/reimbursement mechanics must not leak into admission-note prompts).
 */
export function toPersistedFollowUp(
  plan,
  { generatedAt, status = "open", sentVia = null, faxLogId = null, portalLink = null } = {}
) {
  if (!plan) return null;
  return {
    status, // open | sent | received | resolved
    generated_at: generatedAt || null,
    sent_via: sentVia, // "fax" | "manual" | null
    fax_log_id: faxLogId,
    // NEVER the plaintext link: generateFollowUpPortalToken stores only the
    // token's SHA-256 precisely so that Referral/token reads can't yield live
    // capability links — persisting the plaintext here defeated that one
    // entity over. Only the fact that a link is active is recorded; the
    // plaintext lives in UI state for the session that minted it, and staff
    // can always rotate to get a fresh copyable link.
    portal_link_active: Boolean(portalLink),
    counts: plan.counts,
    items: sortFollowUpItems(plan.items).map((it) => ({
      id: it.id,
      source: it.source,
      category: it.category,
      severity: it.severity,
      title: it.title,
      needed: it.needed,
      why: it.why,
      citation: it.citation,
      impact: it.impact,
      provider_request: it.provider_request,
      // Per-item lifecycle: open → answered (provider responded via portal) →
      // resolved (staff verified). Responses are written by the
      // submitFollowUpResponse backend function.
      item_status: "open",
      response: null,
      answered_at: null,
    })),
  };
}
