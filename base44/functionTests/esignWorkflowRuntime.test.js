// End-to-end runtime proof of the released e-signature workflow: request
// creation by chart access, single-purpose hashed links, signer review,
// signature capture, sealing into a hashed chart PDF, reminders, cancel, the
// in-person path and the discharge-summary clinician signature — plus the
// refusals that keep each step safe. Everything runs against the real
// function source with an in-memory store (esignRuntimeHarness.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGREEMENT_TEXT, createHarness, linkTokenFrom, pdfBytes, pngBytes, sha256Hex,
} from './esignRuntimeHarness.js';

const AGENCY = 'agency-1';
const OTHER_AGENCY = 'agency-2';
const PATIENT = 'patient-1';
const dueDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

function world(options = {}) {
  const h = createHarness(options);
  h.seed('Agency', { id: AGENCY, status: 'active', agency_name: 'Synthetic Home Health' });
  h.seed('Agency', { id: OTHER_AGENCY, status: 'active', agency_name: 'Other Agency' });
  h.addUser('nurse');
  h.addUser('admin');
  h.addUser('stranger');
  h.addUser('office');
  h.addUser('outsider');
  h.addUser('creator');
  h.membership('nurse', AGENCY, 'clinician');
  h.membership('admin', AGENCY, 'agency_admin');
  h.membership('stranger', AGENCY, 'clinician');
  h.membership('office', AGENCY, 'office_staff');
  h.membership('outsider', OTHER_AGENCY, 'agency_admin');
  h.membership('creator', AGENCY, 'clinician');
  h.seed('Patient', { id: PATIENT, agency_id: AGENCY, is_sample: false, is_archived: false,
    first_name: 'Pat', last_name: 'Example', email: 'pat@example.test',
    caregiver_name: 'Cara Giver', caregiver_email: 'cara@example.test', created_by_user_id: 'creator' });
  h.seed('PatientCareTeamAssignment', { id: 'assign-1', agency_id: AGENCY, patient_id: PATIENT,
    user_id: 'nurse', status: 'active' });
  h.chartDocument({ id: 'doc-1', agencyId: AGENCY, patientId: PATIENT, creatorKey: 'nurse' });
  return h;
}

const SIGNERS = [
  { name: 'Pat Example', email: 'pat@example.test', role: 'patient' },
  { name: 'Cara Giver', email: 'cara@example.test', role: 'caregiver' },
];

function createBody(extra = {}) {
  return {
    agency_id: AGENCY, patient_id: PATIENT, document_ids: ['doc-1'], signers: SIGNERS,
    package_name: 'Admission consent', document_type: 'consent', due_date: dueDate,
    client_request_id: 'request-1',
    signature_fields: [
      { document_id: 'doc-1', signer_index: 0, type: 'signature', page: 2, x: 10, y: 80, width: 30, height: 6 },
      { document_id: 'doc-1', signer_index: 1, type: 'signature', page: 2, x: 55, y: 80, width: 30, height: 6 },
      { document_id: 'doc-1', signer_index: 0, type: 'date', page: 2, x: 10, y: 88, width: 15, height: 3 },
    ],
    ...extra,
  };
}

async function createRequest(h, user = 'nurse', extra = {}) {
  return h.call('bulkCreateDocumentPackages', { user, body: createBody(extra) });
}

async function issueLinks(h, request, user = 'nurse') {
  const tokens = {};
  for (const pkg of request.packages) {
    const sent = await h.call('generateSignerToken', { user, body: {
      agency_id: AGENCY, package_id: pkg.id, signer_id: pkg.signer_id, request_id: `issue-${pkg.id}`,
    } });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    const email = h.emails.at(-1);
    assert.equal(email.to, pkg.signer_email);
    tokens[pkg.signer_email] = linkTokenFrom(email);
    assert.ok(tokens[pkg.signer_email], 'the email carries the signing link');
  }
  return tokens;
}

