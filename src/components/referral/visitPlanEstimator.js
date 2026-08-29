// Deterministic visit-plan estimator for the referral analyzer.
//
// ── What is deterministic vs estimated ───────────────────────────────────────
// ORDERED visit frequencies are parsed verbatim from the referral's
// skilled-needs / physician-orders text (e.g. "SN 3w2, 2w2, 1w5",
// "PT 2x/week x 4 weeks") — they are the authoritative plan and are never
// invented here. When the referral orders no explicit frequency, the AI
// analyzer's visit ESTIMATES (clearly labeled, planning-grade only) fill the
// gap so schedulers still get a starting point to confirm at SOC.
//
// ── Payer-aware episode structure ────────────────────────────────────────────
// Medicare FFS pays under PDGM: a 60-day certification bills as two 30-day
// payment periods, each with a LUPA visit threshold of 2–6 visits (set by the
// period's HIPPS group — a period BELOW its threshold drops to per-visit
// payment). Under PDGM more visits never increase the period payment, so
// "maximum reimbursement" means clearing the LUPA threshold in every billed
// period and otherwise matching utilization to clinical need. Medicare
// Advantage / commercial plans typically pay per visit under prior
// authorization; there the revenue risk is unauthorized visits, not LUPA.
// No dollar figures are computed here — payment mechanics stay in calculatePDGM.
//
// Pure + offline (unit-tested with `node --test`); no React, no Base44 SDK,
// no `@/` imports so the colocated Node test resolves without Vite.

// LUPA thresholds are HIPPS-specific (CMS sets one of 2–6 per case-mix group).
// This module never guesses the exact threshold — it bands a period's visit
// count against the published range instead.
export const LUPA_THRESHOLD_MIN = 2;
export const LUPA_THRESHOLD_MAX = 6;

// ---------------------------------------------------------------------------
// Payer classification
// ---------------------------------------------------------------------------

// Named plans that mark Medicare coverage as a Part C (Advantage) product when
// they appear alongside "medicare", and as commercial coverage when alone.
const PLAN_NAMES =
  /\b(?:humana|aetna|cigna|united\s*health(?:care)?|uhc|wellcare|kaiser|anthem|highmark|geisinger|upmc|amerihealth|independence\s+blue|bcbs|blue\s*cross|blue\s*shield|molina|centene|devoted|clover|alignment|scan\b)/i;
const ADVANTAGE_MARKERS =
  /\b(?:advantage|part\s*c|\bma\b|dual\s*complete|hmo|ppo|d-?snp|c-?snp|complete\s+care|gold\s+plus|for\s+life|freedom\s+blue|security\s+blue|keystone\s+65|personal\s+choice\s+65)\b/i;
const FFS_MARKERS = /\b(?:traditional|original|ffs|fee[\s-]*for[\s-]*service|part\s*a|part\s*b|a\s*(?:&|and)\s*b)\b/i;

export const PAYER_LABELS = {
  medicare_ffs: "Medicare (traditional FFS — PDGM)",
  medicare_advantage: "Medicare Advantage (Part C)",
  medicaid: "Medicaid",
  commercial: "Commercial / private",
  unknown: "Payer not identified",
};

/**
 * Classify the referral's PRIMARY payer from its insurance text.
 * @param {object} referralData extracted referral (full extraction, quick-scan,
 *   or Referral entity shape — extracted_data is unwrapped like referralToF2FInput)
 * @returns {{ payer: keyof typeof PAYER_LABELS, label: string, evidence: string|null }}
 */
