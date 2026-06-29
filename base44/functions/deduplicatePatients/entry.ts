import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN GENERATED ENGINE — DO NOT EDIT BY HAND.
// Source: src/components/patient/patientDuplicateUtils.js
// Regenerate: npm run sync:dedupe-engine>>>
// Pure, deterministic utilities for duplicate patient detection.
//
// All scoring/grouping logic lives here (no React / no network) so it can be
// unit-tested and reused by every duplicate-detection surface in the app.
// Point values are calibrated so that:
//   - a single strong identifier (MRN / exact name+DOB / email) clears the bar,
//   - typos and data-entry variations are still caught,
//   - clearly different patients stay below threshold.

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

/** Soundex phonetic code (first letter + 3 digits) for matching misspellings. */
export function soundex(str) {
  if (!str) return '';
  const s = String(str).toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 0) return '';

  const codes = { BFPV: '1', CGJKQSXZ: '2', DT: '3', L: '4', MN: '5', R: '6' };
  const codeFor = (ch) => {
    for (const key in codes) if (key.includes(ch)) return codes[key];
    return '';
  };

  let result = s[0];
  let prevCode = codeFor(s[0]);
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    const code = codeFor(ch);
    if (code && code !== prevCode) result += code;
    // Standard Soundex H/W rule: H and W are transparent — they do NOT reset
    // the "previous code", so two same-coded consonants separated only by H or W
    // are treated as adjacent (coalesced into one digit). Vowels (and Y) DO
    // reset prevCode, so a same-coded consonant on the other side of a vowel is
    // emitted again. Coded consonants set prevCode to their own code.
    if (ch === 'H' || ch === 'W') {
      // leave prevCode unchanged
    } else if (code === '') {
      prevCode = ''; // vowel or Y resets
    } else {
      prevCode = code;
    }
  }
  return (result + '000').substring(0, 4);
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(str1, str2) {
  const a = String(str1 ?? '');
  const b = String(str2 ?? '');
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/** Case-insensitive similarity as a 0-100 percentage. */
export function similarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const a = String(str1).toLowerCase();
  const b = String(str2).toLowerCase();
  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 100 : ((maxLength - distance) / maxLength) * 100;
}

/** Normalize a name: fold accents, lowercase, strip punctuation, collapse whitespace. */
export function normalizeName(name) {
  return (
    String(name ?? '')
      // Fold accented letters to their base ASCII form (José -> jose) BEFORE the
      // a-z strip; otherwise diacritics are deleted (José -> "jos"), corrupting
      // exact/full-name match scoring for accented names.
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
  );
}

/** Normalize an address by removing common street-type words and unit markers. */
export function normalizeAddress(address) {
  if (!address) return '';
  return String(address)
    .toLowerCase()
    .replace(
      /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|place|pl|parkway|pkwy|way)\b/g,
      ''
    )
    .replace(/\b(apt|apartment|unit|ste|suite|#)\s*\w+/gi, '')
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep only digits. */
export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

const pad2 = (v) => String(v).padStart(2, '0');

/** Expand a 2-digit year into the past (a DOB is never in the future), mirroring
 *  the import-side normalizer so "04/15/45" → 1945. */
const pivotYear = (yy) => {
  const ref = new Date().getFullYear();
  const candidate = 2000 + Number(yy);
  return String(candidate > ref ? candidate - 100 : candidate);
};

/**
 * Parse a date of birth into { year, month, day } string components, handling
 * ISO (YYYY-MM-DD), US (MM/DD/YYYY or MM/DD/YY) and bare 8-digit formats.
 * Returns null when the value can't be confidently parsed.
 */
export function parseDob(value) {
  if (!value) return null;
  const s = String(value).trim();

  let m = s.match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})/); // YYYY-MM-DD
  if (m) return validComponents({ year: m[1], month: pad2(m[2]), day: pad2(m[3]) });

  m = s.match(/^(\d{1,2})\D(\d{1,2})\D(\d{4})/); // MM/DD/YYYY
  if (m) return validComponents({ year: m[3], month: pad2(m[1]), day: pad2(m[2]) });

  m = s.match(/^(\d{1,2})\D(\d{1,2})\D(\d{2})(?!\d)/); // MM/DD/YY
  if (m) return validComponents({ year: pivotYear(m[3]), month: pad2(m[1]), day: pad2(m[2]) });

  const digits = s.replace(/\D/g, '');
  if (digits.length === 8) {
    const first4 = parseInt(digits.substring(0, 4), 10);
    if (first4 >= 1900 && first4 <= 2100) {
      return validComponents({ year: digits.substring(0, 4), month: digits.substring(4, 6), day: digits.substring(6, 8) });
    }
    return validComponents({ year: digits.substring(4, 8), month: digits.substring(0, 2), day: digits.substring(2, 4) });
  }
  return null;
}

