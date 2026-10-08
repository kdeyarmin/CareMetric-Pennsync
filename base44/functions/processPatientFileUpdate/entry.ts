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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// ---------------------------------------------------------------------------
// Patient-import helpers (inlined — backend functions deploy independently and
// cannot import local files). Pure + deterministic.
// ---------------------------------------------------------------------------

// Trim a value to a clean string ('' for null/undefined).
function cleanValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\uFEFF/g, '').trim();
}

function normalizeText(value) {
  return cleanValue(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return normalizeText(value).replace(/[^a-z0-9 ]/g, '');
}

function normalizeMrn(value) {
  return cleanValue(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isValidYmd(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
  );
}

// RFC-4180-ish CSV parser: handles quoted fields, escaped quotes ("") and
// embedded commas/newlines inside quotes. Returns an array of row arrays.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  // Flush the trailing field/row (unless the input ended on a clean newline).
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty trailing rows.
  return rows.filter((r) => r.some((c) => cleanValue(c) !== ''));
}

// Normalize a header into a lookup key: lowercased, non-alphanumerics → underscore.
function normalizeHeader(h) {
  return cleanValue(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Map a row's columns onto an object keyed by normalized header.
function buildRowObject(headers, cols) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const key = normalizeHeader(headers[i]);
    if (!key) continue;
    obj[key] = cleanValue(cols[i]);
  }
  return obj;
}

// Normalize a DOB to YYYY-MM-DD (best effort) so name+DOB keys align across formats.
function normalizeDob(value) {
  const v = cleanValue(value);
  if (!v) return '';
  const pivotYear = (year) => {
    if (year.length !== 2) return year;
    const ref = new Date().getFullYear();
    const candidate = 2000 + Number(year);
    return String(candidate > ref ? candidate - 100 : candidate);
  };
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); // YYYY-MM-DD
  if (m) return isValidYmd(m[1], m[2], m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : '';
  m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/); // MM/DD/YYYY or MM/DD/YY
  if (m) {
    const year = pivotYear(m[3]);
    return isValidYmd(year, m[1], m[2]) ? `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
  }
  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

const firstOf = (row, keys) => {
  for (const k of keys) {
    if (row[k] !== undefined && cleanValue(row[k]) !== '') return cleanValue(row[k]);
  }
  return '';
};

function parseFullName(value) {
  const raw = cleanValue(value);
  if (!raw) return { first_name: '', middle_name: '', last_name: '' };
  if (raw.includes(',')) {
    const [lastNamePart, firstNamePart] = raw.split(',').map((part) => cleanValue(part));
    const firstParts = (firstNamePart || '').split(/\s+/).filter(Boolean);
    return {
      first_name: firstParts[0] || '',
      middle_name: firstParts.length > 2 ? firstParts.slice(1, -1).join(' ') : firstParts[1] || '',
      last_name: lastNamePart || (firstParts.length > 1 ? firstParts[firstParts.length - 1] : ''),
    };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first_name: parts[0], middle_name: '', last_name: '' };
  return {
    first_name: parts[0] || '',
    middle_name: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    last_name: parts[parts.length - 1] || '',
  };
}

// Build the normalized lookups used to detect matches against existing patients.
function pushToLookup(map, key, value) {
  if (!key) return;
  const existing = map.get(key) || [];
  existing.push(value);
  map.set(key, existing);
}

function getNameDobKey(patient) {
  const first = normalizeName(patient.first_name);
  const last = normalizeName(patient.last_name);
  const dob = normalizeDob(patient.date_of_birth);
  if (!first || !last || !dob) return null;
  return `${first}|${last}|${dob}`;
}

function buildExistingLookups(existingPatients) {
  const existingByMrn = new Map();
  const existingByNameDob = new Map();
  for (const p of existingPatients || []) {
    // Merged losers keep their MRN forever — including them made every future
    // row for that MRN error "Multiple existing patients share this MRN"
    // (the survivor + the archived loser both matched). Their records belong
    // to the survivor now, so they must never be a match target. Archived
    // DISCHARGED patients stay matchable: the discharge path reports them as
    // "already discharged — no change" and a census row for one flags a
    // possible readmission instead of minting a duplicate chart.
    if (p?.status === 'merged') continue;
    pushToLookup(existingByMrn, normalizeMrn(p.medical_record_number), p);
    pushToLookup(existingByNameDob, getNameDobKey(p), p);
  }
  return { existingByMrn, existingByNameDob };
}

// Parse a raw CSV row object into a normalized patient shape used downstream.
function parseUploadedPatient(row, rowNumber) {
  const parsedName = parseFullName(firstOf(row, ['patient', 'patient_name', 'name']));
  const first_name = firstOf(row, ['first_name', 'firstname', 'first', 'patient_first_name']) || parsedName.first_name;
  const last_name = firstOf(row, ['last_name', 'lastname', 'last', 'patient_last_name']) || parsedName.last_name;
  const middle_name = firstOf(row, ['middle_name', 'middlename', 'middle', 'mi']) || parsedName.middle_name;
  const medical_record_number = firstOf(row, ['medical_record_number', 'mrn', 'record_number', 'patient_id', 'chart_number']);
  const date_of_birth = normalizeDob(firstOf(row, ['date_of_birth', 'dob', 'birth_date', 'birthdate']));
  const admission_date = normalizeDob(firstOf(row, ['admitted_date', 'admission_date', 'soc_date', 'start_of_care', 'admit_date']));
  const discharge_date = normalizeDob(firstOf(row, ['discharge_date', 'dc_date', 'discharged_on']));
  const rawStatus = firstOf(row, ['current_admission_status', 'status', 'patient_status']).toLowerCase();
  // Constrain to the Patient.status enum (active/discharged/hospitalized/merged);
  // an arbitrary CSV value would be written verbatim and silently dropped. Unknown
  // values map to '' so the Patient.status default ('active') applies intentionally.
  const status = rawStatus.includes('discharg') ? 'discharged'
    : rawStatus.includes('hospital') ? 'hospitalized'
    : rawStatus.includes('active') ? 'active'
    : '';
  const payor = firstOf(row, ['primary_payor', 'payor', 'payer', 'insurance', 'primary_insurance']);
  const primary_diagnosis = firstOf(row, ['primary_diagnosis', 'diagnosis', 'dx', 'primary_dx']);
  const secondaryRaw = firstOf(row, ['secondary_diagnoses', 'secondary_diagnosis', 'other_diagnoses']);
  const secondary_diagnoses = secondaryRaw ? secondaryRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : [];
  const phone = firstOf(row, ['phone', 'phone_number', 'home_phone', 'primary_phone']);
  const address = firstOf(row, ['addr_1_care', 'care_address_1', 'address', 'street_address', 'home_address']);

  const patientLabel = `${first_name} ${last_name}`.trim() + (medical_record_number ? ` (MRN ${medical_record_number})` : '') + ` [row ${rowNumber}]`;

  return {
    rowNumber,
    first_name, middle_name, last_name,
    medical_record_number, date_of_birth, admission_date, discharge_date,
    status, payor, primary_diagnosis, secondary_diagnoses, phone, address,
    patientLabel,
  };
}

// The de-dup keys a parsed patient contributes (MRN and/or name+DOB).
function buildUploadKeys(patient) {
  const keys = [];
  const mrn = normalizeMrn(patient.medical_record_number);
  if (mrn) keys.push(`mrn:${mrn}`);
  const nameDobKey = getNameDobKey(patient);
  if (nameDobKey) keys.push(`namedob:${nameDobKey}`);
  return keys;
}

// Resolve a parsed patient against the existing lookups.
// Returns { match, matchedBy } or { error } when it can't be safely verified.
// An MRN match must AGREE with the row's name when the row carries one — a
// single typo'd MRN digit used to match (and discharge/archive) whichever
// patient owned that MRN, name unchecked. Different last names are a conflict
// unless the first names agree exactly (married-name change). Mirrors
// patientImportUtils.js.
const foldNamePart = (v) => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
function mrnNameConflict(row, rec) {
  const rowLast = foldNamePart(row.last_name);
  const recLast = foldNamePart(rec?.last_name);
  if (!rowLast || !recLast) return false;
  if (rowLast === recLast || rowLast.includes(recLast) || recLast.includes(rowLast)) return false;
  const rowFirst = foldNamePart(row.first_name);
  const recFirst = foldNamePart(rec?.first_name);
  return !(rowFirst && recFirst && rowFirst === recFirst);
}

function resolveMatch(patient, existingByMrn, existingByNameDob) {
  const mrn = normalizeMrn(patient.medical_record_number);
  const nameDobKey = getNameDobKey(patient);
  const mrnMatches = mrn ? (existingByMrn.get(mrn) || []) : [];
  const nameDobMatches = nameDobKey ? (existingByNameDob.get(nameDobKey) || []) : [];
  const mrnMatch = mrnMatches[0] || null;
  const nameDobMatch = nameDobMatches[0] || null;

  if (mrnMatches.length > 1) {
    return { error: 'Multiple existing patients already share this MRN.' };
  }
  if (nameDobMatches.length > 1) {
    return { error: 'Multiple existing patients already share this name and DOB.' };
  }
  if (mrnMatch && nameDobMatch && mrnMatch.id !== nameDobMatch.id) {
    return { error: 'MRN matched one patient, but name and DOB matched a different patient.' };
  }
  if (mrnMatch && !nameDobMatch && mrnNameConflict(patient, mrnMatch)) {
    return {
      error: `MRN belongs to ${mrnMatch.first_name || ''} ${mrnMatch.last_name || ''} but this row names a different patient — verify the MRN before importing.`.trim(),
    };
  }
  if (!mrn && !nameDobKey) {
    return { error: 'Cannot safely verify this patient. Provide an MRN or a name with DOB.' };
  }
  return {
    match: mrnMatch || nameDobMatch || null,
    matchedBy: mrnMatch ? 'MRN' : nameDobMatch ? 'Name + DOB' : null,
  };
}

const runInBatches = async (items, batchSize, worker) => {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.all(batch.map(worker));
  }
};

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const MAX_FILE_CHARS = 5_000_000;
const MAX_ROWS = 5000;
const CREATE_BATCH = 5;
const respond = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { ...NO_STORE_HEADERS, ...headers },
});

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function invokeErrorMessage(error) {
  const data = error?.response?.data;
  if (data && typeof data.error === 'string' && data.error) return data.error.slice(0, 300);
  return 'Patient could not be created';
}

/**
 * Patient roster import (owner decision, 2026-10-08).
 *
 * Admin-only and scoped to ONE agency: the caller must hold exactly one active,
 * service-owned AgencyMembership (loadTrustedTenantClaim), and be either an
 * agency_admin there or the built-in administrator. Every match, discharge and
 * creation stays inside that agency: rows from other agencies are never match
 * targets, a match against a chart with no recorded agency is reported for
 * manual review rather than touched, and new charts are created one at a time
 * through createAuthorizedPatient as the caller, so they carry the same
 * immutable tenant and creator provenance as a chart created by hand. The CSV
 * travels inline (file_content) — nothing is fetched from storage — and a
 * commit must name the agency its preview was computed for.
 *
 * Body: { file_content, report_type?, dry_run?, agency_id? (required to commit) }
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return respond({ success: false, error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return respond({ success: false, error: 'Unauthorized' }, 401);
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true) {
      return respond({ success: false, error: 'Forbidden' }, 403);
    }
    // This import can create, discharge and archive patient charts, so it is
    // authorized from the service-owned membership before the body is read.
    const tenant = await loadTrustedTenantClaim(base44, user.id, normalizeClaimEmail(user.email));
    const isBuiltInAdmin = user.role === 'admin';
    if (!tenant || (!isBuiltInAdmin && (user.role !== 'user' || tenant.tenantRole !== 'agency_admin'))) {
      return respond({
        success: false,
        error: 'Forbidden: an agency administrator with one active agency membership is required',
      }, 403);
    }
    const agencyId = tenant.agencyId;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return respond({ success: false, error: 'Request body must be an object' }, 400);
    }
    const reportType = body.report_type === 'discharge_report' ? 'discharge_report' : 'active_census';
    // Preview mode: classify every row and return the plan without writing
    // anything, so an admin can review which patients would be added vs.
    // matched to existing records before committing the import.
    const dryRun = body.dry_run === true || body.mode === 'preview';
    if (!dryRun && body.agency_id !== agencyId) {
      // The preview was computed for one agency; refuse to apply it under another.
      return respond({ success: false, error: 'This import was previewed for a different agency. Preview it again.' }, 409);
    }
    if (body.file_url !== undefined) {
      return respond({ success: false, error: 'Send the CSV as file_content; stored file links are not read' }, 400);
    }
    const fileContent = typeof body.file_content === 'string' ? body.file_content : '';
    if (!cleanValue(fileContent)) {
      return respond({ success: false, error: 'CSV file content is required' }, 400);
    }
    if (fileContent.length > MAX_FILE_CHARS) {
      return respond({ success: false, error: 'CSV file is too large' }, 413);
    }

    // Full CSV parse (handles quoted commas, escaped quotes, and embedded
    // newlines) so a single logical record never gets split across rows.
    const records = parseCsv(fileContent);
    if (records.length < 2) {
      return respond({ success: false, error: 'CSV file must include a header row and at least one patient row' }, 400);
    }
    if (records.length - 1 > MAX_ROWS) {
      return respond({ success: false, error: `CSV file has more than ${MAX_ROWS} patient rows` }, 413);
    }

    const headers = records[0];
    const rawRows = records.slice(1).map((cols, index) => ({
      rowNumber: index + 2,
      data: buildRowObject(headers, cols),
    }));

    // Match against this agency's charts, plus charts with no recorded agency
    // so a legacy chart is never duplicated; another agency's charts are never
    // read into the plan. Page through in 5000-row chunks until a short page.
    const PATIENT_PAGE = 5000;
    const existingPatients = [];
    for (let skip = 0; ; skip += PATIENT_PAGE) {
      const page = await base44.asServiceRole.entities.Patient.list('-created_date', PATIENT_PAGE, skip);
      if (!Array.isArray(page) || page.length === 0) break;
      for (const row of page) {
        const rowAgency = typeof row?.agency_id === 'string' ? row.agency_id : '';
        if (rowAgency === agencyId || rowAgency === '') existingPatients.push(row);
      }
      if (page.length < PATIENT_PAGE) break;
    }
    const { existingByMrn, existingByNameDob } = buildExistingLookups(existingPatients);

    const results = {
      reportType,
      dryRun,
      agency_id: agencyId,
      agency_name: tenant.agencyName,
      processed: 0,
      created: 0,
      matchedExisting: 0,
      discharged: 0,
      archived: 0,
      skippedInFileDuplicates: 0,
      noChanges: 0,
      willCreate: 0,
      willDischarge: 0,
      errors: [],
      // Per-row outcome for the preview table. action is one of:
      // create | matched | needs_review | discharge | no_change | in_file_duplicate | error
      plan: [],
    };

    const existingLabel = (p) => {
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      return p.medical_record_number ? `${name} (MRN ${p.medical_record_number})` : name;
    };

    const createQueue = [];
    const dischargeQueue = [];
    const seenUploadKeys = new Set();
    const queuedDischargeIds = new Set();

    for (const rawRow of rawRows) {
      const hasData = Object.values(rawRow.data).some(Boolean);
      if (!hasData) continue;

      results.processed++;
      const patient = parseUploadedPatient(rawRow.data, rawRow.rowNumber);

      if (!patient.first_name || !patient.last_name) {
        const error = 'Missing patient name; first and last name are required for verification.';
        results.errors.push({ row: rawRow.rowNumber, patient: patient.patientLabel, error });
        results.plan.push({ row: rawRow.rowNumber, action: 'error', patient: patient.patientLabel, detail: error });
        continue;
      }

      const uploadKeys = buildUploadKeys(patient);

      if (uploadKeys.length === 0) {
        const error = 'Cannot safely verify this patient. Provide an MRN or a name with DOB.';
        results.errors.push({ row: rawRow.rowNumber, patient: patient.patientLabel, error });
        results.plan.push({ row: rawRow.rowNumber, action: 'error', patient: patient.patientLabel, detail: error });
        continue;
      }

      if (uploadKeys.some(key => seenUploadKeys.has(key))) {
        results.skippedInFileDuplicates++;
        const error = 'This patient appears more than once in the uploaded file.';
        results.errors.push({ row: rawRow.rowNumber, patient: patient.patientLabel, error });
        results.plan.push({ row: rawRow.rowNumber, action: 'in_file_duplicate', patient: patient.patientLabel, detail: error });
        continue;
      }

      uploadKeys.forEach(key => seenUploadKeys.add(key));

      const matchResult = resolveMatch(patient, existingByMrn, existingByNameDob);
      if (matchResult.error) {
        results.errors.push({ row: rawRow.rowNumber, patient: patient.patientLabel, error: matchResult.error });
        results.plan.push({ row: rawRow.rowNumber, action: 'error', patient: patient.patientLabel, detail: matchResult.error });
        continue;
      }

      if (matchResult.match && matchResult.match.agency_id !== agencyId) {
        // A chart with no recorded agency: never duplicate it, never touch it.
        const error = `Matched by ${matchResult.matchedBy} to ${existingLabel(matchResult.match)}, a chart with no agency recorded — resolve that chart before importing this row.`;
        results.errors.push({ row: rawRow.rowNumber, patient: patient.patientLabel, error });
        results.plan.push({ row: rawRow.rowNumber, action: 'needs_review', patient: patient.patientLabel, detail: error });
        continue;
      }

      if (reportType === 'active_census') {
        if (matchResult.match) {
          results.matchedExisting++;
          results.noChanges++;
          // An ARCHIVED/discharged chart on an active-census row means the
          // patient is back — flag it for review (this import never
          // reactivates automatically).
          const archivedMatch = matchResult.match.is_archived || matchResult.match.status === 'discharged';
          results.plan.push({
            row: rawRow.rowNumber,
            action: archivedMatch ? 'needs_review' : 'matched',
            patient: patient.patientLabel,
            detail: archivedMatch
              ? `On the active census but the chart is ${matchResult.match.status || 'archived'} (matched by ${matchResult.matchedBy} to ${existingLabel(matchResult.match)}) — possible readmission, restore/reactivate the chart manually`
              : `Already in system — matched by ${matchResult.matchedBy} to ${existingLabel(matchResult.match)}`,
          });
          continue;
        }

        results.willCreate++;
        results.plan.push({ row: rawRow.rowNumber, action: 'create', patient: patient.patientLabel, detail: 'New patient — will be added' });
        createQueue.push({
          rowNumber: rawRow.rowNumber,
          patientLabel: patient.patientLabel,
          requestKey: uploadKeys[0],
          payload: {
            first_name: patient.first_name,
            middle_name: patient.middle_name || undefined,
            last_name: patient.last_name,
            date_of_birth: patient.date_of_birth || undefined,
            medical_record_number: patient.medical_record_number || undefined,
            admission_date: patient.admission_date || undefined,
            payor: patient.payor || undefined,
            primary_diagnosis: patient.primary_diagnosis || undefined,
            secondary_diagnoses: patient.secondary_diagnoses.length ? patient.secondary_diagnoses : undefined,
            phone: patient.phone || undefined,
            address: patient.address || undefined,
            care_type: 'home_health',
          },
        });
        continue;
      }

      if (patient.status !== 'discharged') {
        results.noChanges++;
        results.plan.push({ row: rawRow.rowNumber, action: 'no_change', patient: patient.patientLabel, detail: 'Not marked discharged in this report — no change' });
        continue;
      }

      if (!matchResult.match) {
        const error = 'No matching patient was found in the system for this discharged record.';
        results.errors.push({ row: rawRow.rowNumber, patient: patient.patientLabel, error });
        results.plan.push({ row: rawRow.rowNumber, action: 'error', patient: patient.patientLabel, detail: error });
        continue;
      }

      // Check the in-file duplicate BEFORE counting matchedExisting, so a row
      // that resolves to an already-queued patient (via a different match key)
      // is tallied once as a duplicate rather than in both buckets.
      if (queuedDischargeIds.has(matchResult.match.id)) {
        results.skippedInFileDuplicates++;
        results.plan.push({ row: rawRow.rowNumber, action: 'in_file_duplicate', patient: patient.patientLabel, detail: 'Same patient already queued for discharge from an earlier row' });
        continue;
      }

      results.matchedExisting++;

      if (matchResult.match.status === 'discharged' && matchResult.match.is_archived) {
        results.noChanges++;
        results.plan.push({ row: rawRow.rowNumber, action: 'no_change', patient: patient.patientLabel, detail: 'Already discharged and archived — no change' });
        continue;
      }

      results.willDischarge++;
      results.plan.push({
        row: rawRow.rowNumber,
        action: 'discharge',
        patient: patient.patientLabel,
        detail: `Will discharge + archive — matched by ${matchResult.matchedBy} to ${existingLabel(matchResult.match)}`,
      });
      queuedDischargeIds.add(matchResult.match.id);
      dischargeQueue.push({
        id: matchResult.match.id,
        patientLabel: patient.patientLabel,
        payload: {
          status: 'discharged',
          is_archived: true,
          discharge_date: patient.discharge_date || new Date().toISOString().slice(0, 10),
        },
      });
    }

    // Preview mode stops here: report the plan and planned counts, write nothing.
    if (dryRun) {
      return respond({ success: true, results });
    }

    // New charts go through the reviewed creation broker as the caller, with a
    // request id derived from the agency and the row's match key so a retried
    // import cannot mint a second chart for the same row.
    await runInBatches(createQueue, CREATE_BATCH, async (item) => {
      try {
        const clientRequestId = `roster-import-${await sha256Hex(`${agencyId}|${item.requestKey}`)}`;
        const payload = Object.fromEntries(Object.entries(item.payload).filter(([, value]) => value !== undefined));
        const response = await base44.functions.invoke('createAuthorizedPatient', {
          ...payload,
          agency_id: agencyId,
          client_request_id: clientRequestId,
        });
        const data = response && typeof response === 'object' && 'data' in response ? response.data : response;
        if (!data || data.success === false) throw new Error(data?.error || 'Patient could not be created');
        results.created++;
      } catch (error) {
        results.errors.push({
          row: item.rowNumber,
          patient: item.patientLabel,
          error: invokeErrorMessage(error),
        });
      }
    });

    // Discharges touch only charts recorded in this agency, re-read immediately
    // before the write so a chart moved or merged since the preview is skipped.
    await runInBatches(dischargeQueue, 25, async (item) => {
      try {
        const current = await base44.asServiceRole.entities.Patient.filter({ id: item.id }, undefined, 2);
        const row = Array.isArray(current) && current.length === 1 ? current[0] : null;
        if (!row || row.id !== item.id || row.agency_id !== agencyId || row.status === 'merged') {
          throw new Error('The matched chart changed since the preview; it was not discharged.');
        }
        await base44.asServiceRole.entities.Patient.update(item.id, item.payload);
        results.discharged++;
        results.archived++;
      } catch (error) {
        results.errors.push({
          patient: item.patientLabel,
          error: error?.message?.startsWith('The matched chart changed') ? error.message : 'The chart could not be discharged',
        });
      }
    });

    return respond({
      success: true,
      results,
    });
  } catch (error) {
    console.error('processPatientFileUpdate failed:', error?.message || error);
    return respond({
      success: false,
      error: 'Internal server error',
    }, 500);
  }
});
