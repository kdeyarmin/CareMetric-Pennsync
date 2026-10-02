import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArchive } from './tools-pennsync-archive.mjs';
import { LEGACY_APP, LIVE_APP, VARIANTS, buildFixture, patientsCsv } from './tools-pennsync-record-mover-fixtures.mjs';
import { PlanError, loadTargetSpec, parseCsv, planFromArchive, planFromDirectory, runPlanCli } from './tools-pennsync-record-mover-plan.mjs';

const spec = loadTargetSpec(process.cwd());
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-mover-plan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function listing(dir) {
  const h = createHash('sha256');
  for (const name of (await readdir(dir)).sort()) h.update(name).update(await readFile(join(dir, name)));
  return h.digest('hex');
}
const enrolledOf = async (dir) => new Set(JSON.parse(await readFile(join(dir, 'enrolled.json'), 'utf8')));

test('the clean fixture plans with nothing set aside and the legacy app only sealed', async (t) => {
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in') });
  const { report } = await planFromDirectory({ inputDir: f.dir, spec, enrolled: await enrolledOf(f.dir) });
  assert.equal(report.totals.to_load, 12);
  assert.equal(report.totals.quarantined, 0);
  assert.deepEqual(report.findings, []);
  assert.ok(report.sealed_only.length > 0);
  assert.ok(report.sealed_only.every((s) => s.source_app_id === LEGACY_APP && s.reason === 'legacy_source_sealed'));
  assert.ok(report.loads.every((l) => l.source_app_id === LIVE_APP));
  const order = Object.fromEntries(report.loads.map((l) => [l.entity, l.wave]));
  assert.ok(order.Agency < order.User && order.User < order.Patient && order.Patient < order.Visit, JSON.stringify(order));
});

test('each planted defect produces exactly the stated finding', async (t) => {
  const root = await scratch(t);
  for (const [name, v] of Object.entries(VARIANTS)) {
    if (v.archiveRefuses || name === 'clean') continue;
    const f = await buildFixture({ dir: join(root, name), variant: name });
    const { report } = await planFromDirectory({ inputDir: f.dir, spec, enrolled: await enrolledOf(f.dir) });
    const want = f.expected;
    const gotQ = report.quarantine.map((q) => ({ app: q.source_app_id, entity: q.entity, id: q.id, code: q.code, column: q.column }));
    assert.deepEqual(gotQ, want.quarantine ?? [], `${name}: quarantine`);
    const gotF = report.findings.map((x) => ({ app: x.source_app_id, entity: x.entity, code: x.code, ...(x.field ? { field: x.field } : {}), ...(x.code.startsWith('author') ? { count: x.count } : {}) }));
    const wantF = (want.findings ?? []).map((x) => ({ ...x }));
    assert.deepEqual(gotF.filter((x) => x.app === LIVE_APP), wantF.sort((a, b) => (a.entity < b.entity ? -1 : 1)), `${name}: findings`);
  }
});

test('a quarantined row names its column and never its value', async (t) => {
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in'), variant: 'bad_enum' });
  const { report } = await planFromDirectory({ inputDir: f.dir, spec });
  const text = JSON.stringify(report);
  assert.ok(!text.includes('DONE'));
  assert.ok(!text.includes('Fixture') && !text.includes('fixture.invalid'));
});

test('csv needs the id column, and typed cells come back as the target types', async (t) => {
  assert.throws(() => parseCsv(patientsCsv({ withId: false })), (e) => e instanceof PlanError && e.code === 'id_column_missing');
  assert.throws(() => parseCsv('id,id\r\n1,2\r\n'), /csv_header_invalid/);
  assert.throws(() => parseCsv('id,a\r\n1\r\n'), /csv_ragged_row/);
  assert.throws(() => parseCsv('id,a\r\n1,"open\r\n'), /csv_invalid/);
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in') });
  const plan = JSON.parse(await readFile(join(f.dir, 'plan.json'), 'utf8'));
  const c = plan.collections.find((x) => x.entity === 'Patient' && x.source_app_id === LIVE_APP);
  const csvText = patientsCsv();
  await writeFile(join(f.dir, '0-Patient.csv'), csvText);
  c.path = '0-Patient.csv'; c.fields = ['id', 'agency_id', 'first_name', 'last_name', 'status', 'secondary_diagnoses'];
  await writeFile(join(f.dir, 'plan.json'), JSON.stringify(plan));
  const csv = await planFromDirectory({ inputDir: f.dir, spec, keepRows: true });
  const pick = (r) => r.landing.filter((x) => x.entity === 'Patient').map((x) => x.row.secondary_diagnoses);
  assert.deepEqual(pick(csv).find((x) => x?.length), [{ code: 'Z00.0', note: 'invented' }]);
  // A collection file with no id column is refused outright.
  await writeFile(join(f.dir, '0-Patient.csv'), patientsCsv({ withId: false }));
  await assert.rejects(planFromDirectory({ inputDir: f.dir, spec }), (e) => e.code === 'id_column_missing');
});