async function signAs(h, token, name, requestId = `submit-${name}`) {
  const review = await h.call('validateSignerToken', { body: { token } });
  assert.equal(review.status, 200, JSON.stringify(review.data));
  const pending = review.data.documents.find((doc) => doc.status === 'pending');
  const submitted = await h.call('submitSignerSignature', { form: {
    token, review_nonce: pending.review_nonce, document_id: pending.id, typed_name: name,
    agreement_version: review.data.agreement.version, client_request_id: requestId,
    signature_file: new File([pngBytes(name.length)], 'signature.png', { type: 'image/png' }),
  } });
  return { review, submitted };
}

test('a care-team clinician creates a request that binds the exact chart document and signer roster', async () => {
  const h = world();
  const created = await createRequest(h);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { request } = created.data;
  assert.equal(request.documents.length, 1);
  assert.equal(request.packages.length, 2);
  const row = h.db.DocumentSignature[0];
  assert.equal(row.agency_id, AGENCY);
  assert.equal(row.document_binding_id, 'binding-doc-1');
  assert.equal(row.document_content_sha256, sha256Hex(pdfBytes('doc-1')));
  assert.equal(row.created_by_user_id, 'nurse');
  assert.equal(row.creator_membership_id, `membership-nurse-${AGENCY}`);
  assert.equal(row.document_url, undefined);
  assert.deepEqual(row.signers.map((signer) => signer.email), ['pat@example.test', 'cara@example.test']);
  assert.equal(row.signature_fields.length, 3);
  assert.ok(h.db.SignatureAuditEvent.some((event) => event.action === 'request_created'));

  const replay = await createRequest(h);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.created, false);
  assert.equal(h.db.DocumentSignature.length, 1, 'a retry never duplicates rows');
  assert.equal(h.db.DocumentPackage.length, 2);

  const conflict = await createRequest(h, 'nurse', { signers: [SIGNERS[0]], signature_fields: [] });
  assert.equal(conflict.status, 409, 'the same client_request_id cannot name a different roster');
});

test('request creation is decided by membership and chart access, never by profile fields', async () => {
  const h = world();
  h.users.get('stranger').agency_id = AGENCY;
  h.users.get('stranger').account_type = 'agency_admin';
  h.users.get('stranger').is_manager = true;
  const notOnTeam = await createRequest(h, 'stranger');
  assert.equal(notOnTeam.status, 404, 'a clinician off the care team cannot open the chart, whatever their profile says');
  const office = await createRequest(h, 'office');
  assert.equal(office.status, 403, 'office staff cannot create clinical documents');
  const outsider = await createRequest(h, 'outsider');
  assert.equal(outsider.status, 403, 'another agency has no membership here');
  const anonymous = await createRequest(h, null);
  assert.equal(anonymous.status, 401);
  const admin = await createRequest(h, 'admin', { client_request_id: 'admin-request' });
  assert.equal(admin.status, 201, 'an agency_admin opens every chart in the agency');
  assert.equal(h.db.DocumentSignature.length, 1);
});

