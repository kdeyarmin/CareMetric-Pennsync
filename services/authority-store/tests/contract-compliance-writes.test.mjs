/**
 * The write half of the compliance contracts, against the real migration.
 *
 * Three things about this suite are load-bearing rather than shape.
 *
 * It applies the WHOLE record directory through #316's helper, so the store it
 * refuses against is the one a deployment gets. A hand-kept list is how a suite
 * comes to assert refusals against a store missing the table a contract writes
 * and pass, because a contract that does not exist refuses everything.
 *
 * It runs every write through a caller whose claims are set and then COMMITS,
 * because the read-back is the assertion: a write contract that answered
 * correctly and wrote nothing would pass every check made on its answer alone.
 * The read suite beside it rolls back, and that difference is the point.
 *
 * And its authorization cases are seeded so that the tenancy and the OWNERSHIP
 * differ — a colleague in the same agency, an admin in another, a chart in
 * another agency. Both tables are agency-WIDE in this store (D45), so a suite
 * whose callers each hold one agency and whose rows are each their own would
 * pass with every ownership predicate deleted.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations } from './record-migrations.mjs';

const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const RECORDS = 'services/authority-store/supabase/record-migrations/';
const WRITES_NAME = '20260920670000_contract_compliance_writes.sql';
const WRITES = resolve(repository, RECORDS + WRITES_NAME);
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const A = 'agency-a'; const B = 'agency-b';

const AUDIT_CREATE = 'select "public"."pennsync_contract_compliance_audit_create"($1,$2) as result';
const AUDIT_UPDATE = 'select "public"."pennsync_contract_compliance_audit_update"($1,$2,$3) as result';
const ADR_CREATE = 'select "public"."pennsync_contract_adr_case_create"($1,$2) as result';
const ADR_UPDATE = 'select "public"."pennsync_contract_adr_case_update"($1,$2,$3) as result';
const ADR_DELETE = 'select "public"."pennsync_contract_adr_case_delete"($1,$2) as result';
const ADR_READ = 'select "public"."pennsync_contract_adr_case_list"($1,$2,$3) as result';
const HANDLE = 'cmfile:00000000-0000-4000-8000-000000000001';

let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  const applied = await applyRecordMigrations(db);
  assert.deepEqual(applied,
    readdirSync(resolve(repository, RECORDS)).filter(file => file.endsWith('.sql')).sort(),
    'the record directory and what was applied to this store disagree');
  // The ordering guard MOVED to `contract-duty-status.test.mjs` when this
  // migration merged. See `assertNewestRecordMigration`: the check belongs to
  // the newest PENDING file, and a suite whose migration is on `main` drops
  // the call rather than widening it with an exception list — keeping it here
  // would refuse a correct tree the moment any later migration arrives.
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));

  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'],
    ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","first_name","last_name") values ($1,$2,$3,$4,$5)`,
    [APP, id, agency, first, last]);
  }
  for (const [id, agency, patient] of [
    ['visit-a1', A, 'patient-a1'], ['visit-a2', A, 'patient-a2'], ['visit-b1', B, 'patient-b1'],
  ]) {
    await db.query(`insert into ${SCHEMA}."visit"
      ("source_app_id","id","agency_id","patient_id") values ($1,$2,$3,$4)`,
    [APP, id, agency, patient]);
  }
});

after(async () => { await db?.close(); });

/** Run as a caller and COMMIT, because the read-back is the assertion. */
async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}

/** The refusal's own message, which is what the HTTP boundary classifies. */
async function refusal(n, sql, params = []) {
  try {
    await as(n, sql, params);
  } catch (error) { return error.message; }
  throw new Error(`expected a refusal from ${sql}`);
}

/** Read a row back through the store rather than through the answer. */
async function row(table, id) {
  const { rows } = await db.query(
    `select * from ${SCHEMA}."${table}" where "source_app_id" = $1 and "id" = $2`, [APP, id]);
  return rows[0];
}

const audit = (extra = {}) => ({
  visit_id: 'visit-a1', patient_id: 'patient-a1', compliance_score: 91,
  status: 'passed', audit_type: 'automated', ...extra,
});

/* ------------------------------------------------------------ the audit */

test('a clinician files an audit on a chart they open, and owns it', async () => {
  const answer = await as(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit())]);
  assert.equal(answer.success, true);
  const stored = await row('compliance_audit', answer.audit.id);
  assert.equal(stored.visit_id, 'visit-a1');
  assert.equal(stored.compliance_score, 91);
  // Divergence 1. The caller named no owner and could not have.
  assert.equal(stored.nurse_email, email(CLINICIAN_A));
  assert.equal(stored.created_by, email(CLINICIAN_A));
});

