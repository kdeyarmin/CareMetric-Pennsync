import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';

/**
 * Resolving a clinical phrase against the agency's template library.
 *
 * This capability is why D61 exists: `clinical_library_template` reached
 * tenancy only through its OPTIONAL `patient_id`, so every generic and every
 * agency-wide template — nearly all of them — was in no tenant and readable by
 * nobody. With the table carrying its own agency the policies are the whole of
 * the scoping, and the two properties worth the file follow from that: BOTH of
 * the original's five-thousand-row `User` scans are gone, and a template can
 * no longer put a patient field in front of a caller that no read purpose
 * would give them.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PURPOSE = 'services/authority-store/supabase/record-migrations/'
  + '20260920050000_patient_purpose_policy.sql';
const ASSIGNMENT = 'services/authority-store/supabase/record-migrations/'
  + '20260920180000_contract_assignment.sql';
const PHRASE = 'services/authority-store/supabase/record-migrations/'
  + '20260920410000_contract_clinical_phrase.sql';
const ORIGINAL = 'base44/functions/expandClinicalPhrase/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const RESOLVE = 'select "public"."pennsync_contract_clinical_phrase_resolve"($1,$2,$3) as result';
const USED = 'select "public"."pennsync_contract_clinical_phrase_used"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The assignment contract carries `bounded_reason`, which is the trim
  // JavaScript performs and which this reuses rather than declaring a second.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, PURPOSE,
    ASSIGNMENT, PHRASE]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'],
    ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","last_name","primary_diagnosis","allergies","address","phone")
      values ($1,$2,$3,$4,$5,'CHF','penicillin','12 Ada Way','215-555-0100')`,
    [APP, id, agency, first, last]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = true) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    if (commit) await db.exec('commit'); else await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const resolveFor = (n, phrase, patient = null, agency = A) =>
  as(n, RESOLVE, [agency, phrase, patient]);
const used = (n, id, agency = A) => as(n, USED, [agency, id]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

const template = (id, agency, phrase, overrides = {}) => {
  const row = {
    template_type: 'generic', expanded_text: `Expansion of ${phrase}.`,
    is_active: true, is_agency_wide: true, created_by: email(ADMIN_A),
    patient_id: null, patient_data_fields: null, ai_prompt_instructions: null,
    usage_count: null, category: 'assessment', ...overrides,
  };
  const keys = Object.keys(row);
  return db.query(
    `insert into ${SCHEMA}."clinical_library_template"("source_app_id","id","agency_id","phrase",
      ${keys.map(k => `"${k}"`).join(',')})
     values ($1,$2,$3,$4,${keys.map((unused, i) => `$${i + 5}`).join(',')})`,
    [APP, id, agency, phrase, ...keys.map(k => (row[k] !== null && typeof row[k] === 'object'
      ? JSON.stringify(row[k]) : row[k]))]);
};
const reset = () => db.query(`delete from ${SCHEMA}."clinical_library_template"`);
const countOf = async id => (await db.query(
  `select "usage_count" as c from ${SCHEMA}."clinical_library_template" where "id" = $1`,
  [id])).rows[0]?.c;

test('a generic template is the agency s, which is what D61 gave it', async () => {
  // Before D61 this row was in no tenant at all: the table's only tenant path
  // was its optional `patient_id`, and a generic template has none.
  await reset();
  await template('tpl-wound', A, 'wound care');
  const result = await resolveFor(CLINICIAN_A, 'wound care');
  assert.equal(result.template.id, 'tpl-wound');
  assert.equal(result.template.template_type, 'generic');
  assert.equal(result.template.expanded_text, 'Expansion of wound care.');
  assert.equal(result.patient, null);
  assert.equal(result.context, null);
  // A colleague who opens no chart still has the agency's library.
  assert.equal((await resolveFor(CLINICIAN_EMPTY, 'wound care')).template.id, 'tpl-wound');
  // And it stops at the agency boundary — divergences 1 and 4, which delete
  // the original's `User.list(5000)` agency scan and its platform tier.
  assert.equal((await resolveFor(ADMIN_B, 'wound care', null, B)).template, null);
  await refusal(resolveFor(ADMIN_B, 'wound care', null, A), 'PENNSYNC_PHRASE_AGENCY_NOT_HELD');
});

test('the phrase is matched the way the original normalises it', async () => {
  await reset();
  await template('tpl-vitals', A, 'vitals stable');
  for (const asked of ['vitals stable', 'VITALS STABLE', '  Vitals Stable  ',
    ' vitals stable ']) {
    assert.equal((await resolveFor(CLINICIAN_A, asked)).template?.id, 'tpl-vitals', asked);
  }
  // Divergence 5: `bounded_reason` is the trim JavaScript performs, so a
  // non-breaking space is stripped where `btrim` would have kept it.
  assert.equal((await resolveFor(CLINICIAN_A, 'vitals')).template, null, 'not a prefix match');
  for (const empty of ['', '   ', ' ']) {
    await refusal(resolveFor(CLINICIAN_A, empty), 'PENNSYNC_PHRASE_REQUIRED');
  }
  // An inactive template answers nothing, as the original's filter has it.
  await db.query(`update ${SCHEMA}."clinical_library_template" set "is_active" = false`);
  assert.equal((await resolveFor(CLINICIAN_A, 'vitals stable')).template, null);
});

test('a patient-bound template wins, and only for somebody who opens that chart', async () => {
  await reset();
  await template('tpl-generic', A, 'dressing change');
  await template('tpl-bound', A, 'dressing change', {
    template_type: 'patient_specific', patient_id: 'patient-a1',
    ai_prompt_instructions: 'Use the wound measurements.',
    patient_data_fields: ['primary_diagnosis', 'allergies'],
  });
  // The assigned clinician gets the bound one.
  const bound = await resolveFor(CLINICIAN_A, 'dressing change', 'patient-a1');
  assert.equal(bound.template.id, 'tpl-bound');
  assert.equal(bound.patient.name, 'Ada Lovelace');
  // A colleague who opens no chart cannot see the bound row at all, so the
  // generic one answers — which is the original's behaviour once its own
  // re-authorization discards the patient-bound match.
  assert.equal((await resolveFor(CLINICIAN_EMPTY, 'dressing change', 'patient-a1'))
    .template.id, 'tpl-generic');
  // And naming another chart does not reach it.
  assert.equal((await resolveFor(CLINICIAN_A, 'dressing change', 'patient-a2'))
    .template.id, 'tpl-generic');
  // A patient-specific template with no patient named is the original's 400.
  await reset();
  await template('tpl-needs', A, 'wound measure', { template_type: 'patient_specific' });
  await refusal(resolveFor(CLINICIAN_A, 'wound measure'), 'PENNSYNC_PHRASE_SUBJECT_REQUIRED');
});

test('a template may only ask for what the read purpose already discloses', async () => {
  // Divergence 3, and the reason for it: the original interpolates whatever
  // columns a template row names straight into the prompt, so a template could
  // put a field in front of a caller that no read purpose would give them.
  await reset();
  await template('tpl-fields', A, 'assessment', {
    template_type: 'patient_specific', patient_id: 'patient-a1',
    patient_data_fields: ['primary_diagnosis', 'allergies', 'address', 'phone',
      'not_a_column', 'primary_diagnosis'],
  });
  const result = await resolveFor(CLINICIAN_A, 'assessment', 'patient-a1');
  // A field named twice is interpolated twice, because the original's
  // `forEach` appends once per entry. The refusals ARE de-duplicated, because
  // the original has no refusal list at all and a name repeated in an answer
  // says nothing the first one did not.
  assert.deepEqual(result.context_fields,
    ['primary_diagnosis', 'allergies', 'primary_diagnosis']);
  // `address` and `phone` are real columns the patient row HAS, and
  // `smart_note_context` does not disclose them, so they are refused by name.
  assert.deepEqual(result.refused_fields, ['address', 'phone', 'not_a_column']);
  assert.match(result.context, /^primary_diagnosis: "CHF"\n/);
  assert.equal((result.context.match(/primary_diagnosis: "CHF"/g) || []).length, 2);
  // The original's `${field}: ${JSON.stringify(value)}`, so a text value is
  // quoted and a structured one arrives as JSON.
  assert.match(result.context, /allergies: "penicillin"\n/);
  assert.equal(result.context.includes('12 Ada Way'), false, 'the address never reaches a prompt');
  assert.equal(result.context.includes('215-555-0100'), false);
  // The purpose's own ROLE gate is the gate, and it is reached through a
  // `patient_specific` template that is NOT bound to a chart — a bound one is
  // chart-narrowed by the policies, so a caller outside the care team never
  // sees it to be refused for it.
  await reset();
  await template('tpl-unbound', A, 'assessment', {
    template_type: 'patient_specific',
    patient_data_fields: ['primary_diagnosis'],
  });
  assert.equal((await resolveFor(CLINICIAN_A, 'assessment', 'patient-a1'))
    .context_fields.length, 1);
  await db.query(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-2'`);
  await refusal(resolveFor(CLINICIAN_A, 'assessment', 'patient-a1'),
    'PENNSYNC_PHRASE_PURPOSE_FORBIDDEN');
  await db.query(`update pennsync_private.membership set tenant_role = 'clinician'
    where id = 'membership-2'`);
  // And a chart the caller cannot open is refused before any field is read.
  await refusal(resolveFor(CLINICIAN_A, 'assessment', 'patient-a2'),
    'PENNSYNC_PHRASE_PATIENT_NOT_VISIBLE');
});

test('the count is incremented in the statement, not from a snapshot', async () => {
  await reset();
  await template('tpl-count', A, 'education');
  assert.equal(await countOf('tpl-count'), null);
  assert.equal((await used(CLINICIAN_A, 'tpl-count')).usage_count, 1);
  assert.equal((await used(CLINICIAN_A, 'tpl-count')).usage_count, 2);
  assert.equal(await countOf('tpl-count'), 2);
  // Another agency's template is not this agency's to count.
  await template('tpl-theirs', B, 'education');
  await refusal(used(CLINICIAN_A, 'tpl-theirs'), 'PENNSYNC_PHRASE_TEMPLATE_NOT_FOUND');
  await refusal(used(CLINICIAN_A, 'no such id'), 'PENNSYNC_PHRASE_SUBJECT_INVALID');
  await refusal(used(CLINICIAN_A, 'tpl-missing'), 'PENNSYNC_PHRASE_TEMPLATE_NOT_FOUND');
});

test('the scans this contract deletes are still in the original', async () => {
  // Divergences 1 and 4, read from the file rather than remembered: if either
  // reconstruction ever leaves the original, the note in this contract's
  // header stops being true.
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.equal((original.match(/User\s*\n?\s*\.list\('-created_date', 5000\)/g) || []).length, 2,
    'both five-thousand-row agency scans are still there');
  assert.match(original, /isPlatformWide/);
  assert.match(original, /assigned_nurses/);
  const source = readFileSync(resolve(repository, PHRASE), 'utf8');
  const body = source.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  for (const gone of ['agency_name', 'assigned_nurses', 'account_type', 'super_admin']) {
    assert.equal(body.includes(gone), false, `the contract must not read ${gone}`);
  }
});
