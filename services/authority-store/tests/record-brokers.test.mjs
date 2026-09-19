import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import {
  BROKERED_ENTITIES_FILE, BROKER_CODES, BROKER_MIGRATION_FILE, MAX_PAGE, OPERATIONS,
  WRAPPER_PREFIX, WRAPPER_SCHEMA, renderBrokerMigration, renderEntityModule,
} from '../../../tools-record-brokers.mjs';

/**
 * The broker family, as a caller actually reaches it.
 *
 * `record-store-migration.test.mjs` proved the composition is possible: a
 * SECURITY DEFINER function owned by a non-bypass role can serve a caller who
 * holds nothing, and the policies still bind inside it. It built one broker to
 * show that and said so — "the broker in the test exists to prove the boundary,
 * and is not that family".
 *
 * This is the family. What it has to establish is different from what the
 * boundary test established, because the danger has moved: the policies are no
 * longer the only thing standing between two agencies, the broker is also in
 * the path, and a broker that widens is worse than no broker at all. So every
 * case below asks what a caller CANNOT do through it, and the writes assert
 * what the stored row says rather than what the call returned.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** 1 and 2 are in agency-a, 4 is in agency-b. */
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const EMAIL = { 1: 'admin-a@example.invalid', 2: 'clinician-a@example.invalid', 4: 'admin-b@example.invalid' };
const A = 'agency-a'; const B = 'agency-b';
/** One entity of each tenancy shape the family serves. */
const TENANT = 'AIKnowledgeBase'; const SELF = 'AIFeedback'; const GLOBAL = 'ServiceCode';
const CALLER_ROLES = ['anon', 'authenticated', 'service_role'];
let db;

const brokerMigration = () => readFileSync(resolve(repository, BROKER_MIGRATION_FILE), 'utf8');

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await db.exec(readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8'));
  await db.exec(brokerMigration());
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // Seeded as the migration administrator, which bypasses RLS — deliberately,
  // so the rows below exist regardless of what the policies would have allowed
  // and every assertion afterwards is about what a caller can reach, not about
  // what a caller managed to write.
  await db.exec(`
    insert into ${SCHEMA}."ai_knowledge_base"("source_app_id","id","agency_id","title") values
      ('${APP}','kb-a1','${A}','Agency A first'), ('${APP}','kb-a2','${A}','Agency A second'),
      ('${APP}','kb-b1','${B}','Agency B only');
    insert into ${SCHEMA}."ai_feedback"("source_app_id","id","user_email","feedback_text") values
      ('${APP}','fb-1','${EMAIL[1]}','Seen by one'), ('${APP}','fb-2','${EMAIL[2]}','Seen by two');
    insert into ${SCHEMA}."service_code"("source_app_id","id","code","name") values
      ('${APP}','svc-1','G0151','Physical therapy');`);
  // A second membership for one caller, so the family's ONE narrowing — a
  // request names one agency out of the several a caller may hold — is
  // exercised by someone who really holds two. Without it every caller has a
  // single agency, RLS alone produces the right answer, and a broker that
  // dropped the narrowing would pass every case above.
  await db.exec(`
    insert into pennsync_private.membership(app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
    values('${APP}','membership-2b','${B}','${uid(CLINICIAN_A)}','6aac00000000${String(CLINICIAN_A).padStart(12, '0')}','clinician','active');`);
});
after(async () => db?.close());

/** Speak as a fixture identity through the exposed wrapper, holding only what the migration grants. */
async function as(n, sql, params = []) {
  if (sql === listSql) return (await asRows(n, sql, params))[0].page.map(row => ({ row }));
  return asRows(n, sql, params);
}

async function asRows(n, sql, params = []) {
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

/** The same, kept open so a write can be read back in the transaction that made it. */
async function session(n, run) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    return await run(async (sql, params = []) => {
      const { rows } = await db.query(sql, params);
      return sql === listSql ? rows[0].page.map(row => ({ row })) : rows;
    });
  } finally { await db.exec('rollback'); }
}

const refusal = async (promise, code) => {
  await assert.rejects(promise, error => {
    assert.match(String(error?.message ?? error), new RegExp(code));
    return true;
  }, `expected ${code}`);
};

// `list` answers one jsonb array, so the harness unwraps it into the same
// `{ row }` shape the single-row operations produce and every case below reads
// alike.
const listSql = `select ${WRAPPER_SCHEMA}.${WRAPPER_PREFIX}list($1,$2,$3,$4) as page`;
const get = `select ${WRAPPER_SCHEMA}.${WRAPPER_PREFIX}get($1,$2,$3) as row`;
const insert = `select ${WRAPPER_SCHEMA}.${WRAPPER_PREFIX}insert($1,$2,$3) as row`;
const update = `select ${WRAPPER_SCHEMA}.${WRAPPER_PREFIX}update($1,$2,$3,$4) as row`;
const remove = `select ${WRAPPER_SCHEMA}.${WRAPPER_PREFIX}delete($1,$2,$3) as removed`;