test('the sealed archive and the unsealed directory give the same plan', async (t) => {
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in') });
  const key = randomBytes(32);
  await buildArchive({ inputDir: f.dir, archiveDir: join(root, 'out'), key });
  const a = await planFromDirectory({ inputDir: f.dir, spec });
  const b = await planFromArchive({ archiveDir: join(root, 'out'), key: Buffer.from(key), spec });
  assert.equal(a.report.digest, b.report.digest);
  assert.equal(a.report.rows_digest, b.report.rows_digest);
});

test('planning writes nothing and is repeatable', async (t) => {
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in') });
  const before = await listing(f.dir); const rootBefore = (await readdir(root)).sort();
  const one = await planFromDirectory({ inputDir: f.dir, spec });
  const two = await planFromDirectory({ inputDir: f.dir, spec });
  assert.equal(one.report.digest, two.report.digest);
  assert.equal(await listing(f.dir), before);
  assert.deepEqual((await readdir(root)).sort(), rootBefore);
});

test('a changed value changes the rows digest', async (t) => {
  const root = await scratch(t);
  const a = await buildFixture({ dir: join(root, 'a') });
  const b = await buildFixture({ dir: join(root, 'b') });
  const file = join(b.dir, '0-Patient.jsonl');
  await writeFile(file, (await readFile(file, 'utf8')).replace('Alpha0', 'Alpha9'));
  assert.notEqual((await planFromDirectory({ inputDir: a.dir, spec })).report.rows_digest, (await planFromDirectory({ inputDir: b.dir, spec })).report.rows_digest);
});

test('the archive key never reaches an output, an error, or a file', async (t) => {
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in') });
  const canary = randomBytes(32);
  await buildArchive({ inputDir: f.dir, archiveDir: join(root, 'out'), key: Buffer.from(canary) });
  const forms = [canary.toString('base64'), canary.toString('hex'), canary.toString('latin1')];
  const rootBefore = await listing(join(root, 'out'));
  for (const wrong of [false, true]) {
    const material = wrong ? randomBytes(32) : canary;
    const out = []; const err = [];
    const env = { PENNSYNC_ARCHIVE_DIR: join(root, 'out'), PENNSYNC_ARCHIVE_KEY_BASE64: material.toString('base64') };
    const code = await runPlanCli({ env, write: (x) => out.push(x), error: (x) => err.push(x) });
    assert.equal(code, wrong ? 1 : 0);
    assert.equal(env.PENNSYNC_ARCHIVE_KEY_BASE64, undefined, 'key variable is removed');
    const everything = [...out, ...err].join('\n');
    for (const form of [...forms, material.toString('base64')]) assert.ok(!everything.includes(form));
  }
  assert.equal(await listing(join(root, 'out')), rootBefore);
});

test('a key is refused alongside an unsealed rehearsal directory', async (t) => {
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in') });
  const err = [];
  const code = await runPlanCli({ env: { PENNSYNC_PLAN_INPUT_DIR: f.dir, PENNSYNC_ARCHIVE_KEY_BASE64: randomBytes(32).toString('base64') }, write: () => {}, error: (x) => err.push(x) });
  assert.equal(code, 1);
});

test('expected platform fields are reported apart from real unknowns', async (t) => {
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in') });
  const { report } = await planFromDirectory({ inputDir: f.dir, spec });
  assert.deepEqual(report.held_elsewhere, [{ source_app_id: LIVE_APP, entity: 'User', field: 'email', count: 3 }]);
  assert.deepEqual(report.findings, []);
});