// Reject impossible month/day values (e.g. an 8-digit "19451304" → month 13, or a
// reversed value) so the fuzzy variation checks don't treat garbage components as
// a real date and produce spurious reversed/typo "matches". Returns the
// components when valid, else null.
function validComponents(c) {
  if (!c) return null;
  const month = parseInt(c.month, 10);
  const day = parseInt(c.day, 10);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return c;
}

// ---------------------------------------------------------------------------
// Match reason constants
// ---------------------------------------------------------------------------

export const REASON = {
  EXACT_NAME: 'Exact name match',
  FULL_NAME: 'Exact full name match',
  PHONETIC_NAME: 'Names sound alike',
  VERY_SIMILAR_NAME: 'Very similar name',
  SIMILAR_NAME: 'Similar name',
  BOTH_NAMES_SIMILAR: 'Both names similar',
  PARTIAL_NAME: 'Partial name match',
  NAME_VARIATION: 'Name variation match',
  DOB: 'DOB match',
  DOB_SWAPPED: 'DOB month/day swapped',
  DOB_YEAR_TYPO: 'DOB year typo',
  DOB_CLOSE: 'DOB very close',
  MRN: 'MRN match',
  MRN_SIMILAR: 'MRN similar',
  PHONE: 'Phone exact match',
  PHONE_LOCAL: 'Phone local match',
  PHONE_LAST4: 'Phone last-4 match',
  EMERGENCY_PHONE: 'Emergency contact phone match',
  STREET_ADDRESS: 'Street address match',
  STREET_NUMBER: 'Street number match',
  ADDRESS_EXACT: 'Address exact match',
  ADDRESS_SIMILAR: 'Address very similar',
  ADDRESS_PARTIAL: 'Address similar',
  ZIP: 'Same zip code',
  MIDDLE_NAME: 'Middle name match',
  MIDDLE_INITIAL: 'Middle initial match',
  EMAIL: 'Email match',
  CAREGIVER_EMAIL: 'Caregiver email match',
  CAREGIVER_PHONE: 'Caregiver phone match',
  PHYSICIAN_EMAIL: 'Physician email match',
};

// Reasons strong enough on their own to justify a lowered threshold.
const STRONG_IDENTIFIERS = new Set([
  REASON.EXACT_NAME,
  REASON.MRN,
  REASON.DOB,
  REASON.EMAIL,
  REASON.PHONE,
  REASON.ADDRESS_EXACT,
  REASON.STREET_ADDRESS,
]);

// ---------------------------------------------------------------------------
// Pairwise scoring
// ---------------------------------------------------------------------------

function scoreNames(p1, p2, add) {
  const firstName1 = normalizeName(p1.first_name);
  const firstName2 = normalizeName(p2.first_name);
  const lastName1 = normalizeName(p1.last_name);
  const lastName2 = normalizeName(p2.last_name);
  const name1 = `${firstName1} ${lastName1}`.trim();
  const name2 = `${firstName2} ${lastName2}`.trim();

  const exactFirst = firstName1 === firstName2 && firstName1.length >= 2;
  const exactLast = lastName1 === lastName2 && lastName1.length >= 2;

  if (exactFirst && exactLast) {
    add(60, REASON.EXACT_NAME);
    return true; // name fully resolved
  }

  const phonetic =
    soundex(p1.first_name) === soundex(p2.first_name) &&
    soundex(p1.last_name) === soundex(p2.last_name) &&
    soundex(p1.first_name) !== '' &&
    soundex(p1.last_name) !== '';

  if (name1 && name1 === name2) {
    add(45, REASON.FULL_NAME);
    return true;
  }
  if (phonetic) {
    add(40, REASON.PHONETIC_NAME);
    return true;
  }

  let matchedName = false;
  const fullSim = similarity(name1, name2);
  if (fullSim >= 90) {
    add(35, REASON.VERY_SIMILAR_NAME);
    matchedName = true;
  } else if (fullSim >= 75) {
    add(28, REASON.SIMILAR_NAME);
    matchedName = true;
  }

  const firstSim = similarity(firstName1, firstName2);
  const lastSim = similarity(lastName1, lastName2);
  if (firstSim >= 85 && lastSim >= 85) {
    add(30, REASON.BOTH_NAMES_SIMILAR);
    matchedName = true;
  } else if (firstSim === 100 || lastSim === 100) {
    add(18, REASON.PARTIAL_NAME);
    matchedName = true;
  }
  return matchedName;
}

function scoreDob(p1, p2, add) {
  const d1 = digitsOnly(p1.date_of_birth);
  const d2 = digitsOnly(p2.date_of_birth);
  if (!d1 || !d2) return;

  const a = parseDob(p1.date_of_birth);
  const b = parseDob(p2.date_of_birth);

  // Exact match on identical digits OR the same parsed Y/M/D written in
  // different formats (e.g. "1945-04-15" vs "04/15/1945" vs "04/15/45"), so a
  // format/2-digit-year difference doesn't hide a true exact-DOB match.
  const sameYmd = a && b && a.year === b.year && a.month === b.month && a.day === b.day;
  if (d1 === d2 || sameYmd) {
    add(30, REASON.DOB);
    return;
  }

  if (!a || !b) return;

  if (a.year === b.year && a.month === b.day && a.day === b.month) {
    add(22, REASON.DOB_SWAPPED);
  } else if (a.month === b.month && a.day === b.day && Math.abs(+a.year - +b.year) === 1) {
    add(18, REASON.DOB_YEAR_TYPO);
  } else if (
    a.year === b.year &&
    Math.abs(+a.month - +b.month) <= 1 &&
    Math.abs(+a.day - +b.day) <= 1
  ) {
    add(12, REASON.DOB_CLOSE);
  }
}

function scoreMrn(p1, p2, add) {
  if (!p1.medical_record_number || !p2.medical_record_number) return;
  const mrn1 = p1.medical_record_number.toString().trim();
  const mrn2 = p2.medical_record_number.toString().trim();
  if (!mrn1 || !mrn2) return;
  if (mrn1.toLowerCase() === mrn2.toLowerCase()) {
    add(30, REASON.MRN);
  } else if (similarity(mrn1, mrn2) >= 85) {
    add(22, REASON.MRN_SIMILAR);
  }
}

function scorePhone(p1, p2, add) {
  if (!p1.phone || !p2.phone) return;
  const phone1 = digitsOnly(p1.phone);
  const phone2 = digitsOnly(p2.phone);
  if (phone1.length < 10 || phone2.length < 10) return;
  if (phone1 === phone2) {
    add(20, REASON.PHONE);
  } else if (phone1.slice(-7) === phone2.slice(-7)) {
    add(15, REASON.PHONE_LOCAL);
  } else if (phone1.slice(-4) === phone2.slice(-4)) {
    add(8, REASON.PHONE_LAST4);
  }
}

function scoreAddress(p1, p2, add) {
  if (!p1.address || !p2.address) return;
  const addr1 = String(p1.address).toLowerCase().trim();
  const addr2 = String(p2.address).toLowerCase().trim();

  const streetNum1 = String(p1.address).match(/^\d+/)?.[0];
  const streetNum2 = String(p2.address).match(/^\d+/)?.[0];
  const zip1 = String(p1.address).match(/\b\d{5}\b/)?.[0];
  const zip2 = String(p2.address).match(/\b\d{5}\b/)?.[0];

  const normalized1 = normalizeAddress(p1.address);
  const normalized2 = normalizeAddress(p2.address);
  const bestSim = Math.max(similarity(addr1, addr2), similarity(normalized1, normalized2));

  if (streetNum1 && streetNum1 === streetNum2) {
    // Build a street key of "[directional] name" from the normalized address.
    // Taking token[1] blindly picked up the directional itself (so "100 N Main"
    // vs "100 N Oak" both read as street "n"); dropping the directional instead
    // over-collapses ("100 W Main" vs "100 E Main" both become "main"). Keep the
    // directional as PART of the key so same-name/different-direction streets
    // stay distinct while genuine matches still align.
    const streetKeyOf = (normalized) => {
      const tokens = normalized.split(/\s+/).filter(Boolean);
      let i = 0;
      while (i < tokens.length && /^\d+$/.test(tokens[i])) i++; // skip house number
      let dir = '';
      if (i < tokens.length && /^[nsew]$/.test(tokens[i])) { dir = tokens[i]; i++; }
      while (i < tokens.length && /^\d+$/.test(tokens[i])) i++; // skip stray numbers
      const name = tokens[i];
      if (!name) return undefined;
      return dir ? `${dir} ${name}` : name;
    };
    const streetName1 = streetKeyOf(normalized1);
    const streetName2 = streetKeyOf(normalized2);
    if (streetName1 && streetName2 && similarity(streetName1, streetName2) >= 85) {
      add(18, REASON.STREET_ADDRESS);
    } else if (streetName1 && streetName2) {
      add(12, REASON.STREET_NUMBER);
    }
  } else if (bestSim >= 90) {
    add(15, REASON.ADDRESS_EXACT);
  } else if (bestSim >= 80) {
    add(12, REASON.ADDRESS_SIMILAR);
  } else if (bestSim >= 70) {
    add(8, REASON.ADDRESS_PARTIAL);
  }

  if (zip1 && zip1 === zip2) add(6, REASON.ZIP);
}

