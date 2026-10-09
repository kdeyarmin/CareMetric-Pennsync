import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { buildFixture } from './tools-pennsync-record-mover-fixtures.mjs';
import { applyLanding, previousFrom } from './tools-pennsync-record-mover-load.mjs';
import { loadTargetSpec, planFromDirectory } from './tools-pennsync-record-mover-plan.mjs';
import { RollbackError, planDelta, rollbackRun } from './tools-pennsync-record-mover-rollback.mjs';

const require = createRequire(new URL('./services/authority-store/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const STORE = new URL('./services/authority-store/', import.meta.url);
const spec = loadTargetSpec(process.cwd());
const tables = new Set([...spec.entities.values()].map((e) => e.table));
let db; let root; let landing; let waves; let report; let tableWaves;

const count = async (t) => Number((await db.query(`select count(*)::int n from pennsync_records."${t}"`)).rows[0].n);
const wipe = async () => { for (const t of tables) await db.exec(`delete from pennsync_records."${t}"`); };
const load = (over = {}) => applyLanding({ db, landing, waves, tables, report, ...over });
const total = async () => { let n = 0; for (const t of tables) n += await count(t); return n; };

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'pennsync-mover-rollback-'));
  const f = await buildFixture({ dir: join(root, 'in') });
  const planned = await planFromDirectory({ inputDir: f.dir, spec, keepRows: true });
  landing = planned.landing; report = planned.report;
  waves = new Map(report.loads.map((x) => [x.entity, x.wave]));
  tableWaves = new Map(report.loads.map((x) => [x.table, x.wave]));
  db = new PGlite();
  await db.exec(await readFile(new URL('tests/bootstrap.sql', STORE), 'utf8'));
  for (const dir of ['supabase/migrations/', 'supabase/record-migrations/']) {
    for (const name of (await readdir(new URL(dir, STORE))).filter((n) => n.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(dir + name, STORE), 'utf8'));
    }
  }
});
after(async () => { await db?.close(); await rm(root, { recursive: true, force: true }); });

test('a rollback deletes exactly what the run inserted, and a second one finds nothing left', async () => {
  await wipe();
  const receipt = await load();
  assert.equal(await total(), landing.length);
  const out = await rollbackRun({ db, receipt, tableWaves, tables });
  assert.ok(out.entries.every((e) => e.outcome === 'deleted'));
  assert.equal(await total(), 0);
  const again = await rollbackRun({ db, receipt, tableWaves, tables });
  assert.ok(again.entries.every((e) => e.outcome === 'already_absent'));
});

test('children go before the parents they point at', async () => {
  await wipe();
  const receipt = await load();
  const out = await rollbackRun({ db, receipt, tableWaves, tables });
  const order = out.entries.map((e) => tableWaves.get(e.table));
  assert.deepEqual(order, [...order].sort((a, b) => b - a));
  assert.ok(order[0] > order[order.length - 1]);
});

test('a row edited since the run is refused and kept', async () => {
  await wipe();
  const receipt = await load();
  const p = landing.find((r) => r.entity === 'Patient');
  await db.query('update pennsync_records.patient set last_name = $1 where id = $2', ['Edited later', p.id]);
  const out = await rollbackRun({ db, receipt, tableWaves, tables });
  assert.equal(out.entries.find((e) => e.id === p.id).outcome, 'edited_since');
  assert.equal(await count('patient'), 1);
  assert.ok(!JSON.stringify(out).includes('Edited later'));
});

test('rows a run only updated are reported, not guessed back, and unchanged rows are left alone', async () => {
  await wipe();
  const first = await load();
  const p = landing.find((r) => r.entity === 'Patient');
  const changed = landing.map((r) => (r === p ? { ...r, row: { ...r.row, last_name: 'Moved in source' } } : r));
  const { canonical } = await import('./tools-pennsync-record-mover-plan.mjs');
  const { createHash } = await import('node:crypto');
  const sha = (v) => createHash('sha256').update(v).digest('hex');
  const next = changed.map((r) => ({ ...r, hash: sha(canonical({ table: r.table, row: r.row })) }));
  const { digest: _d, ...body } = report;
  body.rows_digest = sha(next.map((r) => `${r.table}|${r.source_app_id}|${r.id}|${r.hash}`).sort().join('\n'));
  const rep2 = { ...body, digest: sha(canonical(body)) };
  const second = await applyLanding({ db, landing: next, waves, tables, report: rep2, previous: previousFrom(first) });
  assert.equal(second.entries.find((e) => e.id === p.id).outcome, 'updated');
  const out = await rollbackRun({ db, receipt: second, tableWaves, tables });
  assert.equal(out.entries.find((e) => e.id === p.id).outcome, 'not_restorable');
  assert.ok(out.entries.filter((e) => e.id !== p.id).every((e) => e.outcome === 'left_alone'));
  assert.equal(await total(), landing.length, 'nothing was deleted');
});