test('links are hashed, single-purpose, and the review discloses only that signer\'s package', async () => {
  const h = world();
  const { request } = (await createRequest(h)).data;
  const tokens = await issueLinks(h, request);
  const token = tokens['pat@example.test'];
  assert.equal(h.db.DocumentPackageToken.length, 2);
  for (const row of h.db.DocumentPackageToken) {
    assert.equal(row.token_hashed, true);
    assert.notEqual(row.token, token, 'the plaintext link is never stored');
    assert.match(row.token, /^[a-f0-9]{64}$/);
    assert.ok(Date.parse(row.expires_at) <= Date.parse(`${dueDate}T23:59:59.999Z`));
  }
  const issuerResponse = await h.call('generateSignerToken', { user: 'nurse', body: {
    agency_id: AGENCY, package_id: request.packages[0].id, signer_id: request.packages[0].signer_id,
    request_id: `issue-${request.packages[0].id}`,
  } });
  assert.equal(issuerResponse.data.idempotent, true);
  assert.equal(JSON.stringify(issuerResponse.data).includes(token), false, 'the requester never sees the link');
  for (const detail of ['Admission consent', PATIENT, 'doc-1', 'Synthetic Home Health']) {
    assert.equal(h.emails[0].body.includes(detail), false, `the signer email does not carry ${detail}`);
  }

  const review = await h.call('validateSignerToken', { body: { token } });
  assert.equal(review.status, 200, JSON.stringify(review.data));
  assert.equal(review.data.signer_name, 'Pat Example');
  assert.equal(review.data.agreement.text, AGREEMENT_TEXT);
  assert.equal(review.data.documents.length, 1);
  assert.equal(review.data.documents[0].review_url.startsWith('https://storage.test/'), true);
  assert.equal(JSON.stringify(review.data).includes('cara@example.test'), false, 'no other signer is disclosed');
  assert.equal(JSON.stringify(review.data).includes(PATIENT), false);

  const bogus = await h.call('validateSignerToken', { body: { token: 'x'.repeat(43) } });
  assert.equal(bogus.status, 401);

  const strangerIssue = await h.call('generateSignerToken', { user: 'stranger', body: {
    agency_id: AGENCY, package_id: request.packages[0].id, signer_id: request.packages[0].signer_id, request_id: 'x-1',
  } });
  assert.equal(strangerIssue.status, 404, 'issuing a link requires chart access');
});