function scoreContact(p1, p2, add) {
  // Emergency contact phone
  if (p1.emergency_contact_phone && p2.emergency_contact_phone) {
    const e1 = digitsOnly(p1.emergency_contact_phone);
    const e2 = digitsOnly(p2.emergency_contact_phone);
    if (e1 === e2 && e1.length >= 10) add(12, REASON.EMERGENCY_PHONE);
  }
  // Middle name
  if (p1.middle_name && p2.middle_name) {
    const m1 = String(p1.middle_name).toLowerCase().trim();
    const m2 = String(p2.middle_name).toLowerCase().trim();
    if (m1 && m1 === m2) add(8, REASON.MIDDLE_NAME);
    else if (m1 && m2 && m1.charAt(0) === m2.charAt(0)) add(5, REASON.MIDDLE_INITIAL);
  }
  // Email
  if (p1.email && p2.email && p1.email.toLowerCase().trim() === p2.email.toLowerCase().trim()) {
    add(25, REASON.EMAIL);
  }
  // Caregiver
  if (
    p1.caregiver_email &&
    p2.caregiver_email &&
    p1.caregiver_email.toLowerCase() === p2.caregiver_email.toLowerCase()
  ) {
    add(10, REASON.CAREGIVER_EMAIL);
  }
  if (p1.caregiver_phone && p2.caregiver_phone) {
    const c1 = digitsOnly(p1.caregiver_phone);
    const c2 = digitsOnly(p2.caregiver_phone);
    if (c1 === c2 && c1.length >= 10) add(10, REASON.CAREGIVER_PHONE);
  }
  // Physician
  if (
    p1.physician_email &&
    p2.physician_email &&
    p1.physician_email.toLowerCase() === p2.physician_email.toLowerCase()
  ) {
    add(8, REASON.PHYSICIAN_EMAIL);
  }
}

/**
 * Which signal groups participate in scoring. All enabled by default so the
 * standard scan behaves identically; callers (e.g. the configurable scanner)
 * can disable groups to restrict matching.
 */
export const DEFAULT_SIGNALS = {
  name: true,
  dob: true,
  mrn: true,
  phone: true,
  address: true,
  // email / middle name / emergency / caregiver / physician
  contact: true,
};

/**
 * Score how likely two patient records are the same person.
 * Returns { score, matches } where `matches` is a de-duplicated list of reasons.
 * Symmetric: scorePatientPair(a, b) === scorePatientPair(b, a).
 *
 * @param {object} p1
 * @param {object} p2
 * @param {{ signals?: Partial<typeof DEFAULT_SIGNALS> }} [options]
 */
