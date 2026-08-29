// Comorbidity capture scanner — documentation-completeness queries that protect
// the PDGM comorbidity adjustment.
//
// A condition that is clinically documented in the referral (a medication that
// treats it, prose in the history, a wound record) but NEVER CODED as a
// diagnosis earns no comorbidity adjustment (worth 2.5–8.5% of the period
// payment per calculatePDGM's multipliers) and understates the clinical
// picture. This module finds those UNCAPTURED signals deterministically and
// emits coder/physician QUERIES — it never assigns a code itself (that mapping
// is exactly where fabrication happens; same rule as diagnosisCodeGenerator).
//
// Signal families align with the calculatePDGM HIGH/MEDIUM_VALUE_COMORBIDITIES
// lists so every query is one that can actually move the comorbidity level.
// A signal counts only when it is NOT negated in its own clause and the
// condition family is NOT already present in the coded/named diagnosis set.
//
// Pure + offline (unit-tested with `node --test`); no React, no `@/` imports.

import { harvestDiagnosisCandidates } from "./diagnosisCodeGenerator.js";
import { normalizeIcd } from "./intakeDiagnosisValidator.js";

// Signal table. `meds` matches medication names; `prose` matches clinical
// text; `dxTerms` + `icdPrefixes` define "already captured". `value` mirrors
// the calculatePDGM comorbidity tiers.
const SIGNALS = [
  {
    key: "diabetes",
    label: "Diabetes",
    value: "medium",
    icdPrefixes: ["E08", "E09", "E10", "E11", "E13"],
    dxTerms: /diabet/i,
    meds: /\b(?:insulin|lantus|humalog|novolog|levemir|tresiba|basaglar|metformin|glipizide|glyburide|glimepiride|januvia|sitagliptin|jardiance|empagliflozin|farxiga|dapagliflozin|ozempic|semaglutide|trulicity|dulaglutide)\b/i,
    prose: /\b(?:blood sugars?|glucose (?:checks?|monitoring)|a1c|hyperglycemi\w*|hypoglycemi\w*|diabetic diet|sliding scale|glucometer)\b/i,
    suggestion:
      "Diabetes is documented (medications/monitoring) but not coded. Query the physician for the diagnosis — and if complications exist (neuropathy, CKD, retinopathy), the with-complication codes (E11.2x–E11.6x) carry high comorbidity value.",
  },
  {
    key: "heart_failure",
    label: "Heart failure",
    value: "high",
    icdPrefixes: ["I50", "I110", "I130", "I132"],
    dxTerms: /heart failure|\bchf\b|cardiomyopath/i,
    meds: /\b(?:furosemide|lasix|bumetanide|bumex|torsemide|entresto|sacubitril|spironolactone.*(?:chf|hf)|digoxin)\b/i,
    prose: /\b(?:chf|heart failure|ejection fraction|bnp elevated|fluid overload|daily weights)\b/i,
    suggestion: "Heart-failure treatment/monitoring is documented but I50.x is not coded — a high-value comorbidity. Query the physician to confirm and code it.",
  },
  {
    key: "copd_respiratory",
    label: "COPD / chronic respiratory disease",
    value: "high",
    icdPrefixes: ["J44", "J43", "J47", "J96"],
    dxTerms: /\bcopd\b|emphysema|chronic bronchitis|chronic respiratory/i,
    meds: /\b(?:spiriva|tiotropium|advair|symbicort|breo|trelegy|anoro|ipratropium|atrovent|combivent|budesonide[-\s]?formoterol)\b/i,
    prose: /\b(?:copd|emphysema|chronic bronchitis|home oxygen|o2 at \d|\d+\s*(?:l|lpm|liters?)(?:\/|\s*per\s*)?min|nebulizer treatments?)\b/i,
    suggestion: "Chronic respiratory disease is documented (inhalers/oxygen) but not coded — a high-value comorbidity. Query to confirm COPD/chronic respiratory failure coding.",
  },
  {
    key: "ckd_renal",
    label: "Chronic kidney disease",
    value: "high",
    icdPrefixes: ["N18", "Z992"],
    dxTerms: /chronic kidney|\bckd\b|\besrd\b|renal failure/i,
    meds: /\b(?:sevelamer|renvela|renagel|calcitriol|epoetin|darbepoetin|kayexalate|patiromer)\b/i,
    prose: /\b(?:ckd|chronic kidney|esrd|dialysis|renal diet|elevated creatinine|egfr \d+)\b/i,
    suggestion: "Renal disease is documented (dialysis/renal meds/diet) but not coded — CKD stage or ESRD is a high-value comorbidity. Query for the stage and code.",
  },
  {
    key: "afib_anticoagulation",
    label: "Atrial fibrillation / anticoagulation indication",
    value: "medium",
    icdPrefixes: ["I48"],
    dxTerms: /atrial fib|a[-\s]?fib|flutter/i,
    meds: /\b(?:warfarin|coumadin|eliquis|apixaban|xarelto|rivaroxaban|pradaxa|dabigatran)\b/i,
    prose: /\b(?:atrial fib\w*|a[-\s]?fib|irregular(?:ly irregular)? rhythm|inr checks?)\b/i,
    suggestion: "An anticoagulant is documented without a coded indication. Query whether it treats atrial fibrillation (I48.x), DVT/PE, or a valve — the indication is codeable and drives the drug-regimen risk picture.",
  },
  {
    key: "dementia",
    label: "Dementia / Alzheimer's",
    value: "high",
    icdPrefixes: ["F01", "F02", "F03", "G30"],
    dxTerms: /dementia|alzheim/i,
    meds: /\b(?:donepezil|aricept|memantine|namenda|rivastigmine|exelon|galantamine)\b/i,
    prose: /\b(?:dementia|alzheim\w*|cognitive (?:impairment|decline)|memory (?:loss|deficit)|confusion at (?:night|baseline))\b/i,
    suggestion: "Cognitive-impairment treatment or findings are documented but dementia is not coded — a high-value comorbidity that also supports supervision needs. Query to confirm.",
  },
  {
    key: "parkinsons",
    label: "Parkinson's disease",
    value: "high",
    icdPrefixes: ["G20"],
    dxTerms: /parkinson/i,
    meds: /\b(?:sinemet|carbidopa|levodopa|ropinirole|pramipexole|rasagiline|entacapone)\b/i,
    prose: /\bparkinson\w*|shuffling gait|cogwheel/i,
    suggestion: "Parkinson's treatment is documented but G20 is not coded — a high-value neuro comorbidity. Query to confirm.",
  },
  {
    key: "depression",
    label: "Depression",
    value: "medium",
    icdPrefixes: ["F32", "F33"],
    dxTerms: /depress/i,
    meds: /\b(?:sertraline|zoloft|fluoxetine|prozac|citalopram|celexa|escitalopram|lexapro|duloxetine|cymbalta|mirtazapine|remeron|venlafaxine|effexor|bupropion|wellbutrin|trazodone)\b/i,
    prose: /\b(?:depress\w*|phq-?9|tearful|flat affect)\b/i,
    suggestion: "Antidepressant therapy is documented but depression is not coded (F32/F33) — a comorbidity that also supports the M1730 screening picture. Query the indication (some agents also treat neuropathy/insomnia).",
  },
  {
    key: "pressure_ulcer",
    label: "Pressure ulcer",
    value: "high",
    icdPrefixes: ["L89"],
    dxTerms: /pressure (?:ulcer|injury|sore)|decubitus/i,
    meds: null,
    prose: /\b(?:pressure (?:ulcer|injury|sore)|decubitus|sacral wound|unstageable|deep tissue injury)\b/i,
    woundTypes: /pressure|decubitus/i,
    suggestion: "A pressure ulcer is documented in the wound record but L89.x is not coded — a high-value comorbidity AND a wound-group driver. Query for site/stage coding.",
  },
  {
    key: "pvd",
    label: "Peripheral vascular disease",
    value: "high",
    icdPrefixes: ["I70", "I73"],
    dxTerms: /peripheral vascular|peripheral arter|\bpvd\b|\bpad\b/i,
    meds: /\b(?:cilostazol|pletal|pentoxifylline)\b/i,
    prose: /\b(?:peripheral vascular|peripheral arter\w*|claudication|arterial insufficiency|diminished (?:pedal )?pulses)\b/i,
    suggestion: "Vascular-disease findings are documented but PVD/PAD is not coded (I70/I73) — a high-value comorbidity relevant to wound healing. Query to confirm.",
  },
  {
    key: "cancer",
    label: "Active cancer",
    value: "high",
    icdPrefixes: ["C"],
    dxTerms: /cancer|malignan|carcinoma|lymphoma|leukemia|metasta/i,
    meds: /\b(?:tamoxifen|anastrozole|arimidex|letrozole|femara|capecitabine|xeloda|imatinib|chemotherapy)\b/i,
    prose: /\b(?:cancer|malignan\w*|metasta\w*|oncolog\w*|chemo(?:therapy)?|radiation therapy)\b/i,
    suggestion: "Active-cancer treatment or history is documented but no C-code is present — active malignancy is a high-value comorbidity. Query whether treatment is current (active code) or historical (Z85).",
  },
  {
    key: "hypertension",
    label: "Hypertension",
    value: "medium",
    icdPrefixes: ["I10", "I11", "I12", "I13"],
    dxTerms: /hypertens|\bhtn\b/i,
    meds: /\b(?:lisinopril|enalapril|losartan|valsartan|olmesartan|amlodipine|hydrochlorothiazide|hctz|chlorthalidone|clonidine)\b/i,
    prose: /\b(?:hypertens\w*|\bhtn\b|elevated (?:bp|blood pressure))\b/i,
    suggestion: "Antihypertensive therapy is documented but hypertension is not coded (I10-I13) — a medium-value comorbidity. Query to confirm.",
  },
];

