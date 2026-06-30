// CMS PDGM case-mix weights loader.
//
// Parses the OFFICIAL CMS Home Health PPS case-mix weights file (the recalibrated
// 432-payment-group table published annually in the HH PPS Final Rule) into the
// `caseMixTable` shape that `pdgmGrouper.groupPeriod()` consumes.
//
// It ships NO weights. The agency exports their official CMS case-mix weights file
// (per the year's Final Rule) to CSV and loads it here — see
// docs/PDGM_CASE_MIX_WEIGHTS.md for where to get the file and the expected columns.
//
// SAFETY: this never fabricates or infers a weight, a clinical group, or a HIPPS
// mapping. Rows it can't map and an incomplete table are REPORTED (errors/warnings),
// not guessed. HIPPS codes are carried through verbatim, never decoded from memory.
// The output feeds the table-driven `pdgmGrouper` reference only; per that engine's
// header it must be reconciled against the canonical backend `calculatePDGM` before
// any billing use — never surfaced as a second, competing reimbursement figure.

import { CLINICAL_GROUPS, caseMixKey } from "./pdgmGrouper.js";

// 2 timing × 2 admission source × 12 clinical groups × 3 functional × 3 comorbidity.
export const EXPECTED_GROUP_COUNT = 432;

// Plausible bounds for a PDGM case-mix weight — a guard against a transcription
// error or a wrong column, NOT an authoritative range. Real weights cluster well
// inside this; anything outside is almost certainly a parse/source mistake.
export const WEIGHT_MIN = 0.2;
export const WEIGHT_MAX = 5.0;

// Canonical clinical-group resolver: case/punctuation-insensitive exact match
// against the 12 official names, plus the common CMS spellings/abbreviations.
// Unknown values resolve to null (reported, never guessed).
const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const CLINICAL_GROUP_BY_NORM = (() => {
  const m = new Map();
  for (const g of CLINICAL_GROUPS) m.set(normKey(g), g);
  const aliases = {
    behavioralhealth: "Behavioral Health",
    complexnursinginterventions: "Complex Nursing Interventions",
    musculoskeletalrehabilitation: "Musculoskeletal Rehabilitation",
    msrehab: "Musculoskeletal Rehabilitation",
    neurorehabilitation: "Neuro Rehabilitation",
    neurorehab: "Neuro Rehabilitation",
    // Official CMS label is "Neuro/Stroke Rehabilitation" (docs/pdgm-cy2026.md).
    neurostrokerehabilitation: "Neuro Rehabilitation",
    strokerehabilitation: "Neuro Rehabilitation",
    wound: "Wound",
    wounds: "Wound",
    // Official CMS label is "Wounds (Post-Op & Skin/Non-Surgical)".
    woundspostopskinnonsurgical: "Wound",
    woundspostopandskinnonsurgical: "Wound",
    woundspostop: "Wound",
    mmtasurgicalaftercare: "MMTA - Surgical Aftercare",
    mmtacardiacandcirculatory: "MMTA - Cardiac and Circulatory",
    mmtacardiac: "MMTA - Cardiac and Circulatory",
    mmtaendocrine: "MMTA - Endocrine",
    mmtagastrointestinaltractandgenitourinarysystem: "MMTA - Gastrointestinal tract and Genitourinary system",
    mmtagigu: "MMTA - Gastrointestinal tract and Genitourinary system",
    mmtainfectiousdiseaseneoplasmsandbloodformingdiseases: "MMTA - Infectious Disease, Neoplasms, and Blood-Forming Diseases",
    mmtarespiratory: "MMTA - Respiratory",
    mmtaother: "MMTA - Other",
  };
  for (const [a, g] of Object.entries(aliases)) m.set(normKey(a), g);
  return m;
})();

