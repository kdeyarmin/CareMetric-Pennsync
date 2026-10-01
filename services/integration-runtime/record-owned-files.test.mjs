// The reader split, and the half of it that is NOT built.
//
// Synthetic fixed destinations and an injected store and fetcher throughout;
// no credentials, no network, no bytes.
//
// What these prove is the property the model rests on: a `cmfile:` handle is
// NOT a bearer capability. The first version of this suite proved it for the
// tenant and asserted, in its opening test, that a colleague sharing the agency
// opens an object they did not mint — which is that property failing inside the
// tenant, because `services/pennsync-api/integrations.mjs:66,86` forwards the
// END USER's bearer and holds no service credential, so the runtime cannot tell
// an authorized chart read from that same user asking directly. An agency-wide
// read predicate therefore makes a leaked handle openable by every active
// member of the agency, which is the thing being denied.
//
// So the record-owned READ is not built. `006`'s getter is narrowed to
// `owner_kind = 'subject'` and the runtime refuses a record-owned row anyway if
// one ever comes back; `UploadRecordFile` refuses to mint one at all. The
// schema, the CHECK and the mint function ship and are tested against a real
// cluster, because what is missing is an authorization decision about the
// boundary between two services rather than any of that SQL. Every test below
// is now a refusal, and the two that assert a SUCCESS are the uploader-owned
// path, which this change leaves byte-for-byte alone.
//
// One consequence to keep in view when the read does ship: the tests here that
// exercise the path and tenant comparisons for a record-owned row are currently
// answered by the `owner_kind` refusal ABOVE them, so they prove that refusal
// and not the comparison. They say so where they stand rather than reading as
// coverage that exists.
// HOW THIS AREA'S TESTS FAIL, and it is structural rather than careless.
//
// The reader split has a layer above and below every check — a store predicate
// under the runtime's comparisons, a contract above them, a fixture standing in
// for each — so anything even slightly too faithful answers FIRST and the check
// under test never runs. Five instances were found while this shipped:
//
//   1. a store double written as migration 006's own predicate, which refused a
//      foreign tenant before the runtime was asked;
//   2. a classifier mask that still matched the call it had just blanked;
//   3. this suite's own missing wiring check — deleting `agencyId` from the
//      provider context in `runtime.mjs` left every test here green;
//   4. `http-storage.test.mjs`'s egress allowlist refusing the new getter, so a
//      suite proving the runtime denies a foreign caller proved its double does;
//   5. an install step filtering the migration directory to `00[1-5]`, so the
//      function under test did not exist in the stack at all.
//
// The three that mattered — 3, 4, 5 — answered from a fixture's allowlist, an
// install step and a context assembled in another module. **None of them is in
// the file under test.** So a reading pass scoped to that file cannot find them
// however carefully it is done; that is a limit of the method, not of the
// reader. Instances 1 and 2 were in-file and reading did catch those.
//
// What found the rest was MUTATION: weaken one production line, run every suite
// that could notice, and see whether anything complains — which needs no idea of
// where the answer is coming from. Nineteen mutations with no-op controls (to
// prove the harness was running at all) found 3 and the unfireable guard in
// `tools-pennsync-file-copy.mjs`. The script was deliberately NOT committed: a
// scratch harness presented as a permanent check is a dead guard, and this file
// exists partly because of two of those. Re-derive it when changing this area.
//
// The rule the fixtures below follow, stated once: **a layered check is proved
// only against a fixture in which every layer beneath it has already failed** —
// and since instance 5, "layer" includes the environment that installs them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders, validateParams } from './providers.mjs';
import { BROWSER_FORBIDDEN_OPERATIONS, OPERATIONS } from './contracts.mjs';
import { BUCKET, performDurable } from './runtime.mjs';

const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const appId = '694ec16e72e01b60d22f7cbf';
const minter = 'b'.repeat(64);
const colleague = 'e'.repeat(64);
const agencyId = 'agency-one';
const otherAgency = 'agency-two';
const recordPath = `${appId}/record/${agencyId}/${id}`;
const subjectPath = `${appId}/${minter}/${id}`;
const config = { appId, supabaseUrl: 'https://xsqobvvreaovwibxwyvv.supabase.co', supabaseKey: 'synthetic' };

