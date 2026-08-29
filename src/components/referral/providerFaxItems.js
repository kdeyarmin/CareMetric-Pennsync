// Analyzer-specific provider fax items — the analyzer findings the follow-up
// engine's generic rules don't itemize, shaped as referralFollowUpEngine items
// so they drop straight into buildProviderForm / the fax PDF:
//
//   1. Per-condition comorbidity-capture queries (comorbidityCapture.js): the
//      engine has one generic "chronic conditions uncoded" rule; these name
//      the specific condition, the evidence, and the exact question.
//   2. The AI analyzer's critical-missing items, keyword-deduped against the
//      items already on the plan so the provider never sees the same request
//      twice.
//
// Pure + offline (unit-tested with `node --test`); no React, no `@/` imports.

/** Keyword families used to dedupe an AI item against existing plan items. */
const DEDUPE_KEYWORDS = [
  /face.?to.?face|f2f/i,
  /insurance|payer|policy|medicare number|mbi/i,
  /order|frequenc/i,
  /medication|med list/i,
  /homebound/i,
  /physician|practitioner|certif/i,
  /diagnos|icd/i,
  /demographic|address|phone|contact/i,
];

const itemText = (it) =>
  [it?.title, it?.needed, it?.provider_request?.question].filter(Boolean).join(" ").toLowerCase();

/** True when `candidateText` and any existing item share a keyword family. */
function coveredByExisting(candidateText, existingItems) {
  const existing = (existingItems || []).map(itemText);
  for (const re of DEDUPE_KEYWORDS) {
    if (re.test(candidateText) && existing.some((t) => re.test(t))) return true;
  }
  return false;
}

/**
 * Build the analyzer-sourced provider items to append to a follow-up plan.
 *
 * @param {object} params
 * @param {object} [params.comorbidityCapture] collectComorbidityCapture() result
 * @param {object} [params.analysis] ReferralAnalyzer AI result
 * @param {Array}  [params.existingItems] the engine plan's items (for dedupe)
 * @returns {Array} referralFollowUpEngine-shaped items (source: "analyzer")
 */
export function buildAnalyzerFaxItems({ comorbidityCapture = null, analysis = null, existingItems = [] } = {}) {
  const items = [];
  let seq = 6000; // after built-in rules (…~4999) and agency custom items (5000+)

  for (const o of comorbidityCapture?.opportunities || []) {
    items.push({
      id: `comorbidity_${o.key}`,
      seq: (seq += 1),
      source: "analyzer",
      category: "reimbursement",
      severity: o.value === "high" ? "high" : "medium",
      title: `Confirm diagnosis: ${o.label} (documented but not coded)`,
      needed: `Confirmation whether ${o.label.toLowerCase()} is an active diagnosis, and its ICD-10 code.`,
      why: `The referral documents ${o.label.toLowerCase()} (${o.evidence
        .map((e) => `${e.source}: "${e.text}"`)
        .join("; ")}) but no corresponding diagnosis code. An active condition left uncoded is a comorbidity the claim cannot capture and understates the patient's clinical picture.`,
      citation: "PDGM comorbidity adjustment subgroups; ICD-10-CM Official Guidelines",
      impact: o.value === "high" ? "Missed high-value comorbidity adjustment" : "Missed comorbidity adjustment",
      provider_request: {
        question: `Is ${o.label.toLowerCase()} an active diagnosis for this patient? If yes, please provide the ICD-10 code (with type/stage/complications where applicable).`,
        response_type: "text",
        hint: `Suggested by: ${o.evidence.map((e) => e.text).join("; ")}`,
      },
    });
  }

  const critical = analysis?.missing_information?.critical_missing || [];
  const allExisting = [...(existingItems || []), ...items];
  critical.forEach((m, idx) => {
    const field = String(m?.field_name ?? "").trim();
    if (!field) return;
    const candidateText = `${field} ${String(m?.why_critical ?? "")}`.toLowerCase();
    if (coveredByExisting(candidateText, allExisting)) return;
    const item = {
      id: `ai_missing_${idx}`,
      seq: (seq += 1),
      source: "analyzer",
      category: "compliance",
      severity: "high",
      title: `Missing information: ${field}`,
      needed: field,
      why: String(m?.why_critical ?? "").trim() || "Identified as critical missing information for this admission.",
      citation: "Intake completeness review",
      impact: "Delays admission",
      provider_request: {
        question: `Please provide: ${field}.`,
        response_type: "text",
        hint: String(m?.how_to_obtain ?? "").trim(),
      },
    };
    items.push(item);
    allExisting.push(item);
  });

  return items;
}
