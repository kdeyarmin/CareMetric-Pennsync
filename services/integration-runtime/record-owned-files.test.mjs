// The reader split: who may open a record-owned object, and who may not.
//
// Synthetic fixed destinations and an injected store and fetcher throughout;
// no credentials, no network, no bytes.
//
// What these prove is the property the model rests on: a `cmfile:` handle is
// NOT a bearer capability. Every refusal below is a caller who holds the handle
// and is refused anyway, because the tenant they hold is resolved by the
// runtime from their own bearer and is not something they can assert.
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
  async fileGetAuthorized({ p_subject: subject, p_agency_id: agency }) {
    if (row.owner_kind === 'subject') return row.subject === subject ? row : null;
    return agency !== null && row.agency_id === agency ? row : null;
  },
});
const signing = objectPath => async (url, options) => {
  assert.equal(url, `${config.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${objectPath}`);
  assert.deepEqual(JSON.parse(options.body), { expiresIn: 60 });
  return Response.json({ signedURL: `/object/sign/${BUCKET}/${objectPath}?token=synthetic` });
};
const denied = error => error.status === 403 && error.code === 'FILE_ACCESS_DENIED';

test('a colleague in the same agency opens a record-owned object they did not mint', async () => {
  const provider = createProviders(config, storeHolding(recordRow()), signing(recordPath));
  const result = await provider('CreateFileSignedUrl', { file_uri: `cmfile:${id}` },
    { subject: colleague, agencyId });
  assert.equal(result.signed_url,
    `${config.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${recordPath}?token=synthetic`);
});

test('holding the handle buys nothing outside the tenant', async () => {
  // The whole point of the model. Each of these callers has the exact handle
  // and is refused, because the agency is the runtime's own reading of their
  // authority rather than anything they sent.
  for (const ctx of [
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
 * it refuses a foreign tenant before the runtime is ever asked — so the test
 * above it proves the store's predicate and NOT the runtime's. Sabotaging
 * `fileRecord`'s agency comparison left that test green, which is how this one
 * came to exist. Here the store hands the row back to everybody, and what is
 * under test is the runtime refusing anyway.
 */
const permissiveStore = row => ({ async fileGetAuthorized() { return row; } });

test('the runtime refuses a foreign tenant even when the store hands the row over', async () => {
  for (const ctx of [
    { subject: colleague, agencyId: otherAgency },
    { subject: minter, agencyId: otherAgency },
    { subject: colleague, agencyId: null },
    { subject: minter, agencyId: null },
    { subject: colleague },
  ]) {
    const provider = createProviders(config, permissiveStore(recordRow()),
      () => assert.fail('the runtime must not sign for a tenant it did not resolve'));
    await assert.rejects(() => provider('CreateFileSignedUrl', { file_uri: `cmfile:${id}` }, ctx), denied);
  }
  // And an uploader-owned row from the same over-permissive store: the subject
  // comparison is the second layer on that side and is proved the same way.
  const provider = createProviders(config, permissiveStore(subjectRow()),
    () => assert.fail('the runtime must not sign an uploader-owned row for another caller'));
  await assert.rejects(() => provider('CreateFileSignedUrl', { file_uri: `cmfile:${id}` },
    { subject: colleague, agencyId }), denied);
});

test('a record-owned row is refused when its path does not address its own agency', async () => {
  // The path is the second copy of the authorization fact, exactly as it is for
  // an uploader-owned row: a row whose agency was altered no longer addresses
  // its bytes, and the runtime refuses rather than signing the old path.
  for (const patch of [{ object_path: subjectPath }, { object_path: `${appId}/record/${otherAgency}/${id}` },
    { agency_id: otherAgency }, { owner_kind: 'unknown_kind' }]) {
    const provider = createProviders(config, permissiveStore(recordRow(patch)),
      () => assert.fail('must not sign a mismatched tenant or storage path'));
    await assert.rejects(() => provider('CreateFileSignedUrl', { file_uri: `cmfile:${id}` },
      { subject: colleague, agencyId }), denied);
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

test('UploadRecordFile mints against the agency and refuses to mint without one', async () => {
  let recorded = null;
  const store = {
    async fileRecordOwned(input) { recorded = input; return true; },
    async fileRecord() { assert.fail('a record-owned upload must not fall back to uploader ownership'); },
  };
  const provider = createProviders(config, store, async (url, options) => {
    assert.equal(url, `${config.supabaseUrl}/storage/v1/object/${BUCKET}/${recordPath}`);
    assert.equal(options.headers['x-upsert'], 'false');
    return new Response('', { status: 200 });
  });
  const result = await provider('UploadRecordFile', { base64: Buffer.from('hello').toString('base64'),
    content_type: 'text/plain' }, { subject: minter, jobId: id, agencyId });
  assert.equal(result.file_uri, `cmfile:${id}`);
  assert.equal(result.private, true);
  assert.equal(recorded.p_agency_id, agencyId);
  assert.equal(recorded.p_object_path, recordPath);
  // Provenance, not authorization: the row records who minted it.
  assert.equal(recorded.p_subject, minter);

  // With no tenant the object would be readable by nobody, so it refuses rather
  // than quietly minting one only its author could open.
  const noTenant = createProviders(config, store, () => assert.fail('must not upload without a tenant'));
  await assert.rejects(() => noTenant('UploadRecordFile',
    { base64: Buffer.from('hello').toString('base64'), content_type: 'text/plain' },
    { subject: minter, jobId: id, agencyId: null }),
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
  // Both halves of the record-owned path: the mint needs the tenant to bind an
  // object to it, and the read needs it to admit a colleague.
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
