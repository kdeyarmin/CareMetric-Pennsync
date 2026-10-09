import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const ROOT = new URL('../', import.meta.url);
const RELEASED = [
  'generateSignerToken',
  'validateSignerToken',
  'submitSignerSignature',
  'scheduleSignatureReminders',
  'dispatchScheduledSignatureReminders',
];

async function source(name) {
  return readFile(new URL(`functions/${name}/entry.ts`, ROOT), 'utf8');
}

// Released 2026-10-08 (owner decision). The release markers are gone; what is
// pinned now is that every broker refuses an unauthenticated or malformed
// caller before it reads, writes, mints, uploads or sends anything. The staff
// brokers get a WELL-FORMED body, so the refusal has to come from the
// authentication decision itself rather than from input validation; the two
// public brokers get a malformed bearer, which is all an outsider can send.
const SEND_AT = new Date(Date.now() + 3_600_000).toISOString();
const ANONYMOUS_BODIES = {
  generateSignerToken: { agency_id: 'agency-1', package_id: 'package-1', signer_id: 'signer-1', request_id: 'request-1' },
  validateSignerToken: { token: 'not-a-signing-link' },
  submitSignerSignature: { token: 'not-a-signing-link' },
  scheduleSignatureReminders: {
    agency_id: 'agency-1', package_id: 'package-1', signer_id: 'signer-1', document_id: 'document-1',
    send_at: SEND_AT, client_request_id: 'request-1',
  },
  dispatchScheduledSignatureReminders: {},
};

test('released signature brokers refuse anonymous callers before any record or provider access', async () => {
  for (const name of RELEASED) {
    let input = await source(name);
    assert.doesNotMatch(input, /const (?:PUBLIC_SIGNATURE_RELEASE_ENABLED|SIGNATURE_REMINDER_RELEASE_ENABLED|SIGNATURE_REMINDER_DISPATCH_ENABLED) = false;/, name);
    assert.match(input, /npm:\@base44\/sdk\@0\.8\.46/);
    input = input
      .replace(/import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
        'const createClientFromRequest = globalThis.__signatureCreateClient; const fetch = () => { throw new Error("network"); };')
      .replace(/import \{ PDFDocument, StandardFonts, rgb \} from 'npm:pdf-lib@[^']+';/,
        'const PDFDocument = null; const StandardFonts = {}; const rgb = () => null;');
    let handler;
    const touched = [];
    const trap = new Proxy({}, { get: (_, entity) => new Proxy({}, {
      get: (_, operation) => () => { touched.push(`${String(entity)}.${String(operation)}`); throw new Error('record access'); },
    }) });
    const integrations = new Proxy({}, { get: () => new Proxy({}, {
      get: (_, operation) => () => { touched.push(`integration.${String(operation)}`); throw new Error('provider access'); },
    }) });
    globalThis.__signatureCreateClient = () => ({
      auth: { me: async () => null },
      entities: trap,
      asServiceRole: { entities: trap, integrations },
    });
    globalThis.Deno = {
      serve: (candidate) => { handler = candidate; },
      env: { get: (key) => (key === 'INTERNAL_FN_SECRET' ? 'synthetic-secret' : undefined) },
    };
    const compiled = transpileTs(input, { fileName: `${name}/entry.ts` }).outputText;
    await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${name}`);
    assert.equal(typeof handler, 'function');
    const response = await handler(new Request(`https://example.test/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ANONYMOUS_BODIES[name]),
    }));
    assert.ok(response.status >= 400 && response.status < 500, `${name} answered ${response.status}`);
    assert.deepEqual(touched, [], `${name} touched ${touched.join(', ')}`);
    assert.equal(response.headers.get('cache-control'), 'no-store', name);
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
  // Chart access and the delivery release are decided before any token write.
  const chartCheck = issuer.indexOf('await assertIssuerChartAccess(');
  const deliveryGate = issuer.indexOf('if (!outboundDeliveryReleased())');
  const firstTokenWrite = issuer.indexOf('DocumentPackageToken.create(');
  assert.ok(chartCheck > 0 && chartCheck < deliveryGate && deliveryGate < firstTokenWrite);
  // The recipient comes from the stored package, never from the request body.
  assert.match(issuer, /to: finalPackage\.package\.signer_email/);

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

