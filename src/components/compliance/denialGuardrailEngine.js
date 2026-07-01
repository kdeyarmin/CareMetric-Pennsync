// Deterministic denial-reason guardrail engine.
//
// Insufficient documentation drives ~51% of home-health improper payments. This
// is a PRE-SAVE check on the four recurring denial clusters that auditors reject:
//
//   1. Homebound narrative QUALITY  — not keyword matching. A conclusory
//      "patient is homebound" passes a presence check but FAILS an audit; a real
//      narrative names a medical reason AND why leaving home is taxing.
//   2. Skilled-need specificity     — "provided nursing care" is custodial-
//      sounding and denied; a real note names the skilled service.
//   3. Face-to-Face (F2F)           — consumed from the referral's F2F validation
//      (see faceToFaceValidator.js); never scanned from the nurse's note.
//   4. Medical-necessity linkage    — the skilled service must tie to the
//      patient's diagnosis / clinical condition.
//
// It COMPOSES the existing compliance modules (getRequiredElements /
// detectPresence) for applicability + CFR citations, then layers deterministic
// QUALITY heuristics on top. Pure + offline (unit-tested with `node --test`).

import { getRequiredElements } from "../smartNote/compliance/requiredElements.js";
import { detectPresence } from "../smartNote/compliance/presenceDetection.js";

export const CLUSTER = {
  HOMEBOUND: "homebound_narrative",
  SKILLED_NEED: "skilled_need_specificity",
  F2F: "face_to_face",
  MEDICAL_NECESSITY: "medical_necessity_linkage",
};

export const GUARD_STATUS = { PASS: "pass", FAIL: "fail", NOT_APPLICABLE: "not_applicable" };

// ── homebound quality signals ───────────────────────────────────────────────
// A medical REASON the patient is confined (or an explicit causal phrase).
const HB_REASON = /\b(dyspnea|short(?:ness)? of breath|sob|weak(?:ness)?|cva|stroke|fracture|fx|pain|dizz(?:y|iness)|fall risk|falls?|wound|surg(?:ery|ical)|post[- ]?op|oxygen|\bo2\b|deconditio|unsteady|gait|amputat|paraly|bedbound|bedfast|edema|chf|copd|neuropath|contracture|non[- ]?weight[- ]?bearing|nwb)\b/i;
const HB_CAUSAL = /\b(due to|secondary to|because of|related to|as a result of|r\/t)\b/i;
// Evidence that leaving home is a considerable and TAXING effort.
const HB_EFFORT = /\b(taxing|considerable effort|requires? (?:the )?assist|assistance of|max(?:imal)? assist|moderate assist|min(?:imal)? assist|two[- ]person|one[- ]person|walker|wheelchair|w\/c|cane|crutch|unable to leave|unsafe to leave|cannot leave|exhaust|only .*(?:with help|steps)|supervision to ambulat|tolerates only)\b/i;
const HB_MENTION = /\b(homebound|confined to (?:home|residence|the house)|leaving (?:the )?home)\b/i;

// ── skilled-need quality signals ────────────────────────────────────────────
// Vague / custodial-sounding statements that auditors treat as unskilled.
const SN_VAGUE = /\b(provided|gave|rendered|performed|completed)\s+(?:the\s+)?(?:routine\s+)?(?:nursing|skilled)\s+(?:care|visit|services?)\b|\broutine (?:nursing )?visit (?:completed|done|performed)\b|\bnursing (?:visit|care) (?:provided|completed|given|done)\b|\bsnv (?:completed|done)\b/i;
// A specific skilled service that requires professional judgment.
const SN_SPECIFIC = /\b(wound care|dressing change|sterile|observation and assessment|skilled (?:observation|assessment)|assessment of (?:the |an? )?\w+|medication management|med (?:management|teaching|reconcil)|teach[- ]?back|catheter|foley|injection|insulin|\biv\b|infusion|titrat|ostomy|trach|lung ausc|edema (?:check|assessment)|gait training|venipuncture|picc|enteral|parenteral)\b/i;

// ── medical-necessity linkage signals ───────────────────────────────────────
const MN_LINK = /\b(for (?:the )?management of|to monitor|monitoring for|assess(?:ing|ment)? (?:for|of)|to evaluate|for evaluation of|due to|secondary to|related to|s\/p|post[- ]?op|for treatment of|management of|to manage)\b/i;
const DX_HINT = /\b(diagnos|\bdx\b|chf|copd|diabet|dm2?|htn|hypertension|wound|ulcer|fracture|cva|stroke|cancer|dementia|parkinson|renal|failure|pneumonia|cellulitis|sepsis|afib|copd)\b/i;

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