const recordRow = patch => ({ id, app_id: appId, subject: minter, owner_kind: 'record',
  agency_id: agencyId, object_path: recordPath, size_bytes: 10, sha256: 'c'.repeat(64), ...patch });
const subjectRow = patch => ({ id, app_id: appId, subject: minter, owner_kind: 'subject',
  agency_id: null, object_path: subjectPath, size_bytes: 10, sha256: 'c'.repeat(64), ...patch });

/**
 * A store that answers the way migration 006's own SQL answers.
 *
 * Written as the predicate rather than as a fixture so a test cannot admit a
 * caller the database would refuse: `cm_integration_file_get_authorized` is
 * `(subject-owned and subject matches) or (record-owned and agency matches and
 * the agency is not null)`, and that is what this is.
 */
const storeHolding = row => ({
  async fileGet({ p_subject: subject }) {
    // `006` narrowed this one to `owner_kind = 'subject'`, so a record-owned
    // row never comes back however the caller is placed. The authorized getter
    // exists in SQL and has no caller here, deliberately.
    if (row.owner_kind !== 'subject') return null;
    return row.subject === subject ? row : null;
  },
  async fileGetAuthorized() {
    assert.fail('the runtime must not read through the authorized getter yet');
  },
});
const signing = objectPath => async (url, options) => {
  assert.equal(url, `${config.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${objectPath}`);
  assert.deepEqual(JSON.parse(options.body), { expiresIn: 60 });
  return Response.json({ signedURL: `/object/sign/${BUCKET}/${objectPath}?token=synthetic` });
};
const denied = error => error.status === 403 && error.code === 'FILE_ACCESS_DENIED';

const unresolved = error =>
  error.status === 403 && error.code === 'RECORD_FILE_READER_MODEL_UNRESOLVED';

test('a colleague in the same agency is refused, because tenancy is not chart authorization', async () => {
  // The inversion, and the reason for the whole change. This test asserted the
  // opposite and passed: the colleague held the handle, shared the agency, and
  // was signed a link to a chart nobody checked they may open.
  //
  // Both layers are driven, because they refuse for different reasons and only
  // one of them is visible from this file. The store's narrowed getter never
  // returns the row at all, which is indistinguishable from an absent one —
  const shut = createProviders(config, storeHolding(recordRow()),
    () => assert.fail('a record-owned object is not readable here at all'));
  await assert.rejects(() => shut('CreateFileSignedUrl', { file_uri: `cmfile:${id}` },
    { subject: colleague, agencyId }), denied);

  // — so the runtime's own refusal is proved against a store that hands the row
  // over regardless. This is the one that survives a later widening of the
  // getter, and it fails closed rather than falling through to the path check.
  const handed = createProviders(config, permissiveStore(recordRow()),
    () => assert.fail('a record-owned object is not readable here at all'));
  await assert.rejects(() => handed('CreateFileSignedUrl', { file_uri: `cmfile:${id}` },
    { subject: colleague, agencyId }), unresolved);

  // And the minter is refused too, which is the distinction worth keeping: the
  // pause is about the OBJECT's ownership kind and not about who is asking, so
  // it cannot be mistaken for a tenant comparison that happens to be strict.
  await assert.rejects(() => handed('CreateFileSignedUrl', { file_uri: `cmfile:${id}` },
    { subject: minter, agencyId }), unresolved);
});

test('holding the handle buys nothing, inside the tenant or outside it', async () => {
  // Stronger than it was: the tenant is no longer what decides, so the list
  // below is not a list of wrong tenants but of every caller there is. The
  // agency is still the runtime's own reading of their authority rather than
  // anything they sent, and now it buys them nothing either way.
  for (const ctx of [
    { subject: colleague, agencyId },                // the object's own tenant
    { subject: minter, agencyId },                   // the minter, in it
    { subject: colleague, agencyId: otherAgency },   // a real caller, wrong tenant
    { subject: minter, agencyId: otherAgency },      // even the minter, wrong tenant
    { subject: colleague, agencyId: null },          // no tenant at all
    { subject: minter, agencyId: null },             // a platform owner with no agency scope
    { subject: colleague },                          // agency absent rather than null
  ]) {
    const provider = createProviders(config, storeHolding(recordRow()),
      () => assert.fail('must not sign for a caller outside the object\'s tenant'));
    await assert.rejects(() => provider('CreateFileSignedUrl', { file_uri: `cmfile:${id}` }, ctx), denied);
  }
});

