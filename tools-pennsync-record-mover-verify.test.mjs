import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { buildFixture } from './tools-pennsync-record-mover-fixtures.mjs';
// The loader is imported ONLY to put rows in the store for the verifier to look at.
import { applyLanding } from './tools-pennsync-record-mover-load.mjs';
import { canonical, loadTargetSpec, planFromDirectory } from './tools-pennsync-record-mover-plan.mjs';
import { checkFiles, inferLinks, sameValue, verifyRun } from './tools-pennsync-record-mover-verify.mjs';

const require = createRequire(new URL('./services/authority-store/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const STORE = new URL('./services/authority-store/', import.meta.url);
const APP = '6a9881683dc68a0bd54f1ef7';
const spec = loadTargetSpec(process.cwd());
const tables = new Set([...spec.entities.values()].map((e) => e.table));
const sha = (v) => createHash('sha256').update(v).digest('hex');
let db; let root; let landing; let waves; let report; let identities;

/** Re-key the planned world into the store's fixture world, so the real policies can be asked about it. */
function inFixtureWorld(rows, rep) {
  const agencies = [...new Set(rows.map((r) => r.row.agency_id).filter(Boolean))].sort();
  const rename = new Map([[agencies[0], 'agency-a'], [agencies[1], 'agency-b']]);
  const fix = (v) => (rename.has(v) ? rename.get(v) : v);
  const next = rows.map((r) => {
    const row = { ...r.row, source_app_id: APP };
    if ('agency_id' in row) row.agency_id = fix(row.agency_id);
    const out = { ...r, source_app_id: APP, id: row.id, row };
    out.hash = sha(canonical({ table: out.table, row }));
    return out;
  });
  const { digest: _d, ...body } = rep;
  body.rows_digest = sha(next.map((r) => `${r.table}|${r.source_app_id}|${r.id}|${r.hash}`).sort().join('\n'));
  return { landing: next, report: { ...body, digest: sha(canonical(body)) } };
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'pennsync-mover-verify-'));
  const f = await buildFixture({ dir: join(root, 'in') });
  const planned = await planFromDirectory({ inputDir: f.dir, spec, keepRows: true });
  const world = inFixtureWorld(planned.landing, planned.report);
  landing = world.landing; report = world.report;
  waves = new Map(report.loads.map((x) => [x.entity, x.wave]));
  db = new PGlite();
  await db.exec(await readFile(new URL('tests/bootstrap.sql', STORE), 'utf8'));
  for (const dir of ['supabase/migrations/', 'supabase/record-migrations/']) {
    for (const name of (await readdir(new URL(dir, STORE))).filter((n) => n.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(dir + name, STORE), 'utf8'));
    }
  }
  await db.exec(await readFile(new URL('tests/fixtures.sql', STORE), 'utf8'));
  await db.exec(`grant usage on schema pennsync_records to authenticated;
    grant select on all tables in schema pennsync_records to authenticated;
    grant execute on all functions in schema pennsync_records to authenticated;`);
  const claims = (n) => ({ sub: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, session_id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  identities = [{ label: 'admin-a', agency_id: 'agency-a', claims: claims(1) }, { label: 'admin-b', agency_id: 'agency-b', claims: claims(4) }];
  await applyLanding({ db, landing, waves, tables, report });
});
after(async () => { await db?.close(); await rm(root, { recursive: true, force: true }); });

const verify = (over = {}) => verifyRun({ db, report, landing, tables, identities, ...over });
const sourceIds = () => {
  const m = new Map();
  for (const r of landing) { if (!m.has(r.entity)) m.set(r.entity, new Set()); m.get(r.entity).add(r.id); }
  for (const h of report.quarantine) { if (!m.has(h.entity)) m.set(h.entity, new Set()); m.get(h.entity).add(h.id); }
  return m;
};

test('a clean run passes all six checks', async () => {
  const bytes = Buffer.from('synthetic');
  const v = await verify({ sourceIds: sourceIds(), files: [{ name: 'a', bytes, sha256: sha(bytes), size: bytes.length }] });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.ok(Object.values(v.counts).every((c) => c.missing === 0));
  assert.ok(v.content.rows_compared === landing.length);
  assert.ok(v.links.items.length > 0 && v.links.items.every((l) => l.checked > 0));
  assert.ok(v.visibility.visibility.length > 0 && identities.every((i) => v.visibility.visibility.some((x) => x.identity === i.label && x.expected > 0)), 'every identity is checked against rows it should see');
});

