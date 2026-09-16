import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders } from './providers.mjs';
import { BUCKET } from './runtime.mjs';

// Synthetic fixed destinations and injected HTTP/store; no credentials or I/O.
const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const appId = '694ec16e72e01b60d22f7cbf';
const subject = 'b'.repeat(64);
const objectPath = `${appId}/${subject}/${id}`;
const config = { appId, supabaseUrl: 'https://xsqobvvreaovwibxwyvv.supabase.co', supabaseKey: 'synthetic' };

for (const variant of [`cmfile:${id}`, `cmfile:${id.toUpperCase()}`, `CMFILE:${id.toUpperCase()}`]) {
  test(`private signing canonicalizes ${variant} before owned row and object lookup`, async () => {
    let reads = 0, requests = 0;
    const store = { async fileGet(input) {
      reads++;
      assert.deepEqual(input, { p_id: id, p_app_id: appId, p_subject: subject });
      return { id, app_id: appId, subject, object_path: objectPath, size_bytes: 10, sha256: 'c'.repeat(64) };
    } };
    const provider = createProviders(config, store, async (url, options) => {
      requests++;
      assert.equal(url, `${config.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${objectPath}`);
      assert.deepEqual(JSON.parse(options.body), { expiresIn: 60 });
      return Response.json({ signedURL: `/object/sign/${BUCKET}/${objectPath}?token=synthetic` });
    });
    const result = await provider('CreateFileSignedUrl', { file_uri: variant }, { subject });
    assert.equal(result.signed_url, `${config.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${objectPath}?token=synthetic`);
    assert.equal(result.expires_in, 60); assert.equal(reads, 1); assert.equal(requests, 1);
  });
}

test('canonicalizing case never relaxes subject or exact storage-path authority', async () => {
  for (const patch of [{ subject: 'd'.repeat(64) }, { object_path: objectPath.replace(id, id.toUpperCase()) }]) {
    const provider = createProviders(config, { async fileGet() {
      return { id, app_id: appId, subject, object_path: objectPath, size_bytes: 10, sha256: 'c'.repeat(64), ...patch };
    } }, () => assert.fail('must not sign a mismatched owner or storage path'));
    await assert.rejects(() => provider('CreateFileSignedUrl', { file_uri: `cmfile:${id.toUpperCase()}` }, { subject }),
      error => error.status === 403 && error.code === 'FILE_ACCESS_DENIED');
  }
});
