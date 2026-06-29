import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
// SSRF guard: only fetch https URLs on public hosts, never internal IPs /
// metadata. Set FILE_URL_ALLOWED_HOSTS (comma-separated) to restrict to your
// storage host(s).
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
  const allow = Deno.env.get('FILE_URL_ALLOWED_HOSTS');
  if (allow) {
    const hosts = allow.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (!hosts.some((h) => host === h || host.endsWith('.' + h))) return false;
  }
  return true;
}
// <<<END SHARED HELPER: isSafeFetchUrl>>>

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
    const user = await base44.auth.me();

    if (!isAdminUser(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { file_url } = await req.json();
    if (!file_url) {
      return Response.json({ error: 'file_url is required' }, { status: 400 });
    }
    if (!isSafeFetchUrl(file_url)) {
      return Response.json({ error: 'Invalid or disallowed file_url' }, { status: 400 });
    }

    // Follow redirects manually so each hop is re-validated. With the default
    // redirect:'follow', isSafeFetchUrl only checks the first URL and a 3xx to
    // http://169.254.169.254/... or an internal IP would be fetched anyway.
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

    const text = await response.text();
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

    const providerMap = new Map();
    for (const provider of existingProviders) {
      const key = cleanValue(provider.npi_number) || `${cleanValue(provider.full_name).toLowerCase()}|${cleanPhone(provider.fax_number)}`;
      if (key) providerMap.set(key, provider);
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

      const existingProvider = providerMap.get(providerKey);
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});