function resolveClinicalGroup(raw) {
  return CLINICAL_GROUP_BY_NORM.get(normKey(raw)) || null;
}
function resolveTiming(raw) {
  const v = String(raw).toLowerCase();
  if (v.startsWith("early")) return "early";
  if (v.startsWith("late")) return "late";
  return null;
}
function resolveAdmission(raw) {
  const v = String(raw).toLowerCase();
  if (v.startsWith("comm")) return "community";
  if (v.startsWith("inst")) return "institutional";
  return null;
}
function resolveFunctional(raw) {
  const v = String(raw).toLowerCase();
  if (v.startsWith("low")) return "low";
  if (v.startsWith("med")) return "medium";
  if (v.startsWith("high")) return "high";
  return null;
}
function resolveComorbidity(raw) {
  const v = String(raw).toLowerCase();
  if (v.startsWith("high")) return "high";
  if (v.startsWith("low")) return "low";
  if (v.startsWith("no")) return "none"; // "none" / "no comorbidity adjustment"
  return null;
}

// Header synonyms → logical column. Matched case/punctuation-insensitively.
const COLUMN_SYNONYMS = {
  clinicalGroup: ["clinical group", "clinical_group", "clinicalgroup", "group"],
  admissionSource: ["admission source", "admission_source", "admissionsource", "admission", "source"],
  timing: ["timing", "episode timing", "period timing"],
  functionalLevel: ["functional level", "functional_level", "functional impairment level", "functional impairment", "functionallevel"],
  comorbidityLevel: ["comorbidity adjustment", "comorbidity_adjustment", "comorbidity adjustment level", "comorbidity", "comorbiditylevel"],
  weight: ["case-mix weight", "case mix weight", "casemixweight", "weight", "cmw"],
  hipps: ["hipps", "hipps code", "hippscode"],
  lupaThreshold: ["lupa threshold", "lupa_threshold", "lupathreshold", "lupa"],
};

function mapHeaders(headerCells) {
  const normalized = headerCells.map((h) => normKey(h));
  const out = {};
  for (const [logical, syns] of Object.entries(COLUMN_SYNONYMS)) {
    const idx = normalized.findIndex((h) => syns.some((s) => normKey(s) === h));
    if (idx !== -1) out[logical] = idx;
  }
  return out;
}

// Thrown by parseCsvRows when a quoted field is never closed, so the caller can
// report a clean "malformed CSV" error instead of silently swallowing the rest of
// the file into one runaway field.
export class CsvParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "CsvParseError";
  }
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes ("")
// and commas/newlines inside quotes. Returns an array of string-cell rows.
// Throws CsvParseError on an unterminated quoted field (a missing closing quote
// would otherwise absorb every following row into a single field).
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = String(text).replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (inQuotes) {
    throw new CsvParseError("Unterminated quoted field — a quoted value is missing its closing double-quote.");
  }
  // flush trailing field/row (unless the file ended on a clean newline)
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Parse the official CMS case-mix weights CSV into the engine's table shape.
 *
 * @param {string} csvText  CSV exported from the official CMS case-mix weights file.
 * @param {{ year?: number|null, source?: string|null, strict?: boolean }} [opts]
 *   strict (default true): require exactly EXPECTED_GROUP_COUNT unique groups and
 *   all 12 clinical groups present; otherwise those become warnings.
 * @returns {{
 *   ok: boolean,
 *   caseMixTable: Record<string, {hipps?: string, weight: number, lupaThreshold?: number}>,
 *   lupaThresholds: Record<string, number>,
 *   meta: { year: number|null, source: string|null, rowsParsed: number, groups: number },
 *   errors: string[], warnings: string[]
 * }}
 */
