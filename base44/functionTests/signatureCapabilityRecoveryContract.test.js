import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const token = 't'.repeat(43);
const agreement = 'Synthetic test consent only. This is not the production consent policy.';
const privateUri = 'mp/private/694ec16e72e01b60d22f7cbf/synthetic/source.pdf';
const clone = (value) => structuredClone(value);

async function fixture(options = {}) {
  const now = Date.now();
  const signer = { signer_id: 'signer-1', signer_name: 'Synthetic Signer', signer_role: 'patient',
    email: 'synthetic@example.test', required: true, status: 'pending' };
  const db = {
    DocumentPackageToken: [{ id: 'token-1', token: hash(token), token_hashed: true,
      agency_id: 'agency-1', package_id: 'package-1', signer_id: signer.signer_id,
      signer_email: signer.email, signer_name: signer.signer_name, document_ids: ['signature-1'],
      status: 'active', is_active: true, authority_version: 1, access_count: 0,
      token_request_id: 'issue-1', token_created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 3600_000).toISOString(),
      ...options.token }],
    DocumentPackage: [{ id: 'package-1', agency_id: 'agency-1', patient_id: 'patient-1',
      created_by_user_id: 'creator-1', created_by_user_email_normalized: 'creator@example.test',
      creator_membership_id: 'membership-1', creator_membership_version: 1,
      signer_id: signer.signer_id, signer_email: signer.email, document_signatures: ['signature-1'],
      status: 'pending', authority_version: 1,
      due_date: new Date(now + 86_400_000).toISOString().slice(0, 10), ...options.package }],
    Agency: [{ id: 'agency-1', status: 'active' }],
    AgencyMembership: [{ id: 'membership-1', agency_id: 'agency-1', user_id: 'creator-1',
      user_email_normalized: 'creator@example.test', status: 'active', version: 1 }],
    Patient: [{ id: 'patient-1', agency_id: 'agency-1', is_sample: false, is_archived: false }],
    DocumentSignature: [{ id: 'signature-1', agency_id: 'agency-1', patient_id: 'patient-1',
      created_by_user_id: 'creator-1', created_by_user_email_normalized: 'creator@example.test',
      creator_membership_id: 'membership-1', creator_membership_version: 1,
      document_binding_id: 'binding-1', document_id: 'document-1', document_binding_version: 2,
      document_content_sha256: hash('synthetic source'), authority_version: 1,
      status: 'pending', workflow_status: 'pending', signers: [signer], ...options.signature }],
    DocumentTenantBinding: [{ id: 'binding-1', agency_id: 'agency-1', patient_id: 'patient-1',
      document_id: 'document-1', storage_mode: 'private', version: 2,
      content_sha256: hash('synthetic source'), file_uri: privateUri }],
    SignerReviewGrant: [], SignatureArtifactBinding: [], SignatureAuditEvent: [],
  };
  const calls = { signedUrls: 0, uploads: 0 };
  const matches = (row, query) => Object.entries(query).every(([key, value]) =>
    value == null ? row[key] == null : JSON.stringify(row[key]) === JSON.stringify(value));
  const entities = Object.fromEntries(Object.entries(db).map(([name, rows]) => [name, {
    filter: async (query) => clone(rows.filter((row) => matches(row, query))),
    create: async (data) => {
      const row = { ...clone(data), id: `${name}-${rows.length + 1}` };
      rows.push(row);
      await options.afterCreate?.(name, db, row);
      return clone(row);
    },
    updateMany: async (query, change) => {
      await options.beforeUpdate?.(name, db, query, change);
      const targets = rows.filter((row) => matches(row, query));
      for (const row of targets) Object.assign(row, clone(change.$set));
      await options.afterUpdate?.(name, db, query, change);
      return { success: true, updated: targets.length, has_more: false };
    },
  }]));
  const client = { asServiceRole: { entities, integrations: { Core: {
    CreateFileSignedUrl: async () => { calls.signedUrls += 1; return { signed_url: 'https://storage.example.test/private-test' }; },
    UploadPrivateFile: async () => {
      calls.uploads += 1;
      await options.onUpload?.(db);
      return { file_uri: privateUri.replace('source.pdf', 'signature.png') };
    },
  } } } };
  async function load(name) {
    let handler;
    globalThis.__signatureRecoveryClient = () => client;
    globalThis.__signatureRecoveryDeno = { serve: (candidate) => { handler = candidate; }, env: { get: (key) => ({
      SIGNATURE_AGREEMENT_TEXT: agreement, SIGNATURE_AGREEMENT_SHA256: hash(agreement),
      SIGNATURE_HMAC_SECRET: 'synthetic-hmac-key-not-for-production-12345',
    })[key] } };
    let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
    source = source.replace(/import \{ createClientFromRequest \} from 'npm:[^']+';/,
      'const createClientFromRequest = globalThis.__signatureRecoveryClient; const Deno = globalThis.__signatureRecoveryDeno;')
      .replace('const PUBLIC_SIGNATURE_RELEASE_ENABLED = false;', 'const PUBLIC_SIGNATURE_RELEASE_ENABLED = true;');
    const compiled = transpileTs(source, { fileName: `${name}/entry.ts` }).outputText;
    await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${crypto.randomUUID()}`);
    delete globalThis.__signatureRecoveryClient;
    delete globalThis.__signatureRecoveryDeno;
    return handler;
  }
  const validate = await load('validateSignerToken');
  const submit = await load('submitSignerSignature');
  const review = () => validate(new Request('https://example.test/review', { method: 'POST', body: JSON.stringify({ token }) }));
  const sign = (nonce, requestId = 'submission-1') => {
    // Parser fixture with its required PNG boundary bytes; no provider is invoked.
    const bytes = new Uint8Array(100);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 69, 78, 68, 174, 66, 96, 130], 92);
    const form = new FormData();
    for (const [key, value] of Object.entries({ token, review_nonce: nonce, document_id: 'signature-1',
      typed_name: signer.signer_name, agreement_version: 'signature-consent-v1', client_request_id: requestId })) form.set(key, value);
    form.set('signature_file', new File([bytes], 'synthetic.png', { type: 'image/png' }));
    return submit(new Request('https://example.test/sign', { method: 'POST', body: form }));
  };
  return { db, calls, review, sign };
}

test('review permits the twentieth access and refuses further grants or signed URLs', async () => {
  const f = await fixture({ token: { access_count: 19 } });
  assert.equal((await f.review()).status, 200);
  assert.equal(f.db.DocumentPackageToken[0].access_count, 20);
  assert.equal((await f.review()).status, 429);
  assert.equal(f.db.SignerReviewGrant.length, 1);
  assert.equal(f.calls.signedUrls, 1);
});

test('concurrent last accesses produce at most one grant and one review response', async () => {
  const f = await fixture({ token: { access_count: 19 } });
  const responses = await Promise.all([f.review(), f.review()]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(f.db.DocumentPackageToken[0].access_count, 20);
  assert.equal(f.db.SignerReviewGrant.length, 1);
  assert.equal(f.calls.signedUrls, 1);
});

test('lost access acknowledgement consumes the attempt without issuing grants', async () => {
  const f = await fixture({ afterUpdate: (name) => {
    if (name === 'DocumentPackageToken') throw new Error('lost acknowledgement');
  } });
  assert.equal((await f.review()).status, 500);
  assert.equal(f.db.DocumentPackageToken[0].access_count, 1);
  assert.equal(f.db.SignerReviewGrant.length, 0);
  assert.equal(f.calls.signedUrls, 0);
});

test('review rejects shortened deadlines and impossible dates before access writes', async () => {
  for (const options of [
    { package: { due_date: '2099-02-30' } },
    { signature: { expires_at: new Date(Date.now() + 60_000).toISOString() } },
    { signature: { expiration_date: new Date(Date.now() - 60_000).toISOString() } },
  ]) {
    const f = await fixture(options);
    assert.equal((await f.review()).status, 401);
    assert.equal(f.db.DocumentPackageToken[0].access_count, 0);
    assert.equal(f.calls.signedUrls, 0);
  }
});

test('signature capture accepts hosted private URIs and an exact replay never reuploads', async () => {
  const f = await fixture();
  const review = await (await f.review()).json();
  const first = await f.sign(review.documents[0].review_nonce);
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
  assert.equal((await first.json()).document_completed, false);
  const second = await f.sign(review.documents[0].review_nonce);
  assert.equal(second.status, 200, JSON.stringify(await second.clone().json()));
  assert.equal((await second.json()).idempotent, true);
  assert.equal(f.calls.uploads, 1);
  assert.equal(f.db.SignatureArtifactBinding.length, 1);
  assert.equal(f.db.DocumentPackageToken[0].submission_upload_operation_id, null);
});

test('deadline shortening after review prevents upload', async () => {
  const f = await fixture();
  const review = await (await f.review()).json();
  f.db.DocumentSignature[0].expires_at = new Date(Date.now() + 60_000).toISOString();
  assert.equal((await f.sign(review.documents[0].review_nonce)).status, 401);
  assert.equal(f.calls.uploads, 0);
});

test('claim takeover during audit is fenced before private upload', async () => {
  const f = await fixture({ afterCreate: (name, db, row) => {
    if (name === 'SignatureAuditEvent' && row.action === 'review_grant_claimed') {
      db.DocumentPackageToken[0].claimed_by_operation_id = 'new-owner';
      db.DocumentPackageToken[0].authority_version += 1;
    }
  } });
  const review = await (await f.review()).json();
  assert.equal((await f.sign(review.documents[0].review_nonce)).status, 409);
  assert.equal(f.calls.uploads, 0);
  assert.equal(f.db.DocumentPackageToken[0].claimed_by_operation_id, 'new-owner');
});

test('an uncertain upload keeps its durable fence and stale retry cannot reupload', async () => {
  const f = await fixture({ onUpload: () => { throw new Error('lost storage acknowledgement'); } });
  const review = await (await f.review()).json();
  const first = await f.sign(review.documents[0].review_nonce);
  assert.equal(first.status, 202);
  assert.equal((await first.json()).requires_reconciliation, true);
  assert.ok(f.db.DocumentPackageToken[0].submission_upload_operation_id);
  for (const row of [f.db.DocumentPackageToken[0], f.db.SignerReviewGrant[0]]) {
    row.claimed_at = new Date(Date.now() - 600_000).toISOString();
  }
  assert.equal((await f.sign(review.documents[0].review_nonce)).status, 202);
  assert.equal(f.calls.uploads, 1);
  assert.equal(f.db.SignatureArtifactBinding.length, 0);
});

test('lost upload-start acknowledgement retains the fence without uploading', async () => {
  const f = await fixture({ afterUpdate: (name, _db, _query, change) => {
    if (name === 'DocumentPackageToken' && change.$set.submission_upload_operation_id) throw new Error('lost marker acknowledgement');
  } });
  const review = await (await f.review()).json();
  assert.equal((await f.sign(review.documents[0].review_nonce)).status, 202);
  assert.equal(f.calls.uploads, 0);
  assert.ok(f.db.DocumentPackageToken[0].submission_upload_operation_id);
});

test('lost artifact acknowledgement recovers the saved artifact without a second upload', async () => {
  let loseAcknowledgement = true;
  const f = await fixture({ afterCreate: (name) => {
    if (name === 'SignatureArtifactBinding' && loseAcknowledgement) {
      loseAcknowledgement = false;
      throw new Error('lost artifact acknowledgement');
    }
  } });
  const review = await (await f.review()).json();
  assert.equal((await f.sign(review.documents[0].review_nonce)).status, 202);
  assert.equal(f.db.SignatureArtifactBinding.length, 1);
  const retry = await f.sign(review.documents[0].review_nonce);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).idempotent, true);
  assert.equal(f.calls.uploads, 1);
});

test('membership revocation during storage prevents recording a signature artifact', async () => {
  const f = await fixture({ onUpload: (db) => { db.AgencyMembership[0].status = 'revoked'; } });
  const review = await (await f.review()).json();
  assert.equal((await f.sign(review.documents[0].review_nonce)).status, 202);
  assert.equal(f.calls.uploads, 1);
  assert.equal(f.db.SignatureArtifactBinding.length, 0);
  assert.ok(f.db.DocumentPackageToken[0].submission_upload_operation_id);
});

test('an exact completed retry after expiration returns its recorded result', async () => {
  const f = await fixture();
  const review = await (await f.review()).json();
  assert.equal((await f.sign(review.documents[0].review_nonce)).status, 200);
  const past = new Date(Date.now() - 60_000).toISOString();
  f.db.DocumentPackageToken[0].expires_at = past;
  f.db.SignerReviewGrant[0].expires_at = past;
  f.db.DocumentSignature[0].expires_at = past;
  const response = await f.sign(review.documents[0].review_nonce);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).idempotent, true);
  assert.equal(f.calls.uploads, 1);
});
