// medicationReconciliation — deterministic medication-discrepancy ASSISTANCE.
//
// WHAT PENNSYNC IS NOT
// PennSync is not the authoritative medication administration record and does
// not hold a licensed drug knowledge base. Its medication content is:
//   - a normalisation layer over free-text medication strings, and
//   - a SMALL, deterministic set of high-severity interaction rules
//     (see drugInteractions.js, which says so itself).
// Everything this module produces is a POTENTIAL discrepancy for a human to
// check against the EMR medication profile — never a medication decision.
//
// WHY NOT AN LLM
// "Is this a duplicate therapy?" and "did the dose change?" are string- and
// number-comparison questions. A deterministic answer can be shown with its
// evidence and reproduced on demand; a model's answer cannot, and a medication
// error is exactly the kind of harm that must not depend on a sampled token.
//
// EXTERNAL KNOWLEDGE
// `setMedicationKnowledgeAdapter` is the seam for an authoritative external
// service (RxNorm normalisation, a licensed interaction database). No adapter is
// wired by default, and `describeKnowledgeSource()` reports honestly which
// source is in use so a screen can never imply a licensed database is behind a
// finding when none is.
//
// Pure + offline so it runs under `node --test`. It may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).

/** Route tokens PennSync recognises, mapped to a canonical form. */
const ROUTES = {
  po: "oral", "by mouth": "oral", oral: "oral", pos: "oral",
  sl: "sublingual", sublingual: "sublingual",
  iv: "intravenous", intravenous: "intravenous",
  im: "intramuscular", intramuscular: "intramuscular",
  sq: "subcutaneous", subq: "subcutaneous", subcutaneous: "subcutaneous", sc: "subcutaneous",
  pr: "rectal", rectal: "rectal",
  top: "topical", topical: "topical", transdermal: "transdermal", patch: "transdermal",
  inh: "inhaled", inhaled: "inhaled", neb: "nebulized", nebulized: "nebulized",
  ophthalmic: "ophthalmic", otic: "otic", nasal: "nasal",
};

/** Frequency tokens, mapped to a canonical form plus doses per day where known. */
const FREQUENCIES = {
  qd: { canonical: "daily", perDay: 1 }, daily: { canonical: "daily", perDay: 1 },
  "once daily": { canonical: "daily", perDay: 1 }, "every day": { canonical: "daily", perDay: 1 },
  bid: { canonical: "twice daily", perDay: 2 }, "twice daily": { canonical: "twice daily", perDay: 2 },
  "two times daily": { canonical: "twice daily", perDay: 2 },
  tid: { canonical: "three times daily", perDay: 3 }, "three times daily": { canonical: "three times daily", perDay: 3 },
  qid: { canonical: "four times daily", perDay: 4 }, "four times daily": { canonical: "four times daily", perDay: 4 },
  qhs: { canonical: "at bedtime", perDay: 1 }, hs: { canonical: "at bedtime", perDay: 1 },
  "at bedtime": { canonical: "at bedtime", perDay: 1 }, nightly: { canonical: "at bedtime", perDay: 1 },
  qam: { canonical: "every morning", perDay: 1 }, "every morning": { canonical: "every morning", perDay: 1 },
  prn: { canonical: "as needed", perDay: null }, "as needed": { canonical: "as needed", perDay: null },
  qweek: { canonical: "weekly", perDay: null }, weekly: { canonical: "weekly", perDay: null },
  "every other day": { canonical: "every other day", perDay: null }, qod: { canonical: "every other day", perDay: null },
};

// Dose forms stripped from a name so "Metoprolol Tartrate 25 mg tablet" and
// "metoprolol tartrate" reduce to the same key.
const DOSE_FORMS = /\b(?:tab(?:let)?s?|cap(?:sule)?s?|er|xr|sr|cr|dr|la|xl|solution|susp(?:ension)?|syrup|elixir|cream|ointment|gel|patch(?:es)?|inhaler|nebule|vial|injection|drops?|suppositor(?:y|ies)|powder)\b/gi;

const STRENGTH = /(\d+(?:\.\d+)?)\s*(mcg|mg|g|ml|units?|iu|meq|%)\b/i;

/**
 * Normalise one medication into comparable parts.
 *
 * Accepts either a Patient.current_medications row ({ name, dosage, frequency,
 * prescriber, start_date }) or a free-text string ("Metoprolol 25 mg PO BID").
 *
 * @param {object|string} input
 * @returns {{
 *   raw: string, name: string, key: string,
 *   strengthValue: number|null, strengthUnit: string|null,
 *   route: string|null, frequency: string|null, dosesPerDay: number|null,
 *   prescriber: string|null, startDate: string|null, source: string|null,
 *   status: string|null,
 * }}
 */