/**
 * The runtime's check is a SECOND layer, so it is proved against a store that
 * has already failed.
 *
 * `storeHolding` above answers the way migration 006's SQL answers, which means
 * it refuses a record-owned row before the runtime is ever asked — so a test
 * using it proves the store's predicate and NOT the runtime's. Sabotaging the
 * runtime's own comparison left such a test green, which is how this one came
 * to exist. Here the store hands the row back to everybody, and what is under
 * test is the runtime refusing anyway.
 *
 * That layering is what makes the paused read provable at all: the getter alone
 * would be indistinguishable from a getter that simply has no matching row.
 */
const permissiveStore = row => ({ async fileGet() { return row; } });

test('the runtime refuses a record-owned row even when the store hands it over', async () => {
  for (const ctx of [
    { subject: colleague, agencyId },
    { subject: minter, agencyId },
    { subject: colleague, agencyId: otherAgency },
    { subject: minter, agencyId: otherAgency },
    { subject: colleague, agencyId: null },
    { subject: minter, agencyId: null },
    { subject: colleague },
  ]) {
    const provider = createProviders(config, permissiveStore(recordRow()),
      () => assert.fail('the runtime must not sign a record-owned object'));
    await assert.rejects(() => provider('CreateFileSignedUrl', { file_uri: `cmfile:${id}` }, ctx),
      unresolved, JSON.stringify(ctx));
  }
  // And an uploader-owned row from the same over-permissive store: the subject
  // comparison is the second layer on that side and is proved the same way.
  const provider = createProviders(config, permissiveStore(subjectRow()),
    () => assert.fail('the runtime must not sign an uploader-owned row for another caller'));
  await assert.rejects(() => provider('CreateFileSignedUrl', { file_uri: `cmfile:${id}` },
    { subject: colleague, agencyId }), denied);
});

test('a tampered record-owned row is refused, and NOT by the path comparison', async () => {
  /*
   * Said plainly rather than left to read as coverage.
   *
   * These four rows are refused, but a record-owned row now meets the
   * `owner_kind` refusal BEFORE any tenant or path comparison, so what this
   * proves is that refusal and not the comparison — the same shape as the
   * five instances the header lists, and as the reader-model gate that was
   * placed in front of `tools-pennsync-file-copy.mjs`'s cross-agency check and
   * silently retired three tests behind it.
   *
   * It is kept because fail-closed on a tampered row is worth asserting, and
   * because the codes distinguish the cases: three carry the pause, while an
   * unknown `owner_kind` is neither and falls to the subject comparison. When
   * the read ships, the first three become the path check and this comment is
   * what says so.
   */
  for (const [patch, expected] of [
    [{ object_path: subjectPath }, unresolved],
    [{ object_path: `${appId}/record/${otherAgency}/${id}` }, unresolved],
    [{ agency_id: otherAgency }, unresolved],
    [{ owner_kind: 'unknown_kind' }, denied],
  ]) {
    const provider = createProviders(config, permissiveStore(recordRow(patch)),
      () => assert.fail('must not sign a mismatched tenant or storage path'));
    await assert.rejects(() => provider('CreateFileSignedUrl', { file_uri: `cmfile:${id}` },
      { subject: colleague, agencyId }), expected, JSON.stringify(patch));
  }
});

test('an uploader-owned object stays the uploader\'s, whatever agency the caller holds', async () => {
  // Nothing about the original model moves. A colleague sharing the tenant is
  // still refused, and the minter is still admitted with no agency at all.
  const shared = storeHolding(subjectRow());
  const refused = createProviders(config, shared, () => assert.fail('must not widen an uploader-owned row'));
  for (const ctx of [{ subject: colleague, agencyId }, { subject: colleague, agencyId: null }]) {
    await assert.rejects(() => refused('CreateFileSignedUrl', { file_uri: `cmfile:${id}` }, ctx), denied);
  }
  const provider = createProviders(config, shared, signing(subjectPath));
  for (const ctx of [{ subject: minter, agencyId: null }, { subject: minter, agencyId }]) {
    const result = await provider('CreateFileSignedUrl', { file_uri: `cmfile:${id}` }, ctx);
    assert.equal(result.signed_url,
      `${config.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${subjectPath}?token=synthetic`);
  }
});

