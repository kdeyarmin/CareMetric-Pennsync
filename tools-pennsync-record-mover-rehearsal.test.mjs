import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { buildFixture } from './tools-pennsync-record-mover-fixtures.mjs';
import { applyLanding, previousFrom } from './tools-pennsync-record-mover-load.mjs';
import { canonical, loadTargetSpec, planFromDirectory } from './tools-pennsync-record-mover-plan.mjs';
import { planDelta, rollbackRun } from './tools-pennsync-record-mover-rollback.mjs';
import { verifyRun } from './tools-pennsync-record-mover-verify.mjs';

/**
 * The rehearsal: every step of a real run, in order, against a throwaway local
 * database and made-up records. Nothing here reads a production system or writes
 * anywhere but memory. The sequence is the one the design file promises: a full
 * run, a deliberate interruption and its resume, a second run that must change
 * nothing, a delta run, and a rollback, with the independent verifier looking
 * after each write step.
 */
const require = createRequire(new URL('./services/authority-store/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const STORE = new URL('./services/authority-store/', import.meta.url);
const spec = loadTargetSpec(process.cwd());
const tables = new Set([...spec.entities.values()].map((e) => e.table));
const sha = (v) => createHash('sha256').update(v).digest('hex');
let db; let root; let landing; let report; let waves; let tableWaves;

function rebind(rows) {
  const next = rows.map((r) => ({ ...r, hash: sha(canonical({ table: r.table, row: r.row })) }));
  const { digest: _d, ...body } = report;
  // A changed row set changes the plan's own arithmetic too, so re-state it the way a re-plan would.
  body.loads = report.loads.map((l) => {
    const n = next.filter((r) => r.entity === l.entity).length;
    return { ...l, rows: n + l.quarantined, load: n };
  });
  body.totals = { ...report.totals, to_load: next.length };
  body.rows_digest = sha(next.map((r) => `${r.table}|${r.source_app_id}|${r.id}|${r.hash}`).sort().join('\n'));
  return { landing: next, report: { ...body, digest: sha(canonical(body)) } };
}
const total = async () => { let n = 0; for (const t of tables) n += Number((await db.query(`select count(*)::int n from pennsync_records."${t}"`)).rows[0].n); return n; };
const check = async (l, r) => verifyRun({ db, report: r, landing: l, tables });

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'pennsync-mover-rehearsal-'));
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

test('the whole rehearsal, in order', async () => {
  // 1. An empty target, a dry run, then the full run.
  assert.equal(await total(), 0);
  const dry = await applyLanding({ db, landing, waves, tables, report, dryRun: true });
  assert.equal(await total(), 0, 'a dry run writes nothing');
  assert.ok(dry.entries.every((e) => e.outcome === 'inserted'));

  // 2. A deliberate interruption: a bad row in a later wave stops the run there.
  const victim = landing.find((r) => r.entity === 'Visit');
  const broken = rebind(landing.map((r) => (r === victim ? { ...r, row: { ...r.row, visit_date: 'not a date' } } : r)));
  let interrupted;
  await assert.rejects(applyLanding({ db, landing: broken.landing, waves, tables, report: broken.report }), (e) => { interrupted = e; return e.code === 'wave_refused'; });
  const partial = await total();
  assert.ok(partial > 0 && partial < landing.length, 'earlier waves stayed, later ones did not start');

  // 3. The resume: the real plan, run again, picks up where it stopped.
  const full = await applyLanding({ db, landing, waves, tables, report });
  const counts = Object.values(full.counts).reduce((a, t) => ({ inserted: a.inserted + t.inserted, unchanged: a.unchanged + t.unchanged }), { inserted: 0, unchanged: 0 });
  assert.equal(counts.inserted + counts.unchanged, landing.length);
  assert.equal(counts.unchanged, partial, 'rows from before the interruption were left alone');
  assert.equal(await total(), landing.length);
  const v1 = await check(landing, report);
  assert.equal(v1.ok, true, JSON.stringify(v1));

  // 4. A second run must change nothing.
  const second = await applyLanding({ db, landing, waves, tables, report, previous: previousFrom(full) });
  assert.ok(second.entries.every((e) => e.outcome === 'unchanged'));
  assert.deepEqual(second.entries.map((e) => e.db_hash), full.entries.map((e) => e.db_hash));

  // 5. A delta run: one source row changes, one is added, and someone edits another on the new side.
  const patients = landing.filter((r) => r.entity === 'Patient');
  const [moved, edited] = patients;
  const added = { ...patients[2], id: 'rehearsal-added-patient', row: { ...patients[2].row, id: 'rehearsal-added-patient' } };
  const next = rebind([...landing.map((r) => (r === moved || r === edited ? { ...r, row: { ...r.row, last_name: 'Moved in source' } } : r)), added]);
  const delta = planDelta({ landing: next.landing, receipt: second });
  assert.deepEqual(delta.counts, { added: 1, changed: 2, unchanged: landing.length - 2, removed_from_source: 0 });
  await db.query('update pennsync_records.patient set last_name = $1 where id = $2', ['Edited on the new side', edited.id]);
  const catchUp = await applyLanding({ db, landing: next.landing, waves, tables, report: next.report, previous: previousFrom(second) });
  const outcome = (id) => catchUp.entries.find((e) => e.id === id).outcome;
  assert.equal(outcome(added.id), 'inserted'); assert.equal(outcome(moved.id), 'updated'); assert.equal(outcome(edited.id), 'conflict');
  // The verifier sees the one row we deliberately left to the new side, and nothing else.
  const v2 = await check(next.landing, next.report);
  assert.deepEqual(v2.content.mismatched.map((m) => [m.id, m.columns]), [[edited.id, ['last_name']]]);
  assert.deepEqual([v2.counts_ok, v2.links.ok, v2.quarantine.ok], [true, true, true], 'the one edited row is the only problem the verifier finds');
  assert.deepEqual(v2.quarantine.problems, []);

  // 6. Rollback of the catch-up run: only what it inserted goes; an updated row is reported.
  const back = await rollbackRun({ db, receipt: catchUp, tableWaves, tables });
  const by = (id) => back.entries.find((e) => e.id === id).outcome;
  assert.equal(by(added.id), 'deleted'); assert.equal(by(moved.id), 'not_restorable');
  assert.equal(await total(), landing.length);

  // 7. Rollback of the first run, in its two parts: the resume, then what the interruption had already committed.
  const undo = await rollbackRun({ db, receipt: full, tableWaves, tables });
  assert.equal(undo.entries.find((e) => e.id === edited.id).outcome, 'left_alone', 'the resume only found it, it did not write it');
  const early = { format: full.format, plan_digest: broken.report.digest, entries: interrupted.partial_entries };
  const undoEarly = await rollbackRun({ db, receipt: early, tableWaves, tables });
  assert.equal(undoEarly.entries.find((e) => e.id === edited.id).outcome, 'edited_since', 'the row someone edited since is kept');
  assert.equal(undoEarly.entries.find((e) => e.id === moved.id).outcome, 'edited_since', 'a row the catch-up updated no longer equals what the first run wrote');
  assert.equal(await total(), 2, 'only the two rows touched since remain');
});