export function classifyPayer(referralData) {
  const ex = referralData?.extracted_data || referralData || {};
  const evidence =
    [
      ex?.demographics?.insurance_primary,
      referralData?.insurance_primary,
      referralData?.insurance,
      referralData?.payer,
    ]
      .map((v) => String(v ?? "").trim())
      .find(Boolean) || null;
  if (!evidence) return { payer: "unknown", label: PAYER_LABELS.unknown, evidence: null };

  const text = evidence.toLowerCase();
  let payer;
  if (/\bmedicare\b/.test(text)) {
    // "Medicare" + an Advantage marker or a named MA plan → Part C. A bare
    // "Medicare" (or FFS markers) → traditional FFS under PDGM.
    payer =
      ADVANTAGE_MARKERS.test(text) || (PLAN_NAMES.test(text) && !FFS_MARKERS.test(text))
        ? "medicare_advantage"
        : "medicare_ffs";
  } else if (/\bmedicaid\b|\bmedical\s+assistance\b/.test(text)) {
    payer = "medicaid";
  } else if (PLAN_NAMES.test(text) || /\bcommercial\b|\bprivate\s+insurance\b|\btricare\b|\bchampva\b/.test(text)) {
    payer = "commercial";
  } else {
    payer = "unknown";
  }
  return { payer, label: PAYER_LABELS[payer], evidence };
}

// ---------------------------------------------------------------------------
// Ordered-frequency parsing
// ---------------------------------------------------------------------------

const DISCIPLINES = [
  // ST before generic word boundaries; "St." (Saint) is excluded by the (?!\.)
  ["SN", /\b(?:sn|s\/n|rn|lpn|lvn|skilled\s+nursing|nursing|nurse)\b/gi],
  ["PT", /\b(?:pt|physical\s+therap\w*)\b/gi],
  ["OT", /\b(?:ot|occupational\s+therap\w*)\b/gi],
  ["ST", /\b(?:st(?!\.)|slp|speech(?:[-\s](?:therap\w*|language\s+patholog\w*|patholog\w*))?)\b/gi],
  ["MSW", /\b(?:msw|social\s+work\w*)\b/gi],
  ["HHA", /\b(?:hha|home\s+health\s+aide|aide)\b/gi],
];

export const DISCIPLINE_NAMES = {
  SN: "Skilled Nursing",
  PT: "Physical Therapy",
  OT: "Occupational Therapy",
  ST: "Speech Therapy",
  MSW: "Medical Social Work",
  HHA: "Home Health Aide",
  Unspecified: "Discipline not specified",
};

