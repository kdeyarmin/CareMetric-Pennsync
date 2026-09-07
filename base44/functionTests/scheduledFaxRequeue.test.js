import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const SECRET = 'fax-capability-test-secret-32-bytes-minimum';
globalThis.Deno = {
  serve() {},
  env: { get: (key) => key === 'INTERNAL_FN_SECRET' ? SECRET : undefined },
};

async function loadInline(entryPath, names) {
  let source = await readFile(new URL(entryPath, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = () => ({});',
  );
  const js = transpileTs(source).outputText;
  const tmp = join(tmpdir(), `scheduled_fax_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${names.join(', ')} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const HASH = 'a'.repeat(64);

function scheduledRow() {
  return {
    id: 'scheduled-1',
    authorization_version: 1,
    schedule_key: 'schedule-key',
    client_request_id: 'request-1',
    agency_id: 'agency-1',
    document_id: 'document-1',
    document_binding_id: 'binding-1',
    document_binding_version: 2,
    document_content_sha256: HASH,
    authorized_by_user_id: 'user-1',
    authorized_by_email_normalized: 'user@example.com',
    authorized_by_membership_id: 'membership-1',
    authorized_by_membership_version: 3,
    authorized_tenant_role: 'manager',
    provider: 'telnyx',
    integration_secret_id: 'secret-1',
    integration_secret_updated_at: '2026-09-06T10:00:00.000Z',
    fax_connection_id: 'connection-1',
    sender_number_e164: '+12155550199',
    sender_telecom_binding_id: 'sender-binding-1',
    sender_telecom_binding_version: 2,
    sender_provider_number_id: 'number-1',
    sender_settings_id: 'settings-1',
    sender_settings_updated_at: '2026-09-06T10:00:00.000Z',
    scheduled_time: '2026-09-06T11:00:00.000Z',
    updated_date: '2026-09-06T10:30:00.000Z',
    to_numbers: ['+12155550111', '+12155550112'],
    document_url: null,
    from_number: null,
  };
}

test('scheduled fax provenance accepts only complete private, tenant and provider authority', async () => {
  const { scheduledProvenanceIsComplete } = await loadInline(
    '../functions/processScheduledFaxes/entry.ts',
    ['scheduledProvenanceIsComplete'],
  );
  const row = scheduledRow();
  assert.equal(scheduledProvenanceIsComplete(row), true);
  for (const field of [
    'agency_id',
    'document_binding_id',
    'integration_secret_id',
    'sender_telecom_binding_id',
  ]) {
    assert.equal(scheduledProvenanceIsComplete({ ...row, [field]: null }), false, field);
  }
  assert.equal(
    scheduledProvenanceIsComplete({ ...row, document_url: 'https://example.test/file.pdf' }),
    false,
  );
  assert.equal(
    scheduledProvenanceIsComplete({ ...row, to_numbers: [row.to_numbers[0], row.to_numbers[0]] }),
    false,
  );
});

test('scheduled result accounting never requeues an accepted or ambiguous provider boundary', async () => {
  const { scheduledResultOutcome } = await loadInline(
    '../functions/processScheduledFaxes/entry.ts',
    ['scheduledResultOutcome'],
  );
  assert.equal(scheduledResultOutcome({ accepted: 2, failed: 0, unknown: 0 }, 2).status, 'sent');
  assert.equal(scheduledResultOutcome({ accepted: 1, failed: 1, unknown: 0 }, 2).status, 'partial_failure');
  assert.equal(scheduledResultOutcome({ accepted: 0, failed: 0, unknown: 2 }, 2).status, 'needs_review');
  assert.equal(scheduledResultOutcome({ accepted: 1, failed: 0, unknown: 0 }, 2).status, 'needs_review');
});

function retryRow() {
  return {
    id: 'fax-1',
    agency_id: 'agency-1',
    referral_id: 'referral-1',
    document_id: 'document-1',
    document_binding_id: 'binding-1',
    document_binding_version: 2,
    document_content_sha256: HASH,
    sent_by_user_id: 'user-1',
    sent_by_membership_id: 'membership-1',
    sent_by_membership_version: 3,
    sent_by: 'user@example.com',
    to_number: '+12155550111',
    status: 'failed',
    provider: 'telnyx',
    integration_secret_id: 'secret-1',
    integration_secret_updated_at: '2026-09-06T10:00:00.000Z',
    fax_connection_id: 'connection-1',
    sender_telecom_binding_id: 'sender-binding-1',
    sender_telecom_binding_version: 2,
    sender_provider_number_id: 'number-1',
    sender_settings_id: 'settings-1',
    sender_settings_updated_at: '2026-09-06T10:00:00.000Z',
    provider_submission_state: 'accepted',
    provider_terminal_status: 'failed',
    provider_submission_attempt_id: 'attempt-1',
    telnyx_fax_id: 'provider-fax-1',
    provider_accepted_at: '2026-09-06T10:00:00.000Z',
    provider_terminal_at: '2026-09-06T10:05:00.000Z',
    next_retry_at: '2026-09-06T11:00:00.000Z',
    updated_date: '2026-09-06T10:05:00.000Z',
    retry_count: 1,
    retry_generation: 0,
    retry_claimed_by: null,
    retry_claimed_at: null,
    retry_claimed_by_user_id: null,
    failure_notify_claimed_by: null,
    failure_notify_claimed_at: null,
    document_url: null,
  };
}

test('automatic retry candidate rejects missing provenance, unsigned failure and generation gaps', async () => {
  const { strictAutomaticRetryCandidate } = await loadInline(
    '../functions/autoRetryFailedFaxes/entry.ts',
    ['strictAutomaticRetryCandidate'],
  );
  const row = retryRow();
  assert.equal(strictAutomaticRetryCandidate(row, NOW), true);
  assert.equal(strictAutomaticRetryCandidate({ ...row, referral_id: null }, NOW), false);
  assert.equal(strictAutomaticRetryCandidate({ ...row, provider_terminal_status: null }, NOW), false);
  assert.equal(strictAutomaticRetryCandidate({ ...row, retry_count: 3 }, NOW), false);
  assert.equal(strictAutomaticRetryCandidate({ ...row, failure_notify_claimed_by: 'notice-claim' }, NOW), false);
});

test('internal fax capability is action/claim bound and remains valid across a two-minute cold start', async () => {
  const creator = await loadInline(
    '../functions/autoRetryFailedFaxes/entry.ts',
    ['createFaxInternalCapability'],
  );
  const verifier = await loadInline(
    '../functions/sendBatchFax/entry.ts',
    ['verifyFaxInternalCapability'],
  );
  const originalNow = Date.now;
  try {
    Date.now = () => NOW;
    const capability = await creator.createFaxInternalCapability('dispatch_retry', 'fax-1', 'claim-1');
    Date.now = () => NOW + 120_000;
    assert.equal(
      await verifier.verifyFaxInternalCapability(capability, 'dispatch_retry', 'fax-1', 'claim-1'),
      true,
    );
    assert.equal(
      await verifier.verifyFaxInternalCapability(capability, 'dispatch_retry', 'fax-2', 'claim-1'),
      false,
    );
    assert.equal(
      await verifier.verifyFaxInternalCapability(capability, 'dispatch_scheduled', 'fax-1', 'claim-1'),
      false,
    );
  } finally {
    Date.now = originalNow;
  }
});

test('only definite non-ambiguous provider 4xx responses are safe rejections', async () => {
  const { providerSubmissionDefinitelyRejected } = await loadInline(
    '../functions/sendBatchFax/entry.ts',
    ['providerSubmissionDefinitelyRejected'],
  );
  assert.equal(providerSubmissionDefinitelyRejected(new Response('', { status: 422 })), true);
  for (const status of [408, 409, 425, 500, 503]) {
    assert.equal(providerSubmissionDefinitelyRejected(new Response('', { status })), false, status);
  }
});

function careTeamAssignment(overrides = {}) {
  return {
    id: 'assignment-1',
    assignment_key: 'agency-1:patient-1:user-1',
    agency_id: 'agency-1',
    patient_id: 'patient-1',
    user_id: 'user-1',
    user_email_normalized: 'user@example.com',
    assignee_membership_id: 'membership-1',
    assignee_membership_version_at_enablement: 3,
    status: 'active',
    source: 'manual',
    created_by_user_id: 'manager-1',
    created_by_user_email_normalized: 'manager@example.com',
    activated_at: '2026-09-06T10:00:00.000Z',
    last_transition_by_user_id: 'manager-1',
    last_transition_by_email_normalized: 'manager@example.com',
    last_transition_at: '2026-09-06T10:00:00.000Z',
    last_transition_reason: 'Assigned for direct care',
    last_transition_action: 'grant',
    last_transition_request_id: 'assignment-request-1',
    last_transition_request_key: 'agency-1:patient-1:user-1:assignment-request-1',
    version: 1,
    updated_date: '2026-09-06T10:00:00.000Z',
    ...overrides,
  };
}

test('scheduled fax care-team access requires one canonical assignment at the exact membership version', async () => {
  const { validateInternalAccess } = await loadInline(
    '../functions/sendBatchFax/entry.ts',
    ['validateInternalAccess'],
  );
  const authority = {
    agencyId: 'agency-1',
    userId: 'user-1',
    email: 'user@example.com',
    membershipId: 'membership-1',
    membershipVersion: 3,
    tenantRole: 'clinician',
  };
  const binding = {
    patientId: 'patient-1',
    creatorEmail: 'creator@example.com',
    binding: { purpose: 'patient_document', created_by_user_id: 'creator-1' },
  };
  const patient = {
    id: 'patient-1',
    agency_id: 'agency-1',
    created_by_user_id: 'creator-1',
    created_by_user_email_normalized: 'creator@example.com',
    is_sample: false,
    is_archived: false,
    updated_date: '2026-09-06T10:00:00.000Z',
  };

  const calls = [];
  const invokeWith = (assignmentRows) => validateInternalAccess({
    Patient: { filter: async () => [patient] },
    PatientCareTeamAssignment: {
      filter: async (query) => {
        calls.push(structuredClone(query));
        return assignmentRows;
      },
    },
  }, authority, binding, null);

  const exact = careTeamAssignment();
  const result = await invokeWith([exact]);
  assert.equal(result.assignment.id, exact.id);
  assert.deepEqual(calls[0], {
    assignment_key: 'agency-1:patient-1:user-1',
    agency_id: 'agency-1',
    patient_id: 'patient-1',
    user_id: 'user-1',
  });

  const corruptRows = [
    careTeamAssignment({ assignment_key: 'forged' }),
    careTeamAssignment({ assignee_membership_id: 'membership-2' }),
    careTeamAssignment({ assignee_membership_version_at_enablement: 2 }),
    careTeamAssignment({ assignee_membership_version_at_enablement: 4 }),
    careTeamAssignment({ last_transition_action: 'suspend' }),
    careTeamAssignment({ version: 2 }),
    careTeamAssignment({
      status: 'active',
      version: 4,
      suspended_at: '2026-09-06T10:30:00.000Z',
      activated_at: '2026-09-06T11:00:00.000Z',
      last_transition_at: '2026-09-06T11:00:00.000Z',
      last_transition_action: 'activate',
    }),
    careTeamAssignment({
      status: 'suspended',
      version: 1,
      suspended_at: '2026-09-06T11:00:00.000Z',
      last_transition_at: '2026-09-06T11:00:00.000Z',
      last_transition_action: 'suspend',
    }),
    careTeamAssignment({
      status: 'revoked',
      version: 2,
      revoked_at: '2026-09-06T11:00:00.000Z',
      revocation_reason: 'Assignment revoked',
      last_transition_at: '2026-09-06T10:00:00.000Z',
      last_transition_reason: 'Assignment revoked',
      last_transition_action: 'revoke',
    }),
    careTeamAssignment({ revoked_at: '2026-09-06T11:00:00.000Z', revocation_reason: 'Polluted terminal metadata' }),
    careTeamAssignment({ source: 'mutable_email' }),
    careTeamAssignment({ last_transition_request_key: 'forged' }),
  ];
  for (const row of corruptRows) {
    await assert.rejects(
      invokeWith([row]),
      (error) => error?.status === 409 && error?.code === 'fax_authority_unavailable',
    );
  }
  await assert.rejects(
    invokeWith([exact, { ...exact, id: 'assignment-duplicate' }]),
    (error) => error?.status === 409 && error?.code === 'fax_authority_unavailable',
  );
});
