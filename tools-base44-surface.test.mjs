import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_FILE, FORMAT, FORMAT_VERSION, METRICS,
  compareSurface, entityCalls, handleKey, main, measureSurface, parseBaseline, sourceFiles,
  takenHandles, unaccountedHandles,
} from './tools-base44-surface.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const baseline = (patch = {}) => ({
  format: FORMAT, version: FORMAT_VERSION,
  maximum: Object.fromEntries(METRICS.map(metric => [metric, 10])), ...patch,
});
const measured = (patch = {}) => ({
  counts: { ...Object.fromEntries(METRICS.map(metric => [metric, 10])), ...patch }, entity_types: [],
});

test('the frontend stays within its committed Base44 coupling baseline', () => {
  const report = compareSurface(measureSurface(repository), parseBaseline(readFileSync(resolve(repository, BASELINE_FILE), 'utf8')));
  assert.deepEqual(report.regressions, [], 'Base44 coupling grew. Migrate the new consumer or justify the change.');
  assert.equal(report.within_baseline, true);
});

test('the measurement reflects the real repository and is not yet zero', () => {
  const { counts, entity_types: entityTypes } = measureSurface(repository);
  assert.ok(counts.entity_call_sites > 0);
  assert.ok(counts.client_importers > 0);
  assert.equal(counts.entity_types, entityTypes.length);
  assert.ok(entityTypes.length > 40);
  // Every directly accessed type is a real schema, so a typo or a match on
  // unrelated code cannot inflate the count.
  const schemas = new Set(readdirSync(resolve(repository, 'base44/entities'))
    .filter(name => /\.jsonc?$/.test(name)).map(name => name.replace(/\.jsonc?$/, '')));
  assert.deepEqual(entityTypes.filter(name => !schemas.has(name)), []);
  // Patient is already broker-only in production source; direct access to it
  // would be a migration regression.
  assert.equal(entityTypes.includes('Patient'), false);
  // An honest report: the exit is not finished.
  assert.equal(compareSurface(measureSurface(repository), baseline({
    maximum: Object.fromEntries(METRICS.map(metric => [metric, 100000])),
  })).base44_free, false);
});

test('a count above its baseline is a regression and a count below it is an improvement', () => {
  const grown = compareSurface(measured({ entity_call_sites: 11 }), baseline());
  assert.deepEqual(grown.regressions, [{ metric: 'entity_call_sites', actual: 11, allowed: 10 }]);
  assert.equal(grown.within_baseline, false);
  const shrunk = compareSurface(measured({ entity_call_sites: 4 }), baseline());
  assert.deepEqual(shrunk.regressions, []);
  assert.deepEqual(shrunk.improvements, [{ metric: 'entity_call_sites', actual: 4, allowed: 10 }]);
  assert.equal(shrunk.within_baseline, true);
});

test('base44_free is claimed only when every measured count is zero', () => {
  assert.equal(compareSurface(measured(), baseline()).base44_free, false);
  const empty = { counts: Object.fromEntries(METRICS.map(metric => [metric, 0])), entity_types: [] };
  assert.equal(compareSurface(empty, baseline()).base44_free, true);
});

for (const [name, raw] of Object.entries({
  malformed: '{',
  array: '[]',
  wrongFormat: JSON.stringify(baseline({ format: 'other' })),
  wrongVersion: JSON.stringify(baseline({ version: 2 })),
  missingMetric: JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, maximum: { client_importers: 1 } }),
  negativeMetric: JSON.stringify(baseline({ maximum: { ...baseline().maximum, entity_types: -1 } })),
  fractionalMetric: JSON.stringify(baseline({ maximum: { ...baseline().maximum, entity_types: 1.5 } })),
  extraMetric: JSON.stringify(baseline({ maximum: { ...baseline().maximum, invented: 1 } })),
})) {
  test(`baseline rejects ${name}`, () => assert.throws(() => parseBaseline(raw)));
}

test('updating the baseline is explicit and writes only the measured counts', () => {
  let written = null;
  const code = main(['--update'], { repository, log: () => {}, write: (path, body) => { written = { path, body }; } });
  assert.equal(code, 0);
  assert.ok(written.path.endsWith(BASELINE_FILE));
  const parsed = parseBaseline(written.body);
  assert.deepEqual(parsed.maximum, measureSurface(repository).counts);
  // Without this the one command a reader reaches for to lower the baseline
  // would silently delete the record of every handle the tool cannot follow.
  assert.deepEqual(parsed.allowed_handles, unaccountedHandles(repository).map(handleKey).sort());
});