test('the committed migration is exactly what the generator produces', () => {
  const { plan, sql } = renderBrokerMigration(repository);
  assert.equal(brokerMigration(), sql,
    'The broker migration has drifted from the generator. '
    + 'Re-run `node tools-record-brokers.mjs --write` rather than editing the SQL.');
  // The service's copy of the allowlist comes from the same plan. Two lists
  // that drift apart is how a handler asks for an entity the family stopped
  // serving and gets a database error instead of a refusal.
  assert.equal(readFileSync(resolve(repository, BROKERED_ENTITIES_FILE), 'utf8'), renderEntityModule(plan));
});

test('every refusal the SQL can raise is one the service knows the name of', () => {
  const sql = brokerMigration();
  const raised = [...sql.matchAll(/message\s*=\s*'(PENNSYNC_BROKER_[A-Z_]+)'/g)].map(match => match[1]);
  assert.ok(raised.length >= Object.keys(BROKER_CODES).length, 'expected the family to raise its own codes');
  // Both directions. A code the SQL raises that the client does not know
  // becomes a generic outage for the caller; a code the client expects that
  // nothing raises is a branch that can never be taken.
  assert.deepEqual([...new Set(raised)].sort(), Object.values(BROKER_CODES).sort());
});

test('a caller holding nothing reads its own agency and not the other one', async () => {
  const rows = await as(ADMIN_A, listSql, [A, TENANT, 50, null]);
  assert.deepEqual(rows.map(r => r.row.id).sort(), ['kb-a1', 'kb-a2']);
  assert.ok(rows.every(r => r.row.agency_id === A));
  const other = await as(ADMIN_B, listSql, [B, TENANT, 50, null]);
  assert.deepEqual(other.map(r => r.row.id), ['kb-b1']);
});

test('a caller holding two agencies sees one at a time', async () => {
  // Both memberships are real, so RLS admits rows from both. What keeps them
  // apart is the agency the request named, and this is the only place the
  // family narrows anything at all.
  assert.deepEqual((await as(CLINICIAN_A, listSql, [A, TENANT, 50, null])).map(r => r.row.id).sort(),
    ['kb-a1', 'kb-a2']);
  assert.deepEqual((await as(CLINICIAN_A, listSql, [B, TENANT, 50, null])).map(r => r.row.id), ['kb-b1']);
  assert.equal((await as(CLINICIAN_A, get, [A, TENANT, 'kb-b1']))[0].row, null);
  assert.ok((await as(CLINICIAN_A, get, [B, TENANT, 'kb-b1']))[0].row);
  // And a write lands in the agency the request named, not in whichever one
  // the caller happens to hold first.
  await session(CLINICIAN_A, async (run) => {
    const [{ row }] = await run(insert, [B, TENANT, { title: 'Into B' }]);
    assert.equal(row.agency_id, B);
    assert.equal((await run(get, [A, TENANT, row.id]))[0].row, null);
  });
});

test('an id from another agency is absent rather than refused', async () => {
  // Telling "not yours" apart from "not there" reports whether an id exists
  // somewhere else, which is the thing the tenant boundary is for.
  const [row] = await as(ADMIN_A, get, [A, TENANT, 'kb-b1']);
  assert.equal(row.row, null);
  const [mine] = await as(ADMIN_A, get, [A, TENANT, 'kb-a1']);
  assert.equal(mine.row.title, 'Agency A first');
});

test('naming an agency the caller does not hold is refused before any row is touched', async () => {
  await refusal(as(ADMIN_A, listSql, [B, TENANT, 50, null]), 'PENNSYNC_BROKER_AGENCY_NOT_HELD');
  await refusal(as(ADMIN_A, get, [B, TENANT, 'kb-b1']), 'PENNSYNC_BROKER_AGENCY_NOT_HELD');
  await refusal(as(ADMIN_A, insert, [B, TENANT, { title: 'x' }]), 'PENNSYNC_BROKER_AGENCY_NOT_HELD');
  await refusal(as(ADMIN_A, remove, [B, TENANT, 'kb-b1']), 'PENNSYNC_BROKER_AGENCY_NOT_HELD');
  await refusal(as(ADMIN_A, listSql, [null, TENANT, 50, null]), 'PENNSYNC_BROKER_AGENCY_REQUIRED');
});