// Frequency matchers, tried in priority order; overlapping later matches are
// dropped so "2 visits per week for 6 weeks" is one verbose order, not a
// verbose order plus a "2 visits" total.
const FREQ_MATCHERS = [
  {
    kind: "verbose",
    re: /\b(\d{1,2})\s*(?:x|times?|visits?)?\s*(?:\/\s*|per\s+|a\s+|each\s+)?(?:weekly|weeks?|wks?)\s*(?:[x×]|for)\s*(\d{1,2})\s*(?:weeks?|wks?)\b/gi,
    mk: (m) => ({ perWeek: Number(m[1]), weeks: Number(m[2]) }),
  },
  {
    // The dominant home-health shorthand: "3w2" / "3wk2" = 3 visits/week × 2 weeks.
    kind: "shorthand",
    re: /\b(\d{1,2})w(?:ks?)?(\d{1,2})\b/gi,
    mk: (m) => ({ perWeek: Number(m[1]), weeks: Number(m[2]) }),
  },
  // Daily/QOD forms need a discipline just before them ("SN daily x 14 days"):
  // "change dressing daily x 2 weeks" is a treatment instruction, not a visit
  // order, and counting it would over-clear the LUPA check.
  {
    kind: "daily_weeks",
    needsDiscipline: true,
    re: /\b(?:daily|every\s+day|qd)\s*(?:[x×]|for)\s*(\d{1,2})\s*(?:weeks?|wks?)\b/gi,
    mk: (m) => ({ perWeek: 7, weeks: Number(m[1]) }),
  },
  {
    kind: "daily_days",
    needsDiscipline: true,
    re: /\b(?:daily|every\s+day|qd)\s*(?:[x×]|for)\s*(\d{1,3})\s*(?:days?|d)\b/gi,
    mk: (m) => ({ perWeek: 7, weeks: Number(m[1]) / 7 }),
  },
  {
    kind: "qod_duration",
    needsDiscipline: true,
    re: /\b(?:qod|every\s+other\s+day)\s*(?:[x×]|for)\s*(\d{1,2})\s*(?:weeks?|wks?)\b/gi,
    mk: (m) => ({ perWeek: 3.5, weeks: Number(m[1]) }),
  },
  {
    kind: "rate_only",
    re: /\b(\d{1,2})\s*(?:x|times?|visits?)\s*(?:\/\s*|per\s+|a\s+|each\s+)(?:week|wk)\b/gi,
    mk: (m) => ({ perWeek: Number(m[1]), weeks: null }),
  },
  // Bare-word rates are order-shaped ONLY next to a discipline ("SN daily",
  // "PT BIW", "MSW weekly"). Without that guard, prose ("daily dressing
  // changes by caregiver") and med sigs ("lisinopril 10 mg QD" inside a
  // physician order) fabricate visit frequencies.
  { kind: "rate_only", needsDiscipline: true, re: /\bbiw\b/gi, mk: () => ({ perWeek: 2, weeks: null }) },
  { kind: "rate_only", needsDiscipline: true, re: /\btiw\b/gi, mk: () => ({ perWeek: 3, weeks: null }) },
  { kind: "rate_only", needsDiscipline: true, re: /\b(?:qw|1x\s*weekly|weekly)\b/gi, mk: () => ({ perWeek: 1, weeks: null }) },
  { kind: "rate_only", needsDiscipline: true, re: /\b(?:daily|every\s+day|qd)\b/gi, mk: () => ({ perWeek: 7, weeks: null }) },
  { kind: "rate_only", needsDiscipline: true, re: /\b(?:qod|every\s+other\s+day)\b/gi, mk: () => ({ perWeek: 3.5, weeks: null }) },
  {
    // Total-only order with no weekly structure: "6 visits", "eval + 6 visits".
    kind: "total_only",
    re: /\b(\d{1,2})\s*visits?\b(?!\s*(?:\/|per|a\s|each\s)\s*(?:week|wk))/gi,
    mk: (m) => ({ totalVisits: Number(m[1]) }),
  },
];

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * Parse every visit-frequency order out of a free-text field.
 * @returns {Array<{discipline:string, kind:string, raw:string, perWeek?:number,
 *   weeks?:number|null, totalVisits?:number}>} in text order. `weeks: null`
 *   marks an open-ended rate (no duration ordered).
 */
export function parseVisitFrequencies(text) {
  const s = String(text || "");
  if (!s.trim()) return [];

  const disciplineHits = [];
  for (const [code, re] of DISCIPLINES) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) {
      disciplineHits.push({ code, index: m.index, end: m.index + m[0].length });
    }
  }
  disciplineHits.sort((a, b) => a.index - b.index);
  // "SN daily" — the discipline token must sit just before the rate word
  // (allowing separators like ":", "-", "visits").
  const disciplineJustBefore = (start) =>
    disciplineHits.some((h) => h.end <= start && start - h.end <= 12);

  const claims = [];
  for (const { kind, re, mk, needsDiscipline } of FREQ_MATCHERS) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) {
      if (needsDiscipline && !disciplineJustBefore(m.index)) continue;
      const claim = { kind, raw: m[0].trim(), start: m.index, end: m.index + m[0].length, ...mk(m) };
      if (!claims.some((c) => overlaps(c, claim))) claims.push(claim);
    }
  }

  return claims
    .sort((a, b) => a.start - b.start)
    .map(({ start, end: _end, ...claim }) => {
      let discipline = "Unspecified";
      for (const hit of disciplineHits) {
        if (hit.index < start) discipline = hit.code;
        else break;
      }
      return { discipline, ...claim };
    });
}

// Referral fields that carry ordered frequencies, as [path, isArray]. Covers
// the full clinical extraction AND the quick-scan shapes from
// referralExtraction.js. Deliberately narrow — scanning the whole document
// would misread prose ("fell 3 weeks ago") as orders.
const FREQUENCY_FIELDS = [
  ["skilled_needs.frequency_duration", false],
  ["skilled_needs.services_ordered", true],
  ["orders_treatments.physician_orders", true],
  ["skilled_nursing_needs", true],
  ["therapy_requirements", true],
];