export function normalizeMedication(input) {
  const row = typeof input === "string" ? { name: input } : (input || {});
  const raw = [row.name, row.dosage, row.route, row.frequency].filter(Boolean).join(" ").trim()
    || String(row.name || "").trim();
  const lower = raw.toLowerCase();

  const strengthMatch = (row.dosage ? String(row.dosage) : raw).match(STRENGTH);
  const strengthValue = strengthMatch ? Number(strengthMatch[1]) : null;
  const strengthUnit = strengthMatch ? strengthMatch[2].toLowerCase().replace(/^units$/, "unit") : null;

  // Longest token wins, so "subcutaneous" is not shadowed by "sc".
  let route = null;
  for (const token of Object.keys(ROUTES).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(?:^|[^a-z])${token}(?:[^a-z]|$)`, "i").test(lower)) { route = ROUTES[token]; break; }
  }

  let frequency = null;
  let dosesPerDay = null;
  for (const token of Object.keys(FREQUENCIES).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(?:^|[^a-z])${token}(?:[^a-z]|$)`, "i").test(lower)) {
      frequency = FREQUENCIES[token].canonical;
      dosesPerDay = FREQUENCIES[token].perDay;
      break;
    }
  }

  // The NAME is whatever is left once strength, route, frequency and dose form
  // are removed. Keeping it conservative: a token we do not recognise stays in
  // the name rather than being discarded, so two different drugs never collapse
  // onto one key by over-trimming.
  const name = String(row.name || raw)
    .replace(STRENGTH, " ")
    .replace(DOSE_FORMS, " ")
    .replace(new RegExp(`\\b(?:${Object.keys(ROUTES).join("|")})\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(?:${Object.keys(FREQUENCIES).join("|")})\\b`, "gi"), " ")
    .replace(/[^a-z0-9\s/-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    raw,
    name,
    key: name.toLowerCase(),
    strengthValue,
    strengthUnit,
    route,
    frequency,
    dosesPerDay,
    prescriber: row.prescriber || null,
    startDate: row.start_date || row.startDate || null,
    source: row.source || null,
    status: row.status || null,
  };
}

// ── External knowledge adapter seam ────────────────────────────────────────

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   licensed: boolean,
 *   normalize?: (med: object) => object,
 * }} MedicationKnowledgeAdapter
 */

/** @type {MedicationKnowledgeAdapter} */
const BUILT_IN_ADAPTER = Object.freeze({
  id: "pennsync-builtin",
  label: "PennSync built-in list",
  licensed: false,
});

let activeAdapter = BUILT_IN_ADAPTER;

/**
 * Install an authoritative external medication-knowledge service (e.g. RxNorm).
 * Passing null restores the built-in list.
 * @param {MedicationKnowledgeAdapter|null} adapter
 */
export function setMedicationKnowledgeAdapter(adapter) {
  activeAdapter = adapter || BUILT_IN_ADAPTER;
}

/**
 * Which knowledge source is behind the findings, stated honestly.
 *
 * `caveat` is non-empty whenever the source is NOT a licensed database, so a
 * screen cannot imply authoritative backing that does not exist.
 */
export function describeKnowledgeSource() {
  return {
    id: activeAdapter.id,
    label: activeAdapter.label,
    licensed: !!activeAdapter.licensed,
    caveat: activeAdapter.licensed
      ? ""
      : "PennSync's medication list is limited and is not a licensed drug database. "
        + "Confirm every finding against the EMR medication profile and a medication reference.",
  };
}

// ── Discrepancy detection ──────────────────────────────────────────────────

/** Advisory wording used by every finding. Never a medication instruction. */
const ADVISORY =
  "Potential medication discrepancy — compare with the EMR medication profile and "
  + "confirm with patient/provider.";

function discrepancy(id, type, severity, title, detail, extra = {}) {
  return { id, type, severity, title, detail, advisory: ADVISORY, ...extra };
}