test('an entity outside the allowlist is unreachable even though its table exists', async () => {
  // `Patient` is dispositioned `port`, so it has a table and 4 policies and is
  // deliberately not something a generic family may serve.
  for (const entity of ['Patient', 'Visit', 'patient', 'ai_knowledge_base', '', 'AIKnowledgeBase; drop table x']) {
    await refusal(as(ADMIN_A, listSql, [A, entity, 50, null]), 'PENNSYNC_BROKER_ENTITY_NOT_BROKERED');
  }
});

test('an insert is stamped, not trusted', async () => {
  await session(ADMIN_A, async (run) => {
    const [{ row }] = await run(insert, [A, TENANT, { title: 'Written through the broker', is_active: true }]);
    assert.equal(row.agency_id, A, 'the broker stamps the agency it verified');
    assert.equal(row.source_app_id, APP);
    assert.equal(row.created_by, EMAIL[ADMIN_A]);
    assert.match(row.id, /^[0-9a-f]{32}$/, 'the id is generated rather than accepted');
    assert.ok(row.created_date && row.updated_date);
    assert.equal(row.title, 'Written through the broker');
    // Read back through the broker, so what is asserted is the stored row.
    const [{ row: stored }] = await run(get, [A, TENANT, row.id]);
    assert.deepEqual(stored, row);
  });
});

test('a payload naming a stamped column is refused rather than silently stripped', async () => {
  // Stripping it leaves a caller believing it set an owner it did not.
  for (const payload of [{ agency_id: B }, { agency_id: A }, { source_app_id: 'other' },
    { id: 'chosen' }, { created_by: 'someone@example.invalid' }, { created_date: '2020-01-01' },
    { title: 'fine', agency_id: B }]) {
    await refusal(as(ADMIN_A, insert, [A, TENANT, payload]), 'PENNSYNC_BROKER_COLUMN_NOT_WRITABLE');
    await refusal(as(ADMIN_A, update, [A, TENANT, 'kb-a1', payload]), 'PENNSYNC_BROKER_COLUMN_NOT_WRITABLE');
  }
});

test('a payload naming something that is not a column is refused', async () => {
  for (const payload of [{ nope: 1 }, { 'title; drop table x': 1 }, { TITLE: 'case matters' }]) {
    await refusal(as(ADMIN_A, insert, [A, TENANT, payload]), 'PENNSYNC_BROKER_COLUMN_UNKNOWN');
  }
  for (const payload of [null, '"text"', '[]', '5']) {
    await refusal(as(ADMIN_A, insert, [A, TENANT, payload]), 'PENNSYNC_BROKER_RECORD_REQUIRED');
  }
});

test('an update patches the named keys, touches the stamp, and reaches no other agency', async () => {
  await session(ADMIN_A, async (run) => {
    const [{ row }] = await run(update, [A, TENANT, 'kb-a1', { title: 'Renamed', category: 'compliance' }]);
    assert.equal(row.title, 'Renamed');
    assert.equal(row.category, 'compliance');
    assert.equal(row.agency_id, A);
    assert.ok(row.updated_date, 'the broker stamps the update time');
    // An explicit null clears; an absent key does not.
    const [{ row: cleared }] = await run(update, [A, TENANT, 'kb-a1', { category: null }]);
    assert.equal(cleared.category, null);
    assert.equal(cleared.title, 'Renamed');
    // Another agency's row is not found, rather than refused or changed.
    const [{ row: missing }] = await run(update, [A, TENANT, 'kb-b1', { title: 'Reached across' }]);
    assert.equal(missing, null);
  });
  const [{ row: untouched }] = await as(ADMIN_B, get, [B, TENANT, 'kb-b1']);
  assert.equal(untouched.title, 'Agency B only', 'the cross-tenant update must not have landed');
});

test('a delete removes only what the caller could already see', async () => {
  await session(ADMIN_A, async (run) => {
    assert.equal((await run(remove, [A, TENANT, 'kb-b1']))[0].removed, false);
    assert.equal((await run(remove, [A, TENANT, 'kb-a2']))[0].removed, true);
    assert.equal((await run(get, [A, TENANT, 'kb-a2']))[0].row, null);
  });
  const [{ row }] = await as(ADMIN_B, get, [B, TENANT, 'kb-b1']);
  assert.ok(row, 'agency B still has its row');
});

