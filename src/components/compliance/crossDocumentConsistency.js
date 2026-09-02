// crossDocumentConsistency — deterministic note ↔ OASIS ↔ care-plan review.
//
// WHAT IT DOES
// Finds places where two records PennSync holds say different things, and shows
// both sides with their evidence so a human can decide which is right.
//
// WHAT IT DELIBERATELY DOES NOT DO
//  - It NEVER rewrites a record. Silently "fixing" an inconsistency would edit
//    clinician-entered facts, and PennSync is not the record of truth for any of
//    the three sources.
//  - It never decides which side is correct. Every finding is a REVIEW PROMPT
//    with source A, source B, the evidence, a severity and a suggested action.
//  - It never asserts an OASIS response is wrong. Corrections, if any are
//    needed, are made on the official assessment in the EMR.
//
// Every check is a field or regex comparison — reproducible, explainable, and
// safe to act on. No LLM decides whether two clinical records conflict.
//
// Pure + offline so it runs under `node --test`. It may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).
import { RESPONSE_SCHEMA_V2_CMS_E2 } from "../oasis/responseSchema/registry.js";

/** Resolution actions a reviewer may take. PennSync records the choice only. */
export const RESOLUTIONS = Object.freeze(["acknowledged", "resolved", "task_created", "not_applicable"]);

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2 };

function finding({ id, severity, title, sourceA, sourceB, evidence, action }) {
  return {
    id,
    severity,
    title,
    sourceA,
    sourceB,
    evidence,
    action,
    // Always: PennSync surfaces, a human decides.
    advisory: true,
    resolution: null,
  };
}

// OASIS responses, read from the shape they are ACTUALLY persisted in.
//
// `OASISAssessment.oasis_items` is an ARRAY of { item_number, response, … } —
// see the entity schema and SmartOASISAssessment's save path. An earlier version
// of this module treated it as an object keyed by item id, so every lookup
// returned null on a real saved assessment: the OASIS cross-checks silently did
// nothing while the panel reported no inconsistencies found. That is the worst
// possible failure for a review tool, because absence of findings reads as
// assurance.
//
// The reader below is local to this module on purpose. The outcome engine's
// extractor is CMS-scoring-grade and refuses anything that is not a v2
// clinician-selected response; these checks are not CMS scoring, so they read
// both schemas — but each rule states, per schema, which codes meet it.
/**
 * Read saved OASIS answers for DISCREPANCY DETECTION ONLY.
 *
 * This module never emits an official code, never exports one, and never feeds a
 * CMS-labeled calculation — it asks the clinician to look again at their EMR. So
 * unlike the outcome engine it deliberately reads BOTH response schemas: gating
 * it on v2 would silently switch the safety check off for every assessment
 * recorded before the cutover, which is the opposite of safer.
 *
 * What it must NOT do is read a code without knowing which scale it came from.
 * Each answer is returned WITH its schema, and every rule below states the codes
 * it treats as meeting the condition, per schema.
 *
 * @returns {Object<string, {code: string, schema: "v1"|"v2"}>}
 */
function oasisAnswers(oasis) {
  if (!oasis) return {};
  const items = oasis.oasis_items || oasis.items || oasis.responses || oasis;
  const out = {};
  if (!Array.isArray(items)) {
    // A flat { m1860: 5 } map carries no schema at all, so it can only be read
    // under the legacy meanings — that is what it was written under.
    if (!items || typeof items !== "object") return out;
    for (const [k, v] of Object.entries(items)) {
      if (v === undefined || v === null || v === "") continue;
      if (typeof v === "object") continue;
      out[String(k).toLowerCase().replace(/[^a-z0-9]/g, "")] = { code: String(v), schema: "v1" };
    }
    return out;
  }
  for (const it of items) {
    if (!it || it.item_number == null) continue;
    const key = String(it.item_number).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (it.response_schema_id === RESPONSE_SCHEMA_V2_CMS_E2) {
      const code = it.response_value?.code;
      if (typeof code === "string") out[key] = { code, schema: "v2" };
    } else {
      // Legacy or unversioned: the value means what PennSync's old option list
      // meant. Recorded as v1 so a rule cannot apply a v2 threshold to it.
      const raw = it.response;
      if (raw !== undefined && raw !== null && raw !== "") out[key] = { code: String(raw), schema: "v1" };
    }
  }
  return out;
}

