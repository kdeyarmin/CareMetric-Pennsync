// First-visit (SOC) preparation checklist for the admitting nurse.
//
// Deterministic, built from the extracted referral: what to BRING, what to
// assess first, what to TEACH, what to VERIFY for compliance (the items whose
// absence drives denials — meds against bottles, the homebound narrative with
// its two required elements, the F2F on file), home-safety checks, and
// medication risk flags (high-risk classes plus the app's deterministic
// drug-interaction rules). Rendered into the admitting-nurse briefing email so
// the nurse walks in prepared instead of reconstructing this from the referral.
//
// Pure + offline (unit-tested with `node --test`); no React, no `@/` imports.

import { findDeterministicInteractions } from "../medication/drugInteractions.js";

const text = (v) => String(v ?? "").toLowerCase();

/** All referral text a prep rule may look at (meds handled separately). */
function referralText(ex) {
  return [
    ex?.admission_details?.referral_reason,
    JSON.stringify(ex?.skilled_needs || {}),
    JSON.stringify(ex?.orders_treatments || {}),
    JSON.stringify(ex?.functional_status || {}),
    JSON.stringify(ex?.clinical_info || {}),
    JSON.stringify(ex?.wound_details || []),
    JSON.stringify(ex?.safety_concerns || {}),
    JSON.stringify(ex?.nutritional_status || {}),
    ex?.oasis_relevant_notes,
  ]
    .map(text)
    .join(" \n ");
}

// Medication classes that change what the nurse must assess/teach on day 1.
const MED_FLAGS = [
  [/\b(?:warfarin|coumadin)\b/i, "Warfarin on board — bleeding precautions; confirm INR draw schedule and last INR value."],
  [/\b(?:eliquis|apixaban|xarelto|rivaroxaban|pradaxa|dabigatran)\b/i, "DOAC anticoagulant — bleeding precautions teaching; verify renal dosing was reviewed."],
  [/\binsulin|lantus|humalog|novolog|levemir|tresiba\b/i, "Insulin — verify the exact sliding scale/orders, watch hypoglycemia, confirm glucometer supplies and technique."],
  [/\b(?:oxycodone|hydrocodone|morphine|fentanyl|tramadol|hydromorphone|dilaudid)\b/i, "Opioid — fall risk, constipation protocol, safe storage/disposal teaching, pain reassessment plan."],
  [/\b(?:furosemide|lasix|bumetanide|bumex|torsemide)\b/i, "Loop diuretic — daily weights teaching, orthostatic checks, ask about potassium replacement/labs."],
  [/\b(?:prednisone|methylprednisolone|dexamethasone)\b/i, "Systemic steroid — glucose monitoring (even in non-diabetics), skin fragility, infection signs."],
  [/\b(?:methotrexate|humira|adalimumab|enbrel|etanercept|tacrolimus|mycophenolate)\b/i, "Immunosuppressant — strict infection precautions and early-infection teaching."],
  [/\b(?:digoxin)\b/i, "Digoxin — apical pulse before dosing, toxicity signs (nausea, vision changes), confirm recent level."],
];

/**
 * Build the SOC visit prep checklist.
 * @param {object} referralData extracted referral
 * @param {object} [analysis] ReferralAnalyzer AI result (risk flags feed safety)
 * @returns {{ bring:string[], assess:string[], teach:string[], verify:string[],
 *             safety:string[], medFlags:string[], hasContent:boolean }}
 */
