import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
  const admission_date = normalizeDob(firstOf(row, ['admission_date', 'soc_date', 'start_of_care', 'admit_date']));
  const discharge_date = normalizeDob(firstOf(row, ['discharge_date', 'dc_date', 'discharged_on']));
  const rawStatus = firstOf(row, ['status', 'patient_status']).toLowerCase();
  // Constrain to the Patient.status enum (active/discharged/hospitalized/merged);
  // an arbitrary CSV value would be written verbatim and silently dropped. Unknown
  // values map to '' so the Patient.status default ('active') applies intentionally.
  const status = rawStatus.includes('discharg') ? 'discharged'
    : rawStatus.includes('hospital') ? 'hospitalized'
    : rawStatus.includes('active') ? 'active'
    : '';
  const payor = firstOf(row, ['payor', 'payer', 'insurance', 'primary_insurance']);
  const primary_diagnosis = firstOf(row, ['primary_diagnosis', 'diagnosis', 'dx', 'primary_dx']);
  const secondaryRaw = firstOf(row, ['secondary_diagnoses', 'secondary_diagnosis', 'other_diagnoses']);
  const secondary_diagnoses = secondaryRaw ? secondaryRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : [];
  const phone = firstOf(row, ['phone', 'phone_number', 'home_phone', 'primary_phone']);
  const address = firstOf(row, ['address', 'street_address', 'home_address']);

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
  if (!mrn && !nameDobKey) {
    return { error: 'Cannot safely verify this patient. Provide an MRN or a name with DOB.' };
  }
  return {
    match: mrnMatch || nameDobMatch || null,
    matchedBy: mrnMatch ? 'MRN' : nameDobMatch ? 'Name + DOB' : null,
  };
}

// SSRF guard: only fetch https URLs on public hosts, never internal IPs /
// metadata. Set FILE_URL_ALLOWED_HOSTS (comma-separated) to restrict to your
// storage host(s). Set FILE_URL_STRICT=true to make that allowlist MANDATORY —
// with strict on and no allowlist configured, all external fetches are rejected
// (fully closes the SSRF surface) rather than allowing any public host.
// (Allowlisting also mitigates DNS rebinding.)
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
  const hosts = (allow || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (hosts.length > 0) {
    if (!hosts.some((h) => host === h || host.endsWith('.' + h))) return false;
  } else if (Deno.env.get('FILE_URL_STRICT') === 'true') {
    // Strict mode with no allowlist configured: fail closed (allow nothing).
    return false;
  }
  return true;
}

const runInBatches = async (items, batchSize, worker) => {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.all(batch.map(worker));
  }
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const reportType = body.report_type === 'discharge_report' ? 'discharge_report' : 'active_census';
    // Preview mode: classify every row and return the plan without writing
    // anything, so an admin can review which patients would be added vs.
    // matched to existing records before committing the import.
    const dryRun = body.dry_run === true || body.mode === 'preview';
    let fileContent = cleanValue(body.file_content);

    if (!fileContent && body.file_url) {
      if (!isSafeFetchUrl(body.file_url)) return Response.json({ success: false, error: 'Invalid or disallowed file_url' }, { status: 400 });
      const fileResponse = await fetch(body.file_url);
      if (!fileResponse.ok) {
        return Response.json({ success: false, error: 'Failed to read the uploaded file' }, { status: 400 });
      }
      fileContent = await fileResponse.text();
    }

    if (!fileContent) {
      return Response.json({ success: false, error: 'CSV file content is required' }, { status: 400 });
    }

    // Full CSV parse (handles quoted commas, escaped quotes, and embedded
    // newlines) so a single logical record never gets split across rows.
    const records = parseCsv(fileContent);
    if (records.length < 2) {
      return Response.json({ success: false, error: 'CSV file must include a header row and at least one patient row' }, { status: 400 });
    }

    const headers = records[0];
    const rawRows = records.slice(1).map((cols, index) => ({
      rowNumber: index + 2,
      data: buildRowObject(headers, cols),
    }));

    const existingPatients = await base44.asServiceRole.entities.Patient.list('-created_date', 2000);
    const { existingByMrn, existingByNameDob } = buildExistingLookups(existingPatients);

    const results = {
      reportType,
      dryRun,
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
      // create | matched | discharge | no_change | in_file_duplicate | error
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

      if (reportType === 'active_census') {
        if (matchResult.match) {
          results.matchedExisting++;
          results.noChanges++;
          results.plan.push({
            row: rawRow.rowNumber,
            action: 'matched',
            patient: patient.patientLabel,
            detail: `Already in system — matched by ${matchResult.matchedBy} to ${existingLabel(matchResult.match)}`,
          });
          continue;
        }

        results.willCreate++;
        results.plan.push({ row: rawRow.rowNumber, action: 'create', patient: patient.patientLabel, detail: 'New patient — will be added' });
        createQueue.push({
          rowNumber: rawRow.rowNumber,
          patientLabel: patient.patientLabel,
          payload: {
            first_name: patient.first_name,
            middle_name: patient.middle_name || undefined,
            last_name: patient.last_name,
            date_of_birth: patient.date_of_birth || undefined,
            medical_record_number: patient.medical_record_number || undefined,
            admission_date: patient.admission_date || undefined,
            status: patient.status || 'active',
            payor: patient.payor || undefined,
            primary_diagnosis: patient.primary_diagnosis || undefined,
            secondary_diagnoses: patient.secondary_diagnoses.length ? patient.secondary_diagnoses : undefined,
            phone: patient.phone || undefined,
            address: patient.address || undefined,
            care_type: 'home_health',
            is_archived: false,
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
      return Response.json({ success: true, results });
    }

    await runInBatches(createQueue, 25, async (item) => {
      try {
        await base44.asServiceRole.entities.Patient.create(item.payload);
        results.created++;
      } catch (error) {
        results.errors.push({
          row: item.rowNumber,
          patient: item.patientLabel,
          error: error.message,
        });
      }
    });

    await runInBatches(dischargeQueue, 25, async (item) => {
      try {
        await base44.asServiceRole.entities.Patient.update(item.id, item.payload);
        results.discharged++;
        results.archived++;
      } catch (error) {
        results.errors.push({
          patient: item.patientLabel,
          error: error.message,
        });
      }
    });

    return Response.json({
      success: true,
      results,
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
});