test('the owner is STAMPED, so naming one is refused rather than ignored', async () => {
  // The real hazard this closes, from `AIComplianceAuditor.jsx`: a client that
  // sends `currentUser?.email || 'system'` writes a row owned by the literal
  // string `system`, which the read contract's predicate matches for nobody.
  // Refused rather than filtered, because a caller who names it believes it
  // took effect (D39).
  assert.match(
    await refusal(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit({ nurse_email: 'system' }))]),
    /PENNSYNC_AUDIT_WRITE_FIELD_RESERVED/);
  assert.match(
    await refusal(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit({ created_by: 'x@y.invalid' }))]),
    /PENNSYNC_AUDIT_WRITE_FIELD_RESERVED/);
});

test('the reviewer trio is refused by name, not dropped (D39)', async () => {
  for (const field of ['reviewed_by', 'reviewed_at', 'review_notes']) {
    assert.match(
      await refusal(ADMIN_A, AUDIT_CREATE, [A, JSON.stringify(audit({ [field]: 'x' }))]),
      /PENNSYNC_AUDIT_WRITE_FIELD_RESERVED/,
      `${field} is the reviewer's and there is no reviewer capability here`);
  }
});

test('a misspelled field is refused as UNKNOWN, which is a different mistake', async () => {
  assert.match(
    await refusal(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit({ complaince_score: 1 }))]),
    /PENNSYNC_AUDIT_WRITE_FIELD_UNKNOWN/);
});

test('the visit decides the tenant, and another agency\'s is not visible', async () => {
  assert.match(
    await refusal(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit({ visit_id: 'visit-b1' }))]),
    /PENNSYNC_AUDIT_WRITE_VISIT_NOT_VISIBLE/);
  // And the same visit named under the agency that holds it, by a caller who
  // does not hold that agency, is refused on the agency rather than the visit.
  assert.match(
    await refusal(CLINICIAN_A, AUDIT_CREATE, [B, JSON.stringify(audit({ visit_id: 'visit-b1' }))]),
    /PENNSYNC_AUDIT_WRITE_AGENCY_NOT_HELD/);
});

test('an unknown status or type is refused rather than raising a check violation', async () => {
  // D54's rule: a constrained column checked against its own enum before the
  // insert, because a check violation raises a code the boundary redacts.
  assert.match(
    await refusal(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit({ status: 'PASSED' }))]),
    /PENNSYNC_AUDIT_WRITE_STATUS_INVALID/);
  assert.match(
    await refusal(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit({ audit_type: 'robot' }))]),
    /PENNSYNC_AUDIT_WRITE_TYPE_INVALID/);
});

test('the four required fields are required, and the fifth is stamped', async () => {
  for (const missing of ['visit_id', 'compliance_score', 'status']) {
    const payload = audit();
    delete payload[missing];
    assert.match(await refusal(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(payload)]),
      /PENNSYNC_AUDIT_WRITE_REQUIRED/, `${missing} is one of the entity's required four`);
  }
});

test('a patch writes only the keys sent, and a JSON null is one of them', async () => {
  const created = await as(CLINICIAN_A, AUDIT_CREATE, [A,
    JSON.stringify(audit({ acknowledgment: { acknowledged_by: 'x' }, compliant_elements: ['a'] }))]);
  const id = created.audit.id;
  // `buildAuditFields` ALWAYS sends `acknowledgment`, as null when nothing was
  // acknowledged, and its own comment says why: omitting the key on a re-save
  // left the prior override stamp on the record.
  const answer = await as(CLINICIAN_A, AUDIT_UPDATE, [A, id,
    JSON.stringify({ compliance_score: 72, status: 'flagged', acknowledgment: null })]);
  assert.equal(answer.updated, true);
  const stored = await row('compliance_audit', id);
  assert.equal(stored.compliance_score, 72);
  assert.equal(stored.status, 'flagged');
  assert.equal(stored.acknowledgment, null);
  // Untouched, because the patch did not name it. A contract that rewrote
  // every column from a merged record would have blanked this.
  assert.deepEqual(stored.compliant_elements, ['a']);
});