export function scorePatientPair(p1, p2, options = {}) {
  const signals = { ...DEFAULT_SIGNALS, ...(options.signals || {}) };
  let score = 0;
  const matches = [];
  const add = (points, reason) => {
    if (matches.includes(reason)) return;
    score += points;
    matches.push(reason);
  };

  const nameMatched = signals.name ? scoreNames(p1, p2, add) : false;
  if (signals.dob) scoreDob(p1, p2, add);
  if (signals.mrn) scoreMrn(p1, p2, add);
  if (signals.phone) scorePhone(p1, p2, add);
  if (signals.address) scoreAddress(p1, p2, add);
  if (signals.contact) scoreContact(p1, p2, add);

  // Name-variation cross-check only when no other name signal fired, so we
  // never double-count the name.
  if (signals.name && !nameMatched) {
    const variations = (p) => {
      const set = new Set();
      const first = normalizeName(p.first_name);
      const middle = normalizeName(p.middle_name);
      const last = normalizeName(p.last_name);
      if (first && last) {
        set.add(`${first} ${last}`);
        if (middle) {
          set.add(`${first} ${middle} ${last}`);
          set.add(`${first} ${middle.charAt(0)} ${last}`);
        }
        set.add(`${first.charAt(0)} ${last}`);
        set.add(`${last} ${first}`);
      }
      return [...set];
    };
    const v1 = variations(p1);
    const v2 = variations(p2);
    let found = false;
    for (const a of v1) {
      for (const b of v2) {
        if (similarity(a, b) >= 95) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) add(8, REASON.NAME_VARIATION);
  }

  return { score, matches };
}

// ---------------------------------------------------------------------------
// Related-entity (visit) corroboration
// ---------------------------------------------------------------------------

/** Build a Map of patient_id -> visits[] once, for O(1) lookups during a scan. */
export function buildVisitsByPatient(visits = []) {
  const map = new Map();
  for (const v of visits) {
    if (!v || !v.patient_id) continue;
    if (!map.has(v.patient_id)) map.set(v.patient_id, []);
    map.get(v.patient_id).push(v);
  }
  return map;
}

/** Extra score from shared visit history between two patients. */
export function relatedEntityScore(p1, p2, visitsByPatient) {
  const matches = [];
  let score = 0;
  if (!visitsByPatient) return { score, matches };

  const v1 = visitsByPatient.get(p1.id) || [];
  const v2 = visitsByPatient.get(p2.id) || [];
  if (v1.length === 0 || v2.length === 0) return { score, matches };

  const dates2 = new Set(v2.map((v) => v.visit_date).filter(Boolean));
  const commonDates = [...new Set(v1.map((v) => v.visit_date).filter(Boolean))].filter((d) =>
    dates2.has(d)
  );
  if (commonDates.length > 0) {
    score += 15;
    matches.push(`${commonDates.length} matching visit date(s)`);
  }

  const nurses2 = new Set(v2.map((v) => v.created_by).filter(Boolean));
  if (v1.some((v) => v.created_by && nurses2.has(v.created_by))) {
    score += 8;
    matches.push('Same nurse documentation');
  }

  return { score, matches };
}

// ---------------------------------------------------------------------------
// Confidence + grouping
// ---------------------------------------------------------------------------

/** Bucket a raw score into a confidence level. */
export function confidenceFromScore(score) {
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

/** A display-safe confidence percentage (never exceeds 100). */
export function confidencePercent(score) {
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** The score a pair must reach to be flagged, lowered for strong signals. */
export function effectiveThreshold(matches, base = 35) {
  return matches.some((m) => STRONG_IDENTIFIERS.has(m)) ? 25 : base;
}

/**
 * Score a single (possibly unsaved) candidate patient against an existing
 * roster and return the records it most likely duplicates, strongest first.
 *
 * This powers the add-time guard: before a new patient is created we run the
 * exact same scoring engine the scanner uses, so anything the scanner would
 * later flag is caught at the point of entry instead — and the two surfaces can
 * never disagree about what counts as a duplicate.
 *
 * @param {object} candidate           the patient being entered (need not have an id)
 * @param {Array}  patients            existing patient records to compare against
 * @param {{
 *   threshold?: number,
 *   scoreOptions?: object,
 *   excludeId?: string | null,        skip this id (e.g. the record being edited)
 *   limit?: number,                   cap the number of matches returned
 * }} [opts]
 * @returns {Array<{ patient, score, matches, confidenceLevel, confidencePercent }>}
 */
export function findDuplicatesForCandidate(candidate, patients = [], opts = {}) {
  const { threshold = 35, scoreOptions = undefined, excludeId = null, limit = 10 } = opts;
  if (!candidate) return [];

  const matchesOut = [];
  for (const other of patients) {
    if (!other) continue;
    if (excludeId != null && other.id === excludeId) continue;

    const { score, matches } = scorePatientPair(candidate, other, scoreOptions);
    if (matches.length === 0) continue;
    const cutoff = effectiveThreshold(matches, threshold);
    if (score >= cutoff) {
      matchesOut.push({
        patient: other,
        score,
        matches,
        confidenceLevel: confidenceFromScore(score),
        confidencePercent: confidencePercent(score),
      });
    }
  }

  matchesOut.sort((a, b) => b.score - a.score);
  return limit != null ? matchesOut.slice(0, limit) : matchesOut;
}

/**
 * Group patients into duplicate clusters.
 *
 * Clustering is TRANSITIVE: records are linked by a union-find pass over every
 * qualifying pair, so a chain like A↔B and B↔C lands A, B and C in one group
 * even when A and C don't directly score above threshold. The previous greedy
 * pass claimed each match under the first record that matched it and never
 * revisited it, so those bridged duplicates were silently dropped — a common
 * source of "the scanner missed obvious duplicates" in real, messy data.
 *
 * Deterministic for a given input order: the lowest-indexed record in each
 * cluster is its `primary`, every other record is reported once with the score
 * of its strongest link to another cluster member, and groups come out in
 * primary-index order. Each patient belongs to at most one group.
 *
 * @param {Array} patients
 * @param {{
 *   visitsByPatient?: Map,
 *   threshold?: number,
 *   minScore?: number | null,
 *   scoreOptions?: object,
 * }} [opts]
 *   - `minScore`, when provided, is a hard floor that overrides the adaptive
 *     threshold (used by destructive scans that should only act on high
 *     confidence matches).
 *   - `scoreOptions` is forwarded to `scorePatientPair` (e.g. `{ signals }`).
 * @returns {Array<{ primary: object, duplicates: Array }>}
 */
export function findDuplicateGroups(patients, opts = {}) {
  const { visitsByPatient = null, threshold = 35, minScore = null, scoreOptions = undefined } = opts;
  const n = patients.length;

  // Union-Find. Always attach the higher root to the lower one so each cluster's
  // root is its lowest original index — that index is the deterministic primary.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const next = parent[x]; parent[x] = r; x = next; } // path compression
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // Sparse adjacency of only the pairs that cleared the cutoff (real candidate
  // duplicates are rare relative to n², so this stays small).
  const links = new Map(); // index -> [{ idx, score, matches }]
  const addLink = (i, j, score, matches) => {
    if (!links.has(i)) links.set(i, []);
    if (!links.has(j)) links.set(j, []);
    links.get(i).push({ idx: j, score, matches });
    links.get(j).push({ idx: i, score, matches });
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const base = scorePatientPair(patients[i], patients[j], scoreOptions);
      const related = relatedEntityScore(patients[i], patients[j], visitsByPatient);
      const totalScore = base.score + related.score;
      const cutoff = minScore != null ? minScore : effectiveThreshold(base.matches, threshold);

      if (totalScore >= cutoff) {
        addLink(i, j, totalScore, [...base.matches, ...related.matches]);
        union(i, j);
      }
    }
  }

  // Collect cluster members by root. Iterating i ascending means each root (the
  // cluster's min index) is first seen at i === root, so clusters land in
  // primary-index order without a follow-up sort.
  const clusters = new Map(); // root -> [indices]
  for (let i = 0; i < n; i++) {
    if (!links.has(i)) continue; // record matched nothing — not part of any group
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(i);
  }

  const groups = [];
  for (const indices of clusters.values()) {
    if (indices.length < 2) continue;
    const memberSet = new Set(indices);
    const primaryIdx = indices[0]; // ascending insertion => lowest index first

    const duplicates = [];
    for (const idx of indices) {
      if (idx === primaryIdx) continue;
      // Report this record with its strongest link to any other cluster member,
      // so a record bridged in via a third party still shows a meaningful score.
      let best = null;
      for (const link of links.get(idx)) {
        if (!memberSet.has(link.idx)) continue;
        if (!best || link.score > best.score) best = link;
      }
      duplicates.push({
        patient: patients[idx],
        score: best.score,
        matches: best.matches,
        confidenceLevel: confidenceFromScore(best.score),
        confidencePercent: confidencePercent(best.score),
      });
    }

    duplicates.sort((a, b) => b.score - a.score);
    groups.push({ primary: patients[primaryIdx], duplicates });
  }

  return groups;
}
// <<<END GENERATED ENGINE>>>

// This admin-only operation DELETES records, so it only acts on HIGH-confidence
// duplicates (shared score >= 70). A name match alone scores 60, so it never
// qualifies on its own — corroboration (DOB / phone / email / address / ...) is
// required. Exact Medical Record Number matches are treated as definitive and
// handled separately.
//
// Candidate generation is intentionally bucketed by exact MRN and exact
// normalized name (rather than an O(n^2) cross-scan) to stay within the edge
// function timeout. The interactive UI performs the full fuzzy/phonetic scan.
const BACKEND_MIN_SCORE = 70;

// Completeness score for survivor selection: when a duplicate group is merged,
// keep the MORE COMPLETE record rather than just the newest, so a sparse stub
// can't win over a rich chart and lose identifiers/clinical data. Strong
// identifiers (MRN, DOB) are weighted because losing those is the worst outcome.
function isPopulated(v) {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return String(v).trim() !== '';
}
function completenessScore(p) {
  if (!p) return 0;
  let score = 0;
  if (isPopulated(p.medical_record_number)) score += 3;
  if (isPopulated(p.date_of_birth)) score += 2;
  const fields = [
    p.first_name, p.last_name, p.middle_name, p.address, p.phone, p.email,
    p.payor, p.emergency_contact_name, p.emergency_contact_phone,
    p.physician_name, p.physician_phone, p.caregiver_name, p.caregiver_email,
    p.primary_diagnosis, p.secondary_diagnoses, p.allergies, p.current_medications,
    p.insurance_primary, p.insurance_secondary, p.admission_date, p.care_type,
    p.advance_directives, p.functional_status, p.assigned_nurses,
    p.enhanced_notes_history, p.clinical_notes, p.goals_of_care,
  ];
  for (const f of fields) if (isPopulated(f)) score += 1;
  return score;
}

Deno.serve(async (req) => {
  const startTime = Date.now();

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    // DRY-RUN BY DEFAULT. The merge is destructive, so callers must explicitly
    // pass { confirm: true } to apply it; any other invocation only PREVIEWS the
    // groups that would be merged (no DB changes). The function may be invoked
    // with no body, so parse defensively.
    const body = await req.json().catch(() => ({}));
    const confirm = body?.confirm === true;

    console.log(`Starting deduplication (${confirm ? 'APPLY' : 'dry-run preview'})...`);

    // Bounded to the SDK's 5000/request max; omitting a limit silently caps at
    // the SDK default of 50. Re-run the scan if more patients remain.
    const patients = await base44.asServiceRole.entities.Patient.list('-created_date', 5000);
    console.log(`Loaded ${patients.length} patients in ${Date.now() - startTime}ms`);

    // Quick candidate bucketing by exact MRN and exact normalized name.
    const mrnGroups = new Map();
    const nameGroups = new Map();

    patients.forEach((patient) => {
      if (patient.medical_record_number) {
        const mrn = patient.medical_record_number.toString().trim().toUpperCase();
        if (mrn) {
          if (!mrnGroups.has(mrn)) mrnGroups.set(mrn, []);
          mrnGroups.get(mrn).push(patient);
        }
      }

      const nameKey = `${normalizeName(patient.first_name)}|${normalizeName(patient.last_name)}`;
      if (nameKey !== '|') {
        if (!nameGroups.has(nameKey)) nameGroups.set(nameKey, []);
        nameGroups.get(nameKey).push(patient);
      }
    });

    console.log(`Grouped into ${mrnGroups.size} MRN groups, ${nameGroups.size} name groups`);

    const duplicateGroups = [];
    const processed = new Set();

    // Phase 1: exact MRN matches are definitive (100% confidence).
    for (const [, group] of mrnGroups) {
      const unprocessed = group.filter((p) => !processed.has(p.id));
      if (unprocessed.length > 1) {
        duplicateGroups.push({
          primary: unprocessed[0],
          duplicates: unprocessed.slice(1).map((p) => ({
            patient: p,
            score: 100,
            matches: [REASON.MRN],
            confidenceLevel: 'high',
            confidencePercent: 100,
          })),
        });
        unprocessed.forEach((p) => processed.add(p.id));
      }
    }

    // Phase 2: same-name buckets scored with the shared engine, high confidence
    // only, so two genuinely different people who share a name are not removed.
    let groupsProcessed = 0;
    for (const [, group] of nameGroups) {
      const unprocessed = group.filter((p) => !processed.has(p.id));
      if (unprocessed.length > 1) {
        const found = findDuplicateGroups(unprocessed, { minScore: BACKEND_MIN_SCORE });
        for (const g of found) {
          duplicateGroups.push(g);
          processed.add(g.primary.id);
          g.duplicates.forEach((d) => processed.add(d.patient.id));
        }
        groupsProcessed++;
      }

      // Check timeout every 20 groups
      if (groupsProcessed % 20 === 0 && Date.now() - startTime > 20000) {
        console.log('Approaching timeout, stopping search');
        break;
      }
    }

    console.log(`Found ${duplicateGroups.length} groups in ${Date.now() - startTime}ms`);

    // Remove duplicates with timeout protection
    const removed = [];
    const detailsArray = [];

    const batchSize = 5;
    for (let i = 0; i < duplicateGroups.length; i += batchSize) {
      if (Date.now() - startTime > 25000) {
        console.log('Timeout protection - stopping removal');
        break;
      }

      const batch = duplicateGroups.slice(i, i + batchSize);

      for (const group of batch) {
        // Choose the survivor: active first, then the MOST COMPLETE record, then
        // newest as a tiebreak. (Previously this kept the newest active record,
        // so a sparse just-created stub could survive over an older rich chart
        // and silently lose its identifiers/clinical data.)
        const allInGroup = [group.primary, ...group.duplicates.map((d) => d.patient)];
        allInGroup.sort((a, b) => {
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (a.status !== 'active' && b.status === 'active') return 1;
          const ca = completenessScore(a);
          const cb = completenessScore(b);
          if (cb !== ca) return cb - ca; // keep the more complete record
          const dateA = a.created_date ? new Date(a.created_date).getTime() : 0;
          const dateB = b.created_date ? new Date(b.created_date).getTime() : 0;
          return dateB - dateA;
        });

        const keep = allInGroup[0];
        const toRemove = allInGroup.slice(1);

        const removedFromGroup = [];
        for (const patient of toRemove) {
          const entry = {
            id: patient.id,
            name: `${patient.first_name} ${patient.last_name}`,
            mrn: patient.medical_record_number || 'N/A',
            match_score: group.duplicates.find((d) => d.patient.id === patient.id)?.score || 100,
          };

          if (!confirm) {
            // Dry-run preview: report what WOULD be merged; change nothing.
            removedFromGroup.push(entry);
            continue;
          }

          // SOFT-delete (archive) — NOT an irreversible hard cascade-delete. The
          // duplicate is marked merged/archived and pointed at the survivor; the
          // main patient list filters is_archived, so it disappears from view
          // while its record and clinical history (visits, care plans, alerts,
          // incidents, tasks) are preserved and fully recoverable (clear
          // is_archived/status to restore). The previous Patient.delete() also
          // cascade-deleted all of that with no recovery.
          try {
            await base44.asServiceRole.entities.Patient.update(patient.id, {
              status: 'merged',
              is_archived: true,
              merged_into_id: keep.id,
              merged_at: new Date().toISOString(),
              merged_by: user.email,
            });
            removedFromGroup.push(entry);
          } catch (err) {
            console.error(`Failed to archive ${patient.id}:`, err.message);
          }
        }

        removed.push(...removedFromGroup);
        detailsArray.push({
          kept: {
            id: keep.id,
            name: `${keep.first_name} ${keep.last_name}`,
            mrn: keep.medical_record_number || 'N/A',
            status: keep.status,
          },
          removed: removedFromGroup,
        });
      }
    }

    // Persist an audit trail of an APPLIED merge (skip for dry-run previews,
    // which change nothing). Records kept/removed IDs + MRNs (identifiers, not
    // full PHI bodies) so a wrongful merge can be traced and recovered.
    if (confirm && removed.length > 0) {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: 'patients_deduplicated',
        entity_type: 'Patient',
        details: {
          removed_count: removed.length,
          groups: detailsArray.map((d) => ({
            kept_id: d.kept.id,
            kept_mrn: d.kept.mrn,
            removed: d.removed.map((r) => ({ id: r.id, mrn: r.mrn, match_score: r.match_score })),
          })),
          timestamp: new Date().toISOString(),
        },
        status: 'success',
      }).catch((err) => console.error('Failed to write dedup audit:', err));
    }

    // Calculate confidence levels for results
    const resultsWithConfidence = detailsArray.map((detail) => {
      const avgScore = detail.removed.length > 0
        ? detail.removed.reduce((sum, r) => sum + r.match_score, 0) / detail.removed.length
        : 100;

      let confidence = 'High';
      if (avgScore < 70) confidence = 'Medium';
      if (avgScore < 50) confidence = 'Low';

      return {
        ...detail,
        confidence,
        average_match_score: Math.round(avgScore),
      };
    });

    return Response.json({
      success: true,
      dry_run: !confirm,
      // In dry-run these are the groups/records that WOULD be merged; with
      // confirm:true they are the records actually archived (merged).
      duplicate_groups_found: duplicateGroups.length,
      patients_removed: confirm ? removed.length : 0,
      patients_to_remove: confirm ? 0 : removed.length,
      removed_patients: removed,
      details: resultsWithConfidence,
    });
  } catch (error) {
    console.error('Deduplication error:', error);
    // Generic message — don't leak internals to the client.
    return Response.json({
      error: 'Deduplication failed',
      details: 'Check function logs for more information',
    }, { status: 500 });
  }
});