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
import { referenceTarget } from './tools-pennsync-record-mover-references.mjs';
import { checkFiles, checkVisibility, inferLinks, sameValue, verifyRun } from './tools-pennsync-record-mover-verify.mjs';

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

const verify = (over = {}) => verifyRun({ db, report, landing, tables, identities, acknowledgeUnclassified: ['user', 'agency'], skip: ['files', 'source'], ...over });
const sourceIds = () => {
  const m = new Map();
  for (const r of landing) { if (!m.has(r.entity)) m.set(r.entity, new Set()); m.get(r.entity).add(`${r.source_app_id}|${r.id}`); }
  for (const h of report.quarantine) { if (!m.has(h.entity)) m.set(h.entity, new Set()); m.get(h.entity).add(`${h.source_app_id}|${h.id}`); }
  return m;
};

test('a clean run passes all six checks', async () => {
  const bytes = Buffer.from('synthetic');
  const v = await verify({ sourceIds: sourceIds(), skip: [], files: [{ name: 'a', bytes, sha256: sha(bytes), size: bytes.length }] });
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
  const missingFromSource = sourceIds(); missingFromSource.get('Visit').add(`${APP}|ffffffffffffffffffffffff`);
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
  const bad = checkFiles({ files: [{ name: 'Jane Doe intake.pdf', bytes: Buffer.from('abd'), sha256: sha(bytes), size: 3 }] });
  assert.deepEqual(bad.files.problems.map((p) => [p.file_index, p.code]), [[0, 'file_digest_differs']]);
  assert.ok(!JSON.stringify(bad).includes('Jane'), 'the file name is never echoed');
});