test('a colleague in the same agency cannot rewrite an audit (D45)', async () => {
  const created = await as(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit())]);
  const id = created.audit.id;
  // `compliance_audit` is tenanted agency-WIDE through its visit, so this
  // caller passes every policy and the contract's own predicate is what
  // refuses. Delete it and this test is the one that fails.
  assert.match(
    await refusal(CLINICIAN_EMPTY, AUDIT_UPDATE, [A, id, JSON.stringify({ status: 'passed' })]),
    /PENNSYNC_AUDIT_WRITE_NOT_(OWNED|FOUND)/);
  // The agency's administrator may, which is D40's successor to `role=admin`.
  const answer = await as(ADMIN_A, AUDIT_UPDATE, [A, id, JSON.stringify({ status: 'critical' })]);
  assert.equal(answer.updated, true);
  assert.equal((await row('compliance_audit', id)).status, 'critical');
});

test('a patch may not move the row\'s identity or its tenant path', async () => {
  const created = await as(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit())]);
  for (const field of ['visit_id', 'patient_id', 'recovery_request_id']) {
    assert.match(
      await refusal(CLINICIAN_A, AUDIT_UPDATE, [A, created.audit.id,
        JSON.stringify({ [field]: 'visit-b1' })]),
      /PENNSYNC_AUDIT_WRITE_FIELD_RESERVED/,
      `an audit that changed ${field} would change agency, past the check above`);
  }
});

/* -------------------------------------------------------------- the case */

test('an ADR case is created into the caller\'s agency, owned by them', async () => {
  const answer = await as(ADMIN_A, ADR_CREATE, [A, JSON.stringify({
    case_name: 'Palmetto TPE', status: 'checklist_ready', audit_type: 'tpe',
    contractor_name: 'Palmetto', letter_file_url: HANDLE,
  })]);
  assert.equal(answer.success, true);
  const stored = await row('adr_audit_case', answer.case.id);
  assert.equal(stored.agency_id, A);
  assert.equal(stored.created_by, email(ADMIN_A));
  assert.equal(stored.letter_file_url, HANDLE);
  // The answer is the read half's projection, so the locator it accepted is
  // NOT handed back — a write that answered with one would return what the
  // read refuses to project.
  assert.equal(Object.hasOwn(answer.case, 'letter_file_url'), false);
});

test('a Base44 storage URL is refused rather than stored (D77)', async () => {
  for (const field of ['letter_file_url', 'packet_file_url', 'final_packet_url']) {
    assert.match(
      await refusal(ADMIN_A, ADR_CREATE, [A, JSON.stringify({
        case_name: 'x', [field]: 'https://base44.app/storage/letter.pdf' })]),
      /PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED/,
      `${field} would be a row whose file leg can never resolve`);
  }
  // An absent or empty locator is legitimate: a case is filed before the
  // packet exists, and refusing that would fail blank on the common path.
  const answer = await as(ADMIN_A, ADR_CREATE, [A,
    JSON.stringify({ case_name: 'no letter yet', packet_file_url: '' })]);
  assert.equal(answer.success, true);
  assert.equal((await row('adr_audit_case', answer.case.id)).packet_file_url, null);
});

test('the sweep\'s own marker is refused on both create and update', async () => {
  const marker = JSON.stringify({ deadline_reminders: { last_days_left: 1 } });
  assert.match(await refusal(ADMIN_A, ADR_CREATE, [A, marker]),
    /PENNSYNC_ADR_WRITE_FIELD_RESERVED/);
  const created = await as(ADMIN_A, ADR_CREATE, [A, JSON.stringify({ case_name: 'x' })]);
  assert.match(await refusal(ADMIN_A, ADR_UPDATE, [A, created.case.id, marker]),
    /PENNSYNC_ADR_WRITE_FIELD_RESERVED/,
    'a caller who could write it could silence a Medicare response deadline');
});

test('the agency is stamped, so a payload naming one is refused', async () => {
  assert.match(
    await refusal(ADMIN_A, ADR_CREATE, [A, JSON.stringify({ case_name: 'x', agency_id: B })]),
    /PENNSYNC_ADR_WRITE_FIELD_RESERVED/);
});

test('an empty body is refused, because an accidental call would file a blank case', async () => {
  assert.match(await refusal(ADMIN_A, ADR_CREATE, [A, '{}']),
    /PENNSYNC_ADR_WRITE_PAYLOAD_INVALID/);
  const created = await as(ADMIN_A, ADR_CREATE, [A, JSON.stringify({ case_name: 'x' })]);
  assert.match(await refusal(ADMIN_A, ADR_UPDATE, [A, created.case.id, '{}']),
    /PENNSYNC_ADR_WRITE_PAYLOAD_INVALID/);
});

