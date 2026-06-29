// Pure, dependency-free helpers for the patient roster CSV import.
//
// These are kept free of any Deno/Base44 runtime APIs so they can be unit
// tested with `node --test` and reused by the edge function in entry.ts.
// The duplicate-detection contract lives here: parsing, normalization, the
// keys used to recognize the same person, and the matching against existing
// patients.

export const cleanValue = (value) => String(value ?? '').replace(/\uFEFF/g, '').trim();
export const normalizeHeader = (value) => cleanValue(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const normalizeText = (value) => cleanValue(value).toLowerCase().replace(/\s+/g, ' ').trim();
export const normalizeName = (value) => normalizeText(value).replace(/[^a-z0-9 ]/g, '');
export const normalizeMrn = (value) => cleanValue(value).toLowerCase().replace(/[^a-z0-9]/g, '');

const isValidYmd = (year, month, day) => {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
  );
};

// Convert a wide range of date inputs to a canonical YYYY-MM-DD string.
//
// Two-digit years are pivoted so they never land in the future relative to
// `referenceYear` (default: today). This matters for dates of birth: an input
// like "04/15/45" must resolve to 1945-04-15, not 2045-04-15, otherwise the
// same patient on a re-upload would not match an existing record and a
// duplicate would be created.
export const toIsoDate = (value, referenceYear = new Date().getUTCFullYear()) => {
  const raw = cleanValue(value);
  if (!raw) return null;

  const pivotYear = (year) => {
    if (year.length !== 2) return year;
    const candidate = 2000 + Number(year);
    return String(candidate > referenceYear ? candidate - 100 : candidate);
  };

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return isValidYmd(year, month, day) ? raw : null;
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
  if (slashMatch) {
    let [, month, day, year] = slashMatch;
    year = pivotYear(year);
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return isValidYmd(year, month, day) ? iso : null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

// Full RFC-4180-style CSV parser that returns an array of records (each an
// array of cleaned field values). Unlike a naive line split, this correctly
// handles quoted fields that contain commas, escaped quotes, and embedded
// newlines, so a value like "123 Main St,\nApt 2" stays in a single field
// instead of corrupting the record boundaries.
export const parseCsv = (content) => {
  const text = String(content ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field.trim() === '') {
      // RFC-4180: a quote only opens a quoted field at the start of the field
      // (leading whitespace before it is dropped). A quote anywhere else is a
      // literal character, so values like He said "hi" are preserved as-is.
      inQuotes = true;
      field = '';
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  record.push(field);
  records.push(record);

  return records
    .map((row) => row.map((value) => cleanValue(value)))
    .filter((row) => row.some((value) => value !== ''));
};

// Parse a single CSV line (no embedded newlines). Retained for callers/tests
// that work line-by-line; parseCsv is preferred for whole files.
export const parseCsvLine = (line) => parseCsv(line)[0] || [];

export const parseFullName = (value) => {
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
  if (parts.length === 1) {
    return { first_name: parts[0], middle_name: '', last_name: '' };
  }

  return {
    first_name: parts[0] || '',
    middle_name: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    last_name: parts[parts.length - 1] || '',
  };
};

export const normalizeStatus = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return 'active';
  if (normalized.includes('discharg')) return 'discharged';
  if (normalized.includes('hospital')) return 'hospitalized';
  return 'active';
};

export const buildAddress = (row) => {
  const line1 = cleanValue(row.addr_1_care || row.address || row.care_address_1);
  const line2 = cleanValue(row.addr_2_care || row.care_address_2);
  const apt = cleanValue(row.apt_care || row.apartment || row.unit);
  const city = cleanValue(row.city_care || row.city);
  const state = cleanValue(row.state_care || row.state);
  const zip = cleanValue(row.zip_code_care || row.zip || row.zip_code);

  const streetParts = [line1, line2, apt ? `Apt ${apt}` : ''].filter(Boolean).join(', ');
  const localityParts = [city, state, zip].filter(Boolean).join(', ');
  return [streetParts, localityParts].filter(Boolean).join(' • ');
};

export const buildRowObject = (headers, row) => {
  const mapped = {};
  headers.forEach((header, index) => {
    mapped[normalizeHeader(header) || `column_${index}`] = cleanValue(row[index]);
  });
  return mapped;
};

// Canonical "same person by identity" key: requires first, last, and a valid
// DOB. Returns null when any are missing so callers fall back to MRN.
export const getNameDobKey = (patient) => {
  const first = normalizeName(patient.first_name);
  const last = normalizeName(patient.last_name);
  const dob = toIsoDate(patient.date_of_birth);
  if (!first || !last || !dob) return null;
  return `${first}|${last}|${dob}`;
};

export const pushToLookup = (map, key, value) => {
  if (!key) return;
  const existing = map.get(key) || [];
  existing.push(value);
  map.set(key, existing);
};

// Build the MRN and Name+DOB lookup maps from the existing roster so uploads
// can be matched against patients already in the system.
export const buildExistingLookups = (existingPatients) => {
  const existingByMrn = new Map();
  const existingByNameDob = new Map();
  (existingPatients || []).forEach((patient) => {
    pushToLookup(existingByMrn, normalizeMrn(patient.medical_record_number), patient);
    pushToLookup(existingByNameDob, getNameDobKey(patient), patient);
  });
  return { existingByMrn, existingByNameDob };
};

export const parseUploadedPatient = (row, rowNumber) => {
  const parsedName = parseFullName(row.patient || `${row.first_name || ''} ${row.last_name || ''}`.trim());
  const firstName = cleanValue(row.first_name || parsedName.first_name);
  const lastName = cleanValue(row.last_name || parsedName.last_name);
  const middleName = cleanValue(row.middle_name || parsedName.middle_name);
  const dob = toIsoDate(row.dob || row.date_of_birth);
  const admissionDate = toIsoDate(row.admitted_date || row.admission_date);
  const medicalRecordNumber = cleanValue(row.mrn || row.medical_record_number);
  const status = normalizeStatus(row.current_admission_status || row.status);
  const address = buildAddress(row);
  const secondaryDiagnoses = cleanValue(row.secondary_diagnosis)
    .split(/[;,]/)
    .map((item) => cleanValue(item))
    .filter(Boolean);

  return {
    rowNumber,
    patientLabel: cleanValue(row.patient) || `${firstName} ${lastName}`.trim() || `Row ${rowNumber}`,
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    date_of_birth: dob,
    medical_record_number: medicalRecordNumber,
    admission_date: admissionDate,
    status,
    payor: cleanValue(row.primary_payor || row.payor),
    primary_diagnosis: cleanValue(row.primary_diagnosis),
    secondary_diagnoses: secondaryDiagnoses,
    phone: cleanValue(row.home_phone || row.phone),
    address,
    care_type: 'home_health',
    is_archived: false,
  };
};

// The keys that identify a row within the uploaded file. A row is an in-file
// duplicate when ANY of its keys was already seen on an earlier row.
export const buildUploadKeys = (patient) => {
  const keys = [];
  const mrnKey = normalizeMrn(patient.medical_record_number);
  const nameDobKey = getNameDobKey(patient);
  if (mrnKey) keys.push(`mrn:${mrnKey}`);
  if (nameDobKey) keys.push(`namedob:${nameDobKey}`);
  return keys;
};

// Resolve an uploaded patient against the existing roster. Matches by MRN
// first, then by Name+DOB. Surfaces ambiguity (the same key shared by several
// existing patients, or MRN and Name+DOB pointing at different people) as an
// error so we never silently update or duplicate the wrong record.
export const resolveMatch = (patient, existingByMrn, existingByNameDob) => {
  const mrnKey = normalizeMrn(patient.medical_record_number);
  const nameDobKey = getNameDobKey(patient);
  const mrnMatches = mrnKey ? (existingByMrn.get(mrnKey) || []) : [];
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

  return {
    match: mrnMatch || nameDobMatch || null,
    matchedBy: mrnMatch ? 'MRN' : nameDobMatch ? 'Name + DOB' : null,
    lookupKeys: {
      mrnKey,
      nameDobKey,
    },
  };
};