test('counts: a missing row is reported by table', async () => {
  const row = landing.find((r) => r.entity === 'Task');
  await db.query('delete from pennsync_records.task where id = $1', [row.id]);
  try {
    const v = await verify();
    assert.equal(v.counts_ok, false); assert.equal(v.counts.task.missing, 1);
  } finally { await applyLanding({ db, landing, waves, tables, report }); }
});

test('content: an altered value is found, naming the column and never the value', async () => {
  const row = landing.find((r) => r.entity === 'Patient');
  await db.query('update pennsync_records.patient set last_name = $1 where id = $2', ['Sabotaged value', row.id]);
  try {
    const v = await verify();
    assert.equal(v.content.ok, false);
    assert.deepEqual(v.content.mismatched.map((m) => [m.table, m.id, m.columns]), [['patient', row.id, ['last_name']]]);
    assert.ok(!JSON.stringify(v).includes('Sabotaged value'));
  } finally { await db.query('update pennsync_records.patient set last_name = $1 where id = $2', [row.row.last_name, row.id]); }
});

test('links: a dangling reference and a cross-agency one are both counted', async () => {
  const visit = landing.find((r) => r.entity === 'Visit');
  await db.query("update pennsync_records.visit set patient_id = 'nobody' where id = $1", [visit.id]);
  let v = await verify(); assert.equal(v.links.ok, false);
  assert.equal(v.links.items.find((l) => l.table === 'visit' && l.column === 'patient_id').dangling, 1);
  await db.query('update pennsync_records.visit set patient_id = $1 where id = $2', [visit.row.patient_id, visit.id]);
  const other = landing.find((r) => r.entity === 'Patient' && r.row.agency_id !== visit.row.agency_id);
  await db.query('update pennsync_records.visit set patient_id = $1 where id = $2', [other.id, visit.id]);
  try {
    v = await verify();
    assert.equal(v.links.items.find((l) => l.table === 'visit' && l.column === 'patient_id').cross_agency, 1);
  } finally { await db.query('update pennsync_records.visit set patient_id = $1 where id = $2', [visit.row.patient_id, visit.id]); }
  assert.equal((await verify()).links.ok, true);
});

test('visibility: an agency that can see another agency\'s rows fails, through the real policies', async () => {
  const agencyB = landing.find((r) => r.entity === 'Patient' && r.row.agency_id === 'agency-b'); assert.ok(agencyB, JSON.stringify(landing.filter((r) => r.entity === 'Patient').map((r) => r.row.agency_id)));
  await db.query("update pennsync_records.patient set agency_id = 'agency-a' where id = $1", [agencyB.id]);
  try {
    const v = await verify();
    assert.equal(v.visibility.ok, false);
    const bad = v.visibility.visibility.filter((x) => x.leaked || x.missing);
    assert.ok(bad.length >= 1 && bad.every((x) => x.table === 'patient' || x.table === 'visit'));
  } finally { await db.query("update pennsync_records.patient set agency_id = 'agency-b' where id = $1", [agencyB.id]); }
  assert.equal((await verify()).visibility.ok, true);
});

test('quarantine: a row in neither state, or in both, fails', async () => {
  const missingFromSource = sourceIds(); missingFromSource.get('Visit').add('ffffffffffffffffffffffff');
  let v = await verify({ sourceIds: missingFromSource });
  assert.ok(v.quarantine.problems.some((p) => p.code === 'source_row_unaccounted'));
  const twice = { ...report, quarantine: [...report.quarantine, { source_app_id: APP, entity: 'Task', id: landing.find((r) => r.entity === 'Task').id, code: 'x' }] };
  v = await verify({ report: twice });
  assert.ok(v.quarantine.problems.some((p) => p.code === 'both_loaded_and_quarantined'));
  assert.ok(v.quarantine.problems.some((p) => p.code === 'quarantined_row_in_store'));
});

test('files: a changed byte fails', () => {
  const bytes = Buffer.from('abc');
  assert.equal(checkFiles({ files: [{ name: 'f', bytes, sha256: sha(bytes), size: 3 }] }).files.ok, true);
  const bad = checkFiles({ files: [{ name: 'f', bytes: Buffer.from('abd'), sha256: sha(bytes), size: 3 }] });
  assert.deepEqual(bad.files.problems, [{ file: 'f', code: 'file_digest_differs' }]);
});

test('the verifier shares no code with the loader, and reports no value', async () => {
  const text = await readFile(new URL('./tools-pennsync-record-mover-verify.mjs', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/tools-pennsync-record-mover-load/.test(text) && !/from '\.\/tools-pennsync-record-mover-plan/.test(text));
  assert.equal(sameValue('2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05+00:00'), true);
  assert.equal(sameValue('a', 'b'), false);
  assert.ok(inferLinks(landing).some((l) => l.table === 'visit' && l.target === 'patient'));
});