export function buildSocVisitPrep(referralData, analysis = null) {
  const ex = referralData?.extracted_data || referralData || {};
  const all = referralText(ex);
  const meds = Array.isArray(ex.medications) ? ex.medications : [];
  const medText = meds.map((m) => [m?.name, m?.dosage, m?.frequency, m?.notes].filter(Boolean).join(" ")).join(" \n ");
  const wounds = Array.isArray(ex.wound_details) ? ex.wound_details : [];

  const bring = [];
  const assess = [];
  const teach = [];
  const verify = [];
  const safety = [];
  const medFlags = [];

  // ── wounds ──
  if (wounds.length > 0 || /wound care|dressing change|ulcer/.test(all)) {
    bring.push("Wound care supplies (per the ordered treatment) + measuring guide and camera per agency policy");
    assess.push(
      wounds.length > 0
        ? `Measure, stage, and document each of the ${wounds.length} documented wound${wounds.length === 1 ? "" : "s"} (location, size L×W×D, exudate, wound bed, periwound)`
        : "Full skin assessment — wound care is ordered; document any wound found (location, size, stage)"
    );
    teach.push("Caregiver dressing-change technique and infection signs (if delegated between visits)");
  }

  // ── lines / devices ──
  if (/\b(?:foley|indwelling cath|catheter)\b/.test(all)) {
    bring.push("Catheter supplies (kit, securement, drainage bags)");
    assess.push("Catheter patency, securement, and urine character; confirm change schedule");
  }
  if (/\b(?:picc|central line|midline|iv therapy|infusion)\b/.test(all)) {
    bring.push("IV/PICC dressing kit and flushes per orders");
    assess.push("Line site, dressing integrity, and flush per protocol; confirm lab draw schedule");
  }
  if (/\b(?:ostomy|colostomy|ileostomy|urostomy)\b/.test(all)) {
    bring.push("Ostomy supplies (verify the patient's product/size before the visit)");
    assess.push("Stoma and peristomal skin; supply fit and quantity on hand");
  }
  if (/\b(?:feeding tube|peg tube|g-tube|tube feeding|enteral)\b/.test(all)) {
    assess.push("Tube site, placement verification per policy, feeding tolerance, and pump settings");
  }

  // ── diabetes ──
  if (/\b(?:diabet|insulin|glucometer|blood sugar|sliding scale)\b/.test(all + " " + text(medText))) {
    bring.push("Glucometer supplies (if the agency provides) and hypoglycemia teaching sheet");
    teach.push("Hypoglycemia signs and treatment; glucose log; when to call");
  }

  // ── oxygen / respiratory ──
  if (/\b(?:oxygen|\bo2\b|\d+\s*(?:l|lpm)|nebulizer|copd|trach)\b/.test(all)) {
    safety.push("Home oxygen safety: no smoking signage, tubing trip hazards, concentrator backup plan");
    assess.push("O2 saturation at rest and exertion on the ordered liter flow; breath sounds");
    teach.push("Oxygen safety and when to call for breathing changes");
  }

  // ── cardiac ──
  if (/\b(?:chf|heart failure|daily weights)\b/.test(all)) {
    bring.push("Scale availability check — daily-weight monitoring needs a working scale in the home");
    teach.push("Daily weights (same time, same clothing), 2-3 lb/day gain call threshold, sodium awareness");
  }

  // ── falls / safety ──
  const fallRisk = /fall/.test(text(ex?.functional_status?.fall_risk)) || /fall risk|recent falls?|history of falls?/.test(all);
  if (fallRisk) {
    assess.push("Standardized fall-risk assessment; footwear and assistive-device fit");
    safety.push("Home safety walkthrough: rugs, cords, lighting, bathroom grab bars, clear paths");
  }
  if (text(ex?.safety_concerns?.environmental_hazards)) {
    safety.push(`Referral-noted hazards to address: ${ex.safety_concerns.environmental_hazards}`);
  }
  for (const r of analysis?.risk_flags || []) {
    if (r?.severity === "High" && r?.risk_type) {
      safety.push(`High risk flag from analysis — ${r.risk_type}: ${r.mitigation_strategy || r.description || "address at SOC"}`);
    }
  }

  // ── swallowing / nutrition ──
  if (text(ex?.nutritional_status?.swallowing_difficulties)) {
    assess.push("Swallowing screen at first PO intake; confirm the ordered diet texture is in use");
  }

  // ── medication flags + deterministic interactions ──
  for (const [re, message] of MED_FLAGS) {
    if (re.test(medText)) medFlags.push(message);
  }
  for (const ix of findDeterministicInteractions(meds)) {
    if (ix.severity === "critical" || ix.severity === "major") {
      medFlags.push(`Interaction (${ix.severity}): ${ix.drug_a} + ${ix.drug_b} — ${ix.recommendation}`);
    }
  }

  // ── universal compliance verifications (the denial-proof items) ──
  verify.push(
    "Reconcile every medication against the bottles in the home (the referral list is a starting point, not the truth)",
    "Document the homebound narrative with BOTH elements: the medical reason leaving home is contraindicated/taxing AND the taxing effort/assistance required — not just the word \"homebound\"",
    "Name the specific skilled service delivered and tie it to the diagnosis (never \"provided skilled nursing care\")",
    "Confirm the Face-to-Face note is on file (or escalate to intake if still missing)",
    "Emergency plan, advance directives status, and patient rights review"
  );

  const hasContent = bring.length + assess.length + teach.length + safety.length + medFlags.length > 0;
  return { bring, assess, teach, verify, safety, medFlags, hasContent };
}

/** Render the prep checklist as plain-text email lines (skips empty groups). */
export function socVisitPrepLines(prep) {
  if (!prep) return [];
  const lines = [];
  const group = (title, items) => {
    if (!items || items.length === 0) return;
    lines.push(`${title}:`);
    for (const i of items) lines.push(`- ${i}`);
  };
  group("Bring", prep.bring);
  group("Assess first", prep.assess);
  group("Teach", prep.teach);
  group("Medication flags", prep.medFlags);
  group("Home safety", prep.safety);
  group("Verify & document (denial-proofing)", prep.verify);
  return lines;
}
