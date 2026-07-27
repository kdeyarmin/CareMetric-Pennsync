// Plausibility / consistency validation for the PDGM Rate Settings editor.
//
// Safety rails only — these checks catch transcription mistakes (a base rate
// with a dropped decimal, a weight typed into the wrong cell, two ICD prefix
// rows silently overwriting each other) BEFORE they are saved and applied to
// every PDGM payment estimate. They are deliberately loose bounds, not an
// authoritative CMS range: anything they reject is almost certainly a typo.
//
// Pure functions, no I/O — unit-tested in rateSettingsValidation.spec.js.

import { DEFAULT_PDGM_RATES } from "./pdgmRates.js";

// Sane range for a case-mix weight or payment multiplier cell. Real PDGM
// weights/multipliers cluster well inside [0.1, 5]; outside is a typo.
export const RATE_CELL_MIN = 0.1;
export const RATE_CELL_MAX = 5;

// The base 30-day rate must be within an order of magnitude of the built-in
// default — $203 or $20,382 would both be transcription errors, not rates.
export const BASE_RATE_ORDER_OF_MAGNITUDE = 10;

const CELL_TABLES = [
  { key: "clinicalGroupWeights", label: "Clinical-group case-mix weights" },
  { key: "functionalMultipliers", label: "Functional-level multipliers" },
  { key: "comorbidityMultipliers", label: "Comorbidity multipliers" },
];

const money = (n) => `$${Number(n).toFixed(2)}`;

/**
 * Plausibility-check a rates object (the formToRates output — finite numbers
 * only; omitted cells fall back to the defaults and are fine).
 * @returns {string[]} specific, human-readable error messages; empty = OK.
 */
export function validateRateNumbers(rates, defaults = DEFAULT_PDGM_RATES) {
  const errors = [];
  if (!rates || typeof rates !== "object") return errors;

  const base = rates.basePaymentRate;
  if (base !== undefined) {
    const lo = defaults.basePaymentRate / BASE_RATE_ORDER_OF_MAGNITUDE;
    const hi = defaults.basePaymentRate * BASE_RATE_ORDER_OF_MAGNITUDE;
    if (!(base > 0) || base < lo || base > hi) {
      errors.push(
        `Base 30-day payment rate ${money(base)} is implausible — expected within an order of magnitude of the ${money(defaults.basePaymentRate)} default (${money(lo)}–${money(hi)}). Check for a dropped or extra digit.`,
      );
    }
  }

  // Labor share is a FRACTION of the base payment (CY2026: 0.749). An
  // out-of-range value (e.g. 74.9 entered as a percent) silently clamps to 1.0
  // in the engine, applying the full wage index to the whole payment.
  const laborShare = rates.laborShare;
  if (laborShare !== undefined && typeof laborShare === "number") {
    if (!(laborShare > 0 && laborShare <= 1)) {
      errors.push(
        `Labor-related share ${laborShare} must be a fraction between 0 and 1 (e.g. 0.749 for 74.9%). Did you enter a percentage?`,
      );
    }
  }

  for (const { key, label } of CELL_TABLES) {
    const table = rates[key];
    if (!table || typeof table !== "object") continue;
    for (const row of Object.keys(table)) {
      for (const col of Object.keys(table[row] || {})) {
        const v = table[row][col];
        if (typeof v !== "number") continue;
        if (v < RATE_CELL_MIN || v > RATE_CELL_MAX) {
          errors.push(
            `${label}: ${row} × ${col} is ${v} — outside the sane ${RATE_CELL_MIN}–${RATE_CELL_MAX} range for a weight/multiplier. Check for a misplaced decimal.`,
          );
        }
      }
    }
  }

  // Functional thresholds are POINT CUTOFFS, not weights: each bucket's low
  // cutoff must sit below its high cutoff or every period lands in one level.
  const thresholds = rates.functionalThresholds;
  if (thresholds && typeof thresholds === "object") {
    for (const bucket of Object.keys(thresholds)) {
      const t = thresholds[bucket] || {};
      const { low, high } = t;
      for (const [name, v] of Object.entries(t)) {
        if (typeof v === "number" && v < 0) {
          errors.push(`Functional-impairment thresholds: ${bucket} ${name} is ${v} — point cutoffs cannot be negative.`);
        }
      }
      if (typeof low === "number" && typeof high === "number" && low >= high) {
        errors.push(
          `Functional-impairment thresholds: ${bucket} low cutoff (${low}) must be below the high cutoff (${high}).`,
        );
      }
    }
  }

  return errors;
}

// Same prefix normalization the editor's rowsToMap applies on save, so the
// validation flags exactly the rows that would collide in the saved map.
export const normalizeIcdPrefix = (p) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();

/**
 * Validate the ICD-10 prefix → clinical-group rows against the weighted groups.
 *
 * errors  (block save): the same normalized prefix mapped to DIFFERENT groups
 *         (the last row would silently win), and mappings pointing at a
 *         clinical group that has no case-mix weight in the rate tables.
 * warnings (flag only): identical duplicate rows (collapse harmlessly on save)
 *         and incomplete rows that would be dropped on save.
 *
 * @param {Array<{prefix?: string, group?: string}>} rows editor rows, in order
 * @param {string[]} weightedGroups keys of the effective clinicalGroupWeights
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateIcdMappings(rows, weightedGroups) {
  const errors = [];
  const warnings = [];
  const weighted = new Set(weightedGroups || []);
  const byPrefix = new Map(); // normalized prefix -> [{ line, group }]

  (rows || []).forEach((row, i) => {
    const line = i + 1;
    const prefix = normalizeIcdPrefix(row?.prefix);
    const group = row?.group || "";

    if (!prefix) {
      if (group) warnings.push(`Row ${line} has no ICD-10 prefix — it will be dropped on save.`);
      return;
    }
    if (!group) {
      warnings.push(`Row ${line} (prefix ${prefix}) has no clinical group — it will be dropped on save.`);
      return;
    }
    if (!weighted.has(group)) {
      errors.push(
        `Row ${line}: prefix ${prefix} maps to clinical group "${group}", which has no case-mix weight in the tables above — estimates for these diagnoses would fail. Pick a weighted group or add its weights.`,
      );
    }

    const seen = byPrefix.get(prefix) || [];
    seen.push({ line, group });
    byPrefix.set(prefix, seen);
  });

  for (const [prefix, entries] of byPrefix) {
    if (entries.length < 2) continue;
    const groups = new Set(entries.map((e) => e.group));
    const lines = entries.map((e) => e.line).join(", ");
    if (groups.size > 1) {
      errors.push(
        `Prefix ${prefix} is mapped to ${groups.size} different clinical groups (rows ${lines}) — only the last row would be saved. Remove the conflicting rows.`,
      );
    } else {
      warnings.push(`Prefix ${prefix} appears ${entries.length} times (rows ${lines}) — duplicates collapse to one on save.`);
    }
  }

  return { errors, warnings };
}