/*
 * THE SUBJECT COMPARISON IS THE LAST THING STANDING, so it is pinned on its own.
 *
 * `/v1/integrations` authenticates the END USER and never `pennsync-api`
 * (`app.mjs` reads one bearer; `services/pennsync-api/integrations.mjs:66,86`
 * forwards the caller's own and holds no service credential). Both released
 * operations pass a caller-supplied handle to `fileRecord` through
 * `loadDocument`. So nothing between a leaked `cmfile:` UUID and the bytes it
 * names except this comparison — and for thirty-five minutes at `56148ec5`
 * this branch had widened it to the tenant, which a reviewer caught and no test
 * did.
 *
 * The test above does not cover it. `storeHolding` IS migration 006's predicate,
 * so it refuses a foreign subject before the runtime is asked: delete
 * `row.subject !== ctx.subject` from `providers.mjs` and that test stays green.
 * This is instance 1 of the header's list, in the one place it costs a chart.
 *
 * So the store here hands the row to everybody, and the two comparisons are
 * separated rather than asserted together: the second case gives the row a path
 * that matches the CALLER, so the path check cannot refuse and only the subject
 * check can. Sabotage confirmed each case fails for its own line.
 */
test('a handle minted for one subject is refused for every other caller, tenant or not', async () => {
  const handed = row => createProviders(config, permissiveStore(row),
    () => assert.fail('a caller who did not mint this object may not reach the bytes'));
  const open = (row, ctx) => () => handed(row)('CreateFileSignedUrl', { file_uri: `cmfile:${id}` }, ctx);

  // Case one: the row exactly as it is stored, handed to a caller who is not
  // its subject. This is what a widened store predicate would deliver, and it
  // is refused here regardless of where the caller is placed.
  for (const ctx of [
    { subject: colleague, agencyId },                // the minter's own tenant
    { subject: colleague, agencyId: otherAgency },   // another tenant
    { subject: colleague, agencyId: null },          // no tenant at all
    { subject: colleague },                          // agency absent rather than null
  ]) {
    await assert.rejects(open(subjectRow(), ctx), denied);
  }

  // Case two: the subject comparison ALONE. The path embeds the caller, so
  // `row.object_path !== `${appId}/${ctx.subject}/${id}`` holds and cannot be
  // what refuses; only `row.subject !== ctx.subject` is left to do it.
  await assert.rejects(
    open(subjectRow({ object_path: `${appId}/${colleague}/${id}` }), { subject: colleague, agencyId }),
    denied);

  // And the control, so the refusals above are not a provider that refuses
  // everything: the subject themselves still gets their link.
  const mine = createProviders(config, permissiveStore(subjectRow()), signing(subjectPath));
  const result = await mine('CreateFileSignedUrl', { file_uri: `cmfile:${id}` },
    { subject: minter, agencyId });
  assert.equal(result.signed_url,
    `${config.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${subjectPath}?token=synthetic`);
});

test('UploadRecordFile mints nothing, and reports the pause rather than falling back', async () => {
  /*
   * Paused and REPORTED as paused, in the idiom D42 and D73 use: the operator
   * gets the reason rather than a row, and rather than an uploader-owned object
   * quietly standing in for the one they asked for.
   *
   * That fallback is the failure worth asserting against. A caller asking for a
   * file their colleagues can open, silently handed one only they can, would
   * discover it when a colleague could not open a document — with an immutable
   * mapping already recorded for it, which D77's copy cannot repoint.
   */
  const store = {
    async fileRecordOwned() { assert.fail('nothing may mint a record-owned row while the read is unbuilt'); },
    async fileRecord() { assert.fail('a record-owned upload must not fall back to uploader ownership'); },
  };
  const upload = ctx => () => createProviders(config, store,
    () => assert.fail('no bytes may be written for an object nobody can read'))(
    'UploadRecordFile',
    { base64: Buffer.from('hello').toString('base64'), content_type: 'text/plain' }, ctx);

  await assert.rejects(upload({ subject: minter, jobId: id, agencyId }),
    error => error.status === 503 && error.code === 'RECORD_FILE_READER_MODEL_UNRESOLVED');

  // The tenant requirement sits AHEAD of the pause on purpose, so that it is
  // still reached and still proved rather than becoming a line nothing can
  // fire. Both are refusals, so the ordering discloses nothing.
  await assert.rejects(upload({ subject: minter, jobId: id, agencyId: null }),
    error => error.status === 400 && error.code === 'RECORD_FILE_AGENCY_REQUIRED');
});