export function parseCaseMixWeightsCsv(csvText, { year = null, source = null, strict = true } = {}) {
  const errors = [];
  const warnings = [];
  const caseMixTable = {};
  const lupaThresholds = {};

  let rows;
  try {
    rows = parseCsvRows(csvText);
  } catch (err) {
    const msg = err instanceof CsvParseError ? err.message : `Could not parse CSV: ${err?.message || err}`;
    errors.push(msg);
    return { ok: false, caseMixTable, lupaThresholds, meta: { year, source, rowsParsed: 0, groups: 0 }, errors, warnings };
  }
  if (rows.length < 2) {
    errors.push("CSV has no data rows (need a header row plus at least one data row).");
    return { ok: false, caseMixTable, lupaThresholds, meta: { year, source, rowsParsed: 0, groups: 0 }, errors, warnings };
  }

  const cols = mapHeaders(rows[0]);
  const required = ["clinicalGroup", "admissionSource", "timing", "functionalLevel", "comorbidityLevel", "weight"];
  const missingCols = required.filter((c) => cols[c] === undefined);
  if (missingCols.length) {
    errors.push(`Missing required column(s): ${missingCols.join(", ")}. Provide explicit variable columns — HIPPS codes are not decoded automatically. See docs/PDGM_CASE_MIX_WEIGHTS.md.`);
    return { ok: false, caseMixTable, lupaThresholds, meta: { year, source, rowsParsed: 0, groups: 0 }, errors, warnings };
  }

  let rowsParsed = 0;
  const seenGroups = new Set();
  const clinicalGroupsSeen = new Set();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const line = r + 1; // 1-based, header is line 1
    const get = (logical) => (cols[logical] !== undefined ? (cells[cols[logical]] ?? "").trim() : "");

    const clinicalGroup = resolveClinicalGroup(get("clinicalGroup"));
    const timing = resolveTiming(get("timing"));
    const admissionSource = resolveAdmission(get("admissionSource"));
    const functionalLevel = resolveFunctional(get("functionalLevel"));
    const comorbidityLevel = resolveComorbidity(get("comorbidityLevel"));
    const weightRaw = get("weight");
    const weight = Number.parseFloat(weightRaw);

    const bad = [];
    if (!clinicalGroup) bad.push(`clinical group "${get("clinicalGroup")}"`);
    if (!timing) bad.push(`timing "${get("timing")}"`);
    if (!admissionSource) bad.push(`admission source "${get("admissionSource")}"`);
    if (!functionalLevel) bad.push(`functional level "${get("functionalLevel")}"`);
    if (!comorbidityLevel) bad.push(`comorbidity "${get("comorbidityLevel")}"`);
    if (!Number.isFinite(weight)) bad.push(`weight "${weightRaw}"`);
    else if (weight < WEIGHT_MIN || weight > WEIGHT_MAX) bad.push(`weight ${weight} outside plausible range [${WEIGHT_MIN}, ${WEIGHT_MAX}]`);

    if (bad.length) {
      errors.push(`Line ${line}: unmappable ${bad.join(", ")} — not loaded (never guessed).`);
      continue;
    }

    const key = caseMixKey({ timing, admissionSource, clinicalGroup, functionalLevel, comorbidityLevel });
    if (caseMixTable[key]) {
      errors.push(`Line ${line}: duplicate payment group (${key}) — case-mix weights must be unique per group.`);
      continue;
    }

    const entry = { weight };
    const hipps = get("hipps");
    if (hipps) entry.hipps = hipps;
    const lupaRaw = get("lupaThreshold");
    if (lupaRaw) {
      const lupa = Number.parseInt(lupaRaw, 10);
      if (Number.isFinite(lupa)) { entry.lupaThreshold = lupa; lupaThresholds[key] = lupa; }
      else warnings.push(`Line ${line}: non-numeric LUPA threshold "${lupaRaw}" ignored.`);
    }

    caseMixTable[key] = entry;
    seenGroups.add(key);
    clinicalGroupsSeen.add(clinicalGroup);
    rowsParsed++;
  }

  const groups = seenGroups.size;
  const completenessMsg = `loaded ${groups} of ${EXPECTED_GROUP_COUNT} expected payment groups`;
  if (groups !== EXPECTED_GROUP_COUNT) (strict ? errors : warnings).push(`Incomplete table: ${completenessMsg}.`);
  if (clinicalGroupsSeen.size !== CLINICAL_GROUPS.length) {
    const missing = CLINICAL_GROUPS.filter((g) => !clinicalGroupsSeen.has(g));
    (strict ? errors : warnings).push(`Missing clinical group(s): ${missing.join("; ")}.`);
  }

  return {
    ok: errors.length === 0,
    caseMixTable,
    lupaThresholds,
    meta: { year, source, rowsParsed, groups },
    errors,
    warnings,
  };
}
