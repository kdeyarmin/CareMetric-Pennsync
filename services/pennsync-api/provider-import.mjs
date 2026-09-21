// Ported from base44/functions/importProvidersCsv.
//
// The split is the one D58 used: text shaping here, every record decision in
// the contract. `parseCSV`, `normalizeHeader`, `cleanValue`, `cleanPhone`,
// `titleCase` and `formatProviderName` are the original's named functions and
// are reproduced term for term — the test imports the originals and compares,
// so a change upstream fails the build rather than drifting.
//
// **The `file_url` half is refused BY NAME, and that is the partial-port shape
// D31 set.** The original accepts either `csv_text` or a legacy `file_url` it
// downloads through `isSafeFetchUrl`, whose allowlist is
// `FILE_URL_ALLOWED_HOSTS` — `qtrypzzcjebvfcihiynt.supabase.co`, `base44.app`
// and `base44.io`. Porting that branch would carry Base44's own storage host
// into the service, which is exactly what D56 says the file-bound capabilities
// are waiting on: a data migration and a `file_url` → `cmfile:` compatibility
// layer, not a path to write. The original's own comment says the other branch
// needs none of it — *"A provider directory CSV needs no storage upload or AI
// integration"* — and that branch is what `src/components/physician/
// ProviderCsvImport.jsx` actually calls.
import { fail } from './contracts.mjs';

/** The original's 10 MB bound, measured the way it measures it. */
export const MAX_CSV_BYTES = 10 * 1024 * 1024;

export const normalizeHeader = value => String(value || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const cleanValue = value => String(value || '').replace(/﻿/g, '').trim();
export const cleanPhone = value => cleanValue(value).replace(/[^0-9]/g, '');

/** The original's parser, character for character, quotes and CRLF included. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(value);
      if (row.some(cell => String(cell || '').trim() !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some(cell => String(cell || '').trim() !== '')) rows.push(row);
  return rows;
}

export function titleCase(text) {
  return cleanValue(text).toLowerCase().split(/\s+/).filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

/**
 * The original's name formatter, including the fix its own comment records:
 * every segment after the first comma is the given-name portion, so
 * "Smith, John, MD" is "John MD Smith" rather than losing the third part.
 */
export function formatProviderName(rawName) {
  const name = cleanValue(rawName);
  if (!name) return '';
  if (name.includes(',')) {
    const parts = name.split(',');
    const last = parts[0];
    const first = parts.slice(1).join(' ');
    return `${titleCase(first)} ${titleCase(last)}`.replace(/\s+/g, ' ').trim();
  }
  return titleCase(name);
}

/** The columns the original reads, by their normalized header. */
export const PROVIDER_COLUMNS = Object.freeze({
  full_name: 'physician_name', credentials: 'title', fax_number: 'fax_number',
  // The phone is the WORK number and the fax is its own column; they are not
  // the same field with two names.
  phone_number: 'work_number',
  npi_number: 'npi', specialty: 'specialty', practice_name: 'primary_organization_name',
  company: 'company', top_unit: 'top_unit', parent_unit: 'parent_unit',
  sub_unit: 'sub_unit', state_license: 'state_license',
});

/**
 * The parsed CSV as the rows the contract writes, plus the count it skipped.
 *
 * A row with no name or no fax is skipped exactly where the original skips it,
 * and counted, because the answer reports it.
 */
export function shapeProviderRows(text) {
  const parsed = parseCSV(text);
  // The original's own 400: "CSV file is empty" for anything without a header
  // row and at least one data row.
  if (parsed.length < 2) fail(400, 'CSV_EMPTY');
  const headers = parsed[0].map(normalizeHeader);
  const cell = (row, name) => {
    const index = headers.indexOf(name);
    return index === -1 ? '' : cleanValue(row[index]);
  };
  const rows = [];
  let skipped = 0;
  for (const row of parsed.slice(1)) {
    const full_name = formatProviderName(cell(row, PROVIDER_COLUMNS.full_name));
    const fax_number = cleanPhone(cell(row, PROVIDER_COLUMNS.fax_number));
    if (!full_name || !fax_number) { skipped += 1; continue; }
    rows.push({
      full_name,
      credentials: cell(row, PROVIDER_COLUMNS.credentials),
      // `provider_type` is the credentials again in the original; the contract
      // writes both from this one field rather than trusting a second copy.
      specialty: cell(row, PROVIDER_COLUMNS.specialty),
      practice_name: cell(row, PROVIDER_COLUMNS.practice_name),
      company: cell(row, PROVIDER_COLUMNS.company),
      top_unit: cell(row, PROVIDER_COLUMNS.top_unit),
      parent_unit: cell(row, PROVIDER_COLUMNS.parent_unit),
      sub_unit: cell(row, PROVIDER_COLUMNS.sub_unit),
      phone_number: cleanPhone(cell(row, PROVIDER_COLUMNS.phone_number)),
      fax_number,
      npi_number: cleanValue(cell(row, PROVIDER_COLUMNS.npi_number)),
      state_license: cell(row, PROVIDER_COLUMNS.state_license),
    });
  }
  return { rows, skipped };
}

export async function importProviders({ params, contract }) {
  const direct = Object.hasOwn(params, 'csv_text');
  const legacy = Object.hasOwn(params, 'file_url');
  // The original's own refusal, in its own words: exactly one source.
  if (direct === legacy) fail(400, 'CSV_SOURCE_AMBIGUOUS');
  if (legacy) fail(400, 'CSV_FILE_URL_UNSUPPORTED');
  if (typeof params.csv_text !== 'string' || params.csv_text.trim() === '') {
    fail(400, 'CSV_TEXT_REQUIRED');
  }
  if (params.csv_text.length > MAX_CSV_BYTES
    || new TextEncoder().encode(params.csv_text).byteLength > MAX_CSV_BYTES) {
    fail(413, 'CSV_TOO_LARGE');
  }
  const { rows, skipped } = shapeProviderRows(params.csv_text);
  const stored = await contract('importProvidersCsv', { rows });
  return {
    success: true,
    created_providers: stored.created_providers,
    updated_providers: stored.updated_providers,
    skipped_rows: skipped,
  };
}
