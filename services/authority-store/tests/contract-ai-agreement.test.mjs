import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { transpileTs } from '../../../tools-transpile-ts.mjs';

/**
 * Accepting the AI content agreement — the FIRST port that writes D25's
 * activity trail.
 *
 * Two properties are worth the file. The acceptance and its audit entry are
 * written in ONE transaction, so neither can exist without the other: the
 * original writes them separately and then spends four identity rechecks and
 * two full readbacks defending the gap. And the words a person attests to are
 * the ORIGINAL's words — asserted against the original module rather than
 * against this test's own copy, because an attestation to different sentences
 * than the ones displayed is the one defect that would matter here.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const AUDIT = 'services/authority-store/supabase/record-migrations/'
  + '20260920010000_activity_audit.sql';
const AGREEMENT = 'services/authority-store/supabase/record-migrations/'
  + '20260920220000_contract_ai_agreement.sql';
const ORIGINAL = 'base44/functions/acceptAiContentAgreement/entry.ts';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const b44 = n => `6aac00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const STATUS = 'select "public"."pennsync_contract_ai_agreement_status"($1) as result';
const ACCEPT = 'select "public"."pennsync_contract_ai_agreement_accept"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, AUDIT, AGREEMENT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = false) {
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
const status = (n, agency = A) => as(n, STATUS, [agency]);
const accept = (n, version = '1.0', agency = A) => as(n, ACCEPT, [agency, version], true);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

/** The original's own constants, lifted from the module rather than retyped. */
async function originalConstants() {
  let source = await readFile(resolve(repository, ORIGINAL), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, '');
  source = source.replace(/Deno\.serve\([\s\S]*$/, '');
  source += '\nexport { AGREEMENT_VERSION, AGREEMENT_ACKNOWLEDGMENTS };\n';
  const file = join(tmpdir(), `aiparity_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  try { return await import(pathToFileURL(file).href); }
  finally { await unlink(file).catch(() => {}); }
}

test('the words attested to are the original\'s words, not this file\'s', async () => {
  const { AGREEMENT_VERSION, AGREEMENT_ACKNOWLEDGMENTS } = await originalConstants();
  const { rows } = await db.query(`select "pennsync_records".ai_agreement_version() as version,
    "pennsync_records".ai_agreement_acknowledgments() as acks`);
  assert.equal(rows[0].version, AGREEMENT_VERSION);
  // Byte for byte, in order. An attestation to different sentences than the
  // ones a person read is the one defect that would matter here, so this is
  // compared against the ORIGINAL rather than against a copy in this test.
  assert.deepEqual(rows[0].acks, AGREEMENT_ACKNOWLEDGMENTS);
  assert.equal(AGREEMENT_ACKNOWLEDGMENTS.length, 3);
});

test('a member reads their own standing, and it starts at not accepted', async () => {
  const result = await status(CLINICIAN_A);
  assert.equal(result.accepted, false);
  assert.equal(result.attestation_id, null);
  assert.equal(result.agreement_version, '1.0');
  assert.equal(result.acknowledgments.length, 3);
  // An agency the caller holds no membership in is refused before anything.
  await refusal(status(CLINICIAN_A, B), 'PENNSYNC_AI_AGREEMENT_AGENCY_NOT_HELD');
});

test('accepting writes the attestation and its audit entry in one transaction', async () => {
  const result = await accept(CLINICIAN_A);
  assert.equal(result.success, true);
  assert.equal(result.already_accepted, false);
  assert.ok(result.attestation_id);

  const row = (await db.query(`select "user_id","user_email_normalized","agreement_version",
    "acknowledgments","audit_event_id","accepted_at" from ${SCHEMA}."ai_content_agreement_attestation"
    where "id" = $1`, [result.attestation_id])).rows[0];
  assert.equal(row.user_id, b44(CLINICIAN_A));
  assert.equal(row.user_email_normalized, 'clinician-a@example.invalid');
  assert.equal(row.agreement_version, '1.0');
  assert.equal(row.acknowledgments.length, 3);

  // **The trail entry exists, and the attestation points at it.** In the
  // original these are two writes with four identity rechecks between them;
  // here neither can exist without the other.
  assert.ok(row.audit_event_id, 'the attestation carries its audit event');
  const event = (await db.query(`select "action","subject_kind","subject_id","detail","actor_user_id"
    from ${SCHEMA}."activity_audit" where "id" = $1`, [row.audit_event_id])).rows[0];
  assert.ok(event, 'the audit entry the attestation names is really there');
  assert.equal(event.action, 'ai_content_agreement_accepted');
  assert.equal(event.subject_kind, 'user');
  assert.equal(event.subject_id, b44(CLINICIAN_A));
  assert.equal(event.detail.agreement_version, '1.0');
  assert.equal(event.detail.severity, 'info');
  assert.equal(event.detail.acknowledgments.length, 3);
  // D25 stamps the actor from the caller helpers rather than from a payload.
  assert.equal(event.actor_user_id, b44(CLINICIAN_A));

  const after = await status(CLINICIAN_A);
  assert.equal(after.accepted, true);
  assert.equal(after.attestation_id, result.attestation_id);
});

test('accepting again answers the first acceptance and writes nothing', async () => {
  const before = (await db.query(
    `select count(*)::int as n from ${SCHEMA}."activity_audit"`)).rows[0].n;
  const first = await status(CLINICIAN_A);
  const again = await accept(CLINICIAN_A);
  assert.equal(again.already_accepted, true);
  assert.equal(again.attestation_id, first.attestation_id);
  assert.deepEqual(again.accepted_at, first.accepted_at);
  // No second attestation, and no second audit entry: accepting twice is not
  // an event, so recording one would be a false trail.
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."ai_content_agreement_attestation"`)).rows[0].n, 1);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."activity_audit"`)).rows[0].n, before);
});

test('a stale version is told to go and read the current agreement', async () => {
  // The original answers 409 with "Agreement version is stale; review the
  // current agreement" rather than a generic bad request, because somebody who
  // accepted an older agreement has to see the new one.
  await refusal(accept(ADMIN_A, '0.9'), 'PENNSYNC_AI_AGREEMENT_VERSION_STALE');
  await refusal(accept(ADMIN_A, null), 'PENNSYNC_AI_AGREEMENT_VERSION_STALE');
  assert.equal((await status(ADMIN_A)).accepted, false);
});

test('an attestation is one person\'s, and the policy is what says so', async () => {
  // Unlike `policy_acknowledgment` (D36), tenancy here IS ownership: the read
  // policy is `user_id = caller_user_id()`, so the contract adds no ownership
  // check and the colleague simply sees nothing.
  assert.equal((await status(ADMIN_A)).accepted, false);
  assert.equal((await status(CLINICIAN_A)).accepted, true);
  const source = readFileSync(resolve(repository, AGREEMENT), 'utf8');
  assert.equal(/user_id"\s*=\s*"pennsync_records"\.caller_user_id\(\)/.test(source), false,
    'the contract does not restate the policy predicate');
  // The admin of the other agency holds no membership here at all.
  await refusal(accept(ADMIN_B, '1.0', A), 'PENNSYNC_AI_AGREEMENT_AGENCY_NOT_HELD');
});

test('a revoked identity has no standing at all, without a check of its own', async () => {
  // The original's `blockedActor` refuses an inactive, disabled, service or
  // unverified `User`. Every one of those is a carried self-editable label,
  // and none is ported: `pennsync_private.actor` admits an identity only while
  // `enabled and revoked_at is null`, so a revoked person has no caller
  // identity and every helper answers null. Done LAST, because the trigger on
  // `identity_map` makes revocation one-way.
  await db.exec(`update pennsync_private.identity_map set enabled = false,
    revoked_at = clock_timestamp(), version = version + 1
    where base44_user_id = '${b44(ADMIN_A)}'`);
  await refusal(status(ADMIN_A), 'PENNSYNC_AI_AGREEMENT_AGENCY_NOT_HELD');
  await refusal(accept(ADMIN_A), 'PENNSYNC_AI_AGREEMENT_AGENCY_NOT_HELD');
  const source = readFileSync(resolve(repository, AGREEMENT), 'utf8');
  assert.equal(/is_active|is_service|is_verified|disabled/.test(source.replace(/^--.*$/gm, '')), false,
    'no carried self-editable label is read by the contract');
});
