import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>
// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>


// <<<BEGIN GENERATED ENGINE — DO NOT EDIT BY HAND.
// Source: src/components/patient/patientDuplicateUtils.js
// Regenerate: npm run sync:dedupe-engine>>>
// Pure, deterministic utilities for duplicate patient detection.
//
// SINGLE SOURCE OF TRUTH for the whole app. The scoring/grouping logic (no React,
// no network) lives here so it can be unit-tested with the plain node test runner
// and reused by every duplicate-detection surface. A thin `patientDuplicateUtils.jsx`
// re-exports this module so bare-path importers resolve to the exact same engine
// (no more `.js`/`.jsx` shadowing or drift).
//
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
      .replace(/[\u0300-\u036f]/g, '')
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
  POSSIBLE_TWINS: 'Possible twins — verify before merging',
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

  // Soundex is deliberately coarse and collides clearly-different surnames
  // (e.g. "Snyder" and "Smithers" both encode to S536). A phonetic code match
  // alone therefore is NOT proof two people are the same — require the actual
  // name strings to also be reasonably similar before trusting it, so spelling
  // collisions can't bridge unrelated patients.
  const phonetic =
    soundex(p1.first_name) === soundex(p2.first_name) &&
    soundex(p1.last_name) === soundex(p2.last_name) &&
    soundex(p1.first_name) !== '' &&
    soundex(p1.last_name) !== '' &&
    similarity(firstName1, firstName2) >= 70 &&
    similarity(lastName1, lastName2) >= 70;

  if (name1 && name1 === name2) {
    add(45, REASON.FULL_NAME);
    return true;
  }
  if (phonetic) {
    add(40, REASON.PHONETIC_NAME);
    return true;
  }

  const firstSim = similarity(firstName1, firstName2);
  const lastSim = similarity(lastName1, lastName2);

  // Fuzzy full-name match, but ONLY when the LAST names are themselves similar.
  // Comparing the concatenated "first last" string alone let a shared first name
  // + a prefix-overlapping surname clear the bar (e.g. "John Smith" vs
  // "John Smithers" scored 77%), bridging unrelated patients. Requiring the
  // surname to actually match stops that — different families never tie.
  let matchedName = false;
  const fullSim = similarity(name1, name2);
  if (fullSim >= 90 && lastSim >= 80) {
    add(35, REASON.VERY_SIMILAR_NAME);
    matchedName = true;
  } else if (fullSim >= 75 && lastSim >= 80) {
    add(28, REASON.SIMILAR_NAME);
    matchedName = true;
  }

  if (firstSim >= 85 && lastSim >= 85) {
    add(30, REASON.BOTH_NAMES_SIMILAR);
    matchedName = true;
  } else if (lastSim === 100 && firstSim >= 60) {
    // Same last name AND a clearly-related first name (nickname/typo, e.g.
    // "Bob"/"Robert" won't pass but "Jon"/"John" will). A shared FIRST name with
    // a different last name is NOT a person match — that was flagging every
    // "John <X>" as the same patient and letting union-find bridge unrelated
    // people (e.g. "John Snyder" into a cluster of "John Smithers").
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

// Build a street key of "[directional] name" from a normalized address.
// Taking token[1] blindly picked up the directional itself (so "100 N Main"
// vs "100 N Oak" both read as street "n"); dropping the directional instead
// over-collapses ("100 W Main" vs "100 E Main" both become "main"). Keep the
// directional as PART of the key so same-name/different-direction streets stay
// distinct while genuine matches still align. Shared with oasis/patientMatchScore.
export function streetKeyOf(normalized) {
  const tokens = normalized.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^\d+$/.test(tokens[i])) i++; // skip house number
  let dir = '';
  if (i < tokens.length && /^[nsew]$/.test(tokens[i])) { dir = tokens[i]; i++; }
  while (i < tokens.length && /^\d+$/.test(tokens[i])) i++; // skip stray numbers
  const name = tokens[i];
  if (!name) return undefined;
  return dir ? `${dir} ${name}` : name;
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
    // Street key ("[directional] name") keeps same-name/different-direction
    // streets distinct — see the module-level streetKeyOf above.
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

  // ---- Identity guard ----------------------------------------------------
  // Two records are the same PERSON only when a real NAME tie is present. A pile
  // of shared circumstantial data (same address, area code, zip, caregiver) must
  // never bridge two people with different names — that was pulling unrelated
  // patients (e.g. "John Snyder" into a "John Smithers" cluster) together.
  const NAME_TIE = new Set([
    REASON.EXACT_NAME,
    REASON.FULL_NAME,
    REASON.PHONETIC_NAME,
    REASON.VERY_SIMILAR_NAME,
    REASON.SIMILAR_NAME,
    REASON.BOTH_NAMES_SIMILAR,
    REASON.PARTIAL_NAME,
    REASON.NAME_VARIATION,
  ]);
  if (!matches.some((m) => NAME_TIE.has(m))) {
    return { score: 0, matches: [] };
  }

  // Hard blockers: even with a matching name, two DIFFERENT people are not a
  // duplicate. When BOTH records carry a DOB (or both an MRN) and they clearly
  // differ — not a swap/typo we already credited — they are distinct patients.
  const hasDobCredit = matches.some(
    (m) =>
      m === REASON.DOB ||
      m === REASON.DOB_SWAPPED ||
      m === REASON.DOB_YEAR_TYPO ||
      m === REASON.DOB_CLOSE
  );
  const dob1 = parseDob(p1.date_of_birth);
  const dob2 = parseDob(p2.date_of_birth);
  if (!hasDobCredit && dob1 && dob2) {
    // Both DOBs present, parseable, and not credited as same/swap/typo → mismatch.
    return { score: 0, matches: [] };
  }

  const hasMrnCredit = matches.some((m) => m === REASON.MRN || m === REASON.MRN_SIMILAR);
  const mrn1 = String(p1.medical_record_number ?? '').trim();
  const mrn2 = String(p2.medical_record_number ?? '').trim();
  if (!hasMrnCredit && mrn1 && mrn2) {
    // Both MRNs present and neither exact nor similar → different patients.
    return { score: 0, matches: [] };
  }

  // ---- Corroboration requirement -----------------------------------------
  // A NAME match alone is never enough to declare two records the same person —
  // common names ("John Smithers", "John Snyder") collide constantly, and the
  // data is full of bare-name stub records with null DOB/MRN/phone/address. To
  // call a pair a duplicate we require at least ONE corroborating identifier
  // beyond the name: a credited DOB, MRN, phone, address, email, or
  // caregiver/physician/emergency tie. Without that, two same-named records with
  // no shared real-world identifier are treated as DIFFERENT people. This is
  // what stops null-stub bridging (the Smithers/Snyder clusters).
  const CORROBORATING = new Set([
    REASON.DOB, REASON.DOB_SWAPPED, REASON.DOB_YEAR_TYPO, REASON.DOB_CLOSE,
    REASON.MRN, REASON.MRN_SIMILAR,
    REASON.PHONE, REASON.PHONE_LOCAL,
    REASON.EMERGENCY_PHONE,
    REASON.STREET_ADDRESS, REASON.ADDRESS_EXACT, REASON.ADDRESS_SIMILAR,
    REASON.EMAIL, REASON.CAREGIVER_EMAIL, REASON.CAREGIVER_PHONE, REASON.PHYSICIAN_EMAIL,
    REASON.MIDDLE_NAME,
  ]);
  if (!matches.some((m) => CORROBORATING.has(m))) {
    return { score: 0, matches: [] };
  }

  // ---- Twins flag ---------------------------------------------------------
  // Twins share last name, DOB, address, and phone — everything EXCEPT the
  // first name — and were scoring ~100 with no warning ("Ella"/"Emma Smith",
  // same DOB+address+phone → one click from a wrong-patient merge). When both
  // first names are well-formed and clearly different (similarity < 85 with no
  // containment, so "Jon"/"John" and "Katherine"/"Catherine" stay unflagged)
  // while last name + DOB agree, flag the pair for human verification. The
  // score is kept (hiding the pair would remove it from review entirely).
  const twinFirst1 = normalizeName(p1.first_name);
  const twinFirst2 = normalizeName(p2.first_name);
  const possibleTwins =
    hasDobCredit &&
    twinFirst1.length >= 3 && twinFirst2.length >= 3 &&
    twinFirst1 !== twinFirst2 &&
    !twinFirst1.includes(twinFirst2) && !twinFirst2.includes(twinFirst1) &&
    similarity(twinFirst1, twinFirst2) < 85 &&
    // A single-edit variant that KEEPS the first letter is a typo/short
    // nickname ("Jon"/"John"), not a sibling; a leading-letter substitution
    // ("Jason"/"Mason") is exactly the twin-name pattern and stays flagged.
    !(levenshtein(twinFirst1, twinFirst2) <= 1 && twinFirst1[0] === twinFirst2[0]) &&
    similarity(normalizeName(p1.last_name), normalizeName(p2.last_name)) >= 95;
  if (possibleTwins) matches.push(REASON.POSSIBLE_TWINS);

  return { score, matches, ...(possibleTwins ? { possibleTwins: true } : {}) };
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
      // Shared-visit corroboration only BOOSTS a pair that already has a real
      // identity match (name + non-conflicting DOB/MRN). When the pair was
      // rejected by the identity guard (base.matches empty), it must stay
      // unlinked — two different people who happen to share a visit date or
      // nurse are NOT the same patient. This was bridging unrelated records
      // (e.g. "John Snyder" into a "John Smithers" cluster).
      if (base.matches.length === 0) continue;
      const related = relatedEntityScore(patients[i], patients[j], visitsByPatient);
      const totalScore = base.score + related.score;
      const cutoff = minScore != null ? minScore : effectiveThreshold(base.matches, threshold);

      if (totalScore >= cutoff) {
        const allMatches = [...base.matches, ...related.matches];
        addLink(i, j, totalScore, allMatches);
        // Only merge clusters transitively on a STRONG link — one backed by a
        // hard identifier (DOB / MRN / phone / address / email). A pair that
        // qualifies only via softer ties is still reported as a direct pair, but
        // must NOT bridge other records into its cluster. This stops a chain of
        // weak links from daisy-chaining unrelated people (Ritchey↔Langham via a
        // shared phone-area, Smithers↔Snyder via name stubs) into one group.
        const STRONG_LINK = new Set([
          REASON.DOB, REASON.DOB_SWAPPED, REASON.DOB_YEAR_TYPO,
          REASON.MRN, REASON.MRN_SIMILAR,
          REASON.PHONE,
          REASON.ADDRESS_EXACT, REASON.STREET_ADDRESS,
          REASON.EMAIL,
        ]);
        if (base.matches.some((m) => STRONG_LINK.has(m))) {
          union(i, j);
        }
      }
    }
  }

  // Build groups as connected components, but treat weak (non-union) links as
  // STRICTLY PAIRWISE so they can never bridge a third record into a cluster.
  //
  // Strong links share a union-find root → those members cluster together. For
  // each strong cluster we also attach any record weak-linked DIRECTLY to a
  // member (and only that record, not its onward links). A weak link between two
  // records that are each in no strong cluster forms its own 2-record group.
  const memberOf = new Array(n).fill(-1); // index -> group id (once assigned)
  const groups = [];

  // First pass: strong clusters (>= 2 members sharing a union-find root).
  const strongClusters = new Map(); // root -> [indices]
  for (let i = 0; i < n; i++) {
    if (!links.has(i)) continue;
    const root = find(i);
    if (!strongClusters.has(root)) strongClusters.set(root, []);
    strongClusters.get(root).push(i);
  }

  const makeDuplicate = (idx, memberSet) => {
    let best = null;
    for (const link of links.get(idx)) {
      if (!memberSet.has(link.idx)) continue;
      if (!best || link.score > best.score) best = link;
    }
    return {
      patient: patients[idx],
      score: best.score,
      matches: best.matches,
      confidenceLevel: confidenceFromScore(best.score),
      confidencePercent: confidencePercent(best.score),
    };
  };

  for (const indices of strongClusters.values()) {
    if (indices.length < 2) continue; // singleton root — no strong cluster here
    const memberSet = new Set(indices);
    const attachedWeak = new Set();
    for (const idx of indices) {
      for (const link of links.get(idx)) {
        const j = link.idx;
        if (memberSet.has(j) || memberOf[j] !== -1) continue;
        // Skip records that belong to their OWN strong cluster (>= 2 members):
        // they will be reported as members of that cluster's group, so attaching
        // them here as a weak link would emit the same patient in two groups,
        // violating the documented "at most one group" invariant.
        if ((strongClusters.get(find(j))?.length ?? 0) >= 2) continue;
        attachedWeak.add(j);
      }
    }
    const primaryIdx = indices[0];
    for (const idx of indices) memberOf[idx] = groups.length;
    for (const idx of attachedWeak) {
      memberSet.add(idx);
      memberOf[idx] = groups.length;
    }
    const duplicates = indices
      .concat([...attachedWeak].sort((a, b) => a - b))
      .filter((idx) => idx !== primaryIdx)
      .map((idx) => makeDuplicate(idx, memberSet));
    duplicates.sort((a, b) => b.score - a.score);
    groups.push({ primary: patients[primaryIdx], duplicates });
  }

  // Second pass: weak-only pairs. Any link whose endpoints are not already in a
  // strong group becomes its own pairwise group (deduped, lowest index primary).
  const seenWeakPair = new Set();
  for (let i = 0; i < n; i++) {
    if (!links.has(i) || memberOf[i] !== -1) continue;
    for (const link of links.get(i)) {
      if (memberOf[i] !== -1) break; // already placed in a weak group above
      const j = link.idx;
      if (memberOf[j] !== -1) continue; // partner already in a strong group
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = `${a}-${b}`;
      if (seenWeakPair.has(key)) continue;
      seenWeakPair.add(key);
      const memberSet = new Set([a, b]);
      groups.push({
        primary: patients[a],
        duplicates: [makeDuplicate(b, memberSet)],
      });
      memberOf[a] = memberOf[b] = groups.length - 1;
    }
  }

  return groups;
}
// <<<END GENERATED ENGINE>>>

