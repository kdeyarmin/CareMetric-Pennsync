import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { POLICY_SQL_FILES } from '../../../tools-read-purpose-policy.mjs';
import {
  DOCUMENT_EXACT_PURPOSE_POLICY, DOCUMENT_LIST_PURPOSE_POLICY,
} from '../../pennsync-api/read-purpose-policy.mjs';

/**
 * The authorized document read (`contract_document_list` / `..._get`).
 *
 * Two properties are what this family is for and neither is visible in the
 * patient or visit tests:
 *
 * - **The binding is the tenancy (D27).** A `document` row has no
 *   `agency_id`; `document_tenant_binding` says which agency and which patient
 *   it belongs to, and the chart narrowing travels on the binding. So the
 *   fixture includes a document whose binding names a patient the clinician is
 *   not assigned to, one whose binding names no patient at all, and one with
 *   no binding whatsoever.
 * - **No projection carries a file locator, and a row that still has one is
 *   not disclosed.** `file_url` on the document and `file_uri` on the binding
 *   are the two columns that could hand a caller a URL into storage. The
 *   fixture sets both on one document and expects it to be absent, and every
 *   projection is checked for both names.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CONTRACT = 'services/authority-store/supabase/record-migrations/20260920100000_contract_document_read.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = n => `7aac00000000${String(n).padStart(12, '0')}`;
const did = n => `9aac00000000${String(n).padStart(12, '0')}`;
const bid = n => `baac00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const LIST = 'select "public"."pennsync_contract_document_list"($1,$2,$3,$4,$5,$6) as result';
const GET = 'select "public"."pennsync_contract_document_get"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

const PATIENTS = [
  { id: pid(1), agency_id: A }, { id: pid(2), agency_id: A }, { id: pid(3), agency_id: B },
];
/**
 * Five on the clinician's patient, two on the one they are not assigned to,
 * one bound to no patient, one still carrying a file locator, one in the
 * other agency, and one with no binding at all. The binding decides the first
 * three facts; the document row decides the fourth; the absence of a binding
 * decides the last.
 */
