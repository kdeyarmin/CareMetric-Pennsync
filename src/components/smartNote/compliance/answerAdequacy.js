// Deterministic, offline "is this answer specific enough?" check for the handful
// of required elements that Medicare auditors most often deny when documented
// conclusorily (e.g. "patient is homebound" with no reason). Pure — no LLM, no
// network — so it runs instantly and offline alongside the presence scan.
//
// This NEVER blocks and NEVER edits the note. It returns an advisory tip the
// reviewer shows inline; the nurse stays in control. Emptiness is handled by the
// existing critical-gating, not here — an empty answer returns `adequate: true`
// so we don't double-warn.

// A bare restatement of the element with no substance — the exact pattern that
// triggers denials.
const CONCLUSORY = /^\s*(?:the\s+)?(?:patient|pt|client)?\s*(?:is|was|remains)?\s*(?:homebound|skilled|stable|fine|okay|ok|wnl|good|no change|unchanged|as above|same)\.?\s*$/i;

// Per-element adequacy rules. `signals` = at least one must appear for the answer
// to count as specific; `tip` is shown when it doesn't. Elements not listed here
// have no opinion (always adequate).
const ADEQUACY_RULES = {
  homebound: {
    signals: /assist|walker|wheelchair|\bcane\b|bedbound|two[- ]person|dyspnea|shortness of breath|short of breath|\bweak|unable to|exhaust|fatigue|supervision|oxygen|\bfall|taxing|considerable effort|endurance|tolerat/i,
    tip: "Add why leaving home is a considerable and taxing effort — e.g. needs assistance or a device, severe dyspnea/weakness, or fall risk.",
  },
  skilled_need: {
    signals: /assess|observ|evaluat|wound|dressing|medication|med (?:management|reconcil)|teach|educat|catheter|injection|titrat|monitor|manage|skilled (?:assessment|observation|teaching)|sterile|venipuncture|\biv\b/i,
    tip: "Name the specific skilled service (assessment/observation, wound care, medication management, teaching) — not just 'skilled nursing'.",
  },
  comfort_skilled_need: {
    signals: /assess|observ|titrat|manage|symptom|pain|dyspnea|nausea|agitation|repositioning|oxygen|teach|educat|medication/i,
    tip: "Describe the skilled comfort-focused service: symptom assessment/management, medication titration, or caregiver teaching on comfort care.",
  },
  education: {
    signals: /verbali|teach[- ]?back|return demonstrat|demonstrat|understood|repeated back|able to state|correctly/i,
    tip: "State how you confirmed understanding — teach-back, return demonstration, or verbalized understanding.",
  },
  discharge_reason: {
    signals: /goals? (?:met|achieved)|no longer (?:homebound|skilled|eligible|requir)|transfer|hospitali|admitted|expired|deceased|revocation|revoked|request|refus|moved|relocat|independent(?:ly)?|self[- ]manag/i,
    tip: "Name why care is ending — goals met, transfer/hospitalization, no longer homebound or eligible, or patient/family request. A date alone is not a reason.",
  },
  visit_reason: {
    signals: /call|request|report|complain|new onset|change in condition|increas|worsen|\bfell\b|\bfall|pain|short(?:ness)? of breath|\bsob\b|bleed|fever|nausea|vomit|symptom|concern|urgent|crisis|after[- ]hours/i,
    tip: "Say what prompted the visit — who called and the symptom or change in condition that made an extra visit necessary.",
  },
  terminal_prognosis: {
    signals: /\bpps\b|\bfast\b|weight loss|\blbs?\b|\bpound|decline|declining|bedbound|intake|score|%|infection|symptom burden|functional/i,
    tip: "Cite objective decline supporting a ≤6-month prognosis: measurable changes (weight, PPS/FAST, intake), symptom burden, or functional decline.",
  },
};

/**
 * @param {string} id required-element id
 * @param {string} text the nurse's answer
 * @returns {{ adequate: boolean, tip?: string }}
 */
export function checkAnswerAdequacy(id, text) {
  const answer = (text || "").trim();
  const rule = ADEQUACY_RULES[id];
  // No rule for this element, or no answer yet (gating owns emptiness) → no opinion.
  if (!rule || !answer) return { adequate: true };

  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const conclusory = CONCLUSORY.test(answer) || wordCount < 4;
  const hasSignal = rule.signals.test(answer);

  if (hasSignal && !conclusory) return { adequate: true };
  return { adequate: false, tip: rule.tip };
}

/**
 * Critical elements whose DRAFT EVIDENCE reads inadequate.
 *
 * `findInadequateCritical` only ever sees the `answers` map, so it fires solely
 * on the gap-question path. When the draft ITSELF satisfies the presence scan —
 * "Discharged on 3/12", "PRN visit today" — no gap is created, no question is
 * asked, and the adequacy rule for that element never runs, even though it is
 * written precisely for that phrase. This closes that path.
 *
 * `skipIds` exists to avoid double-judging. The denial guardrail already assesses
 * the quality of homebound / skilled-need narratives with purpose-built
 * heuristics (medical reason + taxing effort; service specificity), renders that
 * verdict in its own panel, and gates the chart save on it. Warning about the
 * same text twice, in two voices, is worse than not warning at all — so callers
 * pass the ids the guardrail already covers (see
 * denialGuardrailEngine.elementsJudgedByGuardrail). Elements with no cluster —
 * discharge_reason, visit_reason, terminal_prognosis — have no other quality
 * judge, which is exactly where this adds protection.
 *
 * An element with a TYPED answer is skipped: findInadequateCritical owns it, and
 * the nurse's answer supersedes whatever the draft said.
 *
 * @param {Array} requiredElements
 * @param {Array} presenceResults from detectPresence()
 * @param {Record<string,string>} [answers]
 * @param {{ skipIds?: string[] }} [options]
 * @returns {Array<{id:string,label?:string,tip?:string}>}
 */
export function findInadequateCriticalEvidence(requiredElements = [], presenceResults = [], answers = {}, options = {}) {
  const skip = new Set(options.skipIds || []);
  const byId = new Map((presenceResults || []).map((r) => [r.id, r]));
  const out = [];
  for (const e of requiredElements) {
    if (e.severity !== "critical" || skip.has(e.id)) continue;
    if (answers[e.id] && answers[e.id].trim()) continue;
    const found = byId.get(e.id);
    if (!found || !found.present || !found.evidence) continue;
    const adq = checkAnswerAdequacy(e.id, found.evidence);
    if (!adq.adequate) out.push({ id: e.id, label: e.label, tip: adq.tip });
  }
  return out;
}

/** Which element ids carry an adequacy rule (handy for tests / callers). */
export function elementsWithAdequacyRules() {
  return Object.keys(ADEQUACY_RULES);
}

/**
 * Critical required elements whose answer is present but reads as inadequate —
 * the set that should prompt a soft confirm before generating (never a hard
 * block). An empty / missing answer is NOT included here: emptiness is owned by
 * the existing critical gating, which hard-blocks generation.
 * @param {Array<{id:string,severity:string,label?:string}>} requiredElements
 * @param {Record<string,string>} answers map of elementId -> answer text
 * @returns {Array<{id:string,label?:string,tip?:string}>}
 */
export function findInadequateCritical(requiredElements = [], answers = {}) {
  const out = [];
  for (const e of requiredElements) {
    if (e.severity !== "critical") continue;
    const text = answers[e.id];
    if (!text || !text.trim()) continue; // emptiness → handled by gating, not here
    const adq = checkAnswerAdequacy(e.id, text);
    if (!adq.adequate) out.push({ id: e.id, label: e.label, tip: adq.tip });
  }
  return out;
}