// A prose signal negated in its own clause ("denies chest pain, no CHF") is not
// a documented condition. "History of X" still counts — chronic conditions in
// the history are real comorbidities. Mirrors the calculatePDGM negation rule:
// err toward NOT counting (a missed query loses a prompt; a false one
// pressures over-coding).
const NEGATION_RE = /\b(?:no|not|none|never|negative for|denies|denied|without|w\/o|absence of|ruled out|r\/o|free of|resolved)\s+(?:\w+\s+){0,3}$/i;

function unnegatedMatch(text, re) {
  if (!re) return null;
  const s = String(text || "");
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of s.matchAll(global)) {
    const clauseStart = Math.max(s.lastIndexOf(".", m.index), s.lastIndexOf(";", m.index), s.lastIndexOf("\n", m.index)) + 1;
    if (!NEGATION_RE.test(s.slice(clauseStart, m.index))) return m[0];
  }
  return null;
}

/** Flatten the prose fields worth scanning (never the whole document). */
function proseFields(ex) {
  const out = [];
  const push = (source, v) => {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach((item, i) => push(`${source}[${i}]`, item));
    else if (typeof v === "object") {
      if (v.condition) push(source, [v.condition, v.current_status, v.management].filter(Boolean).join(" — "));
    } else {
      const s = String(v).trim();
      if (s) out.push({ source, text: s });
    }
  };
  push("referral_reason", ex?.admission_details?.referral_reason);
  push("past_medical_history", ex?.diagnoses?.past_medical_history);
  push("functional_status", Object.values(ex?.functional_status || {}).join(" \n "));
  push("clinical_info", Object.values(ex?.clinical_info || {}).filter((v) => typeof v === "string").join(" \n "));
  push("oasis_relevant_notes", ex?.oasis_relevant_notes);
  push("orders_treatments.treatments", ex?.orders_treatments?.treatments);
  push("orders_treatments.monitoring_parameters", ex?.orders_treatments?.monitoring_parameters);
  push("nutritional_status.dietary_restrictions", ex?.nutritional_status?.dietary_restrictions);
  push("skilled_needs.specific_interventions", ex?.skilled_needs?.specific_interventions);
  return out;
}

