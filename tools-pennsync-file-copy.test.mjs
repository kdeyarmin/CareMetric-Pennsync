import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  COPY_CONTRACT, LIMITS, SKIPS, STORAGE_HOSTS, UNCARRIED_DISPOSITIONS, FileCopyError,
  REQUIRED_READER_MODEL, RUNTIME_READER_MODEL,
  applyFileCopy, fileCopyRows, isStorageLocator, locatorKey, locatorPaths, main, planFileCopy,
  writeFileObjects,
  readExport, summarize,
} from './tools-pennsync-file-copy.mjs';

const census = JSON.parse(readFileSync('tools-file-reference-census-expectations.json', 'utf8'));
const manifest = JSON.parse(readFileSync('tools-transition-disposition.json', 'utf8'));
const APP = '6a9881683dc68a0bd54f1ef7';
const STORAGE = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/u/a.pdf';
const SECOND = 'https://base44.app/files/b.pdf';
const HANDLE = 'cmfile:3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_HANDLE = 'cmfile:3f2504e0-4f89-41d3-9a0c-0305e82c33bb';
const zeros = '0'.repeat(64);

/**
 * The paths are READ from the census, never typed here. A first draft invented
 * `DocumentVersion.file_url` and `FaxLog.file_url`; the real ones are
 * `pdf_url` and `document_url`, so the test exercised `unknown_field` while
 * claiming to exercise deduplication. D72's rule, arriving as a test defect:
 * before deciding a field list has to be written, check whether something has
 * already written it down.
 */
const only = entity => {
  const fields = (census.entities[entity] ?? []).filter(field => field.kind === 'locator');
  assert.ok(fields.length > 0, `${entity} has no locator field in the census`);
  return fields[0].path;
};
const DOC = only('Document');
const VERSION = only('DocumentVersion');
const REFERRAL = only('Referral');
const PAUSED = only('FaxLog');

const exported = (references, mapped = []) => readExport(JSON.stringify({
  contract: COPY_CONTRACT, app_id: APP, references, mapped,
}));
const plan = (references, mapped = []) => planFileCopy(exported(references, mapped), census, manifest);
const ref = (patch = {}) => ({ entity: 'Document', path: DOC, row_id: 'doc-1',
  locator: STORAGE, ...patch });

test('the key a plan computes is the key the database computes', () => {
  // The migration hashes the exact string with the built-in `sha256` over its
  // UTF-8 bytes. A plan that disagreed would record rows nothing resolves.
  assert.equal(locatorKey(STORAGE),
    createHash('sha256').update(Buffer.from(STORAGE, 'utf8')).digest('hex'));
  assert.match(locatorKey(''), /^[0-9a-f]{64}$/);
  // Not normalised, because the database does not normalise either: a query
  // string is part of an address.
  assert.notEqual(locatorKey(STORAGE), locatorKey(`${STORAGE}?v=2`));
  assert.notEqual(locatorKey(STORAGE), locatorKey(STORAGE.toUpperCase()));
});

test('a locator this does not recognise is reported, never guessed at', () => {
  for (const host of STORAGE_HOSTS) {
    assert.equal(isStorageLocator(`https://${host}/a.pdf`), true, host);
    assert.equal(isStorageLocator(`https://sub.${host}/a.pdf`), true, `sub.${host}`);
  }
  for (const value of [null, undefined, 42, '', 'a.pdf', 'file:///etc/passwd',
    'https://evil.example/a.pdf', 'https://base44.app.evil.example/a.pdf',
    // A host that merely CONTAINS an allowed one is not that host.
    'https://notbase44.app/a.pdf', HANDLE, `https://base44.app/${'a'.repeat(5000)}`]) {
    assert.equal(isStorageLocator(value), false, JSON.stringify(value)?.slice(0, 60));
  }
});