// ---------------------------------------------------------------------------
// Patient merge broker
// ---------------------------------------------------------------------------
//
// One server-side path merges duplicate charts. It runs as the service role,
// because Patient and most of its linked clinical tables deny every client
// read and write, and it is authorized here rather than by the entity RLS:
//   * the platform tier (built-in role admin), for any agency; or
//   * an ACTIVE agency_admin or manager membership in the patients' agency,
//     rebuilt by withTrustedClaims from the service-owned AgencyMembership.
// Every patient in one merge must carry the same agency_id.
//
// Base44 has no multi-entity transaction, so the merge is ordered so that a
// retry can always finish a half-done one, and so that no step leaves a chart
// less reachable than before it ran:
//   1. the SURVIVOR is written first (its empty fields are filled; nothing it
//      already holds is overwritten);
//   2. every record that references a duplicate is re-pointed at the survivor
//      (care-team grants are CREATED on the survivor before the duplicate's
//      grant is revoked, and immutable note revisions are COPIED rather than
//      rewritten);
//   3. a duplicate is archived LAST, and only when every one of its linked
//      records moved. A failed or unfinished step leaves the duplicate active
//      and is reported, so a retry with the same ids resumes where it stopped:
//      every step is idempotent (rows already moved are no longer found under
//      the duplicate's id, grants already present are not re-created, copies
//      already made are found by their key).