test('a dry run says what would happen and deletes nothing', async () => {
  await wipe();
  const receipt = await load();
  const out = await rollbackRun({ db, receipt, tableWaves, tables, dryRun: true });
  assert.ok(out.dry_run && out.entries.every((e) => e.outcome === 'deleted'));
  assert.equal(await total(), landing.length);
});

test('a receipt naming a table outside the set, or a table with no wave, is refused before any delete', async () => {
  await wipe();
  const receipt = await load();
  const evil = { ...receipt, entries: [{ ...receipt.entries[0], table: 'membership' }] };
  await assert.rejects(rollbackRun({ db, receipt: evil, tableWaves, tables }), (e) => e instanceof RollbackError && e.code === 'table_not_allowed');
  await assert.rejects(rollbackRun({ db, receipt, tableWaves: new Map(), tables }), (e) => e.code === 'table_without_wave');
  await assert.rejects(rollbackRun({ db, receipt: { ...receipt, format: 'other' }, tableWaves, tables }), (e) => e.code === 'rollback_configuration_invalid');
  assert.equal(await total(), landing.length);
});

test('the delta names added, changed, unchanged and removed rows by id only', async () => {
  await wipe();
  const receipt = await load();
  const [gone, ...rest] = landing;
  const edited = rest.map((r, i) => (i === 0 ? { ...r, hash: 'x'.repeat(64) } : r));
  const extra = { ...landing[0], id: 'brand-new', hash: 'y'.repeat(64) };
  const d = planDelta({ landing: [...edited, extra], receipt });
  assert.deepEqual(d.counts, { added: 1, changed: 1, unchanged: rest.length - 1, conflicted: 0, removed_from_source: 1 });
  assert.equal(d.removed_from_source[0].id, gone.id);
  assert.ok(!JSON.stringify(d).includes('Fixture'));
});

test('a kept child keeps the parent it points at, so nothing is left dangling', async () => {
  await wipe();
  const receipt = await load();
  const visit = landing.find((r) => r.entity === 'Visit');
  await db.query('update pennsync_records.visit set status = $1 where id = $2', ['cancelled', visit.id]);
  const out = await rollbackRun({ db, receipt, tableWaves, tables });
  const by = (id) => out.entries.find((e) => e.id === id).outcome;
  assert.equal(by(visit.id), 'edited_since');
  assert.equal(by(visit.row.patient_id), 'kept_for_dependent');
  const kept = (await db.query('select id from pennsync_records.patient')).rows.map((r) => r.id);
  assert.deepEqual(kept, [visit.row.patient_id]);
  const unrelated = landing.find((r) => r.entity === 'Visit' && r.id !== visit.id && r.row.patient_id !== visit.row.patient_id);
  assert.equal(by(unrelated.id), 'deleted');
});

test('a row created since the run keeps the parent it points at, including through a prefixed reference column', async () => {
  await wipe();
  const receipt = await load();
  const visit = landing.find((r) => r.entity === 'Visit');
  await db.query(`insert into pennsync_records.visit select (jsonb_populate_record(null::pennsync_records.visit, to_jsonb(v) || '{"id":"added-after-the-run"}'::jsonb)).* from pennsync_records.visit v where v.id = $1`, [visit.id]);
  const other = landing.find((r) => r.entity === 'Patient' && r.id !== visit.row.patient_id);
  await db.query(`insert into pennsync_records.patient_education_material (id, source_app_id, agency_id, target_patient_id) select 'material-after-the-run', source_app_id, agency_id, id from pennsync_records.patient where id = $1`, [other.id]);
  const out = await rollbackRun({ db, receipt, tableWaves, tables });
  const by = (id) => out.entries.find((e) => e.id === id).outcome;
  assert.equal(by(visit.row.patient_id), 'kept_for_dependent');
  assert.equal(by(other.id), 'kept_for_dependent');
  const kept = (await db.query('select id from pennsync_records.patient order by id')).rows.map((r) => r.id).sort();
  assert.deepEqual(kept, [visit.row.patient_id, other.id].sort());
  assert.equal((await db.query(`select id from pennsync_records.visit where id = 'added-after-the-run'`)).rows.length, 1);
  assert.equal((await db.query(`select id from pennsync_records.patient_education_material where id = 'material-after-the-run'`)).rows.length, 1);
});