/** Text that proves a family is already captured as a diagnosis. */
function capturedDxText(ex, candidates, uncoded) {
  return [
    ex?.diagnoses?.primary_diagnosis,
    ...(Array.isArray(ex?.diagnoses?.secondary_diagnoses) ? ex.diagnoses.secondary_diagnoses : []),
    ...(Array.isArray(ex?.diagnoses?.comorbidity_adjustments) ? ex.diagnoses.comorbidity_adjustments : []),
    ex?.oasis_assessment?.m1021_primary_diagnosis,
    ...(Array.isArray(ex?.oasis_assessment?.m1023_other_diagnoses) ? ex.oasis_assessment.m1023_other_diagnoses : []),
    ...candidates.map((c) => c.description),
    ...uncoded.map((u) => u.description),
  ]
    .map((v) => String(v ?? ""))
    .join(" \n ");
}

/**
 * Scan the referral for documented-but-uncoded comorbidity signals.
 *
 * @param {object} referralData extracted referral (full extraction, quick-scan,
 *   or Referral entity shape)
 * @returns {{
 *   opportunities: Array<{key,label,value,evidence:Array<{source,text}>,suggestion}>,
 *   highValueCount: number, mediumValueCount: number,
 * }}
 */
export function collectComorbidityCapture(referralData) {
  const ex = referralData?.extracted_data || referralData || {};
  const { candidates, uncoded } = harvestDiagnosisCandidates(ex);
  const codedCodes = candidates.map((c) => normalizeIcd(c.code));
  const dxText = capturedDxText(ex, candidates, uncoded);
  const meds = (Array.isArray(ex.medications) ? ex.medications : [])
    .map((m) => [m?.name, m?.notes].filter(Boolean).join(" "))
    .filter(Boolean);
  const prose = proseFields(ex);
  const wounds = Array.isArray(ex.wound_details) ? ex.wound_details : [];

  const opportunities = [];
  for (const signal of SIGNALS) {
    // Already captured? — by ICD family prefix, or named in the diagnosis text.
    const codedByPrefix = codedCodes.some((code) =>
      signal.icdPrefixes.some((p) => code.startsWith(normalizeIcd(p)))
    );
    if (codedByPrefix || unnegatedMatch(dxText, signal.dxTerms)) continue;

    const evidence = [];
    for (const medText of meds) {
      const hit = signal.meds ? unnegatedMatch(medText, signal.meds) : null;
      if (hit) evidence.push({ source: "medications", text: medText });
    }
    for (const { source, text } of prose) {
      const hit = unnegatedMatch(text, signal.prose);
      if (hit) evidence.push({ source, text });
    }
    if (signal.woundTypes) {
      for (const w of wounds) {
        const wtext = [w?.wound_type, w?.stage, w?.location].filter(Boolean).join(" ");
        if (unnegatedMatch(wtext, signal.woundTypes)) evidence.push({ source: "wound_details", text: wtext });
      }
    }
    if (evidence.length === 0) continue;

    opportunities.push({
      key: signal.key,
      label: signal.label,
      value: signal.value,
      // Cap the evidence list so one query stays readable.
      evidence: evidence.slice(0, 3),
      suggestion: signal.suggestion,
    });
  }

  // High-value first, then by label for a stable order.
  opportunities.sort(
    (a, b) => (a.value === b.value ? a.label.localeCompare(b.label) : a.value === "high" ? -1 : 1)
  );
  return {
    opportunities,
    highValueCount: opportunities.filter((o) => o.value === "high").length,
    mediumValueCount: opportunities.filter((o) => o.value === "medium").length,
  };
}