// Every entity field that holds a Patient id, and what a merge does with it.
// patientMergeBrokerContract.test.js scans base44/entities and fails when a
// patient-referencing field is in none of the tables below, so a new
// patient-linked entity cannot silently strand records on an archived chart.
const PATIENT_REFERENCE_FIELDS = [
  ['AdrAuditCase', 'patient_id'], ['AgencyMessage', 'related_patient_id'],
  ['AppliedDataLog', 'patient_id'], ['AppointmentForm', 'patient_id'],
  ['Billing', 'patient_id'], ['CallLog', 'patient_id'],
  ['CareCoordinationAlert', 'patient_id'], ['CarePlan', 'patient_id'],
  ['CarePlanProposal', 'patient_id'], ['ClinicalEvent', 'patient_id'],
  ['ClinicalLibraryTemplate', 'patient_id'], ['ComplianceAudit', 'patient_id'],
  ['DigitalSignature', 'patient_id'], ['DischargeSummary', 'patient_id'],
  ['DocumentAnalysisHistory', 'patient_id'], ['DocumentPackage', 'patient_id'],
  ['DocumentRecord', 'patient_id'], ['DocumentSignature', 'patient_id'],
  ['FaceToFaceEncounter', 'patient_id'], ['FaxDraft', 'patient_id'],
  ['FaxHistory', 'patient_id'], ['FaxLog', 'patient_id'],
  ['GeneratedDocument', 'patient_id'], ['HealthRecord', 'patient_id'],
  ['Immunization', 'patient_id'], ['IncomingFax', 'suggested_patient_id'],
  ['Incident', 'patient_id'], ['InterventionLog', 'patient_id'],
  ['Invoice', 'patient_id'], ['MaterialInteraction', 'patient_id'],
  ['MedicalCode', 'patient_id'], ['Medication', 'patient_id'],
  ['MedicationReconciliation', 'patient_id'], ['Message', 'patient_id'],
  ['MicroLearningProgress', 'related_patient_id'], ['NoteConversion', 'patient_id'],
  ['NoteFeedback', 'patient_id'], ['OASISAssessment', 'patient_id'],
  ['OASISAudit', 'patient_id'], ['OASISFeedback', 'patient_id'],
  ['OASISFeedback', 'suggested_patient_id'], ['OASISFeedback', 'actual_patient_id'],
  ['OASISScenario', 'patient_id'], ['OASISUpload', 'patient_id'],
  ['OASISWorkflowExecution', 'patient_id'], ['PDFIndex', 'patient_id'],
  ['PDGMCaseMix', 'patient_id'], ['PatientAlert', 'patient_id'],
  ['PatientBillingInfo', 'patient_id'], ['PatientDocument', 'patient_id'],
  ['PatientEducationAssignment', 'patient_id'], ['PatientEducationDelivery', 'patient_id'],
  ['PatientEducationDraft', 'patient_id'], ['PatientEducationEngagement', 'patient_id'],
  ['PatientEducationMaterial', 'target_patient_id'], ['PatientMessage', 'patient_id'],
  ['PatientOutcome', 'patient_id'], ['PatientPathwayAssignment', 'patient_id'],
  ['PatientRecommendation', 'patient_id'], ['PatientRiskAssessment', 'patient_id'],
  ['Payment', 'patient_id'], ['PaymentRecord', 'patient_id'],
  ['PendingPatientUpdate', 'patient_id'], ['ProviderPatientAssignment', 'patient_id'],
  ['Referral', 'patient_id'], ['RiskAlert', 'patient_id'],
  ['RiskAnalysis', 'patient_id'], ['ScheduledFax', 'patient_id'],
  ['ScheduledSms', 'patient_id'], ['SentEducationMaterial', 'patient_id'],
  ['SharedDocument', 'related_patient_id'], ['SmsMessage', 'patient_id'],
  ['SuggestedIntervention', 'patient_id'], ['SupplyPrediction', 'patient_id'],
  ['SupplyUsageLog', 'patient_id'], ['Task', 'patient_id'],
  ['TeamMessage', 'patient_id'], ['TeamNote', 'patient_id'],
  ['TelehealthSession', 'patient_id'], ['TimeSavings', 'patient_id'],
  ['TrainingRecommendation', 'patient_id'], ['Visit', 'patient_id'],
];

// Entities whose rows carry a monotonic `version` that their brokers use for
// conditional updates. A re-pointed row bumps it in the same conditional write,
// so a broker holding the old revision reloads instead of overwriting.
const VERSIONED_REFERENCE_ENTITIES = new Set(['IncomingFax', 'Referral']);

// References a dedicated step moves, because a plain pointer rewrite would
// break the entity's own integrity rules.
const SPECIAL_PATIENT_REFERENCES = {
  // Patient.agency_id/patient_id are immutable on an assignment row, so the
  // grant is re-created on the survivor and the duplicate's grant revoked.
  'PatientCareTeamAssignment.patient_id': 'care-team lifecycle: grant on the survivor, then revoke on the duplicate',
  // Stored note revisions are never updated; their keys hash the patient id.
  'PatientNoteHistoryEntry.patient_id': 'immutable revisions are copied onto the survivor under survivor-derived keys',
  // getAuthorizedDocument requires Document.patient_id === binding.patient_id,
  // and a document on an archived chart is unreadable, so the binding's patient
  // pointer moves WITH its Document. Nothing else on the binding changes.
  'DocumentTenantBinding.patient_id': 'moved together with its Document so the binding integrity check still holds',
  'Document.patient_id': 'moved together with its DocumentTenantBinding',
  // Charts previously merged into the duplicate now resolve to the survivor.
  'Patient.merged_into_id': 'merge chains are re-pointed at the survivor',
};

// References deliberately left on the archived duplicate, each with its reason.
// The duplicate stays recoverable (merged_into_id points at the survivor).
const RETAINED_PATIENT_REFERENCES = {
  'PatientOutcomeMetric.patient_id': 'append-only rows whose row_content_hash covers patient_id inside a published run; rewriting one makes the whole published generation fail its integrity check, and the next outcome run re-derives the survivor from the moved OASIS assessments',
  'SmsConsent.patient_id': 'append-only consent ledger keyed by phone number, not by patient; consent for the survivor is governed by the same phone-scoped rows',
  'StagingReadinessFixture.patient_ids': 'synthetic staging fixture manifest, never a production chart reference',
  'User.favorited_patients': 'per-user UI convenience on a self-editable profile; an archived chart is hidden from every roster',
  'ProviderPermission.scope.patient_ids': 'no reader in the application, and the entity carries no agency_id to bind a service-role rewrite to one tenant',
  'ProviderFollowUpToken.request_snapshot': 'immutable minimum-necessary disclosure snapshot of a quarantined capability',
};