/**
 * Whether an item's saved answer is one of the codes that meet a condition.
 * Codes are compared as STRINGS, per schema — never coerced to numbers.
 *
 * @param {object} answers
 * @param {string} itemId
 * @param {{v1: string[], v2: string[]}} codesBySchema
 */
function answerMeans(answers, itemId, codesBySchema) {
  const hit = answers?.[String(itemId || "").toLowerCase()];
  if (!hit) return false;
  const allowed = codesBySchema[hit.schema];
  return Array.isArray(allowed) && allowed.includes(hit.code);
}

/** The saved code for display in a finding, or null. */
function oasisCode(answers, itemId) {
  const hit = answers?.[String(itemId || "").toLowerCase()];
  return hit ? hit.code : null;
}

const CARE_PLAN_TEXT = (carePlans) => (carePlans || [])
  .filter((p) => p && p.status !== "discontinued")
  .map((p) => [p.problem, p.goal, ...(Array.isArray(p.interventions) ? p.interventions : [p.interventions])]
    .filter(Boolean).join(" "))
  .join(" \n");

/**
 * Review one patient's records against each other.
 *
 * @param {{
 *   noteText?: string,
 *   patient?: object|null,
 *   oasis?: object|null,
 *   carePlans?: object[],
 *   openTasks?: object[],
 * }} input
 * @returns {{ findings: object[], counts: object, checked: string[] }}
 */
