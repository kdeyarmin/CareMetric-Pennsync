// The receipt check on an upload, which nothing observed until now.
//
// `providers.mjs` writes the bytes to storage and THEN records the row that
// makes them findable: `if (saved !== true) fail(503, 'FILE_RECEIPT_UNCERTAIN')`.
// Removing that line does not break a single test in this directory — the happy
// path returns `true` and every suite exercises the happy path — so the line
// guards a `cmfile:` handle being returned for a write the database never
// acknowledged. That failure is silent by construction: the caller is told the
// upload succeeded, the bytes are in the bucket, and no row names them, so it
// surfaces later as a file that cannot be opened with nothing anywhere to
// explain it.
//
// What the check is actually defending against is narrower than "the insert
// failed". `cm_integration_file_record` (`001_integration_state.sql:57`) either
// returns `true` or RAISES, and a raise comes back as a non-ok response that
// `rpc` already turns into `INTEGRATION_STATE_UNAVAILABLE` before this line is
// reached.
//
// Two things, then, about what can actually arrive here, and the second was a
// review finding against a first draft of this comment rather than something it
// got right. An EMPTY response body is NOT one of them: `rpc` hands a successful
// body to `readJson`, whose `JSON.parse('')` throws and becomes a 502
// `INVALID_UPSTREAM_RESPONSE` (`safety.mjs`), so it never reaches this line as
// `null` or as anything else. What does produce `null` is the JSON literal
// `null`, which is what PostgREST serializes a SQL NULL return as. A first
// draft of THIS sentence said a plpgsql body falling out without `return true`
// is that case, and it is not: plpgsql raises `control reached end of function
// without RETURN`, measured on PostgreSQL 17.11, so it becomes
// `INTEGRATION_STATE_UNAVAILABLE` like any other raise. What really returns NULL
// is an explicit `return null`, or a `language sql` body whose expression is
// NULL — both measured. A `setof boolean` returning no rows is the other shape,
// and PostgREST renders it `[]`, which is why an array is in the case list. The
// rest is a return type changed by a later migration or a gateway answering in
// its own shape.
//
// So `!== true` rather than `=== false` is the load-bearing part, and the case
// list below is deliberately WIDER than the transport: `undefined` cannot cross
// JSON at all and is reachable only from a store implementation that returns
// nothing, which is a real way for `createStore` to be changed. The cases are
// chosen to prove the strict-equality distinction, not to enumerate the bugs
// most likely to occur.
//
// Synthetic fixed destinations and an injected store and fetcher; no
// credentials, no network, no bytes leaving the process.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders } from './providers.mjs';
import { BUCKET } from './runtime.mjs';

const appId = '694ec16e72e01b60d22f7cbf';
const subject = 'b'.repeat(64);
const jobId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const objectPath = `${appId}/${subject}/${jobId}`;
const config = { appId, supabaseUrl: 'https://xsqobvvreaovwibxwyvv.supabase.co', supabaseKey: 'synthetic' };
const params = { base64: Buffer.from('synthetic bytes').toString('base64'), content_type: 'text/plain' };
const ctx = { subject, jobId };

// The upload itself must SUCCEED in every case here, or the refusal under test
// is not the one being observed: `UPLOAD_OUTCOME_UNCERTAIN` sits one line above
// and would answer in its place.
const uploads = () => {
  let writes = 0;
  const fetcher = async (url, options) => {
    writes += 1;
    assert.equal(url, `${config.supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath}`);
    assert.equal(options.headers['x-upsert'], 'false');
    return new Response('', { status: 200 });
  };
  return { fetcher, writes: () => writes };
};
const uncertain = error => error.status === 503 && error.code === 'FILE_RECEIPT_UNCERTAIN';

for (const operation of ['UploadFile', 'UploadPrivateFile']) {
  test(`${operation} refuses to hand back a handle for an unacknowledged receipt`, async () => {
    // `false` and `null` are the ones to expect, and `null` is the SQL NULL
    // return rather than an empty body — see the header. The rest exist because
    // `=== false` would let them through, and a truthy non-boolean is the one a
    // reader is most likely to think is fine. Not all of them can cross JSON:
    // `undefined` reaches here only from a store that returns nothing, and that
    // is on purpose, because the property under test is the comparison and not
    // the transport.
    for (const saved of [false, null, undefined, 0, '', 'true', 1, {}, { ok: true }, []]) {
      const storage = uploads();
      let recorded = null;
      const provider = createProviders(config,
        { async fileRecord(input) { recorded = input; return saved; } }, storage.fetcher);

      await assert.rejects(() => provider(operation, params, ctx), uncertain,
        `a receipt of ${JSON.stringify(saved) ?? 'undefined'} must not yield a handle`);

      // The bytes DID land, which is why this is an uncertain receipt rather
      // than a failed upload, and why the refusal is 503 rather than a 4xx: the
      // caller must retry or reconcile, not assume nothing happened.
      assert.equal(storage.writes(), 1);
      // And the row the database declined to acknowledge is the right one, so a
      // future change cannot satisfy this test by sending a malformed receipt.
      assert.equal(recorded.p_id, jobId);
      assert.equal(recorded.p_object_path, objectPath);
      assert.equal(recorded.p_subject, subject);
    }
  });

  test(`${operation} returns the handle when the receipt is acknowledged`, async () => {
    // The control, and it is not decoration: without it every assertion above
    // would be satisfied by a provider that refuses this operation outright.
    const storage = uploads();
    const provider = createProviders(config, { async fileRecord() { return true; } }, storage.fetcher);
    const result = await provider(operation, params, ctx);
    assert.deepEqual(result, { file_uri: `cmfile:${jobId}`, size_bytes: 15, private: true });
    assert.equal(storage.writes(), 1);
  });
}