test('the command line refuses unknown arguments and an unavailable baseline', () => {
  const lines = [];
  assert.equal(main(['--fix'], { repository, log: value => lines.push(value) }), 2);
  assert.equal(JSON.parse(lines[0]).error, 'INVALID_ARGUMENTS');
  lines.length = 0;
  assert.equal(main([], { repository: resolve(repository, 'src'), log: value => lines.push(value) }), 2);
  assert.ok(JSON.parse(lines[0]).error);
});

/**
 * The matcher's three binding forms, each driven with the alias PRESENT and
 * ABSENT. Only the pair proves anything: a case that reports sites with the
 * binding removed would be matching on the call shape alone, which is what a
 * first version of this would have done, and a case that reports none with the
 * binding present is the blind spot this closed.
 */
test('an entity call through a binding is counted, and only where the binding is', () => {
  const calls = text => [...entityCalls(text)].map(site =>
    `${site.entity}.${text.slice(site.end).match(/^\s*([a-zA-Z][A-Za-z0-9_]*)/)[1]}`).sort();

  const map = 'const Q = { Incident: base44.entities.Incident };\n';
  assert.deepEqual(calls(`${map}await q.Incident.filter(x);`), ['Incident.filter']);
  assert.deepEqual(calls('await q.Incident.filter(x);'), [],
    'without the binding in the same file there is nothing to read the alias from');

  const destructured = 'const { Task } = base44.entities;\n';
  assert.deepEqual(calls(`${destructured}await Task.create(x);`), ['Task.create']);
  assert.deepEqual(calls('await Task.create(x);'), []);

  const namespace = 'const ns = base44.entities;\n';
  assert.deepEqual(calls(`${namespace}await ns.Patient.list();`), ['Patient.list']);
  assert.deepEqual(calls('await ns.Patient.list();'), []);

  // One call, not two. Both passes match these characters; what makes it one
  // is that `entityCalls` keys on the OPERATION'S OFFSET, not that either pass
  // declines. Double counting would raise the ratchet and the census together
  // in a way that reads as two instruments agreeing.
  assert.deepEqual(calls(`${map}await base44.entities.Incident.filter(x);`), ['Incident.filter']);

  // A deeper chain is not the binding, and this is what the lookbehind is for
  // -- driven here because removing it left every other case in this file
  // green, so without this line the guard would be untested.
  assert.deepEqual(calls(`${map}await a.b.Incident.filter(x);`), []);

  // A typeof guard through optional chaining is not a call, which is what keeps
  // `retiredOfflineQueue.js` at eight rather than ten.
  assert.deepEqual(calls(`${map}if (typeof q?.Incident?.filter !== 'function') return;`), []);
});

test('the module that defeated the old matcher is measured, and it is one module', () => {
  const text = readFileSync(resolve(repository, 'src/lib/retiredOfflineQueue.js'), 'utf8');
  const sites = [...entityCalls(text)];
  assert.equal(sites.length, 8, 'the eight aliased call sites in the offline queue');
  assert.deepEqual([...new Set(sites.map(site => site.entity))].sort(),
    ['ComplianceAudit', 'Incident', 'NoteConversion', 'Task']);
  // The BOUND, asserted rather than remembered: a second module binding the
  // namespace this way is a finding for whoever adds it, not a silent change
  // of population. Measured across the same files the ratchet walks.
  const bound = [];
  for (const file of sourceFiles(resolve(repository, 'src'))) {
    const body = readFileSync(file, 'utf8');
    const literal = [...body.matchAll(/\bbase44\s*\.\s*entities\s*\.\s*([A-Z][A-Za-z0-9_]*)\s*\./g)].length;
    if ([...entityCalls(body)].length > literal) bound.push(relative(repository, file));
  }
  assert.deepEqual(bound, ['src/lib/retiredOfflineQueue.js']);
});

test('a handle TAKEN without an immediate call is seen, and a called one is not', () => {
  const taken = text => takenHandles(text).map(hit => `${hit.entity}:${hit.line}`);
  // The control that bites, and the reason this exists: the shipped matcher is
  // BLIND to this file and says so when asked, rather than being read as blind.
  const probe = 'const handle = base44.entities.Visit;\nexport const go = () => handle.create({});\n';
  assert.deepEqual(taken(probe), ['Visit:1']);
  assert.deepEqual([...entityCalls(probe)], []);

  // Called immediately, through whitespace and a newline, is NOT a taken handle:
  // the existing matcher already counts those and counting them here would
  // report every call site in the repository as a finding.
  assert.deepEqual(taken('base44.entities.Visit.filter({});'), []);
  assert.deepEqual(taken('base44.entities.Visit\n  .filter({});'), []);
  assert.deepEqual(taken('base44.entities . Visit . filter({});'), []);

  // A handle taken as a property value, which is the shape that passes it on.
  assert.deepEqual(taken('useThing({ entity: base44.entities.Task, toItem });'), ['Task:1']);
});

