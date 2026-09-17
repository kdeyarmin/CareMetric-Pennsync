import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. The allowlist is hardcoded (always-on, fail-closed)
// rather than env-configured; add a host here if file storage ever moves.
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}
// <<<END SHARED HELPER: isSafeFetchUrl>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

const normalizeHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const cleanValue = (value) => String(value || '').replace(/\uFEFF/g, '').trim();
const cleanPhone = (value) => cleanValue(value).replace(/[^0-9]/g, '');

function parseCSV(text) {
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
      if (row.some((cell) => String(cell || '').trim() !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => String(cell || '').trim() !== '')) rows.push(row);
  return rows;
}

function titleCase(text) {
  return cleanValue(text)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatProviderName(rawName) {
  const name = cleanValue(rawName);
  if (!name) return '';
  if (name.includes(',')) {
    // "Last, First [Middle/credentials]" — keep every segment after the first comma
    // as the given-name portion instead of dropping it (split destructure would lose
    // a 3rd part, e.g. "Smith, John, MD" -> "John Smith").
    const parts = name.split(',');
    const last = parts[0];
    const first = parts.slice(1).join(' ');
    return `${titleCase(first)} ${titleCase(last)}`.replace(/\s+/g, ' ').trim();
  }
  return titleCase(name);
}

async function processInChunks(items, handler, chunkSize = 3) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(chunk.map(handler));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!isAdminUser(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let input;
    try { input = await req.json(); }
    catch { return Response.json({ error: 'Invalid CSV import request' }, { status: 400 }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return Response.json({ error: 'Invalid CSV import request' }, { status: 400 });
    }
    const direct = Object.hasOwn(input, 'csv_text');
    const legacy = Object.hasOwn(input, 'file_url');
    if (direct === legacy) {
      return Response.json({ error: 'Provide exactly one CSV source: csv_text or file_url' }, { status: 400 });
    }
    const maxCsvBytes = 10 * 1024 * 1024;
    let text;
    if (direct) {
      // A provider directory CSV needs no storage upload or AI integration.
      // Keep the existing privileged import/record rules and a legacy URL path
      // for already-published clients; do not reinterpret an uploaded URL.
      if (typeof input.csv_text !== 'string' || !input.csv_text.trim()) {
        return Response.json({ error: 'csv_text must contain a CSV document' }, { status: 400 });
      }
      if (input.csv_text.length > maxCsvBytes || new TextEncoder().encode(input.csv_text).byteLength > maxCsvBytes) {
        return Response.json({ error: 'CSV must be no larger than 10 MB' }, { status: 413 });
      }
      text = input.csv_text;
    } else {
      const file_url = input.file_url;
      if (typeof file_url !== 'string' || !isSafeFetchUrl(file_url)) {
        return Response.json({ error: 'Invalid or disallowed file_url' }, { status: 400 });
      }
      // Existing hosted links remain supported and every redirect is validated.
      let response;
      let nextUrl = file_url;
      for (let hop = 0; hop < 4; hop++) {
        response = await fetch(nextUrl, { redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) break;
          const resolved = new URL(location, nextUrl).toString();
          if (!isSafeFetchUrl(resolved)) {
            return Response.json({ error: 'Redirect to a disallowed host blocked' }, { status: 400 });
          }
          nextUrl = resolved;
          continue;
        }
        break;
      }
      if (!response || !response.ok) {
        return Response.json({ error: 'Unable to download CSV file' }, { status: 400 });
      }
      text = await response.text();
    }
    const parsedRows = parseCSV(text);
    if (parsedRows.length < 2) {
      return Response.json({ error: 'CSV file is empty' }, { status: 400 });
    }

    const headers = parsedRows[0].map(normalizeHeader);
    const rows = parsedRows.slice(1);
    const columnIndex = (name) => headers.findIndex((header) => header === name);
    const getCell = (row, name) => {
      const index = columnIndex(name);
      return index === -1 ? '' : cleanValue(row[index]);
    };

    const existingProviders = await base44.asServiceRole.entities.Physician.list('-updated_date', 5000);

    const providerMapByNpi = new Map();
    const providerMapByNameFax = new Map();
    for (const provider of existingProviders) {
      const npiKey = cleanValue(provider.npi_number);
      if (npiKey) providerMapByNpi.set(npiKey, provider);
      const providerName = cleanValue(provider.full_name);
      const providerFax = cleanPhone(provider.fax_number);
      if (providerName && providerFax) providerMapByNameFax.set(`${providerName.toLowerCase()}|${providerFax}`, provider);
    }

    const providerCreates = [];
    const providerUpdates = [];
    const seenProviderKeys = new Set();
    let skippedRows = 0;

    for (const row of rows) {
      const full_name = formatProviderName(getCell(row, 'physician_name'));
      const credentials = getCell(row, 'title');
      const fax_number = cleanPhone(getCell(row, 'fax_number'));
      const phone_number = cleanPhone(getCell(row, 'work_number'));
      const npi_number = cleanValue(getCell(row, 'npi'));

      if (!full_name || !fax_number) {
        skippedRows += 1;
        continue;
      }

      const providerKey = npi_number || `${full_name.toLowerCase()}|${fax_number}`;
      if (seenProviderKeys.has(providerKey)) continue;
      seenProviderKeys.add(providerKey);

      const specialty = getCell(row, 'specialty');
      const practice_name = getCell(row, 'primary_organization_name');

      const providerPayload = {
        full_name,
        credentials,
        provider_type: credentials,
        specialty: specialty || '',
        practice_name: practice_name || '',
        company: getCell(row, 'company'),
        top_unit: getCell(row, 'top_unit'),
        parent_unit: getCell(row, 'parent_unit'),
        sub_unit: getCell(row, 'sub_unit'),
        phone_number,
        fax_number,
        npi_number,
        state_license: getCell(row, 'state_license'),
        preferred_contact_method: 'fax',
        is_active: true,
        accepts_home_health: true,
        notes: 'Imported from provider CSV'
      };

      const existingProvider = (npi_number && providerMapByNpi.get(npi_number)) || providerMapByNameFax.get(`${full_name.toLowerCase()}|${fax_number}`);
      if (existingProvider) {
        providerUpdates.push({ id: existingProvider.id, data: providerPayload });
      } else {
        providerCreates.push(providerPayload);
      }

    }

    await processInChunks(providerCreates, (item) => base44.asServiceRole.entities.Physician.create(item));
    await processInChunks(providerUpdates, (item) => base44.asServiceRole.entities.Physician.update(item.id, item.data));

    return Response.json({
      success: true,
      created_providers: providerCreates.length,
      updated_providers: providerUpdates.length,
      skipped_rows: skippedRows
    });
  } catch (error) {
    console.error('importProvidersCsv failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});