const DOCUMENTS = [
  ...Array.from({ length: 5 }, (unused, index) =>
    ({ n: index + 1, agency: A, patient: pid(1), purpose: 'patient_document' })),
  { n: 6, agency: A, patient: pid(2), purpose: 'patient_document' },
  { n: 7, agency: A, patient: pid(2), purpose: 'referral' },
  { n: 8, agency: A, patient: null, purpose: 'referral' },
  { n: 9, agency: A, patient: pid(1), purpose: 'patient_document', fileUrl: 'https://storage.invalid/x.pdf' },
  { n: 10, agency: B, patient: pid(3), purpose: 'patient_document' },
  { n: 11, agency: null, patient: pid(1), purpose: null },
];

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE,
    POLICY_SQL_FILES.document, CONTRACT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const row of PATIENTS) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","status","is_sample","is_archived","first_name","last_name")
      values ($1,$2,$3,'active',false,false,'First','Last')`, [APP, row.id, row.agency_id]);
  }
  for (const row of DOCUMENTS) {
    await db.query(`insert into ${SCHEMA}."document"
      ("source_app_id","id","title","file_url","file_name","file_size","file_type","category",
       "patient_id","document_date","is_sensitive","is_signed","is_locked","updated_date")
      values ($1,$2,$3,$4,$5,1024,'application/pdf','progress_notes',$6,'2026-09-01',false,false,false,
        '2026-09-02T00:00:00Z')`,
    [APP, did(row.n), `Document ${row.n}`, row.fileUrl ?? null, `doc-${row.n}.pdf`, row.patient]);
    // Document 11 is deliberately left unbound: a document in no tenant.
    if (row.agency === null) continue;
    await db.query(`insert into ${SCHEMA}."document_tenant_binding"
      ("source_app_id","id","binding_key","document_id","agency_id","patient_id","purpose",
       "storage_mode","file_uri","file_name","file_type","file_size","version")
      values ($1,$2,$3,$4,$5,$6,$7,'private','cmfile://synthetic/x',$8,'application/pdf',1024,1)`,
    [APP, bid(row.n), `key-${row.n}`, did(row.n), row.agency, row.patient, row.purpose,
      `doc-${row.n}.pdf`]);
  }
  await db.query(`insert into pennsync_private.chart_assignment
    (app_id,agency_id,patient_id,membership_id,status,changed_by)
    values ($1,$2,$3,'membership-2','active',$4)`, [APP, A, pid(1), uid(1)]);
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    return rows;
  } finally { await db.exec('rollback'); }
}
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const listAs = async (n, { agency = A, purpose = 'library', patient = null, binding = null,
  pageSize = 10, after = null } = {}) =>
  (await as(n, LIST, [agency, purpose, patient, binding, pageSize, after]))[0].result;
const getAs = async (n, id, { agency = A, purpose = 'metadata' } = {}) =>
  (await as(n, GET, [agency, purpose, id]))[0].result;

test('no purpose discloses a file locator, on either capability', async () => {
  // The policy first: neither column may appear in any projection.
  for (const policy of [DOCUMENT_LIST_PURPOSE_POLICY, DOCUMENT_EXACT_PURPOSE_POLICY]) {
    for (const [purpose, entry] of Object.entries(policy)) {
      for (const field of ['file_url', 'file_uri']) {
        assert.ok(!entry.fields.includes(field), `${purpose} discloses ${field}`);
      }
    }
  }
  // Then the answer: `download` is the purpose that sounds like it should
  // carry one, and it carries a name and a size. That is why this family is
  // portable before the file layer rather than after it.
  const one = await getAs(ADMIN_A, did(1), { purpose: 'download' });
  assert.deepEqual(Object.keys(one).sort(), [...DOCUMENT_EXACT_PURPOSE_POLICY.download.fields].sort());
  assert.equal(one.file_name, 'doc-1.pdf');
  const listed = (await listAs(ADMIN_A)).documents;
  for (const entry of [...listed, one]) {
    assert.ok(!JSON.stringify(entry).includes('storage.invalid'));
    assert.ok(!JSON.stringify(entry).includes('cmfile://'));
  }
});

test('a document that still carries a locator is not disclosed at all', async () => {
  // The original refuses the whole request on one of these. Both refuse to
  // disclose it; skipping means one un-migrated document does not make an
  // agency's library unreadable.
  const listed = (await listAs(ADMIN_A)).documents.map(row => row.id);
  assert.ok(!listed.includes(did(9)), 'document 9 still has a file_url');
  assert.equal(await getAs(ADMIN_A, did(9)), null);
  await refusal(listAs(ADMIN_A, { after: did(9) }), 'PENNSYNC_DOCUMENT_CURSOR_UNKNOWN');
});

test('the binding decides the tenancy, and D24 narrows it to the care team', async () => {
  const admin = (await listAs(ADMIN_A)).documents.map(row => row.id);
  assert.deepEqual(admin, [did(1), did(2), did(3), did(4), did(5), did(6), did(7), did(8)],
    'an agency_admin sees every binding in the agency, and not the other agency');
  // The binding with no patient is D27's case: before the tenant path asked
  // the binding it belonged to nobody, so this row is the regression guard.
  assert.ok(admin.includes(did(8)), 'a document bound to an agency and no patient belongs to it');
  const clinician = (await listAs(CLINICIAN_A, { patient: pid(1) })).documents.map(row => row.id);
  assert.deepEqual(clinician, [did(1), did(2), did(3), did(4), did(5)]);
  // Naming the patient they are not assigned to answers nothing rather than
  // refusing: the binding is invisible to them, which is indistinguishable
  // from the patient having no documents.
  assert.deepEqual((await listAs(CLINICIAN_A, { patient: pid(2) })).documents, []);
  assert.equal(await getAs(CLINICIAN_A, did(6)), null);
  assert.notEqual(await getAs(CLINICIAN_A, did(1)), null);
  assert.notEqual(await getAs(CLINICIAN_A, did(8)), null, 'a binding with no subject is agency-scoped');
  assert.equal(await getAs(ADMIN_A, did(10)), null, 'another agency document');
});

test('a document with no binding is in no tenant and belongs to nobody', async () => {
  // The same answer both originals give: every document they serve is joined
  // to a binding, and one without is not theirs to disclose.
  for (const caller of [ADMIN_A, CLINICIAN_A, ADMIN_B]) {
    assert.equal(await getAs(caller, did(11), { agency: caller === ADMIN_B ? B : A }), null);
  }
  assert.ok(!(await listAs(ADMIN_A)).documents.map(row => row.id).includes(did(11)));
  await refusal(listAs(ADMIN_A, { after: did(11) }), 'PENNSYNC_DOCUMENT_CURSOR_UNKNOWN');
});

test('a caller who does not open every chart must name one patient', async () => {
  // Not confidentiality — RLS already limits them to their own patients. It is
  // a volume signal: an unscoped list would tell a clinician how many
  // documents their whole caseload holds.
  await refusal(listAs(CLINICIAN_A), 'PENNSYNC_DOCUMENT_SUBJECT_REQUIRED');
  assert.ok((await listAs(ADMIN_A)).documents.length > 0, 'an agency_admin needs no scope');
  // A malformed id is malformed whoever sends it: the scope rule is about an
  // ABSENT patient, so naming an unusable one is answered as unusable rather
  // than as unnamed. Both callers get the same refusal, which is what keeps
  // the message from telling a caller which role they hold.
  for (const caller of [CLINICIAN_A, ADMIN_A]) {
    await refusal(listAs(caller, { patient: 'nope' }), 'PENNSYNC_DOCUMENT_SUBJECT_INVALID');
  }
});

test('the binding purpose partitions what a document is attached to', async () => {
  assert.deepEqual((await listAs(ADMIN_A, { binding: 'referral' })).documents.map(row => row.id),
    [did(7), did(8)]);
  assert.deepEqual((await listAs(ADMIN_A, { binding: 'patient_document' })).documents.map(row => row.id),
    [did(1), did(2), did(3), did(4), did(5), did(6)]);
  for (const binding of ['visit', 'anything', '']) {
    await refusal(listAs(ADMIN_A, { binding }), 'PENNSYNC_DOCUMENT_BINDING_INVALID');
  }
});

test('neither capability answers the other vocabulary, and the agency is asked first', async () => {
  await refusal(listAs(ADMIN_A, { purpose: 'download' }), 'PENNSYNC_DOCUMENT_PURPOSE_INVALID');
  await refusal(getAs(ADMIN_A, did(1), { purpose: 'library' }), 'PENNSYNC_DOCUMENT_PURPOSE_INVALID');
  // The agency is answered before anything about the purpose, so a caller
  // cannot learn which purposes exist by asking about an agency that is not
  // theirs.
  await refusal(listAs(ADMIN_B, { agency: A, purpose: 'nonexistent' }),
    'PENNSYNC_DOCUMENT_AGENCY_NOT_HELD');
  await refusal(getAs(ADMIN_B, did(1), { agency: A }), 'PENNSYNC_DOCUMENT_AGENCY_NOT_HELD');
});

test('the page is bounded at ten and the walk tiles without repeating', async () => {
  await refusal(listAs(ADMIN_A, { pageSize: 11 }), 'PENNSYNC_DOCUMENT_PAGE_SIZE_INVALID');
  for (const pageSize of [0, -1, null]) {
    await refusal(listAs(ADMIN_A, { pageSize }), 'PENNSYNC_DOCUMENT_PAGE_SIZE_INVALID');
  }
  const seen = [];
  let after = null;
  for (let page = 0; page < 10; page += 1) {
    const result = await listAs(ADMIN_A, { pageSize: 3, after });
    seen.push(...result.documents.map(row => row.id));
    after = result.next;
    if (after === null) break;
  }
  assert.equal(after, null, 'the walk ends');
  assert.deepEqual(seen, [...new Set(seen)], 'nothing is repeated');
  assert.deepEqual(seen, (await listAs(ADMIN_A)).documents.map(row => row.id));
  await refusal(listAs(ADMIN_A, { after: 'not-an-id' }), 'PENNSYNC_DOCUMENT_CURSOR_INVALID');
  await refusal(listAs(ADMIN_A, { after: did(99) }), 'PENNSYNC_DOCUMENT_CURSOR_UNKNOWN');
  // The cursor follows the filter: 7 is a referral binding, so it cannot
  // continue a patient_document walk.
  await refusal(listAs(ADMIN_A, { after: did(7), binding: 'patient_document' }),
    'PENNSYNC_DOCUMENT_CURSOR_UNKNOWN');
});

test('no caller role may reach the policy or the gate; the contracts are the way in', async () => {
  const { rows } = await db.query(`select p.proname, r.rolname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon','authenticated','service_role','public']) as r(rolname)
    where n.nspname = $1 and p.proname like 'document_%'
      and has_function_privilege(r.rolname, p.oid, 'execute')`, [SCHEMA]);
  assert.deepEqual(rows, [], 'the policy and the gate answer to the contracts alone');
  for (const name of ['pennsync_contract_document_list', 'pennsync_contract_document_get']) {
    const { rows: granted } = await db.query(
      `select has_function_privilege('authenticated', p.oid, 'execute') as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`, [name]);
    assert.deepEqual(granted.map(row => row.ok), [true], name);
  }
});
