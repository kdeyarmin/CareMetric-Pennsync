// documentationStrength — deterministic "is this statement actually defensible?"
// grading for the four elements that drive most home-health documentation
// denials: homebound status, skilled need, patient response, and teaching.
//
// WHY THIS EXISTS (and why it is separate from presenceDetection)
// presenceDetection answers "did the nurse mention homebound?" — a keyword/regex
// PRESENCE check. That is the right gate for "is this element addressed at all",
// but it scores `Patient is homebound.` as documented, which is precisely the
// sentence Medicare reviewers deny. This module answers the second question:
// "given that the element is present, does the text carry the FACTUAL SUPPORT a
// reviewer looks for?" — and, when it does not, produces the targeted questions
// to ask the nurse.
//
// DESIGN RULES
//  - Deterministic and pure. No LLM anywhere near a regulatory judgement.
//  - It never invents facts. It detects which supporting FACTORS the nurse
//    already documented and asks about the rest. A missing factor produces a
//    QUESTION, never a suggested clinical fact.
//  - Findings are advisory: they explain, they never certify. The wording is
//    "potential documentation gap" / "review recommended", never "compliant".
//  - Every finding carries its evidence (the sentence that triggered it) so
//    nothing is a black-box score.
//
// Pure + offline so it runs under `node --test`. It may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).
import { splitSentences } from "./factExtraction.js";
import { thresholdValue } from "./thresholds.js";

/** Strength bands, weakest first. Exported so UI ordering can't drift. */
export const STRENGTH_LEVELS = Object.freeze(["absent", "weak", "partial", "strong"]);

/** Advisory copy per band. Never says "compliant" or "guaranteed". */
export const STRENGTH_LABELS = Object.freeze({
  absent: "Not documented",
  weak: "Potential documentation gap",
  partial: "Review recommended",
  strong: "No documentation gaps detected by PennSync's current rules",
});

/**
 * A factor is one piece of factual support a reviewer looks for. `pattern` is
 * the deterministic detector; `question` is what PennSync asks the nurse when
 * the factor is missing. The question NEVER suggests an answer.
 */

