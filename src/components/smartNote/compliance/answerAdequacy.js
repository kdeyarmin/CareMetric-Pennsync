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

/** Which element ids carry an adequacy rule (handy for tests / callers). */
export function elementsWithAdequacyRules() {
  return Object.keys(ADEQUACY_RULES);
}
