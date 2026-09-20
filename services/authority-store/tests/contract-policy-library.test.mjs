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
 * The first reviewed per-capability contract, and the pattern for the 94 that
 * follow. What has to hold is different from what the broker family had to
 * hold, because a contract is allowed to do what the family is not:
 *
 * - it returns `doc_url`, the file locator that is exactly why D16's ceiling
 *   keeps `PolicyLibrary` out of the generic family;
 * - it makes an authorization decision about the CALLER — drafts and archived
 *   go only to an administrator — which no policy can express.
 *
 * So every case below asks either "does the wrong caller get refused" or "is
 * this still the same answer the Base44 original gave". The second is not a
 * matter of taste: the projection is reproduced in SQL, so it is compared
 * against the original's own `publicPolicy` running on the same rows rather
 * than against a transcription of it.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CONTRACT_MIGRATION = 'services/authority-store/supabase/record-migrations/20260920000000_contract_policy_library.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** 1 is agency_admin in agency-a, 2 is a clinician there, 4 is agency_admin in agency-b. */
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const A = 'agency-a'; const B = 'agency-b';
const CALL = 'select "public"."pennsync_contract_policy_library_list"($1,$2) as result';
let db;

/** Rows chosen so every normalization the original performs is exercised. */
const ROWS = [
  { id: 'pol-1', agency_id: A, title: 'Zulu policy', policy_number: 'P-002', category: 'clinical',
    content: 'Body one', doc_url: 'https://storage.example/pol-1.pdf', version: '2',
    effective_date: '2026-01-02', review_date: '2027-01-02',
    tags: ['a', 'b'], applies_to_roles: ['nurse'], status: 'active', created_date: '2026-01-02T00:00:00Z' },
  { id: 'pol-2', agency_id: A, title: 'Alpha policy', policy_number: null, category: null,
    content: null, doc_url: null, version: null, effective_date: null, review_date: null,
    // Mixed and non-array members: the original keeps only the strings, and
    // answers [] for something that is not an array at all.
    tags: ['keep', 7, null], applies_to_roles: 'not an array', status: 'active',
    created_date: '2026-01-03T00:00:00Z' },
  { id: 'pol-3', agency_id: A, title: 'Draft policy', policy_number: 'P-003', category: 'safety',
    content: 'Draft body', doc_url: '', version: '1', effective_date: null, review_date: null,
    tags: null, applies_to_roles: null, status: 'draft', created_date: '2026-01-04T00:00:00Z' },
  { id: 'pol-4', agency_id: A, title: 'Archived policy', policy_number: 'P-004', category: null,
    content: '', doc_url: null, version: '', effective_date: null, review_date: null,
    tags: [], applies_to_roles: [], status: 'archived', created_date: '2026-01-01T00:00:00Z' },
  { id: 'pol-b1', agency_id: B, title: 'Agency B policy', policy_number: 'B-001', category: 'hr',
    content: 'Other tenant', doc_url: 'https://storage.example/b1.pdf', version: '1',
    effective_date: null, review_date: null, tags: [], applies_to_roles: [], status: 'active',
    created_date: '2026-01-05T00:00:00Z' },
];

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await db.exec(readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8'));
  await db.exec(readFileSync(resolve(repository, BROKER_MIGRATION_FILE), 'utf8'));
  await db.exec(readFileSync(resolve(repository, CONTRACT_MIGRATION), 'utf8'));
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const row of ROWS) {
    await db.query(`insert into ${SCHEMA}."policy_library"("source_app_id","id","agency_id","title",
      "policy_number","category","content","doc_url","version","effective_date","review_date",
      "tags","applies_to_roles","status","created_date")
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [APP, row.id, row.agency_id, row.title, row.policy_number, row.category, row.content, row.doc_url,
      row.version, row.effective_date, row.review_date,
      row.tags === null ? null : JSON.stringify(row.tags),
      row.applies_to_roles === null ? null : JSON.stringify(row.applies_to_roles),
      row.status, row.created_date]);
  }
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
const call = async (n, agency, mode) => (await as(n, CALL, [agency, mode]))[0].result;
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

/** The original's own projection, lifted from the module rather than retyped. */
async function originalProjection() {
  let source = await readFile(
    new URL('../../../base44/functions/listPolicyLibrary/entry.ts', import.meta.url), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, '');
  source = source.replace(/Deno\.serve\([\s\S]*$/, '');
  source += '\nexport { publicPolicy };\n';
  const file = join(tmpdir(), `policyparity_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  try { return (await import(pathToFileURL(file).href)).publicPolicy; }
  finally { await unlink(file).catch(() => {}); }
}

test('a member reads the active policies of the agency they named, and no other', async () => {
  const result = await call(ADMIN_A, A, 'active');
  // Active only, sorted by title as the original sorts that mode.
  assert.deepEqual(result.policies.map(policy => policy.id), ['pol-2', 'pol-1']);
  const other = await call(ADMIN_B, B, 'active');
  assert.deepEqual(other.policies.map(policy => policy.id), ['pol-b1']);
});

test('the full catalog is the administrator only, and it is a narrowing', async () => {
  // Drafts and archived, newest first, as the original orders `all`.
  const all = await call(ADMIN_A, A, 'all');
  assert.deepEqual(all.policies.map(policy => policy.id), ['pol-3', 'pol-2', 'pol-1', 'pol-4']);
  // A clinician in the same agency gets the active list and is refused the
  // catalog. The Base44 original gave the catalog to a PLATFORM admin, who saw
  // every agency's drafts; an agency_admin sees only their own.
  assert.deepEqual((await call(CLINICIAN_A, A, 'active')).policies.map(policy => policy.id), ['pol-2', 'pol-1']);
  await refusal(call(CLINICIAN_A, A, 'all'), 'PENNSYNC_CONTRACT_FORBIDDEN');
  // And an administrator of another agency is an administrator of theirs only.
  await refusal(call(ADMIN_B, A, 'all'), 'PENNSYNC_CONTRACT_AGENCY_NOT_HELD');
});

test('an agency the caller does not hold is refused rather than answered empty', async () => {
  // An empty list would report that the agency exists and has no policies.
  for (const who of [ADMIN_A, CLINICIAN_A]) {
    await refusal(call(who, B, 'active'), 'PENNSYNC_CONTRACT_AGENCY_NOT_HELD');
  }
  await refusal(call(ADMIN_B, A, 'active'), 'PENNSYNC_CONTRACT_AGENCY_NOT_HELD');
  for (const agency of [null, '', 'no-such-agency']) {
    await refusal(call(ADMIN_A, agency, 'active'), 'PENNSYNC_CONTRACT_AGENCY_NOT_HELD');
  }
});

test('a mode the original refuses is refused here, before anything is read', async () => {
  for (const mode of [null, '', 'ALL', 'Active', 'draft', 'all; drop table x', 'archived']) {
    await refusal(call(ADMIN_A, A, mode), 'PENNSYNC_CONTRACT_MODE_INVALID');
  }
});

test('the projection is what the original produces, field for field', async () => {
  const publicPolicy = await originalProjection();
  const all = await call(ADMIN_A, A, 'all');
  const byId = new Map(all.policies.map(policy => [policy.id, policy]));
  for (const row of ROWS.filter(candidate => candidate.agency_id === A)) {
    // The original reads whatever the platform returned, so it is given the
    // same row this contract read from.
    const expected = publicPolicy({ ...row, updated_date: null });
    const actual = byId.get(row.id);
    assert.ok(actual, `${row.id} should be in the catalog`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${row.id} field set`);
    for (const [key, value] of Object.entries(expected)) {
      // Dates come back as the stored value rather than a re-parsed one; the
      // rest must match exactly, including the '' for an absent string and the
      // [] for something that was not an array.
      if (['effective_date', 'review_date', 'created_date', 'updated_date'].includes(key)) continue;
      assert.deepEqual(actual[key], value, `${row.id}.${key}`);
    }
  }
  // The locator this capability is allowed to return, and the family is not.
  assert.equal(byId.get('pol-1').doc_url, 'https://storage.example/pol-1.pdf');
  assert.equal(byId.get('pol-2').doc_url, '');
  assert.deepEqual(byId.get('pol-2').tags, ['keep']);
  assert.deepEqual(byId.get('pol-2').applies_to_roles, []);
  assert.deepEqual(byId.get('pol-3').tags, []);
});

test('a contract is not an exemption from the policies it runs under', async () => {
  // The contract adds no tenant predicate of its own beyond the agency it was
  // asked for; `policy_library_read` is what keeps another agency's rows out.
  // Removing the policy would let agency B's row into agency A's answer, so
  // this asserts the row set through a caller who holds BOTH agencies.
  await db.exec(`insert into pennsync_private.membership
    (app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
    values('${APP}','membership-policy-2b','${B}','${uid(CLINICIAN_A)}',
      '6aac00000000${String(CLINICIAN_A).padStart(12, '0')}','clinician','active')`);
  try {
    assert.deepEqual((await call(CLINICIAN_A, A, 'active')).policies.map(policy => policy.id),
      ['pol-2', 'pol-1']);
    assert.deepEqual((await call(CLINICIAN_A, B, 'active')).policies.map(policy => policy.id), ['pol-b1']);
  } finally {
    await db.exec(`delete from pennsync_private.membership where id = 'membership-policy-2b'`);
  }
});

test('a session with no identity reaches nothing', async () => {
  await db.exec('begin');
  try {
    await db.exec("select set_config('request.jwt.claims', null, true)");
    await db.exec('set local role authenticated');
    await refusal(db.query(CALL, [A, 'active']), 'PENNSYNC_CONTRACT_AGENCY_NOT_HELD');
  } finally { await db.exec('rollback'); }
});

test('nothing but the wrapper and the contract is reachable, and no table is', async () => {
  const { rows } = await db.query(`
    select n.nspname, p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.proname like '%contract_policy_library%'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
  assert.deepEqual(rows.map(row => `${row.nspname}.${row.proname}`).sort(),
    ['pennsync_records.contract_policy_library_list', 'public.pennsync_contract_policy_library_list']);
  // The helper the contract asks is still the owner's alone.
  const { rows: helper } = await db.query(
    `select has_function_privilege('authenticated', '${SCHEMA}.caller_tenant_role(text)', 'EXECUTE') as allowed`);
  assert.equal(helper[0].allowed, false, 'a caller must not be able to ask its own role directly');
});