test('a comment ABOUT the SDK is not a call site, and line numbers survive the blanking', () => {
  const taken = text => takenHandles(text).map(hit => `${hit.entity}:${hit.line}`);
  assert.deepEqual(taken('// a caller may hold `base44.entities.Patient` or one of its methods\n'), []);
  assert.deepEqual(taken('/*\n * base44.entities.Patient\n */\n'), []);
  // The blanking preserves OFFSETS, so a finding after a multi-line comment
  // still reports its own line. A strip that deleted the text would say 2.
  assert.deepEqual(taken('/* one\n   two\n   three */\nconst h = base44.entities.Task;\n'), ['Task:4']);
  // The stated limit, driven rather than left to the reader: a TRAILING `//`
  // comment is not blanked, so a handle named in one is reported. Whoever makes
  // this stricter should delete this case rather than discover it.
  assert.deepEqual(taken('const x = 1; // see base44.entities.Task\n'), ['Task:1']);

  // The real file that motivated it, asserted against the tree.
  assert.deepEqual(takenHandles(
    readFileSync(resolve(repository, 'src/lib/independentStagingAdapter.js'), 'utf8')), []);
});

const committed = () => parseBaseline(readFileSync(resolve(repository, BASELINE_FILE), 'utf8')).allowed_handles;

test('an unaccounted handle is named with its file and line, and an accounted one is not', () => {
  // Pinned against the COMMITTED allowance rather than a second copy of the
  // list. A hand repairing one of these sites deletes its entry -- which the
  // gate's STALE refusal tells them to do -- and this assertion moves with it,
  // instead of being a test that passes only while the defect exists.
  assert.deepEqual(unaccountedHandles(repository).map(handleKey).sort(), committed());
  assert.ok(committed().length > 0, 'this tree still has unaccounted handles');
  // `retiredOfflineQueue.js` takes four handles and is ABSENT from that list,
  // which is the half that keeps this from being a count of every alias: its
  // aliased path resolves, so the tool can still see the calls arriving.
  assert.equal(takenHandles(
    readFileSync(resolve(repository, 'src/lib/retiredOfflineQueue.js'), 'utf8')).length, 4);
  assert.equal(unaccountedHandles(repository)
    .some(hit => hit.file === 'src/lib/retiredOfflineQueue.js'), false);
  // And a literal read of the SAME entity does not account for a taken handle --
  // the case the training builders are. Scoped to the allowance still naming the
  // file, so repairing the builder retires this case with its entry; the shape
  // itself is pinned permanently over a fixture below, where no repair reaches it.
  if (committed().includes('src/components/training/CourseLessonBuilder.jsx::TrainingModule')) {
    const builder = readFileSync(resolve(repository, 'src/components/training/CourseLessonBuilder.jsx'), 'utf8');
    assert.equal([...entityCalls(builder)].length, 1, 'only the literal read is visible');
    assert.deepEqual([...entityCalls(builder)].map(site => site.entity), ['TrainingModule']);
  }
});