test('a self-scoped entity is bound to the caller, not to the agency', async () => {
  assert.deepEqual((await as(ADMIN_A, listSql, [A, SELF, 50, null])).map(r => r.row.id), ['fb-1']);
  assert.deepEqual((await as(CLINICIAN_A, listSql, [A, SELF, 50, null])).map(r => r.row.id), ['fb-2'],
    'two callers in the SAME agency must not see each other here');
  await session(CLINICIAN_A, async (run) => {
    const [{ row }] = await run(insert, [A, SELF, { feedback_text: 'Mine' }]);
    assert.equal(row.user_email, EMAIL[CLINICIAN_A], 'the subject is stamped from the caller');
    assert.equal(row.created_by, EMAIL[CLINICIAN_A]);
  });
  // The subject is stamped, so naming it is refused like any other stamped column.
  await refusal(as(CLINICIAN_A, insert, [A, SELF, { user_email: EMAIL[ADMIN_A] }]),
    'PENNSYNC_BROKER_COLUMN_NOT_WRITABLE');
});

test('a global entity is readable by every member and writable by none', async () => {
  for (const [who, agency] of [[ADMIN_A, A], [ADMIN_B, B]]) {
    assert.deepEqual((await as(who, listSql, [agency, GLOBAL, 50, null])).map(r => r.row.code), ['G0151']);
  }
  await refusal(as(ADMIN_A, insert, [A, GLOBAL, { code: 'G9999' }]), 'PENNSYNC_BROKER_ENTITY_READ_ONLY');
  await refusal(as(ADMIN_A, update, [A, GLOBAL, 'svc-1', { name: 'Renamed' }]), 'PENNSYNC_BROKER_ENTITY_READ_ONLY');
  await refusal(as(ADMIN_A, remove, [A, GLOBAL, 'svc-1']), 'PENNSYNC_BROKER_ENTITY_READ_ONLY');
});

test('the page is bounded and walks by key rather than by offset', async () => {
  const first = await as(ADMIN_A, listSql, [A, TENANT, 1, null]);
  assert.equal(first.length, 1);
  assert.equal(first[0].row.id, 'kb-a1');
  const next = await as(ADMIN_A, listSql, [A, TENANT, 1, 'kb-a1']);
  assert.deepEqual(next.map(r => r.row.id), ['kb-a2']);
  assert.equal((await as(ADMIN_A, listSql, [A, TENANT, 1, 'kb-a2'])).length, 0);
  // A limit above the ceiling is clamped, not honoured, and a nonsense one is
  // not an error the caller has to handle.
  for (const limit of [MAX_PAGE + 1, 1_000_000, 0, -5, null]) {
    assert.ok((await as(ADMIN_A, listSql, [A, TENANT, limit, null])).length >= 1);
  }
});

test('nothing but the five operations is reachable, and no table is', async () => {
  const { rows: granted } = await db.query(`
    select p.proname, r.rolname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join unnest($2::text[]) as r(rolname)
    where n.nspname = $1 and has_function_privilege(r.rolname, p.oid, 'EXECUTE')`, [SCHEMA, CALLER_ROLES]);
  // The internals — the allowlist, the scope gate, the reserved set and the
  // payload check — answer questions a caller must not be able to ask directly.
  assert.deepEqual(granted.map(row => `${row.rolname}:${row.proname}`).sort(),
    OPERATIONS.map(operation => `authenticated:entity_${operation}`).sort());

  const { rows: tables } = await db.query(`
    select count(*)::integer as reachable
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join unnest($2::text[]) as r(rolname)
    where n.nspname = $1 and c.relkind = 'r'
      and has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE')`, [SCHEMA, CALLER_ROLES]);
  assert.equal(tables[0].reachable, 0, 'the brokers are the only way in');
});

test('the exposed wrappers add nothing and are granted to authenticated alone', async () => {
  const { rows } = await db.query(`
    select p.proname, p.prosecdef, r.rolname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join unnest($2::text[]) as r(rolname)
    where n.nspname = $1 and p.proname like $3 and has_function_privilege(r.rolname, p.oid, 'EXECUTE')`,
  [WRAPPER_SCHEMA, CALLER_ROLES, `${WRAPPER_PREFIX}%`]);
  assert.deepEqual(rows.map(row => `${row.rolname}:${row.proname}`).sort(),
    OPERATIONS.map(operation => `authenticated:${WRAPPER_PREFIX}${operation}`).sort());
  // SECURITY INVOKER: the wrapper must not be a second definer hop that could
  // reach the brokers as someone other than the caller.
  assert.ok(rows.every(row => row.prosecdef === false), 'a wrapper must run as its caller');
});

test('a session with no identity reaches nothing at all', async () => {
  await db.exec('begin');
  try {
    await db.exec("select set_config('request.jwt.claims', null, true)");
    await db.exec('set local role authenticated');
    await refusal(db.query(listSql, [A, TENANT, 50, null]), 'PENNSYNC_BROKER_AGENCY_NOT_HELD');
  } finally { await db.exec('rollback'); }
});