test('every signer signs, the last signature seals a hashed PDF into the chart and completes the request', async () => {
  const h = world();
  const { request } = (await createRequest(h)).data;
  const tokens = await issueLinks(h, request);
  const first = await signAs(h, tokens['pat@example.test'], 'Pat Example');
  assert.equal(first.submitted.status, 200, JSON.stringify(first.submitted.data));
  assert.equal(first.submitted.data.document_completed, false);
  assert.equal(h.db.DocumentSignature[0].workflow_status, 'partial');

  const wrongName = await h.call('submitSignerSignature', { form: {
    token: tokens['cara@example.test'],
    review_nonce: (await h.call('validateSignerToken', { body: { token: tokens['cara@example.test'] } }))
      .data.documents[0].review_nonce,
    document_id: request.documents[0].id, typed_name: 'Someone Else', agreement_version: 'signature-consent-v1',
    client_request_id: 'wrong-name', signature_file: new File([pngBytes(3)], 'signature.png', { type: 'image/png' }),
  } });
  assert.equal(wrongName.status, 400, 'the typed name must match the signer the request named');

  const second = await signAs(h, tokens['cara@example.test'], 'Cara Giver');
  assert.equal(second.submitted.status, 200, JSON.stringify(second.submitted.data));
  assert.equal(second.submitted.data.document_completed, true);

  const row = h.db.DocumentSignature[0];
  assert.equal(row.status, 'completed');
  assert.equal(row.workflow_status, 'completed');
  assert.match(row.signature_hash, /^[a-f0-9]{64}$/);
  const sealedBinding = h.db.DocumentTenantBinding.find((binding) => binding.id === row.signed_document_binding_id);
  assert.equal(sealedBinding.storage_mode, 'private');
  assert.equal(sealedBinding.version, 2);
  assert.equal(sealedBinding.patient_id, PATIENT);
  assert.equal(sealedBinding.created_by_user_id, 'nurse');
  assert.equal(sealedBinding.binding_key,
    sha256Hex(`${AGENCY}\0nurse\0${sealedBinding.client_request_id}`), 'chart readers accept the filing');
  const sealedBytes = h.storage.get(sealedBinding.file_uri);
  assert.equal(sha256Hex(sealedBytes), row.signature_hash, 'the recorded digest is the digest of the sealed bytes');
  const sealed = JSON.parse(new TextDecoder().decode(sealedBytes).split('\n').slice(3).join('\n'));
  assert.ok(sealed.ops.some((op) => op[0] === 'source' && op[1] === row.document_content_sha256),
    'the seal is rendered from the exact reviewed source bytes');
  assert.equal(sealed.ops.filter((op) => op[0] === 'image' && op[1] === 2).length, 2, 'both signatures land in their page-2 boxes');
  assert.ok(sealed.ops.some((op) => op[0] === 'text' && op[2] === 'Electronic Signature Certificate'));
  const document = h.db.Document.find((doc) => doc.id === row.signed_document_id);
  assert.equal(document.patient_id, PATIENT);
  assert.equal(document.file_url, undefined, 'no public URL is ever stored');
  assert.deepEqual(document.tags, ['patient_document']);
  assert.ok(h.db.DocumentPackage.every((pkg) => pkg.status === 'completed'));
  assert.ok(h.db.SignatureAuditEvent.some((event) => event.action === 'document_finalized'
    && event.artifact_content_sha256 === row.signature_hash));

  const notice = h.db.Notification.find((note) => note.dedupe_key === `esign-completed:${AGENCY}:${row.id}`);
  assert.equal(notice.recipient_user_id, 'nurse');
  assert.equal(notice.type, 'signature_request');
  const creatorEmail = h.emails.find((email) => email.to === 'nurse@agency.test');
  assert.ok(creatorEmail, 'the requester is emailed once');
  for (const phi of ['Pat', 'Example', 'Cara', PATIENT, 'Admission consent']) {
    assert.equal(creatorEmail.body.includes(phi), false, `the completion email does not carry ${phi}`);
  }

  const replay = await h.call('submitSignerSignature', { form: {
    token: tokens['cara@example.test'], review_nonce: second.review.data.documents[0].review_nonce,
    document_id: request.documents[0].id, typed_name: 'Cara Giver', agreement_version: 'signature-consent-v1',
    client_request_id: 'submit-Cara Giver',
    signature_file: new File([pngBytes('Cara Giver'.length)], 'signature.png', { type: 'image/png' }),
  } });
  assert.equal(replay.status, 200, JSON.stringify(replay.data));
  assert.equal(replay.data.idempotent, true, 'a lost response retried after sealing reconciles, never re-signs');
  assert.equal(h.db.SignatureArtifactBinding.length, 2);

  const integrity = await h.call('signatureIntegrity', { user: 'nurse', body: { agency_id: AGENCY, document_signature_id: row.id } });
  assert.equal(integrity.data.intact, true, JSON.stringify(integrity.data));
  const certificate = await h.call('generateSignatureCertificate', { user: 'nurse', body: { agency_id: AGENCY, document_signature_id: row.id } });
  assert.equal(certificate.status, 200, JSON.stringify(certificate.data));
  assert.match(certificate.data.pdf_base64, /^[A-Za-z0-9+/=]+$/);
  h.storage.set(sealedBinding.file_uri, new TextEncoder().encode('%PDF-tampered'));
  const tampered = await h.call('signatureIntegrity', { user: 'nurse', body: { agency_id: AGENCY, document_signature_id: row.id } });
  assert.equal(tampered.data.intact, false, 'changing one sealed byte is detected');
  assert.equal(tampered.data.checks.find((entry) => entry.name === 'sealed_document_bytes').ok, false);
});

test('a source that changed after review is never sealed; staff can seal once the bytes are restored', async () => {
  const h = world();
  const { request } = (await createRequest(h)).data;
  const tokens = await issueLinks(h, request);
  await signAs(h, tokens['pat@example.test'], 'Pat Example');
  const original = h.storage.get(`mp/private/694ec16e72e01b60d22f7cbf/doc-1`);
  h.storage.set('mp/private/694ec16e72e01b60d22f7cbf/doc-1', pdfBytes('altered'));
  const last = await signAs(h, tokens['cara@example.test'], 'Cara Giver');
  assert.equal(last.submitted.status, 200, 'the signature itself is still recorded');
  assert.equal(last.submitted.data.document_completed, false);
  assert.equal(h.db.DocumentSignature[0].workflow_status, 'signatures_collected');
  assert.equal(h.db.Document.length, 1, 'nothing was filed from altered bytes');

  h.storage.set('mp/private/694ec16e72e01b60d22f7cbf/doc-1', original);
  const stranger = await h.call('onDocumentSigned', { user: 'stranger', body: { agency_id: AGENCY, document_signature_id: request.documents[0].id } });
  assert.equal(stranger.status, 404);
  const sealed = await h.call('onDocumentSigned', { user: 'nurse', body: { agency_id: AGENCY, document_signature_id: request.documents[0].id } });
  assert.equal(sealed.status, 200, JSON.stringify(sealed.data));
  assert.equal(sealed.data.state, 'completed');
  const again = await h.call('archiveSignedDocument', { user: 'admin', body: { agency_id: AGENCY, document_signature_id: request.documents[0].id } });
  assert.equal(again.data.archived, true);
  assert.equal(again.data.signed_document_id, sealed.data.signed_document_id);
});