test('one locator is copied once however many rows reference it', () => {
  // A Document, the version under it and a Referral naming the same upload are
  // three paths to one object. Copying it three times would let two drift.
  const result = plan([
    ref(),
    ref({ entity: 'DocumentVersion', path: VERSION, row_id: 'ver-1' }),
    ref({ entity: 'Referral', path: REFERRAL, row_id: 'ref-1' }),
  ]);
  assert.equal(result.copies.length, 1);
  assert.equal(result.copies[0].reference_count, 3);
  assert.equal(result.copies[0].locator_key, locatorKey(STORAGE));
  assert.equal(summarize(result).references_covered, 3);
});

test('every reason a reference produces no copy is named', () => {
  const result = plan([
    ref({ locator: null }),
    ref({ locator: '' }),
    ref({ locator: HANDLE }),
    ref({ locator: 'https://evil.example/a.pdf' }),
    ref({ entity: 'NotAnEntity' }),
    ref({ path: 'not_a_locator_field' }),
    // `FaxLog` is `preserved_paused`: no table here, so nothing to re-point.
    ref({ entity: 'FaxLog', path: PAUSED }),
    ref({ locator: SECOND }),
  ], [locatorKey(SECOND)]);
  assert.deepEqual(result.skips, {
    blank: 2, already_owned: 1, not_a_storage_locator: 1, unknown_entity: 1,
    unknown_field: 1, uncarried_entity: 1, already_mapped: 1,
  });
  // Every enumerated reason is one the planner can actually produce, so the
  // list cannot drift from the code that raises it.
  assert.deepEqual(Object.keys(result.skips).sort(), [...SKIPS].sort());
  assert.equal(result.copies.length, 0);
  // A skip names the FIELD and never the row: an operator acts on the field.
  for (const entry of result.skipped_fields) {
    assert.equal(Object.hasOwn(entry, 'row_id'), false);
    assert.ok(SKIPS.includes(entry.reason));
    assert.ok(Number.isSafeInteger(entry.references) && entry.references >= 1);
  }
});

test('a skipped field says how often, because once and four thousand differ', () => {
  const result = plan([
    ref({ locator: null, row_id: 'a' }),
    ref({ locator: null, row_id: 'b' }),
    ref({ locator: null, row_id: 'c' }),
    ref({ path: 'invented_url', row_id: 'd' }),
  ]);
  const blank = result.skipped_fields.find(entry => entry.reason === 'blank');
  assert.equal(blank.references, 3);
  assert.equal(blank.entity, 'Document');
  assert.equal(blank.path, DOC);
  assert.equal(result.skipped_fields.find(entry => entry.reason === 'unknown_field').references, 1);
  // One entry per (reason, entity, path), not one per reference.
  assert.equal(result.skipped_fields.length, 2);
  // And the per-reason totals still count references, not fields.
  assert.equal(result.skips.blank, 3);
});

test('the locator limit is the limit, not one past it', () => {
  // Exactly LIMITS.locators, and one more refuses. Pinned because the check
  // moved from after the insert to before it, and "obviously off by one" was
  // wrong: both forms admit the same count.
  const many = Array.from({ length: LIMITS.locators + 1 }, (unused, index) =>
    ref({ locator: `https://base44.app/files/${index}.pdf`, row_id: `r${index}` }));
  assert.throws(() => plan(many), error => error.code === 'FILE_COPY_TOO_MANY_LOCATORS');
  const exact = many.slice(0, LIMITS.locators);
  assert.equal(plan(exact).copies.length, LIMITS.locators);
});

test('an unfamiliar path on a paused entity is still reported as unfamiliar', () => {
  // The carried check runs AFTER the shape checks on purpose: a census the
  // schemas have outgrown is a finding whatever the disposition says, and
  // reporting it as `uncarried_entity` would hide it behind a decision.
  const result = plan([{ entity: 'FaxLog', path: 'invented_url', row_id: 'x', locator: STORAGE }]);
  assert.equal(result.skips.unknown_field, 1);
  assert.equal(result.skips.uncarried_entity, 0);
});