function getPath(obj, dotted) {
  let cur = obj;
  for (const key of dotted.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Collect every ordered frequency documented in the referral, deduped across
 * fields (the same order restated in frequency_duration AND physician_orders
 * must not double-count — the conservative reading is the safe one for LUPA).
 * @returns {{orders: Array, sources: string[]}}
 */
export function collectOrderedFrequencies(referralData) {
  const ex = referralData?.extracted_data || referralData || {};
  const orders = [];
  const sources = [];
  const seen = new Set();
  for (const [path, isArray] of FREQUENCY_FIELDS) {
    const value = getPath(ex, path);
    const texts = isArray ? (Array.isArray(value) ? value : []) : [value];
    for (const t of texts) {
      for (const parsed of parseVisitFrequencies(t)) {
        const key = [parsed.discipline, parsed.kind, parsed.perWeek, parsed.weeks, parsed.totalVisits].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        orders.push(parsed);
        if (!sources.includes(path)) sources.push(path);
      }
    }
  }
  return { orders, sources };
}

// ---------------------------------------------------------------------------
// 30-day period math + LUPA banding
// ---------------------------------------------------------------------------

/**
 * Split ordered frequencies into the two 30-day PDGM payment periods of the
 * first 60-day certification. Each discipline's segments run sequentially from
 * SOC day 1 (the standard reading of "SN 3w2, 2w2, 1w5"); visits spread evenly
 * across each week, and the day-29–35 boundary week is prorated.
 *
 * @returns {{
 *   period1: number, period2: number, beyond60: number,
 *   byDiscipline: Record<string, {period1:number, period2:number, total:number}>,
 *   openEnded: Array, totalOnly: Array, complete: boolean,
 * }} period totals are FLOORED (the conservative direction for LUPA banding).
 */
export function computePeriodBreakdown(orders) {
  const byDiscipline = {};
  const openEnded = [];
  const totalOnly = [];
  let p1 = 0;
  let p2 = 0;
  let beyond = 0;

  const cursors = {};
  for (const order of orders || []) {
    if (order.kind === "total_only") {
      totalOnly.push(order);
      continue;
    }
    if (order.weeks == null) {
      openEnded.push(order);
      continue;
    }
    const startDay = cursors[order.discipline] || 0; // days elapsed since SOC
    const lengthDays = order.weeks * 7;
    const endDay = startDay + lengthDays;
    cursors[order.discipline] = endDay;
    const dailyRate = order.perWeek / 7;
    const within = (lo, hi) => Math.max(0, Math.min(endDay, hi) - Math.max(startDay, lo)) * dailyRate;
    const in1 = within(0, 30);
    const in2 = within(30, 60);
    p1 += in1;
    p2 += in2;
    beyond += within(60, Infinity);
    const d = (byDiscipline[order.discipline] ||= { period1: 0, period2: 0, total: 0 });
    d.period1 += in1;
    d.period2 += in2;
    d.total += order.perWeek * order.weeks;
  }

  for (const d of Object.values(byDiscipline)) {
    d.period1 = Math.floor(d.period1);
    d.period2 = Math.floor(d.period2);
    d.total = Math.round(d.total);
  }
  return {
    period1: Math.floor(p1),
    period2: Math.floor(p2),
    beyond60: Math.round(beyond),
    byDiscipline,
    openEnded,
    totalOnly,
    // Open-ended rates and unstructured totals mean the period counts are a
    // floor, not the full plan.
    complete: openEnded.length === 0 && totalOnly.length === 0,
  };
}

/**
 * Band a 30-day period's visit count against the published LUPA threshold
 * range (2–6, HIPPS-specific). Never guesses the exact threshold.
 * @returns {{band:'below_all'|'in_band'|'clears_all', message:string}}
 */
export function lupaBand(visits) {
  if (visits < LUPA_THRESHOLD_MIN) {
    return {
      band: "below_all",
      message: `${visits} visit${visits === 1 ? "" : "s"} is below every LUPA threshold (${LUPA_THRESHOLD_MIN}–${LUPA_THRESHOLD_MAX}) — this period would pay per-visit, not the full 30-day rate.`,
    };
  }
  if (visits < LUPA_THRESHOLD_MAX) {
    return {
      band: "in_band",
      message: `${visits} visits sits inside the ${LUPA_THRESHOLD_MIN}–${LUPA_THRESHOLD_MAX} LUPA threshold band — verify against the HIPPS-specific threshold after coding; if below it, the period pays per-visit.`,
    };
  }
  return {
    band: "clears_all",
    message: `${visits} visits clears every LUPA threshold (max ${LUPA_THRESHOLD_MAX}).`,
  };
}

// ---------------------------------------------------------------------------
// Plan assembly
// ---------------------------------------------------------------------------

const STRATEGY = {
  medicare_ffs: [
    "Medicare FFS pays under PDGM: the 60-day certification bills as two 30-day payment periods, each paid a fixed case-mix rate.",
    "Each 30-day period has a LUPA visit threshold of 2–6 visits (all disciplines count). A period below its threshold drops to per-visit payment — schedule at least the threshold number of medically necessary visits in EVERY billed period.",
    "Added visits beyond clinical need never increase a PDGM payment — front-load week 1–2 for clinical stability and LUPA safety, then taper.",
    "Therapy volume does not change the PDGM payment, but therapy visits DO count toward the LUPA threshold — order therapy to clinical need.",
    "An institutional admission source (hospital/SNF discharge within 14 days) and accurate comorbidity coding raise the case-mix weight — confirm both are documented.",
  ],
  medicare_advantage: [
    "Medicare Advantage typically requires PRIOR AUTHORIZATION before start of care — verify the auth number and the approved visit counts per discipline before scheduling.",
    "Payment follows the plan contract (often per-visit or episodic) — visits beyond the authorization are unpaid; request additional authorization before exceeding it.",
    "MA plans apply Medicare coverage criteria (homebound, skilled need, face-to-face) — document them exactly as for traditional Medicare.",
  ],
  medicaid: [
    "Verify state Medicaid home-health coverage and authorization requirements before start of care; payment is typically per-visit.",
    "Match scheduled visits to the authorized amount and re-authorize before extending the plan.",
  ],
  commercial: [
    "Verify benefits, visit limits, and authorization requirements with the plan before start of care; payment is typically per-visit or per-episode by contract.",
    "Track authorized visit counts per discipline — unauthorized visits are the primary denial risk.",
  ],
  unknown: [
    "The referral does not identify the payer — verify coverage and authorization requirements before start of care; the payer drives how the episode is structured and billed.",
  ],
};

/** Normalize the AI analyzer's visit_estimates block (all fields optional). */
export function normalizeAiEstimates(est) {
  if (!est || typeof est !== "object") return null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const out = {
    nursingFirst30: num(est.nursing_visits_first_30_days),
    nursingDays31to60: num(est.nursing_visits_days_31_60),
    pt: num(est.pt_visits),
    ot: num(est.ot_visits),
    st: num(est.st_visits),
    msw: num(est.msw_visits),
    aide: num(est.aide_visits),
    suggestedFrequency: typeof est.suggested_frequency === "string" ? est.suggested_frequency : null,
    rationale: typeof est.rationale === "string" ? est.rationale : null,
    confidence: ["high", "medium", "low"].includes(est.confidence) ? est.confidence : null,
  };
  const hasAny = Object.values(out).some((v) => v !== null);
  return hasAny ? out : null;
}

/**
 * Build the full payer-aware visit plan for a referral.
 *
 * @param {object} referralData extracted referral data
 * @param {object} [aiEstimates] the AI analyzer's visit_estimates block (optional)
 * @returns {{
 *   payer: object, orders: Array, sources: string[], hasOrderedFrequencies: boolean,
 *   periods: object|null, lupa: Array|null, aiEstimates: object|null,
 *   usingAiEstimates: boolean, strategy: string[], actions: string[],
 * }}
 */
export function buildVisitPlan(referralData, aiEstimates = null) {
  const payer = classifyPayer(referralData);
  const { orders, sources } = collectOrderedFrequencies(referralData);
  const hasOrderedFrequencies = orders.length > 0;
  const periods = hasOrderedFrequencies ? computePeriodBreakdown(orders) : null;
  const ai = normalizeAiEstimates(aiEstimates);
  const usingAiEstimates = !hasOrderedFrequencies && ai !== null;

  const isMedicareFfs = payer.payer === "medicare_ffs";
  let lupa = null;
  if (isMedicareFfs) {
    if (periods) {
      lupa = [
        { period: 1, visits: periods.period1, estimate: !periods.complete, ...lupaBand(periods.period1) },
        { period: 2, visits: periods.period2, estimate: !periods.complete, ...lupaBand(periods.period2) },
      ];
    } else if (ai) {
      // Estimate-grade banding: therapy/MSW/aide episode totals split evenly
      // across the two periods. Clearly labeled — a clinician confirms at SOC.
      const otherPerPeriod = ((ai.pt || 0) + (ai.ot || 0) + (ai.st || 0) + (ai.msw || 0) + (ai.aide || 0)) / 2;
      const p1 = ai.nursingFirst30 == null ? null : Math.floor(ai.nursingFirst30 + otherPerPeriod);
      const p2 = ai.nursingDays31to60 == null ? null : Math.floor(ai.nursingDays31to60 + otherPerPeriod);
      lupa = [
        p1 != null ? { period: 1, visits: p1, estimate: true, ...lupaBand(p1) } : null,
        p2 != null ? { period: 2, visits: p2, estimate: true, ...lupaBand(p2) } : null,
      ].filter(Boolean);
      if (lupa.length === 0) lupa = null;
    }
  }

  const actions = [];
  if (payer.payer === "medicare_advantage" || payer.payer === "commercial") {
    actions.push("Obtain/verify prior authorization and approved visit counts before start of care.");
  }
  if (payer.payer === "unknown") {
    actions.push("Identify and verify the payer — insurance is not documented clearly enough to structure the episode.");
  }
  for (const l of lupa || []) {
    if (l.band === "below_all") {
      actions.push(
        `Period ${l.period} ${l.estimate ? "estimate" : "plan"} (${l.visits} visit${l.visits === 1 ? "" : "s"}) is below every LUPA threshold — add medically necessary visits or expect per-visit payment.`
      );
    } else if (l.band === "in_band") {
      actions.push(
        `Period ${l.period} ${l.estimate ? "estimate" : "plan"} (${l.visits} visits) is inside the 2–6 LUPA band — verify the HIPPS threshold after coding and adjust the schedule if it falls below.`
      );
    }
  }
  if (periods && !periods.complete) {
    actions.push(
      "Some orders are open-ended or unscheduled totals — clarify duration with the referral source so the 30-day period plan is complete."
    );
  }
  if (!hasOrderedFrequencies) {
    actions.push(
      ai
        ? "No visit frequencies are ordered in the referral — the counts shown are AI planning estimates; confirm frequencies with the physician and at SOC."
        : "No visit frequencies are ordered in the referral — obtain ordered frequencies from the referring physician."
    );
  }

  return {
    payer,
    orders,
    sources,
    hasOrderedFrequencies,
    periods,
    lupa,
    aiEstimates: ai,
    usingAiEstimates,
    strategy: STRATEGY[payer.payer] || STRATEGY.unknown,
    actions,
  };
}

/** "3/wk × 2 wks" display label for an ordered segment. */
export function formatOrder(order) {
  if (!order) return "";
  if (order.kind === "total_only") return `${order.totalVisits} visit${order.totalVisits === 1 ? "" : "s"} (no weekly structure)`;
  if (order.weeks == null) return `${order.perWeek}/wk (duration not ordered)`;
  const weeks = Number.isInteger(order.weeks) ? order.weeks : order.weeks.toFixed(1);
  return `${order.perWeek}/wk × ${weeks} wk${order.weeks === 1 ? "" : "s"}`;
}