const HOMEBOUND_FACTORS = [
  {
    id: "medical_reason",
    label: "Medical reason leaving home is difficult",
    pattern: /\b(?:due to|because of|secondary to|related to|r\/t)\b|\b(?:chf|copd|cva|stroke|fracture|surgery|post[- ]?op|dementia|neuropathy|amputation|paralysis|parkinson)/i,
    question: "What medical condition makes leaving home difficult for this patient?",
  },
  {
    id: "assistive_device",
    label: "Assistive device",
    pattern: /\b(?:walker|rollator|cane|quad cane|crutch(?:es)?|wheelchair|w\/c\b|scooter|hoyer|gait belt|prosthe|brace|oxygen|o2 (?:tank|concentrator)|nebulizer)\b/i,
    question: "Does the patient need an assistive device (walker, cane, wheelchair, oxygen) to leave home?",
  },
  {
    id: "human_assistance",
    label: "Human assistance required",
    pattern: /\b(?:one[- ]person assist|two[- ]person assist|1[- ]person assist|2[- ]person assist|min(?:imal)?\s*assist|mod(?:erate)?\s*assist|max(?:imal)?\s*assist|assistance of|assist(?:ed|ance)? (?:by|from|of) (?:one|two|1|2|caregiver|family|daughter|son|spouse|aide)|requires (?:help|assistance)|caregiver (?:must|assists|accompanies)|stand[- ]?by assist|contact guard)\b/i,
    question: "Does the patient need another person's help to leave home safely? Who, and how much help?",
  },
  {
    id: "exertional_symptom",
    label: "Dyspnea, pain, or weakness on exertion",
    pattern: /\b(?:dyspnea|shortness of breath|sob\b|short of breath|winded|air hunger|desaturat|exertional|fatigue|weakness|generalized weakness|deconditioned|deconditioning|unsteady|poor endurance|activity intolerance|pain (?:with|on) (?:ambulation|movement|exertion|walking))\b/i,
    question: "What happens physically when the patient tries to leave home — dyspnea, pain, weakness, fatigue?",
  },
  {
    id: "cognitive_safety",
    label: "Cognitive or safety concern",
    pattern: /\b(?:confus|disorient|dementia|alzheimer|cognitive (?:impair|deficit|decline)|wander|unsafe (?:alone|to leave|outside)|fall risk|falls? risk|history of falls?|elopement|impaired (?:judg|safety))\b/i,
    question: "Is there a cognitive or safety reason the patient cannot leave home unaccompanied?",
  },
  {
    id: "taxing_effort",
    label: "Considerable and taxing effort",
    pattern: /\b(?:considerable and taxing|taxing effort|considerable effort|exhaust|takes? (?:her|him|them|the patient) \d+|requires? (?:rest|multiple rest)|rest(?:s|ing)? (?:break|period|after|between)|only a few steps|limited to \d+ (?:feet|ft|steps)|tolerates? only)\b/i,
    question: "What makes leaving home a considerable and taxing effort (rest breaks, distance limits, recovery time)?",
  },
  {
    id: "leave_frequency",
    label: "How often / why the patient does leave home",
    pattern: /\b(?:leaves? (?:the )?home|leaves? the house|goes? out|only leaves?|does not leave|doesn'?t leave|rarely leaves?|medical appointments? only|dialysis|absences? (?:are )?infrequent)\b/i,
    question: "How often does the patient leave home, and for what (medical appointments, dialysis, church)?",
  },
];

const SKILLED_NEED_FACTORS = [
  {
    id: "skilled_assessment",
    label: "Skilled assessment performed",
    pattern: /\b(?:assessed|assessment of|evaluated|observation and assessment|skilled observation|auscultat|palpat|inspected|measured|monitored)\b/i,
    question: "What skilled assessment did you perform this visit?",
  },
  {
    id: "clinical_judgment",
    label: "Clinical judgment applied",
    pattern: /\b(?:determined|identified|recognized|interpreted|correlat|ruled out|differentiat|clinical (?:judg|decision)|based on (?:the )?(?:finding|assessment)|due to (?:the )?(?:finding|change)|indicat(?:ed|ing) (?:the )?need)\b/i,
    question: "What clinical judgment or decision did this visit require from a licensed professional?",
  },
  {
    id: "licensed_intervention",
    label: "Intervention requiring a licensed professional",
    pattern: /\b(?:wound care|dressing change|packed|irrigat|debride|catheter|foley|straight cath|injection|subcutaneous|intramuscular|iv (?:push|flush|therapy)|picc|port|ostomy care|trach|suction|medication (?:management|administration|titration|reconcil)|insulin|anticoagul|enteral|tube feeding)\b/i,
    question: "What intervention did you perform that required a licensed professional rather than an aide?",
  },
  {
    id: "change_or_monitoring",
    label: "Change in condition or ongoing monitoring need",
    pattern: /\b(?:unstable|change in (?:condition|status)|worsen|improv|deteriorat|new (?:onset|symptom|finding)|exacerbation|fluctuat|titrat|requires? (?:ongoing )?monitoring|continued (?:observation|monitoring)|risk of|potential for)\b/i,
    question: "What was changing, unstable, or at risk that required skilled monitoring?",
  },
  {
    id: "skilled_teaching",
    label: "Skilled teaching provided",
    pattern: /\b(?:taught|teaching|educat|instruct|reinforc(?:ed|ing)|demonstrat|reviewed with)\b/i,
    question: "What skilled teaching did you provide, and to whom?",
  },
];

const TEACHING_FACTORS = [
  {
    id: "topic",
    label: "Topic taught",
    pattern: /\b(?:on|about|regarding|re:)\s+(?:the\s+)?[a-z]/i,
    question: "What specific topic did you teach?",
  },
  {
    id: "learner",
    label: "Who was taught",
    pattern: /\b(?:patient|pt\b|caregiver|daughter|son|spouse|wife|husband|family|aide|poa|guardian)\b/i,
    question: "Who did you teach — the patient, a caregiver, or both?",
  },
  {
    id: "method",
    label: "Teaching method",
    pattern: /\b(?:demonstrat|verbal(?:ly)? (?:instruct|review)|written (?:material|instruction)|handout|hands[- ]on|reviewed the|video|pamphlet|step[- ]by[- ]step|modeled)\b/i,
    question: "How did you teach it — verbal review, written materials, hands-on demonstration?",
  },
  {
    id: "teach_back",
    label: "Teach-back or return demonstration",
    pattern: /\b(?:teach[- ]?back|return demonstrat|demonstrated back|repeated back|correctly (?:described|identified|stated|performed|listed)|able to (?:state|describe|demonstrate|list))\b/i,
    question: "How did you confirm understanding — teach-back or return demonstration?",
  },
  {
    id: "understanding",
    label: "Understanding shown",
    pattern: /\b(?:verbali[sz]ed understanding|understanding verbali[sz]ed|states? understanding|expressed understanding|understood|no further questions|unable to (?:verbali|demonstrat)|required (?:re[- ]?)?instruction)\b/i,
    question: "Did the patient or caregiver show understanding, and how did you know?",
  },
  {
    id: "remaining_need",
    label: "Remaining learning need",
    pattern: /\b(?:will (?:continue|reinforce|re[- ]?teach)|needs? (?:further|continued|additional|ongoing) (?:teaching|education|instruction|reinforcement)|remaining (?:learning )?need|not yet (?:able|independent)|plan to (?:reinforce|review))\b/i,
    question: "What learning need remains for the next visit?",
  },
];

// Interventions that a reviewer expects to see a patient response for.
const INTERVENTION_PATTERN =
  /\b(?:administered|performed|applied|changed the dressing|dressing change|packed|irrigat(?:ed|ion)|debrided|flushed|instilled|inserted|removed|catheteri[sz]ed|injected|repositioned|ambulated|transferred|taught|educated|instructed|demonstrated|titrated|adjusted the dose)\b/i;

// A response/tolerance statement. Kept separate from the teaching detector so
// "verbalized understanding" counts as a response to teaching.
const RESPONSE_PATTERN =
  /\b(?:tolerated|tolerance|no adverse|without (?:complaint|difficulty|incident|distress)|denied (?:pain|discomfort)|reported (?:relief|improvement|less)|responded|response (?:was|to)|patient (?:reports?|states?|denies)|verbali[sz]ed|remained (?:comfortable|stable)|no (?:signs? of )?distress|vital signs (?:remained )?stable)\b/i;

/**
 * Grade one element from its factor set.
 *
 * Bands are deterministic counts, not a tuned score: `absent` when the element
 * is not present at all, `weak` when it is asserted with no supporting factor,
 * `partial` below the element's threshold, `strong` at or above it.
 */
function gradeFactors(text, factors, { present, minStrong, minPartial = 1 }) {
  const found = [];
  const missing = [];
  for (const f of factors) {
    if (f.pattern.test(text)) found.push({ id: f.id, label: f.label });
    else missing.push({ id: f.id, label: f.label, question: f.question });
  }
  let level;
  if (!present) level = "absent";
  else if (found.length === 0) level = "weak";
  else if (found.length >= minStrong) level = "strong";
  else if (found.length >= minPartial) level = "partial";
  else level = "weak";
  return { level, found, missing };
}

/** The sentences that mention the element — the evidence shown to the nurse. */
function evidenceFor(text, pattern) {
  return splitSentences(text).filter((s) => pattern.test(s)).slice(0, 4);
}

const HOMEBOUND_PRESENCE =
  /homebound|unable to leave|taxing effort|confined to (?:home|residence)|leaving (?:the )?home requires/i;
const SKILLED_PRESENCE =
  /skilled (?:need|nursing|assessment|service|intervention|observation)|requires the skill|wound care|medication management|observation and assessment/i;
// `reinforc` (not `reinforced`) so a forward-looking "will reinforce next visit"
// — the sentence that states the REMAINING learning need — is recognised as
// teaching content and can support the remaining_need factor.
const TEACHING_PRESENCE =
  /educat|taught|instruct|reinforc|teaching|teach[- ]?back|verbali[sz]ed understanding/i;

/**
 * Homebound documentation strength.
 *
 * "Patient is homebound." grades `weak` — asserted with zero supporting facts,
 * which is the single most-cited home-health denial reason. PennSync does not
 * invent the support; it asks for it.
 *
 * @param {string} noteText
 * @returns {object} finding
 */
export function analyzeHomebound(noteText) {
  const text = noteText || "";
  const present = HOMEBOUND_PRESENCE.test(text);
  // Thresholds live in thresholds.js with their provenance: they are PennSync
  // defaults, not regulatory standards, and an agency can calibrate them.
  const graded = gradeFactors(text, HOMEBOUND_FACTORS, {
    present,
    minStrong: thresholdValue("homebound_strong_factors"),
    minPartial: thresholdValue("homebound_partial_factors"),
  });
  return buildFinding({
    id: "homebound_strength",
    element: "homebound",
    title: "Homebound support",
    rule: "Confined to home requires BOTH a normal inability to leave home and that leaving requires a considerable and taxing effort.",
    citation: "42 CFR 409.42(a)",
    evidence: evidenceFor(text, HOMEBOUND_PRESENCE),
    graded,
    weakExample: "Patient is homebound.",
    remediation:
      "State the medical reason the patient cannot readily leave home AND what makes leaving a considerable and taxing effort (device, human assistance, dyspnea/pain/weakness, rest breaks).",
  });
}

/**
 * Skilled-need documentation strength.
 * @param {string} noteText
 */
export function analyzeSkilledNeed(noteText) {
  const text = noteText || "";
  const present = SKILLED_PRESENCE.test(text);
  const graded = gradeFactors(text, SKILLED_NEED_FACTORS, {
    present,
    minStrong: thresholdValue("skilled_need_strong_factors"),
    minPartial: thresholdValue("skilled_need_partial_factors"),
  });
  return buildFinding({
    id: "skilled_need_strength",
    element: "skilled_need",
    title: "Skilled-need support",
    rule: "The visit must show a service that required the professional skill of a nurse — not a task an aide or family member could perform.",
    citation: "42 CFR 484.75",
    evidence: evidenceFor(text, SKILLED_PRESENCE),
    graded,
    weakExample: "Skilled nursing visit completed.",
    remediation:
      "Name the skilled assessment performed, the clinical judgment it required, what was changing or being monitored, and any teaching provided.",
  });
}

/**
 * Teaching / teach-back documentation strength.
 * @param {string} noteText
 */
export function analyzeTeaching(noteText) {
  const text = noteText || "";
  const present = TEACHING_PRESENCE.test(text);
  // Teaching is graded against the sentences that actually mention teaching, so
  // an unrelated "patient" or "reviewed the" elsewhere in the note cannot make a
  // bare "Education provided." look supported.
  const teachingText = evidenceFor(text, TEACHING_PRESENCE).join(" ");
  const graded = gradeFactors(teachingText, TEACHING_FACTORS, {
    present,
    minStrong: thresholdValue("teaching_strong_factors"),
    minPartial: thresholdValue("teaching_partial_factors"),
  });
  return buildFinding({
    id: "teaching_strength",
    element: "patient_education",
    title: "Teaching and teach-back support",
    rule: "Education is defensible when it names the topic, the learner, the method, and how understanding was confirmed.",
    citation: "42 CFR 484.60(c)",
    evidence: evidenceFor(text, TEACHING_PRESENCE),
    weakExample: "Education provided.",
    graded,
    remediation:
      "Say what you taught, who you taught, how you taught it, how you confirmed understanding (teach-back or return demonstration), and what learning need remains.",
  });
}

/**
 * Patient-response coverage.
 *
 * Unlike the three above, this is a PAIRING check: it finds intervention
 * sentences that have no response/tolerance statement in or adjacent to them.
 * Reported per unmatched intervention so the nurse knows exactly which one to
 * complete, rather than being told "response missing" about the whole note.
 *
 * @param {string} noteText
 */
export function analyzePatientResponse(noteText) {
  const text = noteText || "";
  const sentences = splitSentences(text);
  const anyResponse = RESPONSE_PATTERN.test(text);
  /** @type {Array<{ intervention: string, index: number }>} */
  const unmatched = [];
  const interventions = [];

  sentences.forEach((sentence, i) => {
    if (!INTERVENTION_PATTERN.test(sentence)) return;
    interventions.push(sentence);
    // A response counts when it is in the same sentence or the one immediately
    // after it — how nurses actually write ("Dressing changed. Tolerated well.").
    const inSame = RESPONSE_PATTERN.test(sentence);
    const inNext = i + 1 < sentences.length && RESPONSE_PATTERN.test(sentences[i + 1]);
    if (!inSame && !inNext) unmatched.push({ intervention: sentence, index: i });
  });

  let level;
  if (interventions.length === 0) level = anyResponse ? "strong" : "absent";
  else if (unmatched.length === 0) level = "strong";
  else if (unmatched.length < interventions.length) level = "partial";
  else level = "weak";

  return {
    id: "patient_response_pairing",
    element: "patient_response",
    title: "Patient response to interventions",
    rule: "Each intervention should state how the patient responded to or tolerated it.",
    citation: "42 CFR 484.60(a)",
    level,
    label: STRENGTH_LABELS[level],
    advisory: true,
    evidence: unmatched.slice(0, 4).map((u) => u.intervention),
    interventionCount: interventions.length,
    unmatchedCount: unmatched.length,
    found: interventions.length - unmatched.length,
    missing: unmatched.slice(0, 4).map((u) => ({
      id: `response_for_${u.index}`,
      label: "Response to this intervention",
      question: `How did the patient respond to or tolerate this? "${truncate(u.intervention, 90)}"`,
    })),
    questions: unmatched.slice(0, 4).map(
      (u) => `How did the patient respond to or tolerate this? "${truncate(u.intervention, 90)}"`,
    ),
    remediation:
      "After each intervention, state the patient's response or tolerance (and any adverse reaction).",
    weakExample: "Dressing change performed.",
  };
}

function truncate(value, max) {
  const s = String(value || "").trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function buildFinding({ id, element, title, rule, citation, evidence, graded, remediation, weakExample }) {
  return {
    id,
    element,
    title,
    rule,
    citation,
    level: graded.level,
    label: STRENGTH_LABELS[graded.level],
    // Always advisory: PennSync explains, it never certifies.
    advisory: true,
    evidence,
    found: graded.found,
    missing: graded.missing,
    questions: graded.missing.map((m) => m.question),
    remediation,
    weakExample,
  };
}

/**
 * Run every strength analyzer over a note.
 *
 * @param {string} noteText
 * @param {{ serviceLine?: string }} [options] hospice notes are graded on
 *        comfort-focused skilled need by requiredElements, so homebound is not
 *        applicable and is omitted rather than reported as a gap.
 * @returns {{ findings: Array<object>, weakest: string, needsReview: Array<object> }}
 */
export function analyzeDocumentationStrength(noteText, { serviceLine = "home_health" } = {}) {
  const findings = [];
  if (serviceLine !== "hospice") findings.push(analyzeHomebound(noteText));
  findings.push(analyzeSkilledNeed(noteText));
  findings.push(analyzePatientResponse(noteText));
  findings.push(analyzeTeaching(noteText));

  const rank = (level) => STRENGTH_LEVELS.indexOf(level);
  const weakest = findings.reduce(
    (worst, f) => (rank(f.level) < rank(worst) ? f.level : worst),
    "strong",
  );
  // "absent" is already reported by presenceDetection's required-element gate;
  // this module's job is the quality of what IS there, so only weak/partial
  // findings are surfaced as review prompts (no duplicate nagging).
  const needsReview = findings.filter((f) => f.level === "weak" || f.level === "partial");
  return { findings, weakest, needsReview };
}
