import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { buildFixture } from './tools-pennsync-record-mover-fixtures.mjs';
import { LoadError, applyLanding, openReceipt, previousFrom, sealReceipt } from './tools-pennsync-record-mover-load.mjs';
import { canonical, loadTargetSpec, planFromDirectory } from './tools-pennsync-record-mover-plan.mjs';

const require = createRequire(new URL('./services/authority-store/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const STORE = new URL('./services/authority-store/', import.meta.url);
const spec = loadTargetSpec(process.cwd());
const tables = new Set([...spec.entities.values()].map((e) => e.table));
let db; let root; let landing; let waves; let report;
const sha = (v) => createHash('sha256').update(v).digest('hex');
// Re-derive a consistent plan for changed rows, the way a re-plan of changed source would.
function bound(rows) {
  const next = rows.map((r) => ({ ...r, hash: sha(canonical({ table: r.table, row: r.row })) }));
  const { digest: _drop, ...body } = report;
  body.rows_digest = sha(next.map((r) => `${r.table}|${r.source_app_id}|${r.id}|${r.hash}`).sort().join('\n'));
  return { landing: next, report: { ...body, digest: sha(canonical(body)) } };
}

async function build() {
  const d = new PGlite();
  await d.exec(await readFile(new URL('tests/bootstrap.sql', STORE), 'utf8'));
  for (const dir of ['supabase/migrations/', 'supabase/record-migrations/']) {
    for (const name of (await readdir(new URL(dir, STORE))).filter((f) => f.endsWith('.sql')).sort()) {
      await d.exec(await readFile(new URL(dir + name, STORE), 'utf8'));
    }
  }
  return d;
}
const count = async (t) => Number((await db.query(`select count(*)::int n from pennsync_records."${t}"`)).rows[0].n);
const wipe = async () => { for (const t of tables) await db.exec(`delete from pennsync_records."${t}"`); };
const run = (over = {}) => applyLanding({ db, landing, waves, tables, report, ...over });

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'pennsync-mover-load-'));
  const f = await buildFixture({ dir: join(root, 'in') });
  const { report: rep, landing: l } = await planFromDirectory({ inputDir: f.dir, spec, keepRows: true });
  landing = l; report = rep; waves = new Map(rep.loads.map((x) => [x.entity, x.wave]));
  db = await build();
});
after(async () => { await db?.close(); await rm(root, { recursive: true, force: true }); });

test('a first run inserts every planned row, in the planned agency, with the original id and dates', async () => {
  await wipe();
  const receipt = await run();
  assert.equal(receipt.entries.length, landing.length);
  assert.ok(receipt.entries.every((e) => e.outcome === 'inserted'));
  assert.equal(await count('patient'), 3); assert.equal(await count('visit'), 3); assert.equal(await count('task'), 1);
  const task = landing.find((x) => x.entity === 'Task');
  const { rows } = await db.query('select id, agency_id, created_date::text d from pennsync_records.task where id = $1', [task.id]);
  assert.equal(rows[0].agency_id, task.row.agency_id);
  assert.equal(new Date(rows[0].d).toISOString(), new Date(task.row.created_date).toISOString());
  assert.deepEqual(receipt.waves, [0, 1, 2, 3].filter((w) => receipt.waves.includes(w)));
});

test('a second run changes nothing', async () => {
  await wipe(); const first = await run();
  const before = (await db.query('select txid_current_if_assigned() x')).rows[0].x;
  const second = await run({ previous: previousFrom(first) });
  assert.ok(second.entries.every((e) => e.outcome === 'unchanged'));
  assert.equal(before, null);
  assert.deepEqual(second.entries.map((e) => e.db_hash), first.entries.map((e) => e.db_hash));
});

test('a source change updates only a row nobody touched on the new side', async () => {
  await wipe(); const first = await run();
  const patients = landing.filter((x) => x.entity === 'Patient');
  const [a, b] = patients;
  const changed = bound(landing.map((x) => (x === a || x === b ? { ...x, row: { ...x.row, primary_diagnosis: 'Changed in source' } } : x)));
  // Someone edits row b on the new side after the first run.
  await db.query('update pennsync_records.patient set primary_diagnosis = $1 where id = $2', ['Edited on the new side', b.id]);
  const second = await applyLanding({ db, landing: changed.landing, report: changed.report, waves, tables, previous: previousFrom(first) });
  const by = Object.fromEntries(second.entries.filter((e) => e.table === 'patient').map((e) => [e.id, e.outcome]));
  assert.equal(by[a.id], 'updated'); assert.equal(by[b.id], 'conflict');
  const kept = (await db.query('select id, primary_diagnosis from pennsync_records.patient where id in ($1,$2)', [a.id, b.id])).rows;
  assert.equal(kept.find((r) => r.id === a.id).primary_diagnosis, 'Changed in source');
  assert.equal(kept.find((r) => r.id === b.id).primary_diagnosis, 'Edited on the new side');
});