test('the verifier shares no code with the loader, and reports no value', async () => {
  const text = await readFile(new URL('./tools-pennsync-record-mover-verify.mjs', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/tools-pennsync-record-mover-load/.test(text) && !/from '\.\/tools-pennsync-record-mover-plan/.test(text));
  assert.equal(sameValue('2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05+00:00'), true);
  assert.equal(sameValue('a', 'b'), false);
  assert.ok(inferLinks(landing).some((l) => l.table === 'visit' && l.target === 'patient'));
});

test('plan binding: a changed row, a stale digest or a swapped report is found by recomputing them here', async () => {
  assert.equal((await verify()).plan.ok, true);
  const p = landing.find((r) => r.entity === 'Patient');
  const altered = landing.map((r) => (r === p ? { ...r, row: { ...r.row, last_name: 'Other' } } : r));
  let v = await verify({ landing: altered });
  assert.ok(v.plan.problems.some((x) => x.code === 'row_hash_differs' && x.id === p.id));
  const dropped = await verify({ landing: landing.slice(1) });
  assert.ok(dropped.plan.problems.some((x) => x.code === 'rows_digest_differs'));
  v = await verify({ report: { ...report, totals: { ...report.totals, to_load: 99 } } });
  assert.ok(v.plan.problems.some((x) => x.code === 'report_digest_differs'));
  assert.equal(v.ok, false);
});

test('a check that did not run is not a pass: ok stays false, and a waiver is recorded', async () => {
  const bare = await verifyRun({ db, report, landing, tables });
  assert.equal(bare.ok, false);
  assert.deepEqual(bare.incomplete.sort(), ['files', 'source', 'visibility'].sort());
  const waived = await verify();
  assert.equal(waived.ok, true);
  assert.deepEqual(waived.skipped_on_purpose, ['files', 'source']);
  const unack = await verify({ acknowledgeUnclassified: [] });
  assert.equal(unack.ok, false);
  assert.deepEqual(unack.visibility.unclassified_tables, ['agency', 'user']);
  assert.deepEqual(unack.incomplete, ['visibility_unclassified_tables']);
});

test('quarantine: the same id from another source app is not mistaken for a quarantined row', async () => {
  const task = landing.find((r) => r.entity === 'Task');
  const other = { source_app_id: 'another-source-app', entity: 'Task', id: task.id, code: 'x' };
  const rep = { ...report, quarantine: [...report.quarantine, other], loads: report.loads.map((l) => (l.entity === 'Task' ? { ...l, quarantined: l.quarantined + 1, rows: l.rows + 1 } : l)) };
  const v = await verify({ report: rep });
  assert.ok(!v.quarantine.problems.some((x) => x.code === 'quarantined_row_in_store' || x.code === 'both_loaded_and_quarantined'), JSON.stringify(v.quarantine.problems));
});

test('links: a prefixed reference column finds its target, and the result says the links were inferred', () => {
  const rows = [{ table: 'patient', row: { id: 'p' } }, { table: 'shared_document', row: { id: 'd', related_patient_id: 'p' } }, { table: 'note', row: { id: 'n', target_patient_id: 'p' } }];
  assert.deepEqual(inferLinks(rows).map((l) => `${l.table}.${l.column}>${l.target}`), ['note.target_patient_id>patient', 'shared_document.related_patient_id>patient']);
});

test('links: the verifier and the rollback take one reference rule, from a module that imports nothing', async () => {
  const source = (name) => readFile(new URL(`./tools-pennsync-record-mover-${name}.mjs`, import.meta.url), 'utf8');
  const shared = await source('references');
  assert.ok(!/^import\b/m.test(shared), 'the shared rule must not bring the planner or the loader into the verifier');
  for (const name of ['verify', 'rollback']) {
    const text = await source(name);
    assert.match(text, /import \{ referenceTarget \} from '\.\/tools-pennsync-record-mover-references\.mjs';/, name);
    assert.ok(!/_PREFIXES\s*=/.test(text), `${name} keeps no prefix list of its own`);
  }
  const known = new Set(['agency', 'patient', 'task', 'parent_task']);
  assert.equal(referenceTarget('patient_id', known), 'patient');
  assert.equal(referenceTarget('related_patient_id', known), 'patient');
  assert.equal(referenceTarget('parent_task_id', known), 'parent_task', 'the most specific name that is a table wins');
  assert.equal(referenceTarget('agency_id', known), null, 'the tenant column holds the owned agency id, not a carried agency row id');
  assert.equal(referenceTarget('vehicle_id', new Set(['fleet_vehicle'])), null, 'a name that does not name its table is not recognised');
});

test('visibility: a table with no agency column is judged through the row it links to, or listed as unclassified', async () => {
  const v = await verify();
  assert.deepEqual(v.visibility.unclassified_tables, ['agency', 'user'], 'the tenants themselves and the roster table have no agency to judge them by');
  assert.ok(v.visibility.visibility.some((x) => x.table === 'visit' && x.expected > 0));
});

test('visibility: a planned table whose rows carry no agency is judged through the row it links to', async () => {
  const stripped = landing.map((r) => {
    if (r.entity !== 'Visit') return r;
    const { agency_id: _a, ...row } = r.row;
    return { ...r, row };
  });
  const { visibility } = await checkVisibility({ db, landing: stripped, identities, tables: [...tables] });
  const visits = visibility.visibility.filter((x) => x.table === 'visit');
  assert.ok(visits.every((x) => x.missing === 0 && x.leaked === 0) && visits.some((x) => x.expected > 0));
  assert.ok(!visibility.unclassified_tables.includes('visit'));
});

test('sameValue compares types and never coerces a number', () => {
  // Each of these was reported equal before (Number("") is 0, Number([]) is 0,
  // Number("0x10") is 16), which let a wrong stored value pass as content-equal.
  for (const [planned, stored] of [
    [0, ''], [0, ' '], [0, []], [16, '0x10'], [5, '5'], ['5', 5], [1, true], [0, false],
    [{ count: 1 }, { count: '1' }], [[1, 2], ['1', '2']],
  ]) {
    assert.equal(sameValue(planned, stored), false, `${JSON.stringify(planned)} vs ${JSON.stringify(stored)}`);
  }
  // What the store legitimately hands back for what was planned still matches.
  for (const [planned, stored] of [
    [5, 5], [1.25, 1.25], [0, 0], ['text', 'text'], [true, true], [null, null], [null, undefined],
    ['2026-01-07T09:30:00.000Z', '2026-01-07T09:30:00+00:00'],
    [{ count: 1, tags: ['a'] }, { tags: ['a'], count: 1 }], [[{ code: 'Z00.0' }], [{ code: 'Z00.0' }]],
  ]) {
    assert.equal(sameValue(planned, stored), true, `${JSON.stringify(planned)} vs ${JSON.stringify(stored)}`);
  }
});
