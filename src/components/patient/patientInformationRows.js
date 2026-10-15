// Turns a purpose-bound patient projection into labelled rows for the
// Patient Details information card. Pure, so the rendering rules are tested
// without a chart: empty fields are left out, lists and nested records become
// readable lines, and nothing is invented for a field the read did not return.

import { formatAge, formatLocalDate } from '@/lib/dateLocal';

const humanize = (key) => String(key)
  .replace(/_/g, ' ')
  .replace(/\b(bp|bmi|adl|dnr)\b/gi, (word) => word.toUpperCase())
  .replace(/^./, (first) => first.toUpperCase());

const isBlank = (value) => value === null || value === undefined
  || (typeof value === 'string' && !value.trim())
  || (Array.isArray(value) && value.length === 0);

function scalar(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = String(value).trim();
  // A stored enum token (full_code, home_health) reads as words.
  return /^[a-z]+(?:_[a-z]+)+$/.test(text) ? humanize(text) : text;
}

// One record (a medication, a wound, a hospitalization) as one line. A
// "name"-like field leads; the rest follow as "label: value".
function recordLine(record) {
  if (!record || typeof record !== 'object') return isBlank(record) ? '' : scalar(record);
  const lead = ['name', 'condition', 'location', 'reason'].find((key) => !isBlank(record[key]));
  const rest = Object.entries(record)
    .filter(([key, value]) => key !== lead && !isBlank(value) && typeof value !== 'object')
    .map(([key, value]) => `${humanize(key)}: ${scalar(value)}`);
  return [lead ? scalar(record[lead]) : null, rest.join(', ')].filter(Boolean).join(' — ');
}

/** The lines one field value renders as; [] means the field is left out. */
export function patientValueLines(value) {
  if (isBlank(value)) return [];
  if (Array.isArray(value)) return value.map(recordLine).filter(Boolean);
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, inner]) => !isBlank(inner) && typeof inner !== 'object')
      .map(([key, inner]) => `${humanize(key)}: ${scalar(inner)}`);
  }
  return [scalar(value)];
}

// Display order and labels. Fields a purpose does not return are skipped.
const FIELDS = [
  ['date_of_birth', 'Date of birth'],
  ['medical_record_number', 'Medical record number'],
  ['status', 'Status'],
  ['care_type', 'Care type'],
  ['admission_date', 'Admission date'],
  ['admission_source', 'Admission source'],
  ['primary_diagnosis', 'Primary diagnosis'],
  ['secondary_diagnoses', 'Secondary diagnoses'],
  ['chronic_conditions', 'Chronic conditions'],
  ['allergies', 'Allergies'],
  ['current_medications', 'Current medications'],
  ['past_medical_history', 'Past medical history'],
  ['past_hospitalizations', 'Past hospitalizations'],
  ['functional_status', 'Functional status'],
  ['wounds', 'Wounds'],
  ['baseline_vitals', 'Baseline vitals'],
  ['social_history', 'Social history'],
  ['advance_directives', 'Advance directives'],
];

const ENUM_FIELDS = new Set(['status', 'care_type', 'admission_source']);

export function patientInformationRows(patient, now = new Date()) {
  if (!patient || typeof patient !== 'object') return [];
  const rows = [];
  for (const [key, label] of FIELDS) {
    if (!Object.hasOwn(patient, key)) continue;
    let lines;
    if (key === 'date_of_birth' || key === 'admission_date') {
      const formatted = isBlank(patient[key]) ? '' : formatLocalDate(patient[key]);
      lines = formatted ? [key === 'date_of_birth' ? `${formatted} (age ${formatAge(patient[key], now)})` : formatted] : [];
    } else if (ENUM_FIELDS.has(key) && typeof patient[key] === 'string') {
      lines = isBlank(patient[key]) ? [] : [humanize(patient[key])];
    } else {
      lines = patientValueLines(patient[key]);
    }
    if (lines.length) rows.push({ key, label, lines });
  }
  return rows;
}