test('signature reminder scheduling requires exact requester membership and audit-before-dispatch', async () => {
  const scheduler = await source('scheduleSignatureReminders');
  assert.match(scheduler, /Platform ownership is not tenant membership/);
  // Chart access to the package's patient is re-proved before a reminder row
  // exists (and again by the dispatcher at send time).
  const chartIndex = scheduler.indexOf('await assertRequesterChartAccess(');
  assert.ok(chartIndex > 0 && chartIndex < scheduler.indexOf('await createReminderOnce('));
  assert.match(scheduler, /\{ agency_id: agencyId, user_id: userId \}/);
  assert.doesNotMatch(scheduler, /authority\.membership\?\.id\s*\?\?/);
  assert.doesNotMatch(scheduler, /authority\.membership\?\.version\s*\?\?/);
  assert.match(scheduler, /status:\s*'pending_audit'/);
  assert.match(scheduler, /ensureScheduleAudit/);
  const pendingAuditIndex = scheduler.indexOf("status: 'pending_audit'");
  const auditIndex = scheduler.indexOf('const event = await ensureScheduleAudit', pendingAuditIndex);
  const activationIndex = scheduler.indexOf("status: 'pending'", auditIndex);
  assert.ok(pendingAuditIndex >= 0 && pendingAuditIndex < auditIndex && auditIndex < activationIndex);
  assert.match(scheduler, /audit_event_id:\s*event\.id/);
  assert.match(scheduler, /audit_confirmed_at:\s*auditConfirmedAt/);
  assert.match(scheduler, /const authorizedInput = \{ \.\.\.input, deadline: target\.deadline \}/);
  assert.match(scheduler, /deadline_date:\s*target\.deadline/);
  assert.doesNotMatch(scheduler, /deadline:\s*record\.deadline_date/);
  assert.match(scheduler, /deriveAuthorityDeadline\(pkg, authoritySignatures\)/);

  const entity = JSON5.parse(await readFile(
    new URL('entities/ScheduledSignatureReminder.jsonc', ROOT), 'utf8',
  ));
  assert.ok(entity.properties.status.enum.includes('pending_audit'));
  assert.equal(entity.properties.status.default, 'pending_audit');
  assert.ok(entity.properties.audit_event_id);
  assert.ok(entity.properties.audit_confirmed_at);
});

test('stale sending reminders become indeterminate and can never be auto-resent', async () => {
  const dispatcher = await source('dispatchScheduledSignatureReminders');
  assert.match(dispatcher, /if \(!await schedulerAuthorized\(req, user\)\)/);
  assert.match(dispatcher, /requesterRetainsChartAccess\(entities, reminder\.agencyId, patientId, requesterMembership\)/);
  assert.ok(dispatcher.indexOf('if (!outboundDeliveryReleased())') < dispatcher.indexOf('integrations.Core.SendEmail'));
  assert.match(dispatcher, /quarantineStaleReminderClaims/);
  assert.match(dispatcher, /\{ status: 'sending', delivery_state: 'pending' \}/);
  assert.match(dispatcher, /status:\s*'indeterminate'/);
  assert.match(dispatcher, /delivery_state:\s*'indeterminate'/);
  assert.match(dispatcher, /automatic resend is blocked/);
  assert.match(dispatcher, /stale_indeterminate:\s*staleIndeterminate/);
  assert.match(dispatcher, /!auditEventId/);
  assert.match(dispatcher, /Signature reminder schedule audit is invalid/);
  assert.match(dispatcher, /event_key:\s*scheduleEventKey/);
  assert.match(dispatcher, /scheduleAudit\.membership_id !== reminder\.membershipId/);
  assert.match(dispatcher, /quarantinePendingReminder/);
  assert.match(dispatcher, /quarantineDuplicateReminderKey/);
  assert.match(dispatcher, /const postClaimDuplicates/);
  assert.match(dispatcher, /reminder\.deadline_date !== deadline/);
  assert.match(dispatcher, /Date\.parse\(target\.deadline\)/);
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

test('the native 15-minute reminder workflow is exact and has no legacy function automation', async () => {
  const workflow = JSON5.parse(await readFile(
    new URL('workflows/Dispatch Scheduled Signature Reminders.jsonc', ROOT), 'utf8',
  ));
  assert.equal(workflow.name, 'Dispatch Scheduled Signature Reminders');
  assert.equal(
    workflow.definition?.do?.[0]?.run_function?.with?.function_name,
    'dispatchScheduledSignatureReminders',
  );
  assert.deepEqual(workflow.definition?.do?.[0]?.run_function?.with?.args, {});
  assert.equal(workflow.trigger?.config?.trigger_type, 'scheduled');
  assert.equal(workflow.trigger?.config?.schedule_mode, 'interval');
  assert.equal(workflow.trigger?.config?.interval_unit, 'minutes');
  assert.equal(workflow.trigger?.config?.interval_value, 15);
  assert.equal(workflow.trigger?.config?.ends_type, 'never');
  await assert.rejects(
    readFile(new URL('functions/dispatchScheduledSignatureReminders/function.jsonc', ROOT), 'utf8'),
    (error) => error?.code === 'ENOENT',
  );
});