test('the uncarried half is reported beside the copy set, never merged into it', () => {
  // The census lists 66 locator fields; 34 are on entities with a table here.
  // An inventory is complete, a rewrite has nothing to rewrite for the rest.
  const uncarried = Object.entries(census.entities)
    .filter(([entity, fields]) => fields.some(field => field.kind === 'locator')
      && UNCARRIED_DISPOSITIONS.includes(manifest.entities[entity]));
  assert.ok(uncarried.length > 0, 'the split this tool reports must exist');
  const result = plan([
    ref({ entity: 'FaxLog', path: PAUSED, locator: SECOND }),
    ref(),
  ]);
  assert.equal(result.copies.length, 1);
  assert.equal(result.copies[0].locator, STORAGE);
  assert.equal(result.uncarried_locators, 1);
  assert.equal(summarize(result).uncarried_locators, 1);
});

test('the digest covers what applies and nothing else', () => {
  const first = plan([ref()]);
  const again = plan([ref({ row_id: 'doc-2' })]);
  // Same copy set, same digest: the row a locator came from is not part of
  // what applies.
  assert.equal(first.digest, again.digest);
  const different = plan([ref({ locator: SECOND })]);
  assert.notEqual(first.digest, different.digest);
});

test('an export that is not this contract is refused before it is read', async () => {
  for (const [body, code] of [
    [JSON.stringify({ contract: 'other', app_id: APP, references: [] }), 'FILE_COPY_EXPORT_CONTRACT_MISMATCH'],
    ['not json', 'FILE_COPY_EXPORT_INVALID_JSON'],
    [JSON.stringify({ contract: COPY_CONTRACT, app_id: 'short', references: [] }), 'FILE_COPY_EXPORT_INVALID'],
    [JSON.stringify({ contract: COPY_CONTRACT, app_id: APP }), 'FILE_COPY_EXPORT_INVALID'],
    [JSON.stringify({ contract: COPY_CONTRACT, app_id: APP, references: [{ path: 'file_url' }] }),
      'FILE_COPY_EXPORT_INVALID'],
    [JSON.stringify({ contract: COPY_CONTRACT, app_id: APP, references: [], mapped: ['nothex'] }),
      'FILE_COPY_EXPORT_INVALID'],
  ]) {
    assert.throws(() => readExport(body), error => error instanceof FileCopyError
      && error.code === code, code);
  }
});

test('applying writes only what the copy produced, and only the reviewed plan', async () => {
  const result = plan([ref(), ref({ locator: SECOND, row_id: 'doc-2' })]);
  const statements = [];
  const execute = async (sql, params) => { statements.push([sql, params]); };
  const actorId = '00000000-0000-4000-8000-000000000001';
  // A locator the copy did not produce is DROPPED, never guessed at.
  const rows = fileCopyRows(result, {
    actorId, expectedDigest: result.digest, copyRun: 'run-1',
    results: { [STORAGE]: { file_uri: HANDLE, content_sha256: zeros, byte_size: 11 } },
  });
  assert.equal(rows.length, 1, 'one of the two locators was produced');
  assert.equal(await writeFileObjects(execute, rows), 1);
  // ONE transaction, and the lock INSIDE it. `pg_advisory_xact_lock` is an
  // xact lock: taken outside a transaction it releases immediately and every
  // insert commits on its own, so a later failure leaves earlier IMMUTABLE
  // mappings committed — the one state this design cannot correct in place.
  const sql = statements.map(([text]) => text.trim().split(/\s+/)[0].toLowerCase());
  assert.deepEqual(sql, ['begin', 'select', 'insert', 'commit']);
  assert.match(statements[1][0], /pg_advisory_xact_lock/);
  assert.match(statements[2][0], /insert into pennsync_private\.file_object/);
  // No `on conflict`: the primary key is the refusal, and a locator that
  // already has a destination must not quietly get a second one.
  assert.equal(/on conflict/i.test(statements[2][0]), false);
  assert.deepEqual(statements[2][1].slice(0, 4), [APP, locatorKey(STORAGE), STORAGE, HANDLE]);
});

