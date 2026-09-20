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
 * Signing a policy acknowledgment (`contract_policy_acknowledge`).
 *
 * The property worth the file is the one the original's own comment says out
 * loud: the entity's write RLS is admin-only precisely so a learner cannot
 * sign somebody else's row, and the function does the ownership check because
 * its write goes through a service role that bypasses RLS. Here the write goes
 * through a contract bound by the policies, and the ownership check is still
 * the contract's — tenancy says the row is in this agency, not that it is
 * THIS PERSON'S. The second and third tests are that distinction.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const ACK = 'services/authority-store/supabase/record-migrations/'
  + '20260920210000_contract_policy_ack.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const SIGN = 'select "public"."pennsync_contract_policy_acknowledge"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
const MINE = 'ack-mine'; const THEIRS = 'ack-theirs'; const ELSEWHERE = 'ack-elsewhere';
const SIGNED = 'ack-signed';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ACK]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // `user_id` holds an EMAIL on this entity; the original compares it to the
  // caller's address rather than to an id.
  const rows = [
    [MINE, A, 'clinician-a@example.invalid', false, null],
    [THEIRS, A, 'admin-a@example.invalid', false, null],
    [ELSEWHERE, B, 'clinician-a@example.invalid', false, null],
    [SIGNED, A, 'clinician-a@example.invalid', true, 'Ada L'],
  ];
  for (const [id, agency, email, acknowledged, name] of rows) {
    await db.query(`insert into ${SCHEMA}."policy_acknowledgment"
      ("source_app_id","id","agency_id","policy_id","user_id","acknowledged","status",
       "signed_name","acknowledged_at","doc_url")
      values ($1,$2,$3,'policy-1',$4,$5,$6,$7,$8,'https://example.invalid/policy.pdf')`,
    [APP, id, agency, email, acknowledged, acknowledged ? 'acknowledged' : 'assigned',
      name, acknowledged ? '2026-09-01 00:00:00+00' : null]);
  }
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
const sign = (n, id, name = 'Ada Lovelace', agency = A, commit = true) =>
  as(n, SIGN, [agency, id, name], commit);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const rowOf = async id => (await db.query(
  `select "acknowledged", "status", "signed_name", "acknowledged_at"
   from ${SCHEMA}."policy_acknowledgment" where "id" = $1`, [id])).rows[0];

test('a person signs their own assigned row, and the server stamps the moment', async () => {
  const before = await rowOf(MINE);
  assert.equal(before.acknowledged, false);
  const result = await sign(CLINICIAN_A, MINE, '  Ada Lovelace  ');
  assert.equal(result.success, true);
  assert.equal(result.already_acknowledged, false);
  assert.equal(result.acknowledgment.status, 'acknowledged');
  // Trimmed, as the original trims.
  assert.equal(result.acknowledgment.signed_name, 'Ada Lovelace');
  const after = await rowOf(MINE);
  assert.equal(after.acknowledged, true);
  assert.equal(after.status, 'acknowledged');
  assert.ok(after.acknowledged_at, 'the moment is stamped by the server');
});

test('tenancy is not ownership: an agency colleague cannot sign your row', async () => {
  // Both rows are in agency A, so the POLICIES admit both to both callers.
  // Only the contract's ownership check keeps a learner off somebody else's
  // signature — which is exactly the job the original says it is doing,
  // because its own write bypassed RLS.
  await refusal(sign(CLINICIAN_A, THEIRS), 'PENNSYNC_POLICY_ACK_FORBIDDEN');
  assert.equal((await rowOf(THEIRS)).acknowledged, false);
  // And the admin whose row it is can sign it.
  assert.equal((await sign(ADMIN_A, THEIRS)).success, true);
  assert.equal((await rowOf(THEIRS)).acknowledged, true);
});

test('a row in another agency is not found, even for its own signer', async () => {
  // The caller's address matches the row and it is still unreachable. Asked
  // about the agency they DO hold, the row is simply not in it — the same
  // answer a row that does not exist gets, so the endpoint cannot be used to
  // discover that an acknowledgment exists somewhere else.
  await refusal(sign(CLINICIAN_A, ELSEWHERE), 'PENNSYNC_POLICY_ACK_NOT_FOUND');
  // Asked about the agency the row IS in, they are refused before the row is
  // looked at, because they hold no membership there.
  await refusal(sign(CLINICIAN_A, ELSEWHERE, 'Ada Lovelace', B),
    'PENNSYNC_POLICY_ACK_AGENCY_NOT_HELD');
  // Agency B's admin holds B but the row is not theirs.
  await refusal(sign(ADMIN_B, ELSEWHERE, 'Ada Lovelace', B), 'PENNSYNC_POLICY_ACK_FORBIDDEN');
  assert.equal((await rowOf(ELSEWHERE)).acknowledged, false);
  // A row that does not exist reads the same as one in another agency.
  await refusal(sign(CLINICIAN_A, 'ack-nowhere'), 'PENNSYNC_POLICY_ACK_NOT_FOUND');
});

test('signing twice does not move the moment it was signed', async () => {
  const before = await rowOf(SIGNED);
  const result = await sign(CLINICIAN_A, SIGNED, 'Someone Else');
  assert.equal(result.success, true);
  assert.equal(result.already_acknowledged, true);
  // The original's stamp survives, name included: an acknowledgment records
  // when somebody signed, and signing again does not change that.
  const after = await rowOf(SIGNED);
  assert.equal(after.signed_name, before.signed_name);
  assert.deepEqual(after.acknowledged_at, before.acknowledged_at);
  assert.equal(result.acknowledgment.signed_name, 'Ada L');
});

test('the signature is bounded where the original bounds it nowhere', async () => {
  await refusal(sign(CLINICIAN_A, THEIRS, '   '), 'PENNSYNC_POLICY_ACK_NAME_REQUIRED');
  await refusal(sign(CLINICIAN_A, THEIRS, 'x'.repeat(201)), 'PENNSYNC_POLICY_ACK_NAME_REQUIRED');
  await refusal(sign(CLINICIAN_A, THEIRS, 'Ada\u0007Lovelace'), 'PENNSYNC_POLICY_ACK_NAME_REQUIRED');
  await refusal(sign(CLINICIAN_A, 'has spaces'), 'PENNSYNC_POLICY_ACK_SUBJECT_INVALID');
});

test('nothing the caller sends reaches the audit fields, and no locator leaves', async () => {
  // The original stamps `ip_address` and `device_metadata` from request
  // headers. A contract cannot see a request, and taking them as parameters
  // would let the person signing choose what the trail says about them — so
  // they are not taken at all, and the columns stay null.
  const stamped = (await db.query(
    `select "ip_address", "device_metadata" from ${SCHEMA}."policy_acknowledgment"
     where "id" = $1`, [MINE])).rows[0];
  assert.equal(stamped.ip_address, null);
  assert.equal(stamped.device_metadata, null);
  const source = readFileSync(resolve(repository, ACK), 'utf8');
  assert.equal(/ip_address"\s*=/.test(source), false, 'the contract writes no ip_address');
  assert.equal(/device_metadata"\s*=/.test(source), false, 'the contract writes no device_metadata');
  // `doc_url` is a file locator, which is why D16 keeps this entity's family
  // out of the generic brokers. The answer must not carry one.
  const answer = await as(CLINICIAN_A, SIGN, [A, SIGNED, 'Ada Lovelace']);
  assert.equal(JSON.stringify(answer).includes('doc_url'), false);
  assert.equal(JSON.stringify(answer).includes('example.invalid'), false);
});
