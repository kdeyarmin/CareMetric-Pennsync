import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const ROOT = new URL('../', import.meta.url);
const DORMANT = {
  generateSignerToken: 'PUBLIC_SIGNATURE_RELEASE_ENABLED',
  validateSignerToken: 'PUBLIC_SIGNATURE_RELEASE_ENABLED',
  submitSignerSignature: 'PUBLIC_SIGNATURE_RELEASE_ENABLED',
  scheduleSignatureReminders: 'SIGNATURE_REMINDER_RELEASE_ENABLED',
  dispatchScheduledSignatureReminders: 'SIGNATURE_REMINDER_DISPATCH_ENABLED',
};

async function source(name) {
  return readFile(new URL(`functions/${name}/entry.ts`, ROOT), 'utf8');
}

test('all rebuilt signature brokers execute an early no-store 503 without parsing or SDK access', async () => {
  for (const [name, marker] of Object.entries(DORMANT)) {
    let input = await source(name);
    assert.match(input, new RegExp(`const ${marker} = false;`));
    assert.match(input, /npm:\@base44\/sdk\@0\.8\.46/);
    input = input.replace(
      /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
      'const createClientFromRequest = globalThis.__signatureCreateClient;',
    );
    let handler;
    let clientCalls = 0;
    globalThis.__signatureCreateClient = () => { clientCalls += 1; throw new Error('SDK must not run'); };
    globalThis.Deno = {
      serve: (candidate) => { handler = candidate; },
      env: { get: () => { throw new Error('environment must not be read'); } },
    };
    const compiled = transpileTs(input, { fileName: `${name}/entry.ts` }).outputText;
    await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${name}`);
    assert.equal(typeof handler, 'function');
    const hostileRequest = {
      method: 'POST', headers: new Headers(),
      text: () => { throw new Error('body parsed'); },
      formData: () => { throw new Error('body parsed'); },
      json: () => { throw new Error('body parsed'); },
      arrayBuffer: () => { throw new Error('body parsed'); },
    };
    const response = await handler(hostileRequest);
    assert.equal(response.status, 503, name);
    assert.equal(response.headers.get('cache-control'), 'no-store', name);
    assert.equal(response.headers.get('pragma'), 'no-cache', name);
    assert.equal(clientCalls, 0, name);
  }
  delete globalThis.__signatureCreateClient;
  delete globalThis.Deno;
});
test('token, review, signature, and delivery code retains fail-closed security invariants', async () => {
  const issuer = await source('generateSignerToken');
  assert.match(issuer, /token:\s*tokenDigest,\s*token_hashed:\s*true/);
  assert.match(issuer, /status:\s*'delivery_pending'/);
  assert.match(issuer, /integrations\.Core\.SendEmail/);
  assert.match(issuer, /token_issue_claimed_by/);
  assert.doesNotMatch(issuer, /success:\s*true,\s*token:\s*plaintext/);

  const validator = await source('validateSignerToken');
  assert.match(validator, /\{ token:\s*tokenDigest, token_hashed:\s*true \}/);
  assert.match(validator, /SignerReviewGrant\.create/);
  assert.match(validator, /package_authority_version/);
  assert.match(validator, /signer_roster_sha256/);
  assert.match(validator, /CreateFileSignedUrl/);
  assert.match(validator, /SIGNED_URL_TTL_SECONDS = 60/);

  const submit = await source('submitSignerSignature');
  assert.match(submit, /claimed_by_operation_id/);
  assert.match(submit, /claimed_document_id/);
  assert.match(submit, /UploadPrivateFile/);
  assert.match(submit, /SignatureArtifactBinding\.create/);
  assert.match(submit, /typed_name_hmac_sha256/);
  assert.match(submit, /status:\s*'in_progress', workflow_status:\s*allRequiredSigned \? 'signatures_collected'/);
  assert.match(submit, /finalizeRecordedSignature/);
  assert.match(submit, /requires_reconciliation/);
  assert.doesNotMatch(submit, /signed_pdf_url\s*:/);
});

test('signature authority entities are browser-denied and carry immutable snapshot fields', async () => {
  const required = {
    DocumentSignature: ['agency_id', 'created_by_user_id', 'creator_membership_id', 'document_binding_id', 'document_content_sha256', 'authority_version'],
    DocumentPackage: ['agency_id', 'created_by_user_id', 'creator_membership_id', 'signer_id', 'authority_version'],
    DocumentPackageToken: ['agency_id', 'signer_id', 'token_hashed', 'authority_version', 'claimed_by_operation_id', 'claimed_document_id'],
    ScheduledSignatureReminder: ['agency_id', 'package_id', 'signer_id', 'schedule_key', 'authority_version', 'delivery_state'],
    SignerReviewGrant: ['package_authority_version', 'document_authority_version', 'document_binding_id', 'signer_roster_sha256', 'agreement_text_sha256'],
    SignatureArtifactBinding: ['file_uri', 'content_sha256', 'source_document_sha256', 'typed_name_hmac_sha256', 'agreement_text_sha256'],
    SignatureAuditEvent: ['event_key', 'agency_id', 'action', 'actor_type', 'request_id'],
  };
  for (const [name, fields] of Object.entries(required)) {
    const entity = JSON5.parse(await readFile(new URL(`entities/${name}.jsonc`, ROOT), 'utf8'));
    assert.deepEqual(entity.rls, { read: false, create: false, update: false, delete: false }, name);
    for (const field of fields) assert.ok(entity.properties[field], `${name}.${field}`);
  }
});

test('the function-level 15-minute automation is explicit and inactive', async () => {
  const config = JSON5.parse(await readFile(
    new URL('functions/dispatchScheduledSignatureReminders/function.jsonc', ROOT), 'utf8',
  ));
  assert.equal(config.name, 'dispatchScheduledSignatureReminders');
  assert.equal(config.entry, 'entry.ts');
  assert.equal(config.automations.length, 1);
  assert.deepEqual(config.automations[0].function_args, {});
  assert.equal(config.automations[0].schedule_mode, 'recurring');
  assert.equal(config.automations[0].schedule_type, 'simple');
  assert.equal(config.automations[0].repeat_unit, 'minutes');
  assert.equal(config.automations[0].repeat_interval, 15);
  assert.equal(config.automations[0].ends_type, 'never');
  assert.equal(config.automations[0].is_active, false);
});