test('a case may not name another agency\'s chart, on create or on update', async () => {
  // Divergence 6, and the write side of the leak the read half closed: before
  // `chart_not_elsewhere` a case filed in A naming B's chart handed B's
  // patient name and medicare number to A's administrator.
  assert.match(
    await refusal(ADMIN_A, ADR_CREATE, [A,
      JSON.stringify({ case_name: 'x', patient_id: 'patient-b1' })]),
    /PENNSYNC_ADR_WRITE_CHART_ELSEWHERE/);
  const created = await as(ADMIN_A, ADR_CREATE, [A, JSON.stringify({ case_name: 'x' })]);
  assert.match(
    await refusal(ADMIN_A, ADR_UPDATE, [A, created.case.id,
      JSON.stringify({ patient_id: 'patient-b1' })]),
    /PENNSYNC_ADR_WRITE_CHART_ELSEWHERE/);
  // The positive control beside it, without which "refuses everything" would
  // satisfy the two assertions above.
  const ok = await as(ADMIN_A, ADR_UPDATE, [A, created.case.id,
    JSON.stringify({ patient_id: 'patient-a1' })]);
  assert.equal(ok.case.patient_id, 'patient-a1');
  // And the helper's third branch: a chart this store does not carry is kept,
  // because unresolvable is not proved crossed (D61).
  const uncarried = await as(ADMIN_A, ADR_UPDATE, [A, created.case.id,
    JSON.stringify({ patient_id: 'patient-not-in-this-store' })]);
  assert.equal(uncarried.case.patient_id, 'patient-not-in-this-store');
});

test('a history array may grow and may not shrink (divergence 5)', async () => {
  const created = await as(ADMIN_A, ADR_CREATE, [A, JSON.stringify({ case_name: 'x' })]);
  const id = created.case.id;
  const fax = n => ({ date: `2026-09-0${n}`, to_number: `555000${n}`, fax_id: `f${n}` });
  await as(ADMIN_A, ADR_UPDATE, [A, id,
    JSON.stringify({ submission_faxes: [fax(1), fax(2)], status: 'submitted' })]);
  assert.equal((await row('adr_audit_case', id)).submission_faxes.length, 2);
  // The real failure: a second panel read the case when it held one fax, and
  // its spread rebuilds an array of two where the store now holds three.
  await as(ADMIN_A, ADR_UPDATE, [A, id, JSON.stringify({ submission_faxes: [fax(1), fax(2), fax(3)] })]);
  assert.match(
    await refusal(ADMIN_A, ADR_UPDATE, [A, id, JSON.stringify({ submission_faxes: [fax(1), fax(2)] })]),
    /PENNSYNC_ADR_WRITE_FAXES_TRUNCATED/);
  assert.match(
    await refusal(ADMIN_A, ADR_UPDATE, [A, id, JSON.stringify({ notes: 'not an array' })]),
    /PENNSYNC_ADR_WRITE_NOTES_TRUNCATED/);
  // Rewriting the same length is still allowed: a correction to an entry is
  // not a loss, and refusing it would make the column append-only, which the
  // entity does not say it is (D32's signal is the DESCRIPTION).
  const same = await as(ADMIN_A, ADR_UPDATE, [A, id,
    JSON.stringify({ submission_faxes: [fax(1), fax(2), { ...fax(3), to_name: 'Palmetto' }] })]);
  assert.equal(same.case.submission_faxes[2].to_name, 'Palmetto');
});

test('a colleague cannot update or delete another\'s case, and an admin can', async () => {
  const created = await as(CLINICIAN_A, ADR_CREATE, [A, JSON.stringify({ case_name: 'mine' })]);
  const id = created.case.id;
  assert.match(
    await refusal(CLINICIAN_EMPTY, ADR_UPDATE, [A, id, JSON.stringify({ status: 'closed' })]),
    /PENNSYNC_ADR_WRITE_NOT_OWNED/);
  assert.match(await refusal(CLINICIAN_EMPTY, ADR_DELETE, [A, id]),
    /PENNSYNC_ADR_WRITE_NOT_OWNED/);
  // The row is still there, which is the assertion the refusal alone does not
  // make: a delete that raised after deleting would pass the line above.
  assert.ok(await row('adr_audit_case', id));
  const deleted = await as(ADMIN_A, ADR_DELETE, [A, id]);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.case.case_name, 'mine');
  assert.equal(await row('adr_audit_case', id), undefined);
});

