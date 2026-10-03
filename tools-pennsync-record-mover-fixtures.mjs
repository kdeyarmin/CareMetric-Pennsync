#!/usr/bin/env node
/**
 * Invented export fixtures for the record mover. Local only.
 *
 * Step 1 of docs-of-record `base44-full-exit/record-mover-design-2026-10-02.md`.
 * It writes a supplied-export directory (the format `tools-pennsync-archive.mjs`
 * seals) from invented data, so the planner, loader and verifier can be built and
 * proven without any real record, any real store or any network.
 *
 * Nothing here is real and nothing may look real: every name is a "Fixture"
 * placeholder, every address ends in `.invalid`, and every id is a counter, so a
 * fixture can never be mistaken for, or collide with, a person. Output is
 * deterministic: two builds of one variant are byte-identical.
 *
 * The base export ("clean") has two source apps, because the design keeps the
 * retired app's records sealed in the same archive as the live app's. Each app
 * has two agencies, so a tenant leak has somewhere to go. Variants plant exactly
 * one defect each, with the finding a planner must report recorded in `expected`,
 * so a later tool is checked against a stated answer and not against itself.
 *
 * A variant the archive tool itself refuses is marked `archiveRefuses` with the
 * code it raises; the rest seal cleanly and are the planner's to catch.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_SOURCE_APPS } from './tools-pennsync-archive.mjs';

export const LIVE_APP = ARCHIVE_SOURCE_APPS.production;
export const LEGACY_APP = ARCHIVE_SOURCE_APPS.legacy;
const sha = (v) => createHash('sha256').update(v).digest('hex');
const EVIDENCE = sha('invented fixture decision only');
const id = (n) => n.toString(16).padStart(24, '0');
const dateOf = (n) => new Date(Date.UTC(2026, 0, 1 + n, 9, 30)).toISOString();

export const VARIANTS = Object.freeze({
  clean: { note: 'Seals cleanly; the planner reports nothing wrong.' },
  bad_enum: {
    note: 'A visit whose status is outside the target column\'s allowed values.',
    expected: { quarantine: [{ app: LIVE_APP, entity: 'Visit', id: id(0x3002), code: 'column_value_refused', column: 'status' }] },
  },
  unknown_field: {
    note: 'A patient carrying a field the target table does not have.',
    expected: { findings: [{ app: LIVE_APP, entity: 'Patient', code: 'field_not_in_target', field: 'legacy_flag' }] },
  },
  unenrolled_author: {
    note: 'A patient authored by someone with an identity mapping who has not been enrolled.',
    expected: { findings: [{ app: LIVE_APP, entity: 'Patient', code: 'author_not_enrolled', count: 1 }] },
  },
  cross_agency_link: {
    note: 'A visit in agency B pointing at a patient in agency A.',
    archiveRefuses: 'reference_agency_mismatch',
  },
  missing_agency: {
    note: 'A patient with no agency at all.',
    archiveRefuses: 'ambiguous_agency',
  },
});

function baseRows(app, index) {
  const o = index * 0x10000;
  const agencies = [
    { id: id(o + 0x1001), agency_name: `Fixture Agency ${index}A`, agency_code: `FXA${index}`, status: 'active' },
    { id: id(o + 0x1002), agency_name: `Fixture Agency ${index}B`, agency_code: `FXB${index}`, status: 'active' },
  ];
  const users = [
    { id: id(o + 0x2001), email: `admin-a-${index}@fixture.invalid`, role: 'agency_admin', phone_number: '', favorited_pages: [], favorited_patients: [], referral_code: `R${index}1`, notification_settings: {}, sending_fax_number: '' },
    { id: id(o + 0x2002), email: `nurse-a-${index}@fixture.invalid`, role: 'user', phone_number: '', favorited_pages: [], favorited_patients: [], referral_code: `R${index}2`, notification_settings: {}, sending_fax_number: '' },
    { id: id(o + 0x2003), email: `admin-b-${index}@fixture.invalid`, role: 'agency_admin', phone_number: '', favorited_pages: [], favorited_patients: [], referral_code: `R${index}3`, notification_settings: {}, sending_fax_number: '' },
  ];
  const patients = [
    { id: id(o + 0x3001), agency_id: agencies[0].id, created_by: users[0].email, created_date: dateOf(1), updated_date: dateOf(2), first_name: 'Fixture', last_name: `Alpha${index}`, status: 'active', care_type: 'home_health', secondary_diagnoses: [{ code: 'Z00.0', note: 'invented' }] },
    { id: id(o + 0x3002), agency_id: agencies[0].id, created_by: users[1].email, created_date: dateOf(3), updated_date: dateOf(3), first_name: 'Fixture', last_name: `Beta${index}`, status: 'active', care_type: 'hospice', secondary_diagnoses: [] },
    { id: id(o + 0x3003), agency_id: agencies[1].id, created_by: users[2].email, created_date: dateOf(4), updated_date: dateOf(5), first_name: 'Fixture', last_name: `Gamma${index}`, status: 'discharged', care_type: 'home_health', secondary_diagnoses: [] },
  ];
  const visits = [
    { id: id(o + 0x4001), agency_id: agencies[0].id, patient_id: patients[0].id, created_by: users[1].email, created_date: dateOf(6), updated_date: dateOf(6), visit_date: '2026-01-07', visit_type: 'routine_visit', status: 'completed' },
    { id: id(o + 0x4002), agency_id: agencies[0].id, patient_id: patients[1].id, created_by: users[1].email, created_date: dateOf(7), updated_date: dateOf(7), visit_date: '2026-01-08', visit_type: 'admission', status: 'scheduled' },
    { id: id(o + 0x4003), agency_id: agencies[1].id, patient_id: patients[2].id, created_by: users[2].email, created_date: dateOf(8), updated_date: dateOf(8), visit_date: '2026-01-09', visit_type: 'discharge', status: 'completed' },
  ];
  const tasks = [
    { id: id(o + 0x5001), agency_id: agencies[0].id, patient_id: patients[0].id, created_by: users[0].email, created_date: dateOf(9), updated_date: dateOf(9), title: 'Fixture follow-up call', priority: 'medium', status: 'pending', type: 'call' },
  ];
  return { app, index, agencies, users, patients, visits, tasks };
}

function applyVariant(sets, variant) {
  const live = sets.find((s) => s.app === LIVE_APP);
  if (variant === 'bad_enum') live.visits[1].status = 'DONE';
  if (variant === 'unknown_field') live.patients[0].legacy_flag = 'invented';
  if (variant === 'cross_agency_link') live.visits[2].patient_id = live.patients[0].id;
  if (variant === 'missing_agency') delete live.patients[2].agency_id;
}

const lines = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
const fieldsOf = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r)))];

/**
 * Writes the supplied-export directory and returns what a planner should find.
 * `apps` defaults to both sources; the legacy one is always sealed, never loaded.
 */