test('a failed insert rolls the whole plan back', async () => {
  // The half that matters. Without the transaction the first insert would
  // already be committed and immutable when the second failed.
  const result = plan([ref(), ref({ locator: SECOND, row_id: 'doc-2' })]);
  const statements = [];
  const execute = async (sql, params) => {
    statements.push(sql.trim().split(/\s+/)[0].toLowerCase());
    if (/insert/i.test(sql) && params[2] === SECOND) throw new Error('constraint');
  };
  await assert.rejects(() => writeFileObjects(execute, fileCopyRows(result, {
    actorId: '00000000-0000-4000-8000-000000000001',
    expectedDigest: result.digest,
    copyRun: 'run-1',
    results: {
      [STORAGE]: { file_uri: HANDLE, content_sha256: zeros, byte_size: 11 },
      [SECOND]: { file_uri: OTHER_HANDLE, content_sha256: zeros, byte_size: 12 },
    },
  })), error => /constraint/.test(error.message));
  assert.equal(statements.includes('commit'), false);
  assert.equal(statements.at(-1), 'rollback');
});

test('a plan that is not the one reviewed applies nothing', async () => {
  const result = plan([ref()]);
  const actorId = '00000000-0000-4000-8000-000000000001';
  const results = { [STORAGE]: { file_uri: HANDLE, content_sha256: zeros, byte_size: 11 } };
  const ran = [];
  const execute = async (...args) => { ran.push(args); };
  for (const [patch, code] of [
    [{ expectedDigest: 'wrong' }, 'FILE_COPY_PLAN_DIGEST_MISMATCH'],
    [{ actorId: 'not-a-uuid' }, 'FILE_COPY_ACTOR_INVALID'],
    [{ copyRun: '' }, 'FILE_COPY_RUN_INVALID'],
    [{ results: { [STORAGE]: { file_uri: STORAGE, content_sha256: zeros, byte_size: 1 } } },
      'FILE_COPY_RESULT_URI_INVALID'],
    [{ results: { [STORAGE]: { file_uri: HANDLE, content_sha256: 'NOTHEX', byte_size: 1 } } },
      'FILE_COPY_RESULT_DIGEST_INVALID'],
    [{ results: { [STORAGE]: { file_uri: HANDLE, content_sha256: zeros, byte_size: -1 } } },
      'FILE_COPY_RESULT_SIZE_INVALID'],
  ]) {
    // Synchronous, because building the rows is where every one of these is
    // decided: nothing may reach the transaction that the plan does not justify.
    assert.throws(
      () => fileCopyRows(result,
        { actorId, expectedDigest: result.digest, copyRun: 'run-1', results, ...patch }),
      error => error.code === code, code);
  }
  // Nothing ran for any of them: a refusal that had already taken the lock and
  // written a row would be a partial apply.
  assert.deepEqual(ran.filter(([sql]) => /insert/i.test(sql)), []);
});

test('the census this plans from is the committed one', () => {
  const paths = locatorPaths(census);
  assert.ok(paths.get('Document').has(DOC));
  // A nested path travels intact: the census lists `attachments[].file_url`
  // and an export naming it has to match that string exactly.
  assert.ok(paths.get('AgencyMessage').has('attachments[].file_url'));
  assert.throws(() => locatorPaths({}), error => error.code === 'FILE_COPY_CENSUS_INVALID');
  assert.throws(() => locatorPaths(null), error => error.code === 'FILE_COPY_CENSUS_INVALID');
});

