import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { planAll } from './tools-entity-schema-plan.mjs';
import { buildArchive } from './tools-pennsync-archive.mjs';
import { LIVE_APP, buildFixture } from './tools-pennsync-record-mover-fixtures.mjs';
import { loadTargetSpec, planFromArchive } from './tools-pennsync-record-mover-plan.mjs';
import { RULES, deriveRules, readRules, runStampCli, stampCollection, stampExportDirectory } from './tools-pennsync-record-mover-stamp.mjs';

const R = process.cwd();
const rules = readRules(R);
const spec = loadTargetSpec(R);
const T1 = '000000000000000000009001'; const T2 = '000000000000000000009002';
const A = 'agency-a'; const B = 'agency-b';
const base = (over) => ({ entity: 'Task', appId: LIVE_APP, agencies: [A, B], lookup: new Map(), ...over });
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-mover-stamp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const dirDigest = async (dir) => {
  const h = createHash('sha256');
  for (const n of (await readdir(dir)).sort()) h.update(n).update(await readFile(join(dir, n)));
  return h.digest('hex');
};

test('the committed rule file is exactly what the schema plan implies, and covers every table', () => {
  assert.deepEqual(rules, deriveRules(R));
  const { plans } = planAll(R);
  for (const p of plans) assert.ok(RULES.includes(rules.entities[p.entity]?.rule), `no rule for ${p.entity}`);
  assert.equal(Object.keys(rules.entities).length, plans.length);
  for (const r of Object.values(rules.entities)) if (r.rule === 'none' || r.rule === 'owner') assert.ok(r.reason.length > 20);
});

test('a self-editable agency label never decides: User is not declared', () => {
  assert.equal(rules.entities.User.rule, 'none');
});

test('parent: takes the parent\'s agency, holds a dangling or empty parent, falls back only when told to', () => {
  const lookup = new Map([[`${LIVE_APP}|Patient|p1`, A]]);
  const rule = { rule: 'parent', column: 'patient_id', parent: 'Patient' };
  const out = stampCollection(base({ rule, lookup, rows: [{ id: '1', patient_id: 'p1' }, { id: '2', patient_id: 'nope' }, { id: '3', patient_id: '' }] }));
  assert.deepEqual(out.stamped.map((r) => [r.id, r.agency_id]), [['1', A]]);
  assert.deepEqual(out.held.map((h) => [h.row.id, h.code]), [['2', 'parent_missing'], ['3', 'parent_empty']]);
  const fb = { ...rule, fallback: 'constant' };
  const one = stampCollection(base({ rule: fb, agencies: [A], lookup, rows: [{ id: '3', patient_id: '' }, { id: '2', patient_id: 'nope' }] }));
  assert.deepEqual(one.stamped.map((r) => r.agency_id), [A]);
  assert.deepEqual(one.held.map((h) => h.code), ['parent_missing'], 'a dangling parent is a defect even with a fallback');
  const two = stampCollection(base({ rule: fb, lookup, rows: [{ id: '3', patient_id: null }] }));
  assert.deepEqual(two.held.map((h) => h.code), ['constant_ambiguous']);
});

test('constant: valid for exactly one agency, refused for none or several', () => {
  const rule = { rule: 'constant' };
  assert.deepEqual(stampCollection(base({ rule, agencies: [A], rows: [{ id: '1' }] })).stamped.map((r) => r.agency_id), [A]);
  for (const agencies of [[], [A, B]]) {
    const out = stampCollection(base({ rule, agencies, rows: [{ id: '1' }, { id: '2' }] }));
    assert.equal(out.stamped.length, 0);
    assert.deepEqual(out.held.map((h) => h.code), ['constant_ambiguous', 'constant_ambiguous']);
  }
});

test('declared and conflicting values are checked, not trusted', () => {
  const declared = stampCollection(base({ entity: 'Patient', rule: { rule: 'declared' }, rows: [{ id: '1', agency_id: A }, { id: '2' }, { id: '3', agency_id: 'other' }] }));
  assert.deepEqual(declared.held.map((h) => [h.row.id, h.code]), [['2', 'agency_missing'], ['3', 'agency_unknown']]);
  const clash = stampCollection(base({ rule: { rule: 'constant' }, agencies: [A], rows: [{ id: '1', agency_id: B }] }));
  assert.deepEqual(clash.held.map((h) => h.code), ['agency_conflict'], 'a value that disagrees with the constant is held');
  const parent = { rule: 'parent', column: 'patient_id', parent: 'Patient' };
  const lookup = new Map([[`${LIVE_APP}|Patient|p1`, A]]);
  const conflict = stampCollection(base({ rule: parent, lookup, rows: [{ id: '1', patient_id: 'p1', agency_id: B }] }));
  assert.deepEqual(conflict.held.map((h) => h.code), ['agency_conflict'], 'a stamped value that disagrees with the parent is held');
});

