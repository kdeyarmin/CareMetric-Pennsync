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
import { hasPlaceholder } from "../smartNote/compliance/placeholderGuard.js";

export const CLUSTER = {
  HOMEBOUND: "homebound_narrative",
  SKILLED_NEED: "skilled_need_specificity",
  F2F: "face_to_face",
  MEDICAL_NECESSITY: "medical_necessity_linkage",
};

export const GUARD_STATUS = { PASS: "pass", FAIL: "fail", NOT_APPLICABLE: "not_applicable" };

// Which required-element ids each cluster already judges the QUALITY of.
// Consumers use this to avoid double-judging: an element covered by a cluster
// here is assessed by this engine's purpose-built heuristics (reason + taxing
// effort, service specificity), which are stronger than the generic adequacy
// signals, and a failing cluster already gates the chart save. Elements absent
// from this map have no quality judge but the adequacy rules.
export const CLUSTER_ELEMENT_IDS = {
  [CLUSTER.HOMEBOUND]: ["homebound"],
  [CLUSTER.SKILLED_NEED]: ["skilled_need", "comfort_skilled_need"],
};

/** Element ids whose quality is already judged by a cluster present in `findings`. */
export function elementsJudgedByGuardrail(findings = []) {
  const out = new Set();
  for (const f of Array.isArray(findings) ? findings : []) {
    for (const id of CLUSTER_ELEMENT_IDS[f?.cluster] || []) out.add(id);
  }
  return [...out];
}

