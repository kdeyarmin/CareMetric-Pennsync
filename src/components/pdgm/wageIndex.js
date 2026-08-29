// CBSA wage-index table — import + address matching.
//
// CMS wage-adjusts the labor share of every 30-day payment by the CBSA where
// the BENEFICIARY receives care, so an agency serving several counties has
// several wage indexes — not the single AgencySettings.wage_index. The admin
// imports their CBSA rows (from the year's HH PPS wage index file) with the
// counties/ZIP prefixes they serve; the clinical-manager brief then matches
// the referral's address to a row and hands that wage index to calculatePDGM
// explicitly (the engine's own agency-default fallback is unchanged).
//
// NOTHING in this module is shipped or guessed: no CBSA data, no wage
// indexes, no county↔CBSA mapping — rows the agency didn't import simply
// don't match, and an unmatched address falls back to the agency default with
// a note. (The one bundled dataset, paWageIndexCy2026.js, is Pennsylvania's
// rows extracted VERBATIM from the official CMS CY2026 file with full
// provenance — it loads through the same preview → store flow as a CSV.)
//
// Pure + offline (unit-tested with `node --test`); no React, no Base44 SDK.

import { parseCsvRows } from "./caseMixWeightsLoader.js";

// Plausibility guard for a wage index value — a transcription/wrong-column
// catch, not an authoritative range (real values cluster ~0.6–1.9).
export const WAGE_INDEX_MIN = 0.3;
export const WAGE_INDEX_MAX = 3.0;

const normHeader = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_KEYS = {
  cbsa: ["cbsa", "cbsacode", "cbsanumber", "msa"],
  label: ["label", "name", "cbsaname", "area", "areaname"],
  wage_index: ["wageindex", "index", "wi", "hhwageindex"],
  counties: ["counties", "county", "countynames"],
  zip_prefixes: ["zipprefixes", "zips", "zipcodes", "zip"],
};

function resolveHeader(raw) {
  const n = normHeader(raw);
  if (!n) return null;
  for (const [key, aliases] of Object.entries(HEADER_KEYS)) {
    if (n === normHeader(key) || aliases.includes(n)) return key;
  }
  return null;
}

/** Template CSV an admin downloads, fills from the CMS wage index file, and imports. */
export function wageIndexCsvTemplate() {
  return [
    "cbsa,label,wage_index,counties,zip_prefixes",
    "42540,Scranton--Wilkes-Barre PA,0.8412,Lackawanna; Luzerne; Wyoming,184; 185; 186; 187",
    "20700,East Stroudsburg PA,0.9134,Monroe,183",
    "99917,Rural Pennsylvania (statewide rural),0.8021,Bradford; Susquehanna,188; 189",
  ].join("\n");
}

/**
 * Parse a wage-index CSV into the rows stored at
 * PDGMRateConfig.wage_index_table.rows. Report-not-guess: unusable rows and
 * implausible values land in errors/warnings; a file with no usable rows
 * returns ok:false.
 */
export function parseWageIndexCsv(csvText) {
  const errors = [];
  const warnings = [];
  let rows;
  try {
    rows = parseCsvRows(String(csvText ?? ""));
  } catch (err) {
    return { ok: false, rows: [], errors: [err.message || "Unparseable CSV"], warnings };
  }
  if (!rows || rows.length < 2) {
    return { ok: false, rows: [], errors: ["CSV needs a header row and at least one CBSA row."], warnings };
  }
  const header = rows[0].map(resolveHeader);
  if (!header.includes("wage_index")) {
    return { ok: false, rows: [], errors: ["No wage_index column found. Download the template for the expected columns."], warnings };
  }

  const out = [];
  const seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => String(c ?? "").trim() === "")) continue;
    const rec = {};
    header.forEach((key, i) => {
      if (key) rec[key] = cells[i];
    });
    const rowNo = r + 1;
    const wi = Number(String(rec.wage_index ?? "").replace(/[\s,]/g, ""));
    if (!Number.isFinite(wi)) {
      errors.push(`Row ${rowNo}: wage_index "${rec.wage_index}" is not a number — row skipped.`);
      continue;
    }
    if (wi < WAGE_INDEX_MIN || wi > WAGE_INDEX_MAX) {
      errors.push(`Row ${rowNo}: wage_index ${wi} is outside the plausible range (${WAGE_INDEX_MIN}–${WAGE_INDEX_MAX}) — likely a wrong column; row skipped.`);
      continue;
    }
    const cbsa = String(rec.cbsa ?? "").trim();
    const label = String(rec.label ?? "").trim();
    const counties = String(rec.counties ?? "")
      .split(/[;|]/)
      .map((c) => c.trim().toLowerCase().replace(/\s+county$/i, ""))
      .filter(Boolean);
    const zips = String(rec.zip_prefixes ?? "")
      .split(/[;|]/)
      .map((z) => z.trim().replace(/[^0-9]/g, ""))
      .filter((z) => z.length >= 3 && z.length <= 5);
    if (counties.length === 0 && zips.length === 0) {
      errors.push(`Row ${rowNo} (${label || cbsa || "?"}): no counties or ZIP prefixes — the row could never match an address; row skipped.`);
      continue;
    }
    const key = cbsa || label.toLowerCase();
    if (key && seen.has(key)) {
      warnings.push(`Row ${rowNo}: duplicate CBSA "${cbsa || label}" — later row skipped.`);
      continue;
    }
    if (key) seen.add(key);
    out.push({ cbsa, label, wage_index: wi, counties, zip_prefixes: zips });
  }

  if (out.length === 0) {
    errors.push("No usable CBSA rows found.");
    return { ok: false, rows: [], errors, warnings };
  }
  return { ok: true, rows: out, errors, warnings };
}

/** Rows of a stored table, or null when nothing usable is stored. */
export function storedWageIndexRows(stored) {
  const rows = stored?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows;
}

/**
 * Match a patient address to a stored CBSA row. ZIP wins over county (a ZIP
 * in the address is the more specific signal); no match → null, never a guess.
 *
 * @param {string} addressText the referral's address (free text)
 * @param {object|null} stored PDGMRateConfig.wage_index_table
 * @returns {{wage_index:number, cbsa:string, label:string, matchedBy:'zip'|'county'}|null}
 */
export function matchWageIndex(addressText, stored) {
  const rows = storedWageIndexRows(stored);
  const text = String(addressText ?? "");
  if (!rows || !text.trim()) return null;

  const zips = [...text.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)].map((m) => m[1]);
  for (const zip of zips) {
    // Most specific (longest) matching prefix wins across ALL rows, so
    // overlapping imports ("184" on one row, "18401" on another) resolve to
    // the exact row instead of whichever row happened to come first.
    let best = null;
    for (const row of rows) {
      for (const p of row.zip_prefixes || []) {
        if (p && zip.startsWith(p) && (!best || p.length > best.p.length)) best = { row, p };
      }
    }
    if (best) {
      return { wage_index: best.row.wage_index, cbsa: best.row.cbsa, label: best.row.label, matchedBy: "zip" };
    }
  }

  const lower = text.toLowerCase();
  for (const row of rows) {
    for (const county of row.counties || []) {
      // Whole-word county match ("Wayne" must not match "Waynesburg Rd").
      if (county && new RegExp(`\\b${county.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)) {
        return { wage_index: row.wage_index, cbsa: row.cbsa, label: row.label, matchedBy: "county" };
      }
    }
  }
  return null;
}
