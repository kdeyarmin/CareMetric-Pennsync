// Deterministic visit-over-visit comparison. Pure + offline (no LLM, no network),
// so it is unit-testable under `node --test` and can never hallucinate a trend.
//
// It extracts the same clinically-significant values the rest of the engine uses
// (via factExtraction) from the CURRENT note and from the patient's PRIOR note,
// then reports the change for each metric that is present in BOTH. This powers
// the "check the note against the chart / catch trends and note the change" part
// of the Smart Note flow. Every value it surfaces traces back to real text — the
// current value to the nurse's draft, the prior value to the saved chart note —
// so the trend summary it produces is safe to add to a note and will pass the
// value-guard once that summary is whitelisted as input.
//
// IMPORTANT: loaded by the node test runner, so it may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).
import { extractVitals } from "./factExtraction.js";

/** Pull the first "N/10" rating (0-10) from free text, or null. */
export function extractPain(text) {
  if (!text) return null;
  const m = text.match(/\b(\d{1,2})\s*\/\s*10\b/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return Number.isFinite(v) && v >= 0 && v <= 10 ? v : null;
}

/** Extract the comparable metric set from one note's text. */
function extractMetrics(text) {
  const v = extractVitals(text);
  let weight = v.weight ?? null;
  // extractVitals captures the weight number but drops the unit; normalize a
  // documented kg reading to lbs so a visit-to-visit unit switch (e.g. 80 kg ->
  // 176 lbs) isn't reported as a huge swing, and a real change isn't masked.
  // (Temperature needs no such handling: extractVitals already rejects sub-90
  // values, so a Celsius reading is dropped rather than mis-compared.)
  if (weight != null && /(?:\bwt|weight)\s*\d{2,3}(?:\.\d)?\s*kg\b/i.test(text)) {
    weight = Math.round(weight * 2.20462 * 10) / 10;
  }
  return {
    bp: v.bp_sys != null && v.bp_dia != null ? { sys: v.bp_sys, dia: v.bp_dia } : null,
    hr: v.hr ?? null,
    o2: v.o2 ?? null,
    temp: v.temp ?? null,
    weight,
    pain: extractPain(text),
  };
}

// Scalar metrics. `minDelta` is the smallest change worth surfacing (below it the
// two visits are effectively unchanged / measurement noise). `concern` flags a
// change that clinically warrants attention — used only to colour the UI; the
// inserted note text stays purely factual regardless. `fmt` renders one value
// (including any suffix unit like % or /10); `trailingUnit` is the word unit
// stated once at the end of a sentence segment (bpm, lbs, °F).
const SCALAR_METRICS = [
  { key: "hr", label: "Heart rate", unit: "bpm", trailingUnit: "bpm", minDelta: 10, concern: (p, n) => n > 100 || n < 50 || Math.abs(n - p) >= 15 },
  { key: "o2", label: "Oxygen saturation", unit: "%", fmt: (x) => `${x}%`, minDelta: 2, concern: (p, n) => n < 92 || n - p <= -2 },
  { key: "temp", label: "Temperature", unit: "°F", trailingUnit: "°F", minDelta: 1, concern: (p, n) => n >= 100.4 },
  { key: "weight", label: "Weight", unit: "lbs", trailingUnit: "lbs", minDelta: 3, concern: (p, n) => n - p >= 3 },
  { key: "pain", label: "Pain", unit: "/10", fmt: (x) => `${x}/10`, minDelta: 2, concern: (p, n) => n >= 7 || n - p >= 2 },
];

const BP_MIN_DELTA = 8; // mmHg change (systolic or diastolic) worth surfacing

/**
 * Compare the current note's clinical values against the prior note's.
 * @param {string} currentText the rough draft being written now
 * @param {string} priorText the patient's most recent saved note
 * @returns {{ key: string, label: string, unit: string, trailingUnit: string, prevStr: string, nextStr: string, delta: number, direction: string, concern: boolean }[]}
 *          one entry per metric present in both notes whose change clears minDelta
 */
export function compareVisits(currentText, priorText) {
  if (!currentText || !priorText) return [];
  const cur = extractMetrics(currentText);
  const prev = extractMetrics(priorText);
  const out = [];

  // Blood pressure (compound systolic/diastolic — reported as one row).
  if (cur.bp && prev.bp) {
    const dSys = cur.bp.sys - prev.bp.sys;
    const dDia = cur.bp.dia - prev.bp.dia;
    if (Math.abs(dSys) >= BP_MIN_DELTA || Math.abs(dDia) >= BP_MIN_DELTA) {
      // Drive the row's direction/delta from whichever component moved more, so a
      // diastolic-only change (e.g. 120/70 -> 120/82) isn't rendered as "same".
      const dominant = Math.abs(dDia) > Math.abs(dSys) ? dDia : dSys;
      out.push({
        key: "bp",
        label: "Blood pressure",
        unit: "mmHg",
        trailingUnit: "mmHg",
        prevStr: `${prev.bp.sys}/${prev.bp.dia}`,
        nextStr: `${cur.bp.sys}/${cur.bp.dia}`,
        delta: dominant,
        direction: dominant > 0 ? "up" : dominant < 0 ? "down" : "same",
        concern: cur.bp.sys >= 160 || cur.bp.sys <= 90 || cur.bp.dia >= 100 || Math.abs(dSys) >= 20 || Math.abs(dDia) >= 20,
      });
    }
  }

  for (const m of SCALAR_METRICS) {
    const p = prev[m.key];
    const n = cur[m.key];
    if (p == null || n == null) continue;
    const delta = Number((n - p).toFixed(1));
    if (Math.abs(delta) < m.minDelta) continue;
    const fmt = m.fmt || ((x) => `${x}`);
    out.push({
      key: m.key,
      label: m.label,
      unit: m.unit,
      trailingUnit: m.trailingUnit || "",
      prevStr: fmt(p),
      nextStr: fmt(n),
      delta,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "same",
      concern: m.concern(p, n),
    });
  }

  return out;
}

/**
 * Build a single, plain-text, purely factual sentence describing the changes —
 * suitable for pasting into an EMR and for adding to a note. It states only the
 * prior and current values (no clinical interpretation), so it never overclaims.
 * @param {ReturnType<typeof compareVisits>} comparisons
 * @returns {string} "" when there is nothing to report
 */
export function buildTrendSummary(comparisons) {
  if (!comparisons || !comparisons.length) return "";
  const segments = comparisons.map((c) => {
    // Suffix units (%, /10) already live on prevStr/nextStr; only word units
    // (mmHg, bpm, °F, lbs) are stated once at the end of the segment.
    const unit = c.trailingUnit ? ` ${c.trailingUnit}` : "";
    return `${c.label.toLowerCase()} ${c.prevStr} to ${c.nextStr}${unit}`;
  });
  return `Compared to the prior documented visit, ${segments.join("; ")}.`;
}

// ── Multi-visit (sustained) trend detection ────────────────────────────────
// A single-visit delta can be noise; a value that moves the same direction
// across several consecutive visits is the clinically meaningful signal (e.g.
// weight climbing each visit -> possible fluid retention). These read from the
// patient's saved note history, which the caller already has — no extra fetch.

const TREND_METRICS = [
  { key: "bp_sys", label: "Systolic BP", trailingUnit: "mmHg", get: (m) => m.bp?.sys ?? null, minTotal: 12 },
  { key: "hr", label: "Heart rate", trailingUnit: "bpm", get: (m) => m.hr, minTotal: 12 },
  { key: "o2", label: "Oxygen saturation", get: (m) => m.o2, fmt: (x) => `${x}%`, minTotal: 3 },
  { key: "weight", label: "Weight", trailingUnit: "lbs", get: (m) => m.weight, minTotal: 4 },
  { key: "pain", label: "Pain", get: (m) => m.pain, fmt: (x) => `${x}/10`, minTotal: 3 },
];

const MIN_TREND_RUN = 3; // values (visits) required to call something a trend

/**
 * Detect values that have moved monotonically across the most recent consecutive
 * visits. Pure + offline.
 * @param {string[]} noteTexts ordered oldest -> newest, INCLUDING the current note last
 * @returns {{ key: string, label: string, direction: "up"|"down", display: string, values: number[] }[]}
 */
export function detectSustainedTrends(noteTexts) {
  const texts = (noteTexts || []).filter((t) => t && t.trim());
  if (texts.length < MIN_TREND_RUN) return [];
  const metricsByNote = texts.map(extractMetrics);
  /** @type {{ key: string, label: string, direction: "up"|"down", display: string, values: number[] }[]} */
  const out = [];

  for (const m of TREND_METRICS) {
    // Walk back from the newest note collecting consecutive present values.
    const tail = [];
    for (let i = metricsByNote.length - 1; i >= 0; i--) {
      const val = m.get(metricsByNote[i]);
      if (val == null) break;
      tail.push(val);
    }
    if (tail.length < MIN_TREND_RUN) continue;
    const series = tail.reverse(); // back to oldest -> newest

    const rising = series.every((v, i) => i === 0 || v > series[i - 1]);
    const falling = series.every((v, i) => i === 0 || v < series[i - 1]);
    if (!rising && !falling) continue;
    if (Math.abs(series[series.length - 1] - series[0]) < m.minTotal) continue;

    const fmt = m.fmt || ((x) => `${x}`);
    const unit = m.trailingUnit ? ` ${m.trailingUnit}` : "";
    out.push({
      key: m.key,
      label: m.label,
      direction: rising ? "up" : "down",
      values: series,
      display: `${series.map(fmt).join(" → ")}${unit}`,
    });
  }

  return out;
}