test('an administrator of another agency reaches nothing here', async () => {
  const created = await as(ADMIN_A, ADR_CREATE, [A, JSON.stringify({ case_name: 'x' })]);
  for (const [sql, params] of [
    [ADR_UPDATE, [B, created.case.id, JSON.stringify({ status: 'closed' })]],
    [ADR_DELETE, [B, created.case.id]],
  ]) {
    assert.match(await refusal(ADMIN_B, sql, params), /PENNSYNC_ADR_WRITE_NOT_FOUND/);
  }
  // Naming the agency that holds the row, without holding it, is refused on
  // the agency — which is a different answer and deliberately so.
  assert.match(await refusal(ADMIN_B, ADR_DELETE, [A, created.case.id]),
    /PENNSYNC_ADR_WRITE_AGENCY_NOT_HELD/);
  assert.ok(await row('adr_audit_case', created.case.id));
});

/* ------------------------------------------------- what the pair guarantees */

test('what one contract writes, the other reads (D45\'s cross-contract rule)', async () => {
  // D45's defect was found exactly here: a capability that writes a row
  // another capability reads is proved by neither suite alone. This creates
  // through the write contract and reads through the read one.
  const created = await as(ADMIN_A, ADR_CREATE, [A, JSON.stringify({
    case_name: 'cross-contract', audit_type: 'upic', patient_id: 'patient-a1' })]);
  const list = await as(ADMIN_A, ADR_READ, [A, null, 50]);
  const seen = list.entries.find(entry => entry.id === created.case.id);
  assert.ok(seen, 'a case this contract wrote must be reachable through the read contract');
  assert.equal(seen.case_name, 'cross-contract');
  assert.equal(seen.audit_type, 'upic');
  const audited = await as(CLINICIAN_A, AUDIT_CREATE, [A, JSON.stringify(audit())]);
  const audits = await as(CLINICIAN_A,
    'select "public"."pennsync_contract_compliance_audit_list"($1,$2,$3,$4,$5) as result',
    [A, null, null, null, 50]);
  assert.ok(audits.entries.some(entry => entry.id === audited.audit.id),
    'the stamped owner must be the one the read contract matches on');
});

/* ---------------------------------------------------------- the file itself */

test('every refusal code this migration raises is one the registry can name', async () => {
  // `http-boundary.test.mjs` asserts this across the whole store and is one of
  // the twenty suites outside `pnpm test`. Asserted here too, because a code
  // the registry cannot name is REDACTED at the boundary, so a caller is told
  // something untrue about why they failed — and the code that finds it is
  // this migration's.
  const whole = readFileSync(WRITES, 'utf8');
  // The `do $precondition$` block is cut out first, and that is a real
  // distinction rather than tidiness: the two codes it raises are APPLY-time
  // and reach an operator running the migration, never a caller through the
  // HTTP boundary, so requiring the registry to name them would put two dead
  // entries in it. Sliced by the block's own end rather than by a pattern over
  // the names, because a pattern would also swallow a contract code that
  // happened to start the same way.
  const sql = whole.slice(whole.indexOf('end $precondition$;'));
  const raised = [...sql.matchAll(/message='(PENNSYNC_[A-Z_]+)'/g)].map(m => m[1]);
  assert.equal(raised.includes('PENNSYNC_COMPLIANCE_WRITES_REQUIRE_READS'), false,
    'the precondition block must be outside the scan, or its apply-time codes '
    + 'would be required of a registry no operator reads');
  const registry = readFileSync(resolve(repository, 'services/pennsync-api/record-contracts.mjs'), 'utf8');
  assert.ok(raised.length >= 15, 'the scan must find this migration\'s codes, not zero of them');
  for (const code of new Set(raised)) {
    assert.ok(registry.includes(code), `${code} is raised here and named nowhere in the registry`);
  }
});

test('no contract here projects a file locator', async () => {
  // The read half's rule, from the other side. The three locator columns are
  // accepted as input and must never appear in an answer.
  const sql = readFileSync(WRITES, 'utf8');
  const rows = sql.slice(sql.indexOf('adr_case_row'), sql.indexOf('adr_case_validate'));
  for (const column of ['letter_file_url', 'packet_file_url', 'final_packet_url']) {
    assert.equal(rows.includes(`'${column}'`), false,
      `${column} is projected by the answer, and the read half refuses to project it`);
  }
});