test('a wave that fails leaves the store as it found it, and earlier waves stay', async () => {
  await wipe();
  const bad = bound(landing.map((x) => (x.entity === 'Visit' && x === landing.find((y) => y.entity === 'Visit') ? { ...x, row: { ...x.row, visit_date: 'not a date' } } : x)));
  await assert.rejects(applyLanding({ db, landing: bad.landing, report: bad.report, waves, tables }), (e) => {
    assert.ok(e instanceof LoadError && e.code === 'wave_refused'); assert.equal(e.table, 'visit');
    assert.ok(!JSON.stringify({ c: e.code, t: e.table, i: e.id, w: e.committed_waves }).includes('not a date'));
    assert.ok(e.partial_entries.length > 0 && e.partial_entries.every((x) => x.outcome === 'inserted'), 'the waves that did commit are on the error, so they can be rolled back');
    assert.ok(!JSON.stringify(e.partial_entries).includes('not a date'));
    return true;
  });
  assert.equal(await count('visit'), 0); assert.equal(await count('task'), 0);
  assert.equal(await count('patient'), 3, 'the earlier wave committed');
});

test('a dry run reports the same outcomes and writes nothing', async () => {
  await wipe();
  const receipt = await run({ dryRun: true });
  assert.ok(receipt.entries.every((e) => e.outcome === 'inserted') && receipt.dry_run);
  assert.equal(await count('patient'), 0);
});

test('real names are refused unless this exact plan was approved, and nothing is written first', async () => {
  await wipe();
  const real = bound(landing.map((x) => (x.entity === 'Patient' ? { ...x, row: { ...x.row, first_name: 'Ada' } } : x)));
  for (const approval of [null, { real_names_plan_digest: 'someone else' }, { real_names_plan_digest: report.digest }]) {
    await assert.rejects(applyLanding({ db, landing: real.landing, report: real.report, waves, tables, approval }), (e) => e.code === 'real_names_not_approved');
    assert.equal(await count('agency'), 0);
  }
  const ok = await applyLanding({ db, landing: real.landing, report: real.report, waves, tables, approval: { real_names_plan_digest: real.report.digest } });
  assert.ok(ok.entries.length > 0);
});

test('rows that are not the rows of the plan are refused, with nothing written', async () => {
  await wipe();
  const swapped = landing.map((x) => (x.entity === 'Patient' ? { ...x, row: { ...x.row, first_name: 'Ada' } } : x));
  await assert.rejects(applyLanding({ db, landing: swapped, waves, tables, report }), (e) => e.code === 'plan_does_not_match_payload');
  const dropped = landing.slice(1);
  await assert.rejects(applyLanding({ db, landing: dropped, waves, tables, report }), (e) => e.code === 'plan_does_not_match_payload');
  await assert.rejects(applyLanding({ db, landing, waves, tables, report: { ...report, digest: 'x' } }), (e) => e.code === 'plan_digest_invalid');
  assert.equal(await count('agency'), 0);
});

test('only tables the plan names are written, and the name is never spliced into SQL', async () => {
  await wipe();
  const evil = [{ ...landing[0], table: 'patient"; drop table pennsync_records.patient; --' }];
  await assert.rejects(applyLanding({ db, landing: evil, waves, tables, report }), (e) => e.code === 'table_not_allowed');
  const other = [{ ...landing[0], table: 'membership' }];
  await assert.rejects(applyLanding({ db, landing: other, waves, tables, report }), (e) => e.code === 'table_not_allowed');
  assert.equal(await count('patient'), 0);
});

test('a sealed receipt opens only with its key and carries no key, value or plaintext', async () => {
  await wipe(); const receipt = await run();
  const key = randomBytes(32);
  const sealed = sealReceipt(receipt, Buffer.from(key));
  assert.deepEqual(openReceipt(sealed, key), receipt);
  assert.ok(!sealed.includes(key) && !sealed.includes(Buffer.from(key.toString('base64'))));
  assert.ok(!sealed.includes(Buffer.from('"outcome"')) && !sealed.includes(Buffer.from(receipt.plan_digest)));
  assert.throws(() => openReceipt(sealed, randomBytes(32)), (e) => e.code === 'receipt_unreadable');
  const tampered = Buffer.from(sealed); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => openReceipt(tampered, key), (e) => e.code === 'receipt_unreadable');
  const text = JSON.stringify(receipt);
  assert.ok(!text.includes('Fixture') && !text.includes('fixture.invalid'), 'the receipt holds ids and hashes only');
});