export async function buildFixture({ dir, variant = 'clean', apps = [LIVE_APP, LEGACY_APP] }) {
  if (!Object.hasOwn(VARIANTS, variant)) throw new Error(`unknown variant ${variant}`);
  await mkdir(dir, { recursive: true });
  const sets = apps.map((app, i) => baseRows(app, i));
  applyVariant(sets, variant);
  const plan = { format: 'pennsync-supplied-export', version: 1, source_apps: apps, snapshot_evidence_sha256: EVIDENCE, collections: [], identities: {}, agencies: {}, files: [] };
  const save = async (path, text, rows) => {
    const data = Buffer.from(text);
    await writeFile(join(dir, path), data);
    return { path, bytes: data.length, sha256: sha(data), ...(rows === undefined ? {} : { rows }) };
  };
  const identities = []; const agencyMap = []; const enrolled = [];
  for (const s of sets) {
    const prefix = `${s.index}-`;
    const collections = [
      ['User', s.users, { kind: 'principal' }, []],
      ['Agency', s.agencies, { kind: 'agency_root' }, []],
      ['Patient', s.patients, { kind: 'agency', pointer: '/agency_id' }, []],
      ['Visit', s.visits, { kind: 'agency', pointer: '/agency_id' }, [{ pointer: '/patient_id', entity: 'Patient' }]],
      ['Task', s.tasks, { kind: 'agency', pointer: '/agency_id' }, [{ pointer: '/patient_id', entity: 'Patient' }]],
    ];
    for (const [entity, rows, scope, references] of collections) {
      plan.collections.push({
        source_app_id: s.app, entity, ...await save(`${prefix}${entity}.jsonl`, lines(rows), rows.length),
        fields: fieldsOf(rows), references, file_references: [], opaque_fields: [], scope,
      });
    }
    for (const u of s.users) identities.push({ source_app_id: s.app, user_id: u.id, target_subject: `fixture-subject-${u.id.slice(-6)}`, decision_sha256: EVIDENCE });
    for (const a of s.agencies) agencyMap.push({ source_app_id: s.app, agency_id: a.id, target_agency_id: `fixture-agency-${a.id.slice(-6)}`, decision_sha256: EVIDENCE });
    // Everyone is enrolled except, in one variant, the second nurse of the live app.
    for (const u of s.users) {
      const skip = variant === 'unenrolled_author' && s.app === LIVE_APP && u.email.startsWith('nurse-a-');
      if (!skip) enrolled.push(`fixture-subject-${u.id.slice(-6)}`);
    }
  }
  plan.identities = await save('identities.jsonl', lines(identities), identities.length);
  plan.agencies = await save('agencies.jsonl', lines(agencyMap), agencyMap.length);
  await save('plan.json', JSON.stringify(plan, null, 2));
  await save('enrolled.json', JSON.stringify(enrolled.sort(), null, 2));
  const spec = VARIANTS[variant];
  return { dir, variant, plan, enrolled, expected: spec.expected ?? {}, archiveRefuses: spec.archiveRefuses ?? null };
}

/**
 * The same patients as a CSV export, for the planner's CSV path: one header row,
 * nested values as JSON text in a cell. `withId: false` drops the id column so
 * the "id is required" refusal has an input.
 */
export function patientsCsv({ withId = true } = {}) {
  const rows = baseRows(LIVE_APP, 0).patients;
  const cols = [...(withId ? ['id'] : []), 'agency_id', 'first_name', 'last_name', 'status', 'secondary_diagnoses'];
  const cell = (v) => {
    const t = typeof v === 'string' ? v : JSON.stringify(v ?? '');
    return /[",\r\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
  };
  return `${[cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n')}\r\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dir, flag, name] = process.argv.slice(2);
  if (!dir || (flag && flag !== '--variant')) { console.error('usage: tools-pennsync-record-mover-fixtures.mjs <new-dir> [--variant name]'); process.exit(2); }
  const out = await buildFixture({ dir, variant: name ?? 'clean' });
  console.log(JSON.stringify({ status: 'written', variant: out.variant, collections: out.plan.collections.length }));
}