// Split on SENTENCE terminators + newlines only (NOT ';' or ':'), so a clause
// like "homebound due to dyspnea; requires a walker and assist" stays intact —
// the reason and the taxing-effort evidence must be scoped together.
function sentencesWith(text, re) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && re.test(s));
}

function finding(cluster, status, extra = {}) {
  return { cluster, status, ...extra };
}

/**
 * Evaluate homebound narrative QUALITY (home-health only).
 */
function evaluateHomebound(text, cop) {
  if (!HB_MENTION.test(text)) {
    return finding(CLUSTER.HOMEBOUND, GUARD_STATUS.FAIL, {
      severity: "critical",
      denial_risk: 35,
      cop_reference: cop,
      message: "Homebound status is not documented.",
      remediation: "Document the medical reason for confinement and why leaving home requires a considerable and taxing effort.",
      evidence: null,
    });
  }
  const scope = sentencesWith(text, HB_MENTION).join(" ");
  const hasReason = HB_REASON.test(scope) || HB_CAUSAL.test(scope);
  const hasEffort = HB_EFFORT.test(scope);

  if (hasReason && hasEffort) {
    return finding(CLUSTER.HOMEBOUND, GUARD_STATUS.PASS, {
      severity: "critical",
      denial_risk: 0,
      cop_reference: cop,
      message: "Homebound narrative names a medical reason and the taxing effort to leave home.",
      evidence: scope,
    });
  }
  const missing = [];
  if (!hasReason) missing.push("a medical reason for confinement");
  if (!hasEffort) missing.push("why leaving home is a considerable and taxing effort");
  return finding(CLUSTER.HOMEBOUND, GUARD_STATUS.FAIL, {
    // Conclusory "patient is homebound" with neither element is the top denial
    // driver → critical. Missing only one element is a high (fixable) risk.
    severity: !hasReason && !hasEffort ? "critical" : "high",
    denial_risk: !hasReason && !hasEffort ? 30 : 15,
    cop_reference: cop,
    message: `Homebound statement is conclusory — missing ${missing.join(" and ")}.`,
    remediation: "Replace the conclusory statement with the medical reason AND the taxing effort/assistance needed to leave home.",
    evidence: scope,
  });
}

/**
 * Evaluate skilled-need specificity.
 */
function evaluateSkilledNeed(text, cop) {
  const specific = SN_SPECIFIC.test(text);
  const vague = SN_VAGUE.test(text);

  if (specific) {
    return finding(CLUSTER.SKILLED_NEED, GUARD_STATUS.PASS, {
      severity: "critical",
      denial_risk: 0,
      cop_reference: cop,
      message: "A specific skilled service requiring professional judgment is documented.",
      evidence: sentencesWith(text, SN_SPECIFIC)[0] || null,
    });
  }
  if (vague) {
    return finding(CLUSTER.SKILLED_NEED, GUARD_STATUS.FAIL, {
      severity: "critical",
      denial_risk: 30,
      cop_reference: cop,
      message: "Skilled need is conclusory (e.g. 'provided nursing care') — reads as custodial and is a denial risk.",
      remediation: "Name the specific skilled service (assessment/observation of an unstable patient, wound care, medication management/teaching) and why it required a nurse's skill.",
      evidence: sentencesWith(text, SN_VAGUE)[0] || null,
    });
  }
  return finding(CLUSTER.SKILLED_NEED, GUARD_STATUS.FAIL, {
    severity: "critical",
    denial_risk: 35,
    cop_reference: cop,
    message: "No skilled need is documented.",
    remediation: "Document the specific skilled nursing service that required professional judgment this visit.",
    evidence: null,
  });
}

/**
 * Evaluate medical-necessity linkage: the skilled service must tie to the
 * patient's diagnosis / clinical condition.
 */
function evaluateMedicalNecessity(text, cop, primaryDiagnosis) {
  // Scope the linkage check to the SKILLED-SERVICE sentence(s) — the diagnosis
  // link must tie to the skilled service, not to an unrelated clause (e.g. the
  // homebound "due to weakness" reason).
  const skilledSentences = sentencesWith(text, SN_SPECIFIC);
  const scope = skilledSentences.length ? skilledSentences.join(" ") : text;
  const scopeLower = scope.toLowerCase();
  const dxMentioned =
    DX_HINT.test(scope) ||
    (primaryDiagnosis && scopeLower.includes(String(primaryDiagnosis).toLowerCase().split(/\s+/)[0]));
  const linked = MN_LINK.test(scope);

  if (dxMentioned && linked) {
    return finding(CLUSTER.MEDICAL_NECESSITY, GUARD_STATUS.PASS, {
      severity: "high",
      denial_risk: 0,
      cop_reference: cop,
      message: "The skilled service is linked to the patient's diagnosis / clinical condition.",
      evidence: skilledSentences[0] || null,
    });
  }
  const missing = [];
  if (!dxMentioned) missing.push("a diagnosis / condition reference");
  if (!linked) missing.push("a linkage phrase tying the service to that condition");
  return finding(CLUSTER.MEDICAL_NECESSITY, GUARD_STATUS.FAIL, {
    severity: "high",
    denial_risk: 20,
    cop_reference: cop,
    message: `Medical-necessity linkage is weak — missing ${missing.join(" and ")}.`,
    remediation: "Tie the skilled service to the diagnosis (e.g. 'skilled assessment for management of CHF exacerbation').",
    evidence: null,
  });
}