test('reminders rotate the link, the scheduler dispatches due reminders, and cancel revokes everything', async () => {
  const h = world();
  const { request } = (await createRequest(h)).data;
  const tokens = await issueLinks(h, request);
  const pkg = request.packages[0];
  const blocked = await h.call('generateSignerToken', { user: 'nurse', body: {
    agency_id: AGENCY, package_id: pkg.id, signer_id: pkg.signer_id, request_id: 'second-link',
  } });
  assert.equal(blocked.status, 409, 'a second live link is never minted without rotation');
  const reminder = await h.call('sendSignatureReminder', { user: 'nurse', body: {
    agency_id: AGENCY, package_id: pkg.id, signer_id: pkg.signer_id, request_id: 'reminder-1',
  } });
  assert.equal(reminder.status, 200, JSON.stringify(reminder.data));
  const old = await h.call('validateSignerToken', { body: { token: tokens['pat@example.test'] } });
  assert.equal(old.status, 401, 'the superseded link stops working');
  const fresh = linkTokenFrom(h.emails.at(-1));
  assert.equal((await h.call('validateSignerToken', { body: { token: fresh } })).status, 200);

  const scheduled = await h.call('scheduleSignatureReminders', { user: 'nurse', body: {
    agency_id: AGENCY, package_id: request.packages[1].id, signer_id: request.packages[1].signer_id,
    document_id: request.documents[0].id, send_at: new Date(Date.now() - 1000).toISOString(),
    client_request_id: 'auto-1',
  } });
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled.data));
  const unauthorizedDispatch = await h.call('dispatchScheduledSignatureReminders', { user: 'nurse' });
  assert.equal(unauthorizedDispatch.status, 403);
  const before = h.emails.length;
  const dispatch = await h.call('dispatchScheduledSignatureReminders', {
    headers: { 'x-internal-secret': 'synthetic-internal-secret' },
  });
  assert.equal(dispatch.status, 200, JSON.stringify(dispatch.data));
  assert.equal(dispatch.data.sent, 1);
  assert.equal(h.emails.length, before + 1);
  assert.equal(h.emails.at(-1).to, 'cara@example.test');

  const cancel = await h.call('manageSignatureRequests', { user: 'stranger', body: {
    action: 'cancel', agency_id: AGENCY, request_key: request.request_key,
  } });
  assert.equal(cancel.status, 404, 'cancel requires chart access');
  const cancelled = await h.call('manageSignatureRequests', { user: 'nurse', body: {
    action: 'cancel', agency_id: AGENCY, request_key: request.request_key, reason: 'Sent to the wrong address',
  } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(h.db.DocumentSignature[0].workflow_status, 'cancelled');
  // The cancellation lives on the documents; the carried package rows keep
  // their own enum and only have their authority version retired.
  assert.ok(h.db.DocumentPackage.every((row) => row.status !== 'completed' && row.authority_version > 1));
  assert.ok(h.db.DocumentPackageToken.every((row) => row.status !== 'active'));
  assert.equal((await h.call('validateSignerToken', { body: { token: fresh } })).status, 401);
  const relink = await h.call('generateSignerToken', { user: 'nurse', body: {
    agency_id: AGENCY, package_id: pkg.id, signer_id: pkg.signer_id, request_id: 'after-cancel', rotate: true,
  } });
  assert.ok(relink.status >= 400, 'a cancelled request can never mint another link');
  const listed = await h.call('manageSignatureRequests', { user: 'nurse', body: { action: 'list', agency_id: AGENCY } });
  assert.equal(listed.data.requests[0].status, 'cancelled');
});

