import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

import { validatePatientData as ported } from '../../services/pennsync-api/handlers.mjs';
import { buildAdmissionNoteTemplate } from '../../services/pennsync-api/transforms.mjs';

/**
 * Drift guard for handlers ported out of Base44 into services/pennsync-api.
 *
 * A port is only safe if the migrated caller sees what it saw before. This
 * transpiles the original Deno entry, imports its pure validator, and asserts
 * the ported implementation returns identical errors for every case below.
 * If either side changes, this fails before a caller is migrated.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadOriginal(entryPath, name) {
  let source = await readFile(new URL(entryPath, import.meta.url), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, 'const createClientFromRequest = () => ({});');
  assert.ok(new RegExp(`(function|const)\\s+${name}\\b`).test(source), `${name} not found in ${entryPath}`);
  const js = transpileTs(source).outputText;
  const temporary = join(tmpdir(), `portparity_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(temporary, `${js}\nexport { ${name} };\n`);
  try { return (await import(pathToFileURL(temporary).href))[name]; }
  finally { await unlink(temporary).catch(() => {}); }
}

const base = { first_name: 'Synthetic', last_name: 'Patient', date_of_birth: '1950-04-02' };
const CASES = [
  base,
  {},
  { ...base, first_name: '' },
  { ...base, first_name: '   ' },
  { ...base, last_name: null },
  { ...base, date_of_birth: undefined },
  { ...base, date_of_birth: '02-04-1950' },
  { ...base, date_of_birth: '2024-13-45' },
  { ...base, date_of_birth: '2999-01-01' },
  { ...base, email: 'clinician@example.test' },
  { ...base, email: 'not-an-email' },
  { ...base, email: '' },
  { ...base, phone: '5551234567' },
  { ...base, phone: '15551234567' },
  { ...base, phone: '25551234567' },
  { ...base, phone: '555' },
  { ...base, emergency_contact_phone: '123' },
  { ...base, physician_email: 'bad@' },
  { ...base, physician_phone: '5551234567' },
  { ...base, caregiver_email: 'caregiver@example.test' },
  { ...base, caregiver_phone: '123' },
  { ...base, admission_date: '2026-01-15' },
  { ...base, admission_date: '15-01-2026' },
  { ...base, admission_date: '' },
  { first_name: '', last_name: '', date_of_birth: 'nope', email: 'x', phone: '1', admission_date: 'y' },
];

test('the ported patient validator matches its Base44 original exactly', async () => {
  const original = await loadOriginal('../functions/validatePatientData/entry.ts', 'validatePatientData');
  for (const patient of CASES) {
    assert.deepEqual(ported(patient), original(patient),
      `ported validatePatientData drifted for ${JSON.stringify(patient)}`);
  }
});

const REFERRAL_CASES = [
  {},
  { admission_details: { referral_reason: 'Wound care after discharge' } },
  { admission_details: { referral_reason: 'Wound care', clinical_history: 'Admitted 3/2 for cellulitis.' } },
  { diagnoses: { past_medical_history: [{ condition: 'CHF' }, { condition: 'COPD' }] } },
  // A mixed list: strings and objects, plus entries that must be dropped.
  { diagnoses: { past_medical_history: ['Diabetes', { condition: 'CKD' }, { onset_date: '2020-01-01' }, null] } },
  { diagnoses: { past_medical_history: [] } },
  { diagnoses: { allergies: 'Penicillin' } },
  { medications: [{ name: 'Lasix', dosage: '40mg', frequency: 'daily' }] },
  { medications: [{ name: 'Lasix' }, { name: 'Eliquis', frequency: 'BID' }] },
  { medications: [] },
  { skilled_needs: { services_ordered: ['SN', 'PT'] } },
  { skilled_needs: { services_ordered: [] } },
  { skilled_needs: { goals_of_care: 'Independent with dressing changes' } },
  { clinical_info: { vital_signs: 'BP 130/82, HR 78, T 98.4' } },
  {
    admission_details: { referral_reason: 'SOC', clinical_history: 'History' },
    diagnoses: { past_medical_history: [{ condition: 'CHF' }], allergies: 'Sulfa' },
    medications: [{ name: 'Lasix', dosage: '40mg', frequency: 'daily' }],
    skilled_needs: { services_ordered: ['SN'], goals_of_care: 'Wound closure' },
    clinical_info: { vital_signs: 'BP 130/82' },
  },
];

test('the ported admission note template matches its Base44 original exactly', async () => {
  const original = await loadOriginal('../functions/extractReferralDataForSmartNote/entry.ts', 'generateAdmissionNoteTemplate');
  for (const refData of REFERRAL_CASES) {
    assert.equal(buildAdmissionNoteTemplate(refData), original(refData),
      `ported admission note drifted for ${JSON.stringify(refData)}`);
  }
});