/**
 * Evaluate the F2F cluster from the referral's F2F validation result. F2F is a
 * referral-level artifact (see faceToFaceValidator.js) — this guardrail NEVER
 * scans the nurse's note for it. When no validation is supplied the cluster is
 * not-applicable (e.g. a routine visit, or F2F handled elsewhere).
 */
function evaluateF2F(f2fValidation, cop) {
  if (!f2fValidation) {
    return finding(CLUSTER.F2F, GUARD_STATUS.NOT_APPLICABLE, {
      severity: "info",
      denial_risk: 0,
      cop_reference: cop,
      message: "No F2F validation supplied for this note (evaluated at referral intake).",
    });
  }
  if (f2fValidation.valid) {
    return finding(CLUSTER.F2F, GUARD_STATUS.PASS, {
      severity: "critical",
      denial_risk: 0,
      cop_reference: cop,
      message: "A valid Face-to-Face encounter is on file for this episode.",
    });
  }
  return finding(CLUSTER.F2F, GUARD_STATUS.FAIL, {
    severity: "critical",
    denial_risk: 25,
    cop_reference: cop,
    message: `Face-to-Face encounter is invalid or missing: ${(f2fValidation.reasons || []).join("; ") || "not documented"}.`,
    remediation: "Obtain a compliant F2F encounter (eligible certifying practitioner, within the 90-days-before/30-days-after window, linked to the primary diagnosis).",
    evidence: null,
  });
}

/**
 * Run the denial-reason guardrail over a draft note.
 *
 * @param {Object} input
 * @param {string} input.noteText
 * @param {string} [input.serviceLine="home_health"]
 * @param {string} [input.visitType="routine_visit"]
 * @param {Object} [input.context]  { f2fValidation, primaryDiagnosis }
 * @returns {{
 *   passed: boolean, blocking: boolean, denial_risk_score: number,
 *   findings: Array, blocking_findings: Array,
 * }}
 */
export function runDenialGuardrail({ noteText, serviceLine = "home_health", visitType = "routine_visit", context = {} } = {}) {
  const text = normalize(noteText);
  const elements = getRequiredElements(serviceLine, visitType);
  const byId = Object.fromEntries(elements.map((e) => [e.id, e]));

  // Presence signals from the existing module (composition, not duplication).
  const presence = detectPresence(text, elements);
  const presentIds = new Set(presence.filter((p) => p.present).map((p) => p.id));

  const homeboundRequired = !!byId.homebound;
  const skilledEl = byId.skilled_need || byId.comfort_skilled_need;
  const f2fApplicable = ["admission", "recertification"].includes(visitType) && serviceLine === "home_health";

  const findings = [];

  if (homeboundRequired) {
    findings.push(evaluateHomebound(text, byId.homebound.copReference));
  }
  if (skilledEl) {
    findings.push(evaluateSkilledNeed(text, skilledEl.copReference));
    findings.push(evaluateMedicalNecessity(text, skilledEl.copReference, context.primaryDiagnosis));
  }
  if (f2fApplicable || context.f2fValidation) {
    findings.push(evaluateF2F(context.f2fValidation, "42 CFR 424.22"));
  }

  const denialRisk = Math.min(
    100,
    findings.filter((f) => f.status === GUARD_STATUS.FAIL).reduce((sum, f) => sum + (f.denial_risk || 0), 0),
  );
  const blockingFindings = findings.filter((f) => f.status === GUARD_STATUS.FAIL && f.severity === "critical");

  return {
    passed: findings.every((f) => f.status !== GUARD_STATUS.FAIL),
    blocking: blockingFindings.length > 0,
    denial_risk_score: denialRisk,
    findings,
    blocking_findings: blockingFindings,
    // Expose which required elements were present (from the composed detector),
    // so a UI can reconcile guardrail findings with the checklist.
    present_element_ids: [...presentIds],
  };
}