test('the staff list shows only charts the caller may open', async () => {
  const h = world();
  await createRequest(h);
  const nurse = await h.call('manageSignatureRequests', { user: 'nurse', body: { action: 'list', agency_id: AGENCY } });
  assert.equal(nurse.status, 200, JSON.stringify(nurse.data));
  assert.equal(nurse.data.requests.length, 1);
  assert.equal(nurse.data.requests[0].patient_name, 'Pat Example');
  assert.equal(nurse.data.requests[0].status, 'awaiting_signatures');
  const stranger = await h.call('manageSignatureRequests', { user: 'stranger', body: { action: 'list', agency_id: AGENCY } });
  assert.equal(stranger.data.requests.length, 0);
  const outsider = await h.call('manageSignatureRequests', { user: 'outsider', body: { action: 'list', agency_id: AGENCY } });
  assert.equal(outsider.status, 403);
  const summary = await h.call('manageSignatureRequests', { user: 'admin', body: { action: 'summary', agency_id: AGENCY } });
  assert.equal(summary.data.summary.open, 1);
  const audit = await h.call('manageSignatureRequests', { user: 'nurse', body: { action: 'audit', agency_id: AGENCY } });
  assert.equal(audit.status, 403, 'the audit trail is for agency administrators and managers');
  const adminAudit = await h.call('manageSignatureRequests', { user: 'admin', body: { action: 'audit', agency_id: AGENCY } });
  assert.ok(adminAudit.data.events.some((event) => event.action === 'request_created'));
});

test('in-person signing and template requests run through the same bindings and sealing', async () => {
  const h = world();
  const { request } = (await createRequest(h, 'nurse', { signers: [SIGNERS[0]], signature_fields: [] })).data;
  const form = (extra = {}) => ({
    mode: 'in_person', agency_id: AGENCY, document_signature_id: request.documents[0].id,
    signer_id: request.packages[0].signer_id, typed_name: 'Pat Example', agreement_version: 'signature-consent-v1',
    identity_confirmed: 'true', client_request_id: 'in-person-1',
    signature_file: new File([pngBytes(9)], 'signature.png', { type: 'image/png' }), ...extra,
  });
  const unconfirmed = await h.call('submitDocumentSignatures', { user: 'nurse', form: form({ identity_confirmed: 'false' }) });
  assert.equal(unconfirmed.status, 400);
  const stranger = await h.call('submitDocumentSignatures', { user: 'stranger', form: form() });
  assert.equal(stranger.status, 404);
  const signed = await h.call('submitDocumentSignatures', { user: 'nurse', form: form() });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  assert.equal(signed.data.document_completed, true);
  const artifact = h.db.SignatureArtifactBinding[0];
  assert.equal(artifact.capture_method, 'in_person');
  assert.equal(artifact.collected_by_user_id, 'nurse');
  const replay = await h.call('submitDocumentSignatures', { user: 'nurse', form: form() });
  assert.equal(replay.data.idempotent, true);

  h.seed('DocumentTemplate', { id: 'template-1', template_name: 'HIPAA acknowledgment', category: 'consent',
    content: '<p>I, {{patient_name}}, acknowledge receipt of the notice from {{agency_name}}.</p>' });
  const catalog = await h.call('manageSignatureRequests', { user: 'nurse', body: { action: 'templates', agency_id: AGENCY } });
  assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
  assert.deepEqual(catalog.data.templates, [{ id: 'template-1', name: 'HIPAA acknowledgment', category: 'consent', description: null }]);
  const outsiderCatalog = await h.call('manageSignatureRequests', { user: 'outsider', body: { action: 'templates', agency_id: AGENCY } });
  assert.ok(outsiderCatalog.status >= 400, 'the catalog still requires membership in the named agency');
  const templated = await h.call('generateDocumentPackageFromTemplate', { user: 'nurse', body: {
    agency_id: AGENCY, patient_id: PATIENT, template_id: 'template-1', signer_source: 'caregiver',
    due_date: dueDate, client_request_id: 'template-request-1',
  } });
  assert.equal(templated.status, 201, JSON.stringify(templated.data));
  assert.equal(templated.data.request.packages[0].signer_email, 'cara@example.test');
  const templateRow = h.db.DocumentSignature.find((row) => row.document_id === templated.data.template_document_id);
  assert.equal(templateRow.signature_fields.length, 2, 'the rendered signature and date lines become fields');
  const filed = h.db.DocumentTenantBinding.find((row) => row.document_id === templated.data.template_document_id);
  assert.equal(filed.content_sha256, templateRow.document_content_sha256);
});

