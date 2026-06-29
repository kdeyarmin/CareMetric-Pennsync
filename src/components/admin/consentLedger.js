/**
 * consentLedger — pure client-side helpers for the SMS consent ledger UI.
 *
 * Aggregation + CSV formatting live here (not in the component) so the
 * compliance-export and totals logic is unit-testable in isolation. The backend
 * also returns totals, but summarizeConsent lets the UI recompute from whatever
 * rows it has (e.g. a filtered slice) without a round-trip.
 */
import { toCsv } from "./csvExport.js";

const STATUSES = ["opted_in", "opted_out", "unknown"];

/**
 * Count consent rows by status. Any value that isn't 'opted_in' or 'opted_out'
 * (including null/undefined/unknown) counts as 'unknown'.
 * @param {Array<{consent_status?: string}>} rows
 * @returns {{opted_in:number, opted_out:number, unknown:number, total:number}}
 */
export function summarizeConsent(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const out = { opted_in: 0, opted_out: 0, unknown: 0, total: 0 };
  for (const r of list) {
    const s = r && r.consent_status;
    if (s === "opted_in") out.opted_in += 1;
    else if (s === "opted_out") out.opted_out += 1;
    else out.unknown += 1;
    out.total += 1;
  }
  return out;
}

/** Human-friendly label for a consent status. */
export function consentStatusLabel(status) {
  if (status === "opted_in") return "Opted in";
  if (status === "opted_out") return "Opted out";
  return "Unknown";
}

/** Format an ISO timestamp for export/display; passes through unparseable input. */
export function formatConsentDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString();
}

const CSV_COLUMNS = [
  { key: "phone_e164", label: "Phone" },
  { key: "consent_status", label: "Consent Status", format: (v) => consentStatusLabel(v) },
  { key: "consent_source", label: "Source" },
  { key: "captured_at", label: "Captured At", format: (v) => formatConsentDate(v) },
  { key: "patient_id", label: "Patient ID" },
  { key: "notes", label: "Notes" },
];

/**
 * Build a compliance-safe CSV string of consent rows using the shared toCsv
 * helper (RFC 4180 quoting + formula-injection neutralization). Exports consent
 * metadata only — never message bodies — so it can't leak PHI.
 * @param {Array<object>} rows
 * @returns {string} CSV text
 */
export function formatConsentCsv(rows) {
  return toCsv(CSV_COLUMNS, Array.isArray(rows) ? rows : []);
}

export { STATUSES };