/** Stopped/held wording in a note, near a drug name. */
const STOPPED = /\b(?:stopped|discontinued|d\/c(?:'d|ed)?|held|holding|no longer (?:taking|on)|off the|quit(?:ting)?|not taking)\b/i;

/**
 * Compare what the chart lists against what this visit's note says.
 *
 * @param {{
 *   chartMedications?: Array<object|string>,
 *   noteMedications?: Array<object|string>,
 *   noteText?: string,
 *   allergies?: string,
 * }} input
 * @returns {{ findings: object[], counts: object, knowledgeSource: object, changes: object[] }}
 */
export function reconcileMedications({
  chartMedications = [],
  noteMedications = [],
  noteText = "",
  allergies = "",
} = {}) {
  const chart = chartMedications.filter(Boolean).map(normalizeMedication).filter((m) => m.key);
  const note = noteMedications.filter(Boolean).map(normalizeMedication).filter((m) => m.key);
  const chartByKey = new Map(chart.map((m) => [m.key, m]));
  const noteByKey = new Map(note.map((m) => [m.key, m]));
  const findings = [];
  const changes = [];

  // ── In the note but not on the list ──────────────────────────────────────
  for (const med of note) {
    if (chartByKey.has(med.key)) continue;
    findings.push(discrepancy(
      `not_on_list:${med.key}`, "not_on_list", "high",
      `${med.name} appears in this visit's note but not on the medication list`,
      "PennSync's medication list for this patient does not include it.",
      { medication: med.name, evidence: med.raw },
    ));
    changes.push({ medication: med.name, change: "documented_this_visit", detail: med.raw });
  }

  // ── On the list but reported stopped ─────────────────────────────────────
  for (const med of chart) {
    // Only when the stop wording sits in the SAME sentence as the drug name —
    // a stop phrase elsewhere in the note says nothing about this drug.
    const sentences = String(noteText || "").split(/(?<=[.!?])\s+/);
    const mentioned = sentences.filter((s) => s.toLowerCase().includes(med.key));
    const stoppedIn = mentioned.find((s) => STOPPED.test(s));
    if (stoppedIn) {
      findings.push(discrepancy(
        `reported_stopped:${med.key}`, "reported_stopped", "high",
        `${med.name} is on the medication list but the note says it was stopped or held`,
        "The list still shows it as current.",
        { medication: med.name, evidence: stoppedIn.trim() },
      ));
      changes.push({ medication: med.name, change: "reported_stopped", detail: stoppedIn.trim() });
      continue;
    }
    // ── Dose change ────────────────────────────────────────────────────────
    const inNote = noteByKey.get(med.key);
    if (!inNote) continue;
    if (
      med.strengthValue != null && inNote.strengthValue != null
      && med.strengthUnit === inNote.strengthUnit
      && med.strengthValue !== inNote.strengthValue
    ) {
      findings.push(discrepancy(
        `dose_change:${med.key}`, "dose_change", "high",
        `${med.name} dose differs from the medication list`,
        `List: ${med.strengthValue} ${med.strengthUnit}. This visit: ${inNote.strengthValue} ${inNote.strengthUnit}.`,
        { medication: med.name, from: `${med.strengthValue} ${med.strengthUnit}`, to: `${inNote.strengthValue} ${inNote.strengthUnit}` },
      ));
      changes.push({ medication: med.name, change: "dose_change", detail: `${med.strengthValue} ${med.strengthUnit} → ${inNote.strengthValue} ${inNote.strengthUnit}` });
    } else if (med.frequency && inNote.frequency && med.frequency !== inNote.frequency) {
      findings.push(discrepancy(
        `frequency_change:${med.key}`, "frequency_change", "medium",
        `${med.name} frequency differs from the medication list`,
        `List: ${med.frequency}. This visit: ${inNote.frequency}.`,
        { medication: med.name, from: med.frequency, to: inNote.frequency },
      ));
      changes.push({ medication: med.name, change: "frequency_change", detail: `${med.frequency} → ${inNote.frequency}` });
    }
  }

  // ── Duplicate therapy (same normalised name listed twice) ────────────────
  const seen = new Map();
  for (const med of chart) {
    const prior = seen.get(med.key);
    if (prior) {
      findings.push(discrepancy(
        `duplicate:${med.key}`, "duplicate_therapy", "high",
        `${med.name} appears more than once on the medication list`,
        `Entries: "${prior.raw}" and "${med.raw}".`,
        { medication: med.name },
      ));
    } else {
      seen.set(med.key, med);
    }
  }

  // ── Allergy conflict ─────────────────────────────────────────────────────
  // Word-boundary matched against the documented allergy text. Conservative by
  // design: a near-miss is not reported, because a false allergy alert trains
  // nurses to dismiss the real one.
  const allergyText = String(allergies || "").toLowerCase();
  if (allergyText && !/^(?:none|nkda|no known)/i.test(allergyText.trim())) {
    for (const med of [...chart, ...note]) {
      if (!med.key || med.key.length < 4) continue;
      if (!new RegExp(`\\b${med.key.split(" ")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(allergyText)) continue;
      if (findings.some((f) => f.id === `allergy_conflict:${med.key}`)) continue;
      findings.push(discrepancy(
        `allergy_conflict:${med.key}`, "allergy_conflict", "critical",
        `${med.name} may conflict with a documented allergy`,
        `Documented allergies: ${allergies}`,
        { medication: med.name },
      ));
    }
  }

  return {
    findings,
    counts: {
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      total: findings.length,
    },
    knowledgeSource: describeKnowledgeSource(),
    changes,
  };
}

/**
 * "Medication changes this visit" — the compact summary that can feed the Smart
 * Note, a provider follow-up, a care-plan review, and the next visit's prep.
 *
 * @param {object[]} changes from reconcileMedications
 * @returns {{ lines: string[], text: string, count: number }}
 */
export function summarizeMedicationChanges(changes) {
  const LABEL = {
    documented_this_visit: "documented this visit but not on the list",
    reported_stopped: "reported stopped or held",
    dose_change: "dose differs from the list",
    frequency_change: "frequency differs from the list",
  };
  const lines = (Array.isArray(changes) ? changes : [])
    .filter((c) => c && c.medication)
    .map((c) => `${c.medication} — ${LABEL[c.change] || c.change}${c.detail ? ` (${c.detail})` : ""}`);
  return {
    lines,
    // Framed as items to verify, never as a completed reconciliation.
    text: lines.length
      ? `Medication items to verify against the EMR profile this visit: ${lines.join("; ")}.`
      : "",
    count: lines.length,
  };
}