test('the plan attests that computing it moved nothing', async () => {
  // The same three fields the census carries, for the same reason: an operator
  // reads this artifact and acts on it.
  const result = plan([ref()]);
  assert.equal(result.hosted_inventory_performed, false);
  assert.equal(result.object_bytes_read, 0);
  assert.equal(result.files_copied, 0);
  // And applying moves nothing either: it records where the operator's own
  // copy put the bytes, and never fetches one.
  const source = readFileSync('tools-pennsync-file-copy.mjs', 'utf8');
  for (const reach of [/\bfetch\s*\(/, /node:https?/, /\bXMLHttpRequest\b/]) {
    assert.equal(reach.test(source), false, String(reach));
  }
});

test('the command line plans and never copies', async () => {
  const lines = [];
  const body = JSON.stringify({ contract: COPY_CONTRACT, app_id: APP, references: [ref()] });
  assert.equal(await main(['export.json'], { log: l => lines.push(l), read: async () => body }), 0);
  const summary = JSON.parse(lines[0]);
  assert.equal(summary.to_copy, 1);
  assert.equal(summary.contract, COPY_CONTRACT);
  assert.match(summary.digest, /^[0-9a-f]{64}$/);
  // No usage, no path: refused rather than defaulted.
  lines.length = 0;
  assert.equal(await main([], { log: l => lines.push(l) }), 2);
  assert.deepEqual(JSON.parse(lines[0]), { error: 'FILE_COPY_USAGE' });
  lines.length = 0;
  assert.equal(await main(['export.json', '--apply'], { log: l => lines.push(l) }), 2);
  assert.deepEqual(JSON.parse(lines[0]), { error: 'FILE_COPY_USAGE' });
});

test('every apply is refused, and the refusal is tied to the runtime it is about', async () => {
  /*
   * THE FIRST VERSION OF THIS GOT THE POLARITY BACKWARDS, and it is the kind
   * of mistake that reads as a control. It took a `readerModel` from the
   * operator, refused `uploader_owned` by name and ACCEPTED `record_authorized`
   * — which nothing implements. The label was never checked against anything,
   * so the only accepted value was the one that cannot be true, and the refusal
   * message named it: an operator following the error would type the word that
   * let IMMUTABLE rows be written for handles nobody but one person can open.
   *
   * So there is no label any more. The refusal is derived from a fact about
   * another service, and the assertions below are what keep that fact honest:
   * they read the runtime's own two checks, because when either goes the
   * refusal is the one line to delete.
   */
  const result = plan([ref()]);
  await assert.rejects(
    () => applyFileCopy(async () => {}, result, {
      actorId: '00000000-0000-4000-8000-000000000001',
      expectedDigest: result.digest,
      copyRun: 'run-1',
      results: { [STORAGE]: { file_uri: HANDLE, content_sha256: zeros, byte_size: 11 } },
    }),
    error => error.code === 'FILE_COPY_READER_MODEL_UNRESOLVED',
    'a well-formed apply is refused too, which is the whole point');
  // And it refuses BEFORE the plan is read, so a malformed one gets this
  // reason rather than a shape complaint that hides it.
  await assert.rejects(() => applyFileCopy(async () => {}, {}, {}),
    error => error.code === 'FILE_COPY_READER_MODEL_UNRESOLVED');

  const runtime = readFileSync('services/integration-runtime/providers.mjs', 'utf8');
  assert.match(runtime, /row\.subject !== ctx\.subject/,
    'the runtime no longer binds a handle to the caller: revisit RUNTIME_READER_MODEL');
  assert.match(runtime, /row\.object_path !== `\$\{config\.appId\}\/\$\{ctx\.subject\}\/\$\{id\}`/,
    'the runtime no longer embeds the subject in the path: revisit RUNTIME_READER_MODEL');
  assert.equal(RUNTIME_READER_MODEL, 'uploader_owned');
  assert.notEqual(RUNTIME_READER_MODEL, REQUIRED_READER_MODEL,
    'these differing is what refuses every apply');
});