test('a literal call does not account for a handle of the same entity in the same file', () => {
  // The discrimination the whole refusal turns on, over a fixture so that it
  // survives every repair to the four sites this tree happens to hold.
  const root = mkdtempSync(join(tmpdir(), 'base44-surface-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'builder.jsx'),
      'const rows = base44.entities.TrainingModule.filter({ id });\n'
      + 'export const panel = () => useBuilder({ entity: base44.entities.TrainingModule, rows });\n');
    assert.deepEqual(unaccountedHandles(root),
      [{ file: 'src/builder.jsx', line: 2, entity: 'TrainingModule' }],
      'the literal filter is visible and the handed-on handle is still refused');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('this tree\'s unaccounted handles are the committed allowance, so the gate passes', () => {
  const lines = [];
  const code = main(['--summary'], { repository, log: line => lines.push(String(line)) });
  const unaccounted = unaccountedHandles(repository);
  assert.equal(unaccounted.length > 0, true, 'this tree still has unaccounted handles');
  assert.equal(code, 0, 'a handle the committed baseline records does not fail the gate');
  // Named anyway, every one of them: the allowance records an undercount, and a
  // reader of this output has to be able to see which counts are short.
  for (const hit of unaccounted) {
    assert.equal(lines.some(line => line.includes(`${hit.file}:${hit.line}`)), true,
      `${hit.file}:${hit.line} is not named in the summary`);
  }
  assert.equal(lines.some(line => line.startsWith('  REFUSED')), false);
  assert.equal(lines.some(line => line.includes('STALE ALLOWANCE')), false,
    'an allowance entry matching nothing should have been deleted with the fix that earned it');
  const json = [];
  main([], { repository, log: line => json.push(String(line)) });
  const report = JSON.parse(json.join('\n'));
  assert.deepEqual(report.unaccounted_handles, unaccounted);
  assert.deepEqual(report.refused_handles, []);
});

test('a handle the allowance does not name fails the gate, and naming it clears it', () => {
  // Over a fixture tree through the real walker, matcher and command line: the
  // question is what the GATE does, and a hand-built report cannot answer it.
  const root = mkdtempSync(join(tmpdir(), 'base44-surface-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'screen.jsx'),
      'const handle = base44.entities.Visit;\nexport const save = payload => handle.create(payload);\n');
    const file = { format: FORMAT, version: FORMAT_VERSION, maximum: Object.fromEntries(METRICS.map(m => [m, 50])) };
    writeFileSync(join(root, BASELINE_FILE), JSON.stringify({ ...file, allowed_handles: [] }));
    const refused = [];
    assert.equal(main(['--summary'], { repository: root, log: line => refused.push(String(line)) }), 1);
    assert.match(refused.join('\n'), /within baseline/, 'it fails on the handle, not on the ratchet');
    assert.equal(refused.some(line => line.startsWith('  REFUSED HANDLE src/screen.jsx:1')), true);

    writeFileSync(join(root, BASELINE_FILE), JSON.stringify({ ...file, allowed_handles: ['src/screen.jsx::Visit'] }));
    const allowed = [];
    assert.equal(main(['--summary'], { repository: root, log: line => allowed.push(String(line)) }), 0);
    assert.equal(allowed.some(line => line.startsWith('  allowed HANDLE src/screen.jsx:1')), true);

    // A stale entry FAILS: whoever repaired the handle has to delete its record,
    // and a passing note is a line nobody reads.
    writeFileSync(join(root, BASELINE_FILE), JSON.stringify({ ...file, allowed_handles: ['src/gone.js::Visit', 'src/screen.jsx::Visit'] }));
    const stale = [];
    assert.equal(main(['--summary'], { repository: root, log: line => stale.push(String(line)) }), 1);
    assert.equal(stale.some(line => line.includes('STALE ALLOWANCE src/gone.js::Visit')), true);
    assert.equal(stale.some(line => line.startsWith('  REFUSED')), false, 'and not as a refusal');

    // A SECOND handle of an already-declared entity in an already-declared file
    // is refused, because one entry declares one occurrence. Found by review:
    // keying without counting admitted the new site beside its neighbour.
    writeFileSync(join(root, 'src', 'screen.jsx'),
      'const handle = base44.entities.Visit;\nexport const save = payload => handle.create(payload);\n'
      + 'export const second = base44.entities.Visit;\n');
    writeFileSync(join(root, BASELINE_FILE), JSON.stringify({ ...file, allowed_handles: ['src/screen.jsx::Visit'] }));
    const second = [];
    assert.equal(main(['--summary'], { repository: root, log: line => second.push(String(line)) }), 1);
    assert.equal(second.some(line => line.startsWith('  REFUSED HANDLE src/screen.jsx:3')), true);
    assert.equal(second.some(line => line.startsWith('  allowed HANDLE src/screen.jsx:1')), true,
      'the declared occurrence is still the first one, not whichever the surplus is');
    // And declaring it twice admits both.
    writeFileSync(join(root, BASELINE_FILE),
      JSON.stringify({ ...file, allowed_handles: ['src/screen.jsx::Visit', 'src/screen.jsx::Visit'] }));
    assert.equal(main(['--summary'], { repository: root, log: () => {} }), 0);
    // Dropping back to one taken handle makes the second declaration STALE.
    writeFileSync(join(root, 'src', 'screen.jsx'),
      'const handle = base44.entities.Visit;\nexport const save = payload => handle.create(payload);\n');
    const shrunk = [];
    assert.equal(main(['--summary'], { repository: root, log: line => shrunk.push(String(line)) }), 1);
    assert.equal(shrunk.some(line => line.includes('declared 2 time(s) and taken 1')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the baseline rejects an allowance it cannot be read against', () => {
  const file = patch => JSON.stringify({ ...baseline(), ...patch });
  for (const [name, patch] of Object.entries({
    notAnArray: { allowed_handles: 'src/screen.jsx::Visit' },
    notStrings: { allowed_handles: [{ file: 'src/screen.jsx', entity: 'Visit' }] },
    missingEntity: { allowed_handles: ['src/screen.jsx'] },
  })) {
    assert.throws(() => parseBaseline(file(patch)), /BASELINE_INVALID_ALLOWANCE/, name);
  }
  // A repeated key is LEGAL: it declares a second occurrence in the same file.
  assert.deepEqual(parseBaseline(file({ allowed_handles: ['s::V', 's::V'] })).allowed_handles, ['s::V', 's::V']);
  // Absent is empty, which refuses every handle rather than allowing them.
  assert.deepEqual(parseBaseline(file({})).allowed_handles, []);
});