test('the existing uploads are untouched and still bind to the subject', async () => {
  for (const operation of ['UploadFile', 'UploadPrivateFile']) {
    let recorded = null;
    const store = {
      async fileRecord(input) { recorded = input; return true; },
      async fileRecordOwned() { assert.fail(`${operation} must not mint a record-owned object`); },
    };
    const provider = createProviders(config, store, async url => {
      assert.equal(url, `${config.supabaseUrl}/storage/v1/object/${BUCKET}/${subjectPath}`);
      return new Response('', { status: 200 });
    });
    // An agency on the request changes nothing: these two are uploader-owned
    // whatever tenant the caller happens to hold.
    await provider(operation, { base64: Buffer.from('hello').toString('base64'), content_type: 'text/plain' },
      { subject: minter, jobId: id, agencyId });
    assert.equal(recorded.p_object_path, subjectPath);
    assert.ok(!('p_agency_id' in recorded));
  }
});

test('UploadRecordFile is a governed operation and never a browser one', () => {
  assert.ok(OPERATIONS.includes('UploadRecordFile'),
    'it must be nameable in INTEGRATIONS_ALLOWED_OPERATIONS to be served at all');
  assert.ok(BROWSER_FORBIDDEN_OPERATIONS.includes('UploadRecordFile'),
    'minting an agency-readable object is a decision a contract makes, never a browser');
  // The same parameter contract as the uploads it sits beside: nothing extra
  // crosses from the caller, and the tenant is not among its inputs.
  assert.throws(() => validateParams('UploadRecordFile',
    { base64: 'aGk=', content_type: 'text/plain', agency_id: agencyId }, config),
  error => error.status === 400);
  validateParams('UploadRecordFile', { base64: 'aGk=', content_type: 'text/plain' }, config);
});

/**
 * The tenant has to ARRIVE, and nothing above proved that it does.
 *
 * Every test above hands `createProviders` a ctx it wrote itself, so each one
 * proves the provider's behaviour GIVEN a tenant and says nothing about whether
 * the tenant the runtime resolved ever reaches it. Deleting `agencyId` from the
 * provider ctx in `runtime.mjs` left all of them green — a whole capability
 * inert, and no check anywhere in this change noticed.
 *
 * It is the same shape as `permissiveStore` above and as the CI failure that
 * followed: something other than the layer under test supplied the answer. The
 * layer here is the WIRING, so this drives the real `performDurable` and asserts
 * what the provider was handed.
 */
test('the agency the runtime resolved is the one the provider is given', async () => {
  const config = { appId, supabaseUrl: 'https://xsqobvvreaovwibxwyvv.supabase.co', supabaseKey: 'synthetic',
    hashKey: 'f'.repeat(64), encryptionKey: '1'.repeat(64), released: true, revision: 'synthetic' };
  const store = {
    async reserve() { return { id, outcome: 'owned' }; },
    async finish() { return true; },
  };
  // The authority double answers about the agency the way the real resolver
  // does: the caller's tenant is its OUTPUT, never the provider's input.
  const authority = async (_config, _req, resolved) => ({
    subject: minter, canEmail: false, snapshot: `synthetic:${resolved}` });
  // Both halves of the record-owned path. The provider is a double, so this is
  // about the wiring and not about either refusal: the tenant has to ARRIVE for
  // the mint to bind an object to it and for the read to be able to decide
  // anything at all, and that stays true while both are refused.
  for (const operation of ['UploadRecordFile', 'CreateFileSignedUrl']) {
    const seen = [];
    // `usableResult` refuses a signed link that is already stale, so the double
    // answers with a live one; nothing here turns on its value.
    const provider = async (_operation, _params, ctx) => { seen.push(ctx);
      return { ok: true, expires_at_ms: Date.now() + 60000 }; };
    await performDurable({ config, req: new Request('https://runtime.test/v1/integrations',
      { headers: { authorization: 'Bearer synthetic' } }), agencyId, operation,
      params: {}, requestId: `request-${operation}`, provider, store, authority });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].agencyId, agencyId,
      `${operation}: the provider must be handed the tenant the runtime resolved, or every record-owned path is inert`);
    assert.equal(seen[0].subject, minter);
    assert.equal(seen[0].jobId, id);
  }
});
