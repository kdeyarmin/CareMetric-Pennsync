import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArchive, verifyArchive } from './tools-pennsync-archive.mjs';
import { LEGACY_APP, LIVE_APP, VARIANTS, buildFixture, patientsCsv } from './tools-pennsync-record-mover-fixtures.mjs';

async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-mover-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function digest(dir) {
  const h = createHash('sha256');
  for (const name of (await readdir(dir)).sort()) h.update(name).update(await readFile(join(dir, name)));
  return h.digest('hex');
}

test('the clean fixture seals and verifies through the real archive tool', async (t) => {
  const root = await scratch(t);
  const f = await buildFixture({ dir: join(root, 'in') });
  const key = randomBytes(32);
  const sealed = await buildArchive({ inputDir: f.dir, archiveDir: join(root, 'out'), key });
  assert.ok(sealed);
  await verifyArchive({ archiveDir: join(root, 'out'), key });
  assert.deepEqual(f.plan.source_apps, [LIVE_APP, LEGACY_APP]);
});

test('every variant either seals or is refused by the archive tool, as it declares', async (t) => {
  const root = await scratch(t);
  for (const [name, spec] of Object.entries(VARIANTS)) {
    const f = await buildFixture({ dir: join(root, name), variant: name });
    const build = buildArchive({ inputDir: f.dir, archiveDir: join(root, `${name}-out`), key: randomBytes(32) });
    if (spec.archiveRefuses) {
      await assert.rejects(build, (e) => { assert.equal(e.code, spec.archiveRefuses, `${name}: ${e.code}`); return true; });
    } else {
      await build;
    }
  }
});

test('a fixture is deterministic: two builds are byte-identical', async (t) => {
  const root = await scratch(t);
  await buildFixture({ dir: join(root, 'a') }); await buildFixture({ dir: join(root, 'b') });
  assert.equal(await digest(join(root, 'a')), await digest(join(root, 'b')));
});

test('nothing in a fixture looks real', async (t) => {
  const root = await scratch(t);
  await buildFixture({ dir: join(root, 'x') });
  for (const name of await readdir(join(root, 'x'))) {
    const text = await readFile(join(root, 'x', name), 'utf8');
    for (const email of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) assert.match(email, /\.invalid$/, `${name}: ${email}`);
    assert.doesNotMatch(text, /password|token|secret|session/i);
    for (const n of text.match(/"first_name":"[^"]*"/g) ?? []) assert.match(n, /Fixture/, n);
    for (const n of text.match(/"last_name":"[^"]*"/g) ?? []) assert.match(n, /"(Alpha|Beta|Gamma)\d"/, n);
  }
});

test('the csv export carries the id column unless asked not to', () => {
  assert.match(patientsCsv().split('\r\n')[0], /^id,/);
  assert.doesNotMatch(patientsCsv({ withId: false }).split('\r\n')[0], /(^|,)id(,|$)/);
  assert.ok(patientsCsv().includes('""code"":""Z00.0""'), 'nested values travel as quoted JSON text');
});

test('an unknown variant is refused', async (t) => {
  const root = await scratch(t);
  await assert.rejects(buildFixture({ dir: join(root, 'z'), variant: 'nope' }), /unknown variant/);
});