// ── homebound quality signals ───────────────────────────────────────────────
// A medical REASON the patient is confined (or an explicit causal phrase).
const HB_REASON = /\b(dyspnea|short(?:ness)? of breath|sob|weak(?:ness)?|cva|stroke|fracture|fx|pain|dizz(?:y|iness)|fall risk|falls?|wound|surg(?:ery|ical)|post[- ]?op|oxygen|\bo2\b|deconditio\w*|unsteady|gait|amputat\w*|paraly\w*|bedbound|bedfast|edema|chf|copd|neuropath\w*|contracture|non[- ]?weight[- ]?bearing|nwb)\b/i;
const HB_CAUSAL = /\b(due to|secondary to|because of|related to|as a result of|r\/t)\b/i;
// Evidence that leaving home is a considerable and TAXING effort.
const HB_EFFORT = /\b(taxing|considerable effort|requires? (?:the )?assist|assistance of|max(?:imal)? assist|moderate assist|min(?:imal)? assist|two[- ]person|one[- ]person|walker|wheelchair|w\/c|cane|crutch|unable to leave|unsafe to leave|cannot leave|exhaust\w*|only .*(?:with help|steps)|supervision to ambulat\w*|tolerates only)\b/i;
// The homebound VOCABULARY must match what presenceDetection's homebound element
// accepts, because coverageScore now uses a FAILED homebound cluster to veto
// `homebound_status_verified`. When the two disagreed, a note the presence
// detector accepted ("Patient unable to leave home due to severe dyspnea and
// requires a walker with one-person assistance") fell through to "Homebound
// status is not documented" here — HB_MENTION knew "leaving home" but not
// "unable to leave home" — and the veto then persisted `false` for genuinely
// good documentation. Keep this list in sync with E.homebound's pattern.
const HB_MENTION = /\b(homebound|confined to (?:home|residence|the house)|(?:unable to|not able to|cannot|can't|unsafe to) leave (?:the )?(?:home|house|residence)|leaving (?:the )?home)\b/i;
// An affirmative statement that the patient is NOT homebound — an ELIGIBILITY
// failure, never a quality pass ("no longer homebound", "not homebound",
// "denies being homebound").
const HB_NEGATED = /\b(?:no longer|not|never|denies being|is not|isn't)\s+(?:considered\s+|currently\s+)?homebound\b/i;

// ── skilled-need quality signals ────────────────────────────────────────────
// Vague / custodial-sounding statements that auditors treat as unskilled.
const SN_VAGUE = /\b(provided|gave|rendered|performed|completed)\s+(?:the\s+)?(?:routine\s+)?(?:nursing|skilled)\s+(?:care|visit|services?)\b|\broutine (?:nursing )?visit (?:completed|done|performed)\b|\bnursing (?:visit|care) (?:provided|completed|given|done)\b|\bsnv (?:completed|done)\b/i;
// A specific skilled service that requires professional judgment.
const SN_SPECIFIC = /\b(wound care|dressing change|sterile|observation and assessment|skilled (?:observation|assessment)|assessment of (?:the |an? )?\w+|medication management|med (?:management|teaching|reconcil\w*)|teach[- ]?back|catheter|foley|injection|insulin|\biv\b|infusion|titrat\w*|ostomy|trach|lung ausc\w*|edema (?:check|assessment)|gait training|venipuncture|picc|enteral|parenteral)\b/i;
// Comfort-focused skilled services for HOSPICE notes (comfort_skilled_need).
// The home-health vocabulary alone hard-blocked compliant comfort-care notes
// ("managed with repositioning, mouth care, and caregiver coaching").
const SN_COMFORT = /\b(symptom (?:management|assessment|control)|comfort (?:care|measures?|plan)|reposition\w*|mouth care|oral care|pain (?:management|control|assessment|reassess\w*)|oxygen (?:titrat\w*|administr\w*|therapy)|caregiver (?:coaching|teaching|education)|end[- ]of[- ]life|terminal (?:care|restlessness|agitation)|bowel regimen|secretion management|(?:dyspnea|nausea|anxiety|agitation|air hunger) (?:management|managed|control)|managed with|morphine|roxanol|lorazepam|comfort kit)\b/i;
const SN_SPECIFIC_COMFORT = new RegExp(`${SN_SPECIFIC.source}|${SN_COMFORT.source}`, "i");

// A skilled-service mention negated in its own clause is NOT a delivered
// service — "No wound care performed", "Patient refused wound care" used to
// PASS skilled-need specificity.
// Up to 4 words between the negation and the hit, so a coordinated phrase
// ("No wound care or skilled service…") is still seen as negated. Clause
// boundaries (; , :) reset the window.
const SN_NEGATED_PREFIX = /\b(?:no|not|without|denies|declined?s?|refused?s?|unable to|deferred|held)\s+(?:\w+\s+){0,4}$/i;

// Post-term negation, mirroring presenceDetection.js. Looking only BEHIND the
// hit missed the two commonest ways a service is recorded as NOT delivered:
//   standalone  "Wound care: none", "Skilled service — declined"
//   verb form   "Wound care declined by patient", "Teaching deferred"
// Both used to count as a delivered skilled service and PASS the guardrail.
// The standalone form requires the negative to end the sentence, so
// "Wound care: no complications noted" — which documents care that WAS given —
// is untouched.
const SN_STANDALONE_DENIAL =
  /[:\-–—]+\s*(?:no|none|negative|nil|n\/?a|denied|declined|refused|deferred|held)\s*$/i;
const SN_NEGATED_VERB_SUFFIX =
  /^\s+(?:\w+\s+){0,2}(?:declines?|declined|refuses?|refused|defers?|deferred|withheld|held|not\s+(?:done|performed|provided|completed|indicated|applicable))\b/i;

function unnegatedSentences(text, re) {
  return sentencesWith(text, re).filter((s) => {
    const m = re.exec(s);
    if (!m) return false;
    if (SN_STANDALONE_DENIAL.test(s)) return false;
    const boundary = Math.max(s.lastIndexOf(";", m.index), s.lastIndexOf(",", m.index), s.lastIndexOf(":", m.index));
    if (SN_NEGATED_PREFIX.test(s.slice(boundary + 1, m.index))) return false;
    const tail = s.slice(m.index + m[0].length);
    const clauseEnd = tail.search(/[;,]/);
    return !SN_NEGATED_VERB_SUFFIX.test(clauseEnd === -1 ? tail : tail.slice(0, clauseEnd));
  });
}

// ── medical-necessity linkage signals ───────────────────────────────────────
const MN_LINK = /\b(for (?:the )?management of|to monitor|monitoring for|assess(?:ing|ment)? (?:for|of)|to evaluate|for evaluation of|due to|secondary to|related to|s\/p|post[- ]?op|for treatment of|management of|to manage)\b/i;
const DX_HINT = /\b(diagnos\w*|\bdx\b|chf|copd|diabet\w*|dm2?|htn|hypertension|wound|ulcer|fracture|cva|stroke|cancer|dementia|parkinson|renal|failure|pneumonia|cellulitis|sepsis|afib|copd)\b/i;

function normalize(text) {
  // Collapse runs of spaces/tabs but PRESERVE newlines, so sentencesWith() can
  // still scope clause-by-clause. Collapsing newlines here merged bullet drafts
  // (newline-separated, no periods) into one line, letting a reason in one bullet
  // and taxing-effort evidence in another falsely satisfy homebound/skilled-need.
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Split on SENTENCE terminators + newlines only (NOT ';' or ':'), so a clause
// like "homebound due to dyspnea; requires a walker and assist" stays intact —
// the reason and the taxing-effort evidence must be scoped together.
// No lookbehind: it is a parse-time SyntaxError on Safari < 16.4, which would
// kill the whole module on import (see factExtraction.js) — terminators are
// rewritten to newlines instead.
function sentencesWith(text, re) {
  return String(text || "")
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/\n+/)
    .map((s) => s.trim())
    // An unfilled template line is not a documented narrative. Without this an
    // untouched "Homebound status: unable to leave home without considerable
    // effort due to [diagnosis]" supplied BOTH the causal phrase and the
    // taxing-effort evidence, so the homebound cluster reported PASS at 0%
    // denial risk for a note whose reason was still a blank.
    .filter((s) => s && !hasPlaceholder(s) && re.test(s));
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
  // A note that affirmatively documents the patient is NOT homebound is an
  // eligibility failure — the reason/effort quality check must never turn
  // "no longer homebound" into a PASS.
  if (HB_NEGATED.test(text)) {
    return finding(CLUSTER.HOMEBOUND, GUARD_STATUS.FAIL, {
      severity: "critical",
      denial_risk: 35,
      cop_reference: cop,
      message: "The note documents the patient is NOT homebound — the home health benefit requires confined-to-home status.",
      remediation: "If the patient is genuinely no longer homebound, initiate discharge planning; do not bill further home health visits. If homebound status continues, correct the narrative.",
      evidence: sentencesWith(text, HB_NEGATED)[0] || null,
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
 * Evaluate skilled-need specificity. `specificRe` carries the service-line
 * vocabulary (home-health SN_SPECIFIC, or +comfort terms for hospice); only
 * un-negated mentions count as a delivered service.
 */
function evaluateSkilledNeed(text, cop, specificRe = SN_SPECIFIC) {
  const specificHits = unnegatedSentences(text, specificRe);
  const vague = SN_VAGUE.test(text);

  if (specificHits.length) {
    return finding(CLUSTER.SKILLED_NEED, GUARD_STATUS.PASS, {
      severity: "critical",
      denial_risk: 0,
      cop_reference: cop,
      message: "A specific skilled service requiring professional judgment is documented.",
      evidence: specificHits[0] || null,
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
function evaluateMedicalNecessity(text, cop, primaryDiagnosis, specificRe = SN_SPECIFIC) {
  // Scope the linkage check to the SKILLED-SERVICE sentence(s) — the diagnosis
  // link must tie to the skilled service, not to an unrelated clause (e.g. the
  // homebound "due to weakness" reason).
  const skilledSentences = unnegatedSentences(text, specificRe);
  // No skilled service documented ⇒ there is nothing to link. Falling back to
  // the WHOLE note let the homebound sentence's own "due to <diagnosis>" supply
  // both signals, so the cluster reported PASS with denial_risk 0 and a null
  // evidence line for a note documenting no skilled service at all — the exact
  // scoping error the comment above warns about, reintroduced by the fallback.
  if (!skilledSentences.length) {
    return finding(CLUSTER.MEDICAL_NECESSITY, GUARD_STATUS.FAIL, {
      severity: "high",
      denial_risk: 20,
      cop_reference: cop,
      message: "Medical-necessity linkage cannot be established — no skilled service is documented to tie to a diagnosis.",
      remediation: "Document the skilled service delivered, then tie it to the diagnosis (e.g. 'skilled assessment for management of CHF exacerbation').",
      evidence: null,
    });
  }
  const scope = skilledSentences.join(" ");
  // Word-boundary match on a meaningful diagnosis token — a raw substring let
  // "CA of prostate" match inside "CAtheter" and pass medical necessity for a
  // note that never references the diagnosis. Tokens under 3 chars and glue
  // words are skipped.
  const DX_STOPWORDS = new Set(["of", "the", "and", "with", "left", "right", "due", "to"]);
  const dxToken = String(primaryDiagnosis || "")
    .toLowerCase()
    .split(/\s+/)
    .find((t) => t.length >= 3 && !DX_STOPWORDS.has(t));
  const dxTokenRe = dxToken
    ? new RegExp(`\\b${dxToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    : null;
  const dxMentioned = DX_HINT.test(scope) || (dxTokenRe ? dxTokenRe.test(scope) : false);
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
function evaluateF2F(f2fValidation, cop, applicable = false) {
  if (!f2fValidation) {
    // On an admission/recert, "nothing wired up" must not read as green — the
    // F2F cluster is one of the four denial drivers this engine exists to
    // guard. Non-blocking (high, not critical), but visible and risk-scored.
    if (applicable) {
      return finding(CLUSTER.F2F, GUARD_STATUS.FAIL, {
        severity: "high",
        denial_risk: 10,
        cop_reference: cop,
        message: "Face-to-Face validation is not linked to this note — confirm a compliant F2F encounter is on file at referral intake.",
        remediation: "Run the referral's F2F validation (eligible certifying practitioner, timing window, diagnosis linkage) and link the result before billing.",
        evidence: null,
      });
    }
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
 * The whole argument is optional (the signature defaults it to `{}`), so the
 * JSDoc marks it — and `noteText` — optional too: `normalize()` already treats a
 * missing note as empty text, and checkJs otherwise rejects every no-arg /
 * partial call.
 *
 * @param {Object} [input]
 * @param {string} [input.noteText]
 * @param {string} [input.serviceLine="home_health"]
 * @param {string} [input.visitType="routine_visit"]
 * @param {Object} [input.context]  { f2fValidation, primaryDiagnosis }
 * @returns {{
 *   passed: boolean, blocking: boolean, denial_risk_score: number,
 *   findings: Array, blocking_findings: Array, present_element_ids: string[],
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
    // Hospice comfort notes are judged with the comfort-care vocabulary too —
    // repositioning/mouth care/caregiver coaching ARE the skilled service.
    const specificRe = skilledEl.id === "comfort_skilled_need" ? SN_SPECIFIC_COMFORT : SN_SPECIFIC;
    findings.push(evaluateSkilledNeed(text, skilledEl.copReference, specificRe));
    findings.push(evaluateMedicalNecessity(text, skilledEl.copReference, context.primaryDiagnosis, specificRe));
  }
  if (f2fApplicable || context.f2fValidation) {
    findings.push(evaluateF2F(context.f2fValidation, "42 CFR 424.22", f2fApplicable));
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