export function reviewCrossDocumentConsistency({
  noteText = "",
  patient = null,
  oasis = null,
  carePlans = [],
  openTasks = [],
} = {}) {
  const note = String(noteText || "");
  const plans = CARE_PLAN_TEXT(carePlans);
  const answers = oasisAnswers(oasis);
  const findings = [];
  const checked = [];

  // ── Fall risk vs fall-prevention intervention ────────────────────────────
  checked.push("High fall risk with a fall-prevention intervention");
  const fallRiskHigh = patient?.functional_status?.fall_risk === "high"
    // M1910 is a retired CMS item PennSync keeps as an internal screening
    // prompt, so it only ever exists under the legacy set.
    || answerMeans(answers, "m1910", { v1: ["1"], v2: [] });
  const FALL_INTERVENTION = /\bfall(?:s)?[- ](?:precaution|prevention|risk (?:intervention|reduction))|remove(?:d)? (?:clutter|throw rugs?)|grab bars?|non[- ]?skid|bed alarm|assistive device (?:for|to) (?:safe )?(?:ambulation|transfer)|safety (?:sweep|assessment) of the home/i;
  if (fallRiskHigh && !FALL_INTERVENTION.test(`${note} ${plans}`)) {
    findings.push(finding({
      id: "fall_risk_no_intervention",
      severity: "high",
      title: "High fall risk with no fall-prevention intervention documented",
      sourceA: { record: "Patient / OASIS", detail: "Fall risk recorded as high." },
      sourceB: { record: "Visit note / care plan", detail: "No fall-prevention intervention found." },
      evidence: [patient?.functional_status?.notes].filter(Boolean),
      action: "Document the fall-prevention intervention, or record why none applies.",
    }));
  }

  // ── Severe functional limitation vs "independent" in the narrative ───────
  checked.push("Functional limitation consistent with the narrative");
  const ambulation = oasisCode(answers, "m1860");
  // Chairfast or bedfast. Legacy 5/6 are "chairfast, wheels self" / "bedfast";
  // CMS 5/6 are "chairfast, unable to wheel self" / "bedfast". Different
  // wording, same claim for this check — stated per schema rather than assumed.
  const bedfast = answerMeans(answers, "m1860", { v1: ["5", "6"], v2: ["5", "6"] });
  const INDEPENDENT_NARRATIVE = /\b(?:ambulates? independently|independent (?:with )?ambulation|walks? without assistance|independent with (?:all )?adls?)\b/i;
  if (bedfast && INDEPENDENT_NARRATIVE.test(`${note} ${plans}`)) {
    findings.push(finding({
      id: "function_conflict",
      severity: "high",
      title: "OASIS ambulation response conflicts with the narrative",
      sourceA: { record: "OASIS M1860", detail: `Response ${ambulation} indicates the patient is bedfast or chairfast.` },
      sourceB: { record: "Visit note / care plan", detail: "The narrative describes independent ambulation." },
      evidence: sentencesMatching(`${note}\n${plans}`, INDEPENDENT_NARRATIVE),
      action: "Review which reflects the patient today, and correct the official assessment in your EMR if needed.",
    }));
  }
  if (patient?.functional_status?.ambulation === "bedbound" && INDEPENDENT_NARRATIVE.test(note)) {
    findings.push(finding({
      id: "chart_function_conflict",
      severity: "medium",
      title: "Chart records the patient as bedbound but the note describes independent ambulation",
      sourceA: { record: "Patient chart", detail: "Functional status: bedbound." },
      sourceB: { record: "Visit note", detail: "The narrative describes independent ambulation." },
      evidence: sentencesMatching(note, INDEPENDENT_NARRATIVE),
      action: "Confirm the patient's current status and update the chart and EMR accordingly.",
    }));
  }

  // ── Medication-management deficit vs a medication intervention ────────────
  checked.push("Medication-management deficit with a medication intervention");
  const oralMeds = oasisCode(answers, "m2020");
  // Cannot manage oral medications independently. CMS "NA" (no oral medications
  // prescribed) is deliberately absent — it is not a deficit.
  const medDeficit = answerMeans(answers, "m2020", { v1: ["2", "3"], v2: ["2", "3"] });
  const MED_INTERVENTION = /\bmedication (?:management|teaching|reconcil|set[- ]?up|administration|review)|pill ?box|med(?:ication)? planner|taught .{0,40}medication|reviewed .{0,30}medication/i;
  if (medDeficit && !MED_INTERVENTION.test(`${note} ${plans}`)) {
    findings.push(finding({
      id: "med_deficit_no_intervention",
      severity: "high",
      title: "Medication-management deficit with no related intervention documented",
      sourceA: { record: "OASIS M2020", detail: `Response ${oralMeds} indicates the patient cannot manage oral medications independently.` },
      sourceB: { record: "Visit note / care plan", detail: "No medication-management intervention found." },
      evidence: [],
      action: "Document the medication-management intervention, or record who manages the medications.",
    }));
  }

  // ── Wound on the chart vs wound documentation ────────────────────────────
  checked.push("Documented wound with wound care in the note or care plan");
  const wounds = (patient?.wounds || []).filter(Boolean);
  const WOUND_DOC = /\bwound|pressure (?:ulcer|injury)|dressing|incision|ulcer|skin tear|debride|granulat/i;
  if (wounds.length && !WOUND_DOC.test(`${note} ${plans}`)) {
    findings.push(finding({
      id: "wound_not_documented",
      severity: "high",
      title: "The chart lists an active wound with no wound documentation this visit",
      sourceA: { record: "Patient chart", detail: wounds.map((w) => w.location).filter(Boolean).join(", ") || "Active wound recorded." },
      sourceB: { record: "Visit note / care plan", detail: "No wound assessment or care found." },
      evidence: [],
      action: "Document the wound assessment, or record that the wound has resolved.",
    }));
  }

  // ── Deterioration in the note vs an unchanged care plan ──────────────────
  checked.push("Documented decline with a care-plan response");
  const DECLINE = /\b(?:worsen(?:ed|ing)?|declin(?:e|ed|ing)|deteriorat(?:ed|ing|ion)|increased (?:pain|edema|dyspnea|confusion)|new (?:onset|symptom)|exacerbation|larger|more drainage|unable to .{0,25}(?:anymore|now))\b/i;
  const declineSentences = sentencesMatching(note, DECLINE);
  const PLAN_RESPONSE = /\b(?:plan (?:updated|revised|changed)|new order|notified|increase(?:d)? (?:the )?(?:frequency|visits)|added (?:an )?intervention|care plan (?:review|update))\b/i;
  // Task types/wording that plausibly respond to a clinical decline.
  const FOLLOW_UP_TASK = /\b(?:notify|notification|provider|physician|prescriber|md|order|follow[- ]?up|escalat|assess|wound|safety|care plan|clinical)\b/i;
  // A decline is only "responded to" by an OPEN follow-up that plausibly relates
  // to it. Suppressing on ANY task that is merely not `completed` let a
  // cancelled task — or an unrelated supply or scheduling task — silence a
  // documented deterioration, which is the one finding here that must not be
  // silenced by accident.
  const respondingTask = openTasks.some((t) => {
    if (!t || ["completed", "cancelled", "resolved"].includes(t.status)) return false;
    return FOLLOW_UP_TASK.test(`${t.title || ""} ${t.description || ""} ${t.type || ""}`);
  });
  if (declineSentences.length && !PLAN_RESPONSE.test(`${note} ${plans}`) && !respondingTask) {
    findings.push(finding({
      id: "decline_no_plan_change",
      severity: "high",
      title: "The note describes a decline with no care-plan change or follow-up recorded",
      sourceA: { record: "Visit note", detail: "The narrative describes worsening or a new symptom." },
      sourceB: { record: "Care plan / tasks", detail: "No care-plan update or open follow-up found in PennSync." },
      evidence: declineSentences,
      action: "Review whether the plan of care needs updating, and create a provider follow-up if indicated.",
    }));
  }

  // ── Discharge language vs active goals ───────────────────────────────────
  checked.push("Discharge documentation against active care-plan goals");
  const DISCHARGE = /\b(?:discharg(?:e|ed|ing) (?:from|today|home)|goals? (?:have been |were )?met|no longer (?:homebound|skilled|eligible))\b/i;
  const activeGoals = (carePlans || []).filter((p) => p && (p.status === "active" || p.status === "in_progress"));
  if (DISCHARGE.test(note) && activeGoals.length) {
    findings.push(finding({
      id: "discharge_with_active_goals",
      severity: "medium",
      title: "Discharge documentation with care-plan goals still active",
      sourceA: { record: "Visit note", detail: "The narrative describes discharge or goals met." },
      sourceB: { record: "Care plan", detail: `${activeGoals.length} goal${activeGoals.length === 1 ? "" : "s"} still active in PennSync.` },
      evidence: sentencesMatching(note, DISCHARGE),
      action: "Close or update the care-plan goals to match the discharge documentation.",
    }));
  }

  findings.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));

  return {
    findings,
    counts: {
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      total: findings.length,
    },
    checked,
  };
}

/** Sentences of `text` matching `pattern`, capped for display. */
function sentencesMatching(text, pattern) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && pattern.test(s))
    .slice(0, 3);
}

/**
 * Record a reviewer's decision on a finding. PennSync stores the CHOICE — it
 * never edits the underlying records.
 *
 * @param {object} finding
 * @param {"acknowledged"|"resolved"|"task_created"|"not_applicable"} resolution
 * @param {{ actorEmail?: string|null, reason?: string, at?: string }} [meta]
 */
export function resolveFinding(finding, resolution, meta = {}) {
  if (!RESOLUTIONS.includes(resolution)) {
    return { ok: false, reason: `Unknown resolution: ${resolution}`, finding };
  }
  // "Not applicable" without a reason is how a real finding quietly disappears.
  if (resolution === "not_applicable" && !String(meta.reason || "").trim()) {
    return { ok: false, reason: "Marking a finding not applicable requires a reason.", finding };
  }
  return {
    ok: true,
    finding: {
      ...finding,
      resolution: {
        status: resolution,
        by: meta.actorEmail || null,
        at: meta.at || new Date().toISOString(),
        reason: meta.reason || "",
      },
    },
  };
}