test('a clinician signs a reviewed discharge summary with a sealed, server-derived identity', async () => {
  const h = world();
  h.seed('DischargeSummary', { id: 'summary-1', patient_id: PATIENT, discharge_date: dueDate, status: 'draft',
    generated_by: 'nurse@agency.test', summary_of_care: 'Synthetic narrative', discharge_disposition: 'home' });
  const form = {
    mode: 'discharge_summary', agency_id: AGENCY, discharge_summary_id: 'summary-1',
    attestation_version: 'discharge-attestation-v1', client_request_id: 'discharge-sign-1',
    signature_file: new File([pngBytes(4)], 'signature.png', { type: 'image/png' }),
  };
  const draft = await h.call('submitDocumentSignatures', { user: 'nurse', form });
  assert.equal(draft.status, 409, 'a draft must be reviewed first');
  h.db.DischargeSummary[0].status = 'reviewed';
  const office = await h.call('submitDocumentSignatures', { user: 'office', form });
  assert.equal(office.status, 403);
  const signed = await h.call('submitDocumentSignatures', { user: 'nurse', form });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  const summary = h.db.DischargeSummary[0];
  assert.equal(summary.status, 'signed');
  assert.equal(summary.signature.signed_by, 'nurse@agency.test');
  assert.equal(summary.signature.signed_by_user_id, 'nurse');
  assert.equal(summary.signature.signature_data, undefined, 'no base64 image is stored on the row');
  assert.match(summary.signature.integrity_hmac_sha256, /^[a-f0-9]{64}$/);
  assert.ok(h.db.SignatureAuditEvent.some((event) => event.action === 'discharge_summary_signed'));
});

test('missing signing configuration fails closed with a clear code', async () => {
  const h = world({ env: { SIGNATURE_AGREEMENT_TEXT: '', SIGNATURE_HMAC_SECRET: '' } });
  const { request } = (await createRequest(h)).data;
  const tokens = await issueLinks(h, request);
  const review = await h.call('validateSignerToken', { body: { token: tokens['pat@example.test'] } });
  assert.equal(review.status, 503);
  assert.equal(review.data.code, 'signature_agreement_not_configured');
  assert.equal(h.db.SignerReviewGrant.length, 0);
  const noPortal = world({ env: { APP_PUBLIC_URL: '' } });
  const created = (await createRequest(noPortal)).data.request;
  const issued = await noPortal.call('generateSignerToken', { user: 'nurse', body: {
    agency_id: AGENCY, package_id: created.packages[0].id, signer_id: created.packages[0].signer_id, request_id: 'r',
  } });
  assert.equal(issued.status, 503);
  assert.equal(noPortal.emails.length, 0);
  const paused = world({ env: { OUTBOUND_DELIVERY_RELEASE: '' } });
  const pausedRequest = (await createRequest(paused)).data.request;
  const pausedIssue = await paused.call('generateSignerToken', { user: 'nurse', body: {
    agency_id: AGENCY, package_id: pausedRequest.packages[0].id, signer_id: pausedRequest.packages[0].signer_id, request_id: 'r',
  } });
  assert.equal(pausedIssue.status, 503);
  assert.equal(pausedIssue.data.code, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
});