test('a document takes its agency from the binding table, not from its patient', () => {
  const lookup = new Map(); const bindingKeys = new Map([['DocumentTenantBinding', 'document_id']]);
  stampCollection({ entity: 'DocumentTenantBinding', rule: { rule: 'declared' }, rows: [{ id: 'b1', document_id: 'd1', agency_id: B }], appId: LIVE_APP, agencies: [A, B], lookup, bindingKeys });
  const out = stampCollection({ entity: 'Document', rule: rules.entities.Document, rows: [{ id: 'd1', patient_id: 'p1' }, { id: 'd2' }], appId: LIVE_APP, agencies: [A, B], lookup, bindingKeys });
  assert.deepEqual(out.stamped.map((r) => [r.id, r.agency_id]), [['d1', B]]);
  assert.deepEqual(out.held.map((h) => [h.row.id, h.code]), [['d2', 'parent_missing']]);
});

test('no rule reads who created or touched a row', async () => {
  const text = (await readFile(join(R, 'tools-pennsync-record-mover-stamp.mjs'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(text, /created_by|updated_by|\.email|owner_email|user_email/);
});

test('end to end: stamp a CSV and JSON export, seal it, and the planner lands the rows in the right agency', async (t) => {
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in') });
  const plan = JSON.parse(await readFile(join(f.dir, 'plan.json'), 'utf8'));
  // Make Task as Base44 would export it: CSV, no agency, one row with no parent.
  const patientId = (await readFile(join(f.dir, '0-Patient.jsonl'), 'utf8')).split('\n').map((l) => l && JSON.parse(l)).filter(Boolean)[2].id;
  await writeFile(join(f.dir, '0-Task.csv'), `id,patient_id,title,priority,status\r\n${T1},${patientId},Fixture call,medium,pending\r\n${T2},,Fixture orphan,low,pending\r\n`);
  const c = plan.collections.find((x) => x.entity === 'Task' && x.source_app_id === LIVE_APP);
  Object.assign(c, { path: '0-Task.csv', rows: 2, fields: ['id', 'patient_id', 'title', 'priority', 'status'] });
  await writeFile(join(f.dir, 'plan.json'), JSON.stringify(plan));
  const before = await dirDigest(f.dir);
  const result = await stampExportDirectory({ inputDir: f.dir, outputDir: join(root, 'out'), rules, spec });
  assert.equal(await dirDigest(f.dir), before, 'the input is untouched');
  const task = result.report.find((r) => r.entity === 'Task' && r.source_app_id === LIVE_APP);
  assert.deepEqual([task.stamped, task.held, task.held_codes], [1, 1, { constant_ambiguous: 1 }]);
  assert.match(await readFile(join(root, 'out', 'held', '0-Task.jsonl'), 'utf8'), /Fixture orphan/);
  await assert.rejects(stampExportDirectory({ inputDir: f.dir, outputDir: join(root, 'out'), rules, spec }), /EEXIST/);
  const key = randomBytes(32);
  await buildArchive({ inputDir: join(root, 'out'), archiveDir: join(root, 'sealed'), key });
  const { report, landing } = await planFromArchive({ archiveDir: join(root, 'sealed'), key, spec, keepRows: true });
  const row = landing.find((x) => x.entity === 'Task' && x.id === T1).row;
  const patient = landing.find((x) => x.entity === 'Patient' && x.id === patientId).row;
  assert.equal(row.agency_id, patient.agency_id, 'the task lands in its patient\'s mapped agency');
  assert.equal(report.quarantine.length, 0);
  assert.equal(landing.filter((x) => x.entity === 'Task').length, 1, 'the held row is not sealed or planned');
  assert.ok((await stat(join(root, 'out', 'plan.json'))).size > 0);
});

test('the cli names a fixed reason and nothing else', async (t) => {
  const root = await scratch(t);
  const err = [];
  assert.equal(await runStampCli({ env: {}, write: () => {}, error: (x) => err.push(x) }), 1);
  assert.equal(await runStampCli({ env: { PENNSYNC_STAMP_INPUT_DIR: join(root, 'missing'), PENNSYNC_STAMP_OUTPUT_DIR: join(root, 'o') }, write: () => {}, error: (x) => err.push(x) }), 1);
  assert.ok(err.every((x) => /^Agency stamping failed: [a-z ]+\.$/.test(x) && !x.includes(root)));
});