test('a receipt from a dry run is refused, so planned hashes can never match rows another run wrote', async () => {
  await wipe();
  const dry = await load({ dryRun: true });
  await load();
  await assert.rejects(rollbackRun({ db, receipt: dry, tableWaves, tables }), (e) => e.code === 'receipt_is_dry_run');
  assert.equal(await total(), landing.length);
});

test('a conflicted row is still in the comparison, not reported as new', async () => {
  await wipe();
  const first = await load();
  const p = landing.find((r) => r.entity === 'Patient');
  const conflicted = { ...first, entries: first.entries.map((e) => (e.id === p.id ? { ...e, outcome: 'conflict' } : e)) };
  let d = planDelta({ landing, receipt: conflicted });
  assert.deepEqual(d.conflicted.map((x) => [x.id, x.plan_changed]), [[p.id, false]]);
  assert.equal(d.counts.added, 0);
  d = planDelta({ landing: landing.filter((r) => r !== p), receipt: conflicted });
  assert.deepEqual(d.removed_from_source.map((x) => x.id), [p.id]);
});

test('a refused delete says the phase, table and SQLSTATE, never a value, and undoes the whole run', async () => {
  await wipe();
  const receipt = await load();
  const before = await total();
  // The store refuses with a message that quotes the row, as a real constraint error does.
  await db.exec(`
    create function pennsync_records.refuse_patient_delete() returns trigger language plpgsql as $$
    begin raise exception using errcode = '42501', message = 'refusing to delete ' || old.last_name; end $$;
    create trigger refuse_patient_delete before delete on pennsync_records.patient
      for each row execute function pennsync_records.refuse_patient_delete();`);
  try {
    await assert.rejects(rollbackRun({ db, receipt, tableWaves, tables }), (e) => {
      assert.ok(e instanceof RollbackError);
      assert.equal(e.code, 'rollback_refused');
      assert.equal(e.phase, 'delete');
      assert.equal(e.table, 'patient');
      assert.equal(e.sqlstate, '42501');
      const said = JSON.stringify({ ...e, message: e.message });
      assert.doesNotMatch(said, /Alpha|Beta|Gamma|refusing to delete/, 'no row value and no store message on the error');
      return true;
    });
    assert.equal(await total(), before, 'children deleted before the refusal are restored with it');
  } finally {
    await db.exec(`drop trigger refuse_patient_delete on pennsync_records.patient;
      drop function pennsync_records.refuse_patient_delete();`);
  }
});

test('a refused dependent scan names the referencing table it was scanning', async () => {
  await wipe();
  const receipt = await load();
  const before = await total();
  // The store refuses the scan of visit rows pointing at rows about to go, with a
  // message that quotes a value. PGlite runs as a superuser, so the refusal is injected
  // at the connection rather than raised by a policy.
  const scanned = /^select to_jsonb\(r\) j from "pennsync_records"\."visit" r where r\.source_app_id = \$1 and r\."[a-z_]+"::text = any/;
  let refused = 0;
  const refusing = {
    query: (sql, params) => {
      if (scanned.test(sql)) {
        refused += 1;
        return Promise.reject(Object.assign(new Error('could not obtain lock on row for Alpha'), { code: '55P03' }));
      }
      return db.query(sql, params);
    },
  };
  await assert.rejects(rollbackRun({ db: refusing, receipt, tableWaves, tables }), (e) => {
    assert.ok(e instanceof RollbackError);
    assert.equal(e.code, 'rollback_refused');
    assert.equal(e.phase, 'dependents');
    assert.equal(e.table, 'visit', 'the referencing table being scanned, not null');
    assert.equal(e.sqlstate, '55P03');
    assert.doesNotMatch(JSON.stringify({ ...e, message: e.message }), /Alpha|could not obtain/);
    return true;
  });
  assert.equal(refused, 1, 'the scan of visit was reached and refused once');
  assert.equal(await total(), before, 'nothing was deleted');
});