// Survivor fields a merge may FILL (never overwrite) from a duplicate, and the
// only keys a caller-supplied field_patch may name. Identifiers, tenancy,
// creator stamps, claim tokens, archive markers and every other field
// updateAuthorizedPatient protects are absent by construction; the legacy
// enhanced_notes_history array is read-only ("never update this whole array").
const FILL_EMPTY_PATIENT_FIELDS = [
  'date_of_birth', 'medical_record_number', 'phone', 'email', 'address',
  'primary_diagnosis', 'allergies', 'physician_name', 'physician_phone',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
  'insurance_primary', 'insurance_secondary', 'care_type', 'admission_date',
  'advance_directives', 'baseline_vitals', 'functional_status',
];
const UNION_ARRAY_PATIENT_FIELDS = ['secondary_diagnoses', 'current_medications', 'past_medical_history', 'wounds'];
const MERGE_PATCH_FIELDS = new Set([...FILL_EMPTY_PATIENT_FIELDS, ...UNION_ARRAY_PATIENT_FIELDS]);
const OBJECT_PATCH_FIELDS = new Set([
  'insurance_primary', 'insurance_secondary', 'advance_directives', 'baseline_vitals', 'functional_status',
]);

const MERGE_REQUEST_KEYS = new Set(['action', 'keep_id', 'duplicate_ids', 'field_patch', 'agency_id']);
const SCAN_REQUEST_KEYS = new Set(['action', 'confirm']);
const MAX_MERGE_DUPLICATES = 25;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_BODY_BYTES = 400_000;
const MAX_PATCH_STRING_LENGTH = 20_000;
const MAX_PATCH_ARRAY_ITEMS = 1_000;
const MAX_PATCH_VALUE_BYTES = 200_000;
const REASSIGN_PAGE_SIZE = 5000;
const REASSIGN_MAX_PASSES = 20;
const REASSIGN_CONCURRENCY = 6;
const EXACT_ROW_LIMIT = 10;
const CARE_TEAM_SCAN_LIMIT = 500;
const NOTE_HISTORY_SCAN_LIMIT = 5000;
// Stop starting new work before the platform's request timeout; a merge that
// runs out of time leaves its duplicates active and reports itself incomplete.
const MERGE_TIME_BUDGET_MS = 25_000;
const CARE_TEAM_ASSIGNMENT_SOURCES = new Set([
  'manual', 'patient_creator', 'legacy_assigned_nurses', 'legacy_provider_patient_assignment',
]);
const CARE_TEAM_GRANT_REASON = 'Carried over from a merged duplicate patient record';
const CARE_TEAM_REVOKE_REASON = 'Duplicate patient record merged into its surviving chart';
const NOTE_HISTORY_COPY_FIELDS = [
  'agency_id', 'visit_id', 'payload_fingerprint', 'source_entry_id', 'mode', 'visit_date',
  'visit_type', 'visit_revision_at', 'note', 'clinical_notes', 'compliance_score',
  'actor_user_id', 'actor_email_normalized', 'membership_id', 'membership_version', 'recorded_at',
];

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  if (value.startsWith('$')) return null;
  return value;
}

function canonicalEmail(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized || normalized.length > 320 || !normalized.includes('@') || /\s/.test(normalized)) {
    return null;
  }
  return normalized;
}

function validInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireRows(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} returned no rows array`);
  return value;
}

function bump(tally, key, amount = 1) {
  if (amount > 0) tally[key] = (tally[key] || 0) + amount;
}

// ---------------------------------------------------------------------------
// Survivor selection and field merge
// ---------------------------------------------------------------------------

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

const isEmptyPatientValue = (v) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

// Server copy of src/components/patient/mergePatients.js buildFieldMergePatch
// (Deno cannot import src/); patientMergeBrokerContract.test.js drives both
// over the same records and requires the survivor write to equal it.
function buildSurvivorFieldPatch(winner, loser) {
  const patch = {};
  if (!winner || !loser) return patch;
  for (const field of FILL_EMPTY_PATIENT_FIELDS) {
    if (isEmptyPatientValue(winner[field]) && !isEmptyPatientValue(loser[field])) patch[field] = loser[field];
  }
  for (const field of UNION_ARRAY_PATIENT_FIELDS) {
    const w = Array.isArray(winner[field]) ? winner[field] : [];
    const l = Array.isArray(loser[field]) ? loser[field] : [];
    if (!l.length) continue;
    const seen = new Set(w.map((x) => JSON.stringify(x)));
    const merged = [...w];
    for (const item of l) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
    if (merged.length > w.length) patch[field] = merged;
  }
  return patch;
}

function validatePatchValue(field, value) {
  if (value === null || value === undefined) return false;
  let size;
  try {
    size = JSON.stringify(value).length;
  } catch {
    return false;
  }
  if (size > MAX_PATCH_VALUE_BYTES) return false;
  if (UNION_ARRAY_PATIENT_FIELDS.includes(field)) {
    return Array.isArray(value) && value.length <= MAX_PATCH_ARRAY_ITEMS;
  }
  if (OBJECT_PATCH_FIELDS.has(field)) return plainObject(value);
  return typeof value === 'string' && value.length <= MAX_PATCH_STRING_LENGTH;
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

function mergeAuthority(user) {
  if (isProtectedAdmin(user)) return { platform: true, agencyId: null };
  // withTrustedClaims rebuilt agency_id and is_manager from exactly one active,
  // service-owned AgencyMembership in an active Agency: is_manager is true for
  // the agency_admin and manager tenant roles only.
  if (user && user.is_manager === true && claimIdentifier(user.agency_id)) {
    return { platform: false, agencyId: user.agency_id };
  }
  return null;
}

function patientAgency(row) {
  return exactIdentifier(row?.agency_id);
}

function survivorUnavailable(row) {
  return row.is_archived === true || row.status === 'merged' || row.status === 'archived'
    || !!exactIdentifier(row.merged_into_id);
}

async function loadExactPatient(entities, patientId) {
  const rows = requireRows(await entities.Patient.filter({ id: patientId }, undefined, 2), 'Patient.filter');
  if (rows.some((row) => row?.id !== patientId)) {
    throw new PublicError(409, 'Patient query scope could not be verified');
  }
  if (rows.length > 1) throw new PublicError(409, 'Patient record is ambiguous');
  return rows[0] || null;
}

function parseMergeRequest(body) {
  for (const key of Object.keys(body)) {
    if (!MERGE_REQUEST_KEYS.has(key)) throw new PublicError(400, `Unknown merge field: ${key}`);
  }
  const keepId = exactIdentifier(body.keep_id);
  if (!keepId) throw new PublicError(400, 'keep_id is required');
  if (!Array.isArray(body.duplicate_ids) || body.duplicate_ids.length === 0) {
    throw new PublicError(400, 'duplicate_ids must name at least one patient');
  }
  if (body.duplicate_ids.length > MAX_MERGE_DUPLICATES) {
    throw new PublicError(400, `A merge may name at most ${MAX_MERGE_DUPLICATES} duplicates`);
  }
  const duplicateIds = [];
  for (const value of body.duplicate_ids) {
    const id = exactIdentifier(value);
    if (!id) throw new PublicError(400, 'duplicate_ids must contain exact patient ids');
    if (id === keepId) throw new PublicError(400, 'A patient cannot be merged into itself');
    if (duplicateIds.includes(id)) throw new PublicError(400, 'duplicate_ids must be unique');
    duplicateIds.push(id);
  }
  let agencyId = null;
  if (body.agency_id !== undefined && body.agency_id !== null) {
    agencyId = exactIdentifier(body.agency_id);
    if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  }
  let fieldPatch = null;
  if (body.field_patch !== undefined && body.field_patch !== null) {
    if (!plainObject(body.field_patch)) throw new PublicError(400, 'field_patch must be an object');
    for (const [field, value] of Object.entries(body.field_patch)) {
      // Refused rather than filtered: a silently dropped key would read as a
      // field the merge carried when it did not.
      if (!MERGE_PATCH_FIELDS.has(field)) {
        throw new PublicError(400, `field_patch may not set ${field}`);
      }
      if (!validatePatchValue(field, value)) {
        throw new PublicError(400, `field_patch.${field} is invalid`);
      }
    }
    fieldPatch = body.field_patch;
  }
  return { keepId, duplicateIds, agencyId, fieldPatch };
}

// ---------------------------------------------------------------------------
// Merge steps
// ---------------------------------------------------------------------------

// Fill the survivor's empty fields from every duplicate (and from a validated
// caller patch, applied with the same fill-empty/union rules). The write is
// conditional on the survivor's observed revision so a concurrent edit is never
// overwritten; a lost race reloads once and recomputes.
async function fillSurvivorFields(entities, keep, duplicates, fieldPatch) {
  let survivor = keep;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const patch = {};
    const view = { ...survivor };
    for (const source of [...duplicates, ...(fieldPatch ? [fieldPatch] : [])]) {
      const delta = buildSurvivorFieldPatch(view, source);
      Object.assign(patch, delta);
      Object.assign(view, delta);
    }
    const fields = Object.keys(patch);
    if (fields.length === 0) return { fields, survivor };
    if (!validInstant(survivor.updated_date)) {
      await entities.Patient.update(survivor.id, patch);
      return { fields, survivor: view };
    }
    const result = await entities.Patient.updateMany(
      { id: survivor.id, updated_date: survivor.updated_date },
      { $set: patch },
    );
    if (plainObject(result) && result.success === true && result.updated === 1) {
      return { fields, survivor: view };
    }
    survivor = await loadExactPatient(entities, keep.id);
    if (!survivor || survivorUnavailable(survivor) || patientAgency(survivor) !== patientAgency(keep)) {
      throw new PublicError(409, 'The surviving patient record changed during the merge');
    }
  }
  throw new PublicError(409, 'The surviving patient record changed during the merge; retry');
}

// Re-point every row whose `field` names `fromId`. Rows that move drop out of
// the next page, so re-querying from the top walks the whole set; a page that
// moves nothing stops the walk so a permanently failing row cannot loop.
async function reassignReference(entities, entityName, field, fromId, toId) {
  const api = entities[entityName];
  if (!api || typeof api.filter !== 'function') throw new Error(`${entityName} is unavailable`);
  const versioned = VERSIONED_REFERENCE_ENTITIES.has(entityName);
  let moved = 0;
  const failedIds = new Set();
  for (let pass = 0; pass < REASSIGN_MAX_PASSES; pass += 1) {
    const rows = requireRows(
      await api.filter({ [field]: fromId }, undefined, REASSIGN_PAGE_SIZE),
      `${entityName}.filter`,
    );
    if (rows.length === 0) return { moved, failed: failedIds.size };
    let movedThisPage = 0;
    for (const row of rows) {
      const id = exactIdentifier(row?.id);
      // Never write a row the query did not provably select.
      if (!id || row[field] !== fromId) {
        failedIds.add(id || `unverified-${failedIds.size}`);
        continue;
      }
      try {
        // A legacy row with no revision takes part in no conditional update,
        // so it moves with a plain write; a malformed revision is refused.
        if (versioned && row.version !== undefined && row.version !== null) {
          if (!Number.isSafeInteger(row.version) || row.version < 1) {
            failedIds.add(id);
            continue;
          }
          const result = await api.updateMany(
            { id, version: row.version, [field]: fromId },
            { $set: { [field]: toId }, $inc: { version: 1 } },
          );
          if (!plainObject(result) || result.success !== true || result.updated !== 1) {
            failedIds.add(id);
            continue;
          }
        } else {
          await api.update(id, { [field]: toId });
        }
        failedIds.delete(id);
        moved += 1;
        movedThisPage += 1;
      } catch {
        failedIds.add(id);
      }
    }
    if (rows.length < REASSIGN_PAGE_SIZE || movedThisPage === 0) {
      return { moved, failed: failedIds.size };
    }
  }
  // Still finding rows after the pass cap: report rather than archive.
  return { moved, failed: Math.max(1, failedIds.size) };
}

async function loadActiveMembership(entities, agencyId, userId, email) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: agencyId, user_id: userId, status: 'active' },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (
    !exactIdentifier(row?.id)
    || row.agency_id !== agencyId
    || row.user_id !== userId
    || row.status !== 'active'
    || row.membership_key !== `${agencyId}:${userId}`
    || canonicalEmail(row.user_email_normalized) !== email
    || !Number.isSafeInteger(row.version)
    || row.version < 1
  ) {
    return null;
  }
  return row;
}

async function loadSurvivorAssignments(entities, agencyId, patientId, userId) {
  const key = `${agencyId}:${patientId}:${userId}`;
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      { assignment_key: key, agency_id: agencyId, patient_id: patientId, user_id: userId },
      '-updated_date',
      EXACT_ROW_LIMIT,
    ),
    'PatientCareTeamAssignment.filter',
  );
  if (rows.some((row) => row?.assignment_key !== key || row?.agency_id !== agencyId
    || row?.patient_id !== patientId || row?.user_id !== userId)) {
    throw new Error('Care-team assignment query scope could not be verified');
  }
  return rows;
}

function careTeamTransition(key, requestId, action, actor, reason, now) {
  return {
    last_transition_by_user_id: actor.userId,
    last_transition_by_email_normalized: actor.email,
    last_transition_at: now,
    last_transition_reason: reason,
    last_transition_action: action,
    last_transition_request_id: requestId,
    last_transition_request_key: `${key}:${requestId}`,
  };
}

// managePatientCareTeamAssignment's conventions: an assignment row's agency,
// patient and user are immutable, so an ACTIVE grant on the duplicate becomes
// a new version-1 grant on the survivor (never a second active grant for the
// same user), and only then is the duplicate's grant revoked through a
// conditional, version-incrementing transition. A survivor row the agency
// already suspended or revoked for that user is the deliberate state and wins;
// the duplicate's grant is then left on the archived chart, where it opens
// nothing. Suspended or revoked grants on the duplicate open nothing and stay.
async function moveCareTeam(entities, ctx, duplicate, tally) {
  const agencyId = ctx.agencyId;
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      { patient_id: duplicate.id, agency_id: agencyId },
      undefined,
      CARE_TEAM_SCAN_LIMIT + 1,
    ),
    'PatientCareTeamAssignment.filter',
  );
  if (rows.length > CARE_TEAM_SCAN_LIMIT) throw new Error('Too many care-team assignments to merge');
  let failed = 0;
  const requestId = `patient-merge:${duplicate.id}`;
  for (const row of rows) {
    if (row?.patient_id !== duplicate.id || row?.agency_id !== agencyId) {
      failed += 1;
      continue;
    }
    if (row.status !== 'active') continue;
    const userId = exactIdentifier(row.user_id);
    const userEmail = canonicalEmail(row.user_email_normalized);
    const duplicateKey = `${agencyId}:${duplicate.id}:${userId}`;
    if (!userId || !userEmail || row.assignment_key !== duplicateKey
      || !exactIdentifier(row.id) || !Number.isSafeInteger(row.version) || row.version < 1) {
      failed += 1;
      continue;
    }
    try {
      const survivorRows = await loadSurvivorAssignments(entities, agencyId, ctx.keep.id, userId);
      if (survivorRows.length > 1) {
        bump(tally.care_team, 'conflicts');
        continue;
      }
      let survivorRow = survivorRows[0] || null;
      if (survivorRow && survivorRow.status !== 'active') {
        bump(tally.care_team, 'conflicts');
        continue;
      }
      if (!survivorRow) {
        const membership = await loadActiveMembership(entities, agencyId, userId, userEmail);
        if (!membership) {
          // An inactive member's grant already opens nothing; carrying it would.
          bump(tally.care_team, 'skipped_inactive_member');
          continue;
        }
        const survivorKey = `${agencyId}:${ctx.keep.id}:${userId}`;
        const now = new Date().toISOString();
        const payload = {
          assignment_key: survivorKey,
          agency_id: agencyId,
          patient_id: ctx.keep.id,
          user_id: userId,
          user_email_normalized: userEmail,
          assignee_membership_id: membership.id,
          assignee_membership_version_at_enablement: membership.version,
          status: 'active',
          source: CARE_TEAM_ASSIGNMENT_SOURCES.has(row.source) ? row.source : 'manual',
          created_by_user_id: ctx.actor.userId,
          created_by_user_email_normalized: ctx.actor.email,
          activated_at: now,
          version: 1,
          ...careTeamTransition(survivorKey, requestId, 'grant', ctx.actor, CARE_TEAM_GRANT_REASON, now),
        };
        const created = await entities.PatientCareTeamAssignment.create(payload);
        const createdId = exactIdentifier(created?.id);
        const reconciled = await loadSurvivorAssignments(entities, agencyId, ctx.keep.id, userId);
        if (!createdId || reconciled.length !== 1 || reconciled[0].id !== createdId
          || reconciled[0].status !== 'active') {
          failed += 1;
          continue;
        }
        survivorRow = reconciled[0];
        bump(tally.care_team, 'granted_on_survivor');
      } else {
        bump(tally.care_team, 'already_on_survivor');
      }
      const now = new Date().toISOString();
      const result = await entities.PatientCareTeamAssignment.updateMany(
        { id: row.id, assignment_key: duplicateKey, status: 'active', version: row.version },
        {
          $set: {
            status: 'revoked',
            revoked_at: now,
            revocation_reason: CARE_TEAM_REVOKE_REASON,
            ...careTeamTransition(duplicateKey, requestId, 'revoke', ctx.actor, CARE_TEAM_REVOKE_REASON, now),
          },
          $inc: { version: 1 },
        },
      );
      if (!plainObject(result) || result.success !== true || result.updated !== 1 || result.has_more === true) {
        failed += 1;
        continue;
      }
      bump(tally.care_team, 'revoked_on_duplicate');
    } catch {
      failed += 1;
    }
  }
  return failed;
}

// PatientNoteHistoryEntry rows are immutable and their keys hash the patient,
// so each of the duplicate's revisions is COPIED onto the survivor exactly as
// appendPatientNoteHistory would have keyed it there (same payload, author,
// membership and revision time). The originals stay on the archived duplicate.
// A copy already made is found by its event_key, so a retry never doubles one.
async function copyNoteHistory(entities, ctx, duplicate, tally) {
  const agencyId = ctx.agencyId;
  const rows = requireRows(
    await entities.PatientNoteHistoryEntry.filter(
      { patient_id: duplicate.id, agency_id: agencyId },
      undefined,
      NOTE_HISTORY_SCAN_LIMIT + 1,
    ),
    'PatientNoteHistoryEntry.filter',
  );
  if (rows.length > NOTE_HISTORY_SCAN_LIMIT) throw new Error('Too many note revisions to merge');
  let failed = 0;
  for (const row of rows) {
    const visitId = exactIdentifier(row?.visit_id);
    if (row?.patient_id !== duplicate.id || row?.agency_id !== agencyId || !visitId
      || !validSha256(row.payload_fingerprint)) {
      failed += 1;
      continue;
    }
    try {
      const scope = exactIdentifier(row.source_entry_id) || row.payload_fingerprint;
      const logicalNoteKey = await sha256Hex(JSON.stringify([agencyId, ctx.keep.id, visitId]));
      const eventKey = await sha256Hex(JSON.stringify([agencyId, ctx.keep.id, visitId, scope]));
      const existing = requireRows(
        await entities.PatientNoteHistoryEntry.filter(
          { event_key: eventKey, agency_id: agencyId, patient_id: ctx.keep.id },
          undefined,
          2,
        ),
        'PatientNoteHistoryEntry.filter',
      );
      if (existing.some((copy) => copy?.event_key === eventKey && copy?.patient_id === ctx.keep.id)) {
        bump(tally.note_history, 'already_on_survivor');
        continue;
      }
      const payload = {};
      for (const field of NOTE_HISTORY_COPY_FIELDS) {
        if (row[field] !== undefined && row[field] !== null) payload[field] = row[field];
      }
      Object.assign(payload, {
        agency_id: agencyId,
        patient_id: ctx.keep.id,
        logical_note_key: logicalNoteKey,
        event_key: eventKey,
      });
      await entities.PatientNoteHistoryEntry.create(payload);
      bump(tally.note_history, 'copied_to_survivor');
    } catch {
      failed += 1;
    }
  }
  return failed;
}

async function runPool(tasks, limit) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      await tasks[index]();
    }
  });
  await Promise.all(workers);
}

// Move everything that references one duplicate. Never throws: every failure
// is counted against the step that failed, so the caller can decide not to
// archive and still report exactly what happened.
async function moveDuplicateRecords(entities, ctx, duplicate, totals) {
  const failed = {};
  const pending = [];
  const fail = (label, amount = 1) => bump(failed, label, amount);
  const timeUp = () => Date.now() > ctx.deadline;
  const step = async (label, run) => {
    if (timeUp()) {
      pending.push(label);
      return;
    }
    try {
      const count = await run();
      if (count > 0) fail(label, count);
    } catch {
      fail(label);
    }
  };
  const moveField = (entityName, field) => async () => {
    const outcome = await reassignReference(entities, entityName, field, duplicate.id, ctx.keep.id);
    bump(totals.reassigned, `${entityName}.${field}`, outcome.moved);
    return outcome.failed;
  };

  if (ctx.agencyId) {
    await step('PatientCareTeamAssignment.patient_id', () => moveCareTeam(entities, ctx, duplicate, totals));
    await step('PatientNoteHistoryEntry.patient_id', () => copyNoteHistory(entities, ctx, duplicate, totals));
  }
  // A binding and its Document move as a pair, back to back, so the window in
  // which one names the survivor and the other the duplicate is one write wide.
  await step('DocumentTenantBinding.patient_id', moveField('DocumentTenantBinding', 'patient_id'));
  await step('Document.patient_id', moveField('Document', 'patient_id'));
  await runPool(
    PATIENT_REFERENCE_FIELDS.map(([entityName, field]) => () => step(`${entityName}.${field}`, moveField(entityName, field))),
    REASSIGN_CONCURRENCY,
  );
  await step('Patient.merged_into_id', moveField('Patient', 'merged_into_id'));
  return { failed, pending };
}

async function archiveDuplicate(entities, ctx, duplicate) {
  await entities.Patient.update(duplicate.id, {
    status: 'merged',
    is_archived: true,
    merged_into_id: ctx.keep.id,
    merged_at: new Date().toISOString(),
    merged_by: ctx.actor.email,
  });
}

// Validate a merge completely before the first write: survivor live, every
// duplicate present and not merged elsewhere, one shared agency the caller may
// act in. Caller-invisible patients and missing ids answer the same 404, so a
// manager cannot probe another agency's ids.
async function prepareMerge(entities, authority, user, request) {
  const visible = (row) => !!row && (authority.platform || patientAgency(row) === authority.agencyId);
  const keep = await loadExactPatient(entities, request.keepId);
  if (!visible(keep)) throw new PublicError(404, 'Patient record was not found');
  if (survivorUnavailable(keep)) {
    throw new PublicError(409, 'The surviving patient record is archived or already merged');
  }
  const duplicates = [];
  for (const id of request.duplicateIds) {
    const row = await loadExactPatient(entities, id);
    if (!visible(row)) throw new PublicError(404, 'Patient record was not found');
    const mergedInto = exactIdentifier(row.merged_into_id);
    if ((mergedInto || row.status === 'merged') && mergedInto !== keep.id) {
      throw new PublicError(409, 'A duplicate patient record was already merged into a different patient');
    }
    duplicates.push(row);
  }
  const agencyId = patientAgency(keep);
  for (const row of [keep, ...duplicates]) {
    if (patientAgency(row) !== agencyId) {
      throw new PublicError(409, 'Patients in one merge must belong to the same agency');
    }
    if (row.is_sample === true) throw new PublicError(409, 'Sample patient records cannot be merged');
  }
  if (!agencyId && !authority.platform) throw new PublicError(404, 'Patient record was not found');
  if (request.agencyId && request.agencyId !== agencyId) {
    throw new PublicError(409, 'Patients do not belong to the requested agency');
  }
  const actor = { userId: exactIdentifier(user.id), email: canonicalEmail(user.email) };
  if (!actor.userId || !actor.email) throw new PublicError(403, 'Forbidden');
  return { keep, duplicates, agencyId, actor };
}

async function executeMerge(entities, prepared, fieldPatch, deadline) {
  const { keep, duplicates, agencyId, actor } = prepared;
  const totals = { reassigned: {}, care_team: {}, note_history: {} };
  const result = {
    keep_id: keep.id,
    merged_ids: [],
    incomplete: [],
    fields_merged: [],
    totals,
  };
  // 1. Survivor first.
  const filled = await fillSurvivorFields(entities, keep, duplicates, fieldPatch);
  result.fields_merged = filled.fields;
  const ctx = { keep, agencyId, actor, deadline };
  // 2-3. Move each duplicate's records; archive it last, only when complete.
  for (const duplicate of duplicates) {
    const alreadyMerged = duplicate.status === 'merged' && duplicate.merged_into_id === keep.id
      && duplicate.is_archived === true;
    const { failed, pending } = await moveDuplicateRecords(entities, ctx, duplicate, totals);
    if (Object.keys(failed).length > 0 || pending.length > 0) {
      result.incomplete.push({ duplicate_id: duplicate.id, failed, pending });
      continue;
    }
    if (!alreadyMerged) {
      try {
        await archiveDuplicate(entities, ctx, duplicate);
      } catch {
        result.incomplete.push({ duplicate_id: duplicate.id, failed: { 'Patient.archive': 1 }, pending: [] });
        continue;
      }
    }
    result.merged_ids.push(duplicate.id);
  }
  result.complete = result.incomplete.length === 0;
  return result;
}

// Opaque record ids only: MRNs, names and demographics stay on the patient
// records and are never copied into the broad activity log.
async function recordMergeAudit(base44, user, mode, groups) {
  const changed = groups.filter((d) => d.removed.length > 0 || d.incomplete.length > 0);
  if (changed.length === 0) return;
  const removedCount = changed.reduce((sum, d) => sum + d.removed.length, 0);
  const complete = changed.every((d) => d.incomplete.length === 0);
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: user.email,
    user_name: user.full_name,
    action: 'patients_deduplicated',
    entity_type: 'Patient',
    details: {
      mode,
      removed_count: removedCount,
      groups: changed.map((d) => ({
        kept_id: d.kept.id,
        removed_ids: d.removed.map((r) => r.id),
        incomplete_ids: d.incomplete.map((r) => r.id),
      })),
      timestamp: new Date().toISOString(),
    },
    status: complete ? 'success' : 'partial',
  }).catch(() => console.error('Failed to write patient merge audit'));
}

function auditGroup(result) {
  return {
    kept: { id: result.keep_id },
    removed: result.merged_ids.map((id) => ({ id })),
    incomplete: result.incomplete.map((entry) => ({ id: entry.duplicate_id })),
  };
}

// ---------------------------------------------------------------------------
// Scan (dry-run preview) and confirm
// ---------------------------------------------------------------------------

// The confirm path only acts on HIGH-confidence duplicates (shared score >=
// 70). A name match alone scores 60, so it never qualifies on its own —
// corroboration (DOB / phone / email / address / ...) is required. Exact
// Medical Record Number matches still have to clear the identity guards.
//
// Candidate generation is intentionally bucketed by agency + exact MRN and
// agency + exact normalized name (rather than an O(n^2) cross-scan) to stay
// within the edge function timeout. The interactive UI performs the full
// fuzzy/phonetic scan. Bucketing by agency means a group never spans tenants.
const BACKEND_MIN_SCORE = 70;

// Placeholder MRNs are shared by unrelated patients — bucketing on them
// would mark every "N/A" patient a 100%-confidence duplicate of the rest.
const PLACEHOLDER_MRNS = new Set(['N/A', 'NA', 'NONE', 'UNKNOWN', 'PENDING', 'TBD', 'TEMP', '0', '00', '000', '0000', 'X', 'XX', 'XXX']);

function findBackendDuplicateGroups(patients, startTime) {
  const mrnGroups = new Map();
  const nameGroups = new Map();
  patients.forEach((patient) => {
    const agencyKey = patientAgency(patient) || '';
    if (patient.medical_record_number) {
      const mrn = patient.medical_record_number.toString().trim().toUpperCase();
      if (mrn && !PLACEHOLDER_MRNS.has(mrn)) {
        const key = `${agencyKey}|${mrn}`;
        if (!mrnGroups.has(key)) mrnGroups.set(key, []);
        mrnGroups.get(key).push(patient);
      }
    }
    const nameKey = `${normalizeName(patient.first_name)}|${normalizeName(patient.last_name)}`;
    if (nameKey !== '|') {
      const key = `${agencyKey}|${nameKey}`;
      if (!nameGroups.has(key)) nameGroups.set(key, []);
      nameGroups.get(key).push(patient);
    }
  });

  const duplicateGroups = [];
  const processed = new Set();

  // Phase 1: exact MRN matches — but a shared MRN alone is NOT definitive.
  // Each candidate must also clear the engine's identity guards
  // (scorePatientPair hard-blocks different-name + different-DOB pairs), so
  // a typo'd or recycled MRN can never merge two different people at 100%.
  for (const [, group] of mrnGroups) {
    const unprocessed = group.filter((p) => !processed.has(p.id));
    if (unprocessed.length > 1) {
      const primary = unprocessed[0];
      const verified = unprocessed.slice(1).filter((p) => (scorePatientPair(primary, p)?.score ?? 0) > 0);
      if (verified.length > 0) {
        duplicateGroups.push({
          primary,
          duplicates: verified.map((p) => ({
            patient: p,
            score: 100,
            matches: [REASON.MRN],
            confidenceLevel: 'high',
            confidencePercent: 100,
          })),
        });
        processed.add(primary.id);
        verified.forEach((p) => processed.add(p.id));
      }
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
    if (groupsProcessed % 20 === 0 && Date.now() - startTime > 20000) break;
  }
  return duplicateGroups;
}

// Choose the survivor: active first, then the MOST COMPLETE record, then
// newest as a tiebreak, so a sparse just-created stub never survives over an
// older rich chart.
function orderGroupForMerge(group) {
  const allInGroup = [group.primary, ...group.duplicates.map((d) => d.patient)];
  allInGroup.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    const ca = completenessScore(a);
    const cb = completenessScore(b);
    if (cb !== ca) return cb - ca;
    const dateA = a.created_date ? new Date(a.created_date).getTime() : 0;
    const dateB = b.created_date ? new Date(b.created_date).getTime() : 0;
    return dateB - dateA;
  });
  return { keep: allInGroup[0], toRemove: allInGroup.slice(1) };
}

async function loadScanCandidates(entities, authority) {
  // Bounded to the SDK's 5000/request max; omitting a limit silently caps at
  // the SDK default of 50. An agency caller only ever loads its own agency.
  const loaded = requireRows(
    authority.platform
      ? await entities.Patient.list('-created_date', 5000)
      : await entities.Patient.filter({ agency_id: authority.agencyId }, '-created_date', 5000),
    'Patient read',
  );
  if (!authority.platform && loaded.some((p) => p?.agency_id !== authority.agencyId)) {
    throw new Error('Patient scan scope could not be verified');
  }
  // Exclude merged / soft-archived duplicates from the candidate set: a merged
  // loser keeps the survivor's MRN and name, so re-scanning it re-buckets the
  // same pair as a phantom duplicate on every run (and could even pick an
  // archived stub as the survivor).
  return loaded.filter((p) => !p.is_archived && p.status !== 'merged' && p.is_sample !== true);
}

async function handleScan(base44, user, authority, confirm, startTime) {
  const entities = base44.asServiceRole.entities;
  const patients = await loadScanCandidates(entities, authority);
  const duplicateGroups = findBackendDuplicateGroups(patients, startTime);
  const removed = [];
  const detailsArray = [];
  const auditGroups = [];
  let mergeFailures = 0;
  const deadline = startTime + MERGE_TIME_BUDGET_MS;

  for (const group of duplicateGroups) {
    const { keep, toRemove } = orderGroupForMerge(group);
    const entries = toRemove.map((patient) => ({
      id: patient.id,
      name: `${patient.first_name} ${patient.last_name}`,
      mrn: patient.medical_record_number || 'N/A',
      // null (not a fabricated 100) when the group carries no per-patient
      // score — e.g. the removed record was the group's primary.
      match_score: group.duplicates.find((d) => d.patient.id === patient.id)?.score ?? null,
    }));
    const detail = {
      kept: {
        id: keep.id,
        name: `${keep.first_name} ${keep.last_name}`,
        mrn: keep.medical_record_number || 'N/A',
        status: keep.status,
      },
      removed: entries,
    };
    if (confirm) {
      if (Date.now() > deadline) {
        detail.removed = [];
        detail.failed = entries.map(({ id, name, mrn }) => ({ id, name, mrn }));
        mergeFailures += entries.length;
        detailsArray.push(detail);
        continue;
      }
      try {
        const prepared = await prepareMerge(entities, authority, user, {
          keepId: keep.id,
          duplicateIds: toRemove.map((p) => p.id),
          agencyId: null,
        });
        const outcome = await executeMerge(entities, prepared, null, deadline);
        const merged = new Set(outcome.merged_ids);
        detail.removed = entries.filter((e) => merged.has(e.id));
        detail.failed = entries.filter((e) => !merged.has(e.id)).map(({ id, name, mrn }) => ({ id, name, mrn }));
        mergeFailures += detail.failed.length;
        auditGroups.push(auditGroup(outcome));
      } catch {
        detail.removed = [];
        detail.failed = entries.map(({ id, name, mrn }) => ({ id, name, mrn }));
        mergeFailures += entries.length;
      }
    }
    removed.push(...detail.removed);
    detailsArray.push(detail);
  }

  if (confirm) await recordMergeAudit(base44, user, 'confirm', auditGroups);

  const resultsWithConfidence = detailsArray.map((detail) => {
    // Average only the records that actually carry a score. A deliberate null
    // match_score (the removed record was the group's primary) coerced to 0
    // through the sum, dragging an MRN-verified merge down to "Low" at 0%.
    const scored = detail.removed.filter((r) => typeof r.match_score === 'number');
    if (scored.length === 0) return { ...detail, confidence: null, average_match_score: null };
    const avgScore = scored.reduce((sum, r) => sum + r.match_score, 0) / scored.length;
    let confidence = 'High';
    if (avgScore < 70) confidence = 'Medium';
    if (avgScore < 50) confidence = 'Low';
    return { ...detail, confidence, average_match_score: Math.round(avgScore) };
  });

  return jsonResponse({
    success: true,
    dry_run: !confirm,
    // In dry-run these are the groups/records that WOULD be merged; with
    // confirm:true they are the records actually archived (merged).
    duplicate_groups_found: duplicateGroups.length,
    patients_removed: confirm ? removed.length : 0,
    patients_to_remove: confirm ? 0 : removed.length,
    merge_failures: mergeFailures,
    removed_patients: removed,
    details: resultsWithConfidence,
  });
}

async function handleMerge(base44, user, authority, body, startTime) {
  const request = parseMergeRequest(body);
  const entities = base44.asServiceRole.entities;
  const prepared = await prepareMerge(entities, authority, user, request);
  const outcome = await executeMerge(entities, prepared, request.fieldPatch, startTime + MERGE_TIME_BUDGET_MS);
  await recordMergeAudit(base44, user, 'merge', [auditGroup(outcome)]);
  return jsonResponse({
    success: outcome.complete,
    complete: outcome.complete,
    keep_id: outcome.keep_id,
    merged_ids: outcome.merged_ids,
    incomplete: outcome.incomplete,
    fields_merged: outcome.fields_merged,
    reassigned: outcome.totals.reassigned,
    care_team: outcome.totals.care_team,
    note_history: outcome.totals.note_history,
    retained_on_duplicate: Object.keys(RETAINED_PATIENT_REFERENCES),
  }, { status: outcome.complete ? 200 : 207 });
}

function jsonResponse(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...(init.headers || {}) },
  });
}

// Kill switch. Flip to true to refuse every caller before any client, auth or
// patient read happens.
const PATIENT_DEDUPLICATION_PAUSED = false;

Deno.serve(async (req) => {
  if (PATIENT_DEDUPLICATION_PAUSED) {
    return Response.json({
      error: 'Patient duplicate scanning and merging are temporarily unavailable',
      code: 'patient_merge_paused',
    }, { status: 503 });
  }

  const startTime = Date.now();

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
    }
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await withTrustedClaims(base44, await base44.auth.me().catch(() => null));
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const authority = mergeAuthority(user);
    if (!authority) {
      return jsonResponse({ error: 'Unauthorized - agency administrator or manager access required' }, { status: 403 });
    }

    const contentLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request body is too large' }, { status: 413 });
    }
    // DRY-RUN BY DEFAULT. Merging is destructive, so callers either name the
    // exact records with action:'merge' or pass { confirm: true } to apply the
    // high-confidence scan; any other invocation only PREVIEWS the groups that
    // would be merged. The function may be invoked with no body.
    const body = await req.json().catch(() => ({}));
    if (!plainObject(body)) return jsonResponse({ error: 'Request body must be an object' }, { status: 400 });

    if (body.action === 'merge') return await handleMerge(base44, user, authority, body, startTime);
    if (body.action !== undefined && body.action !== 'scan') {
      return jsonResponse({ error: "action must be 'scan' or 'merge'" }, { status: 400 });
    }
    for (const key of Object.keys(body)) {
      if (!SCAN_REQUEST_KEYS.has(key)) return jsonResponse({ error: `Unknown scan field: ${key}` }, { status: 400 });
    }
    return await handleScan(base44, user, authority, body.confirm === true, startTime);
  } catch (error) {
    if (error instanceof PublicError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    // Status-only log: no record ids, names or datastore error strings.
    console.error('Patient deduplication failed');
    return jsonResponse({
      error: 'Deduplication failed',
      details: 'Check function logs for more information',
    }, { status: 500 });
  }
});
