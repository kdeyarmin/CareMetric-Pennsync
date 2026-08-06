// Phase 0 stabilization guardrails from docs/audits/IMPLEMENTATION_ROADMAP.md.
// These tests intentionally prove repository-verifiable acceptance criteria and
// identify the remaining Base44-hosted policy/staging requirements without
// pretending local code can validate deployed tenant policies or provider state.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const entity = (name) => JSON5.parse(readFileSync(join(HERE, 'entities', `${name}.jsonc`), 'utf8'));
const source = (rel) => readFileSync(join(REPO, rel), 'utf8');

const HIGH_RISK_ACCESS = [
  { entity: 'Patient', owners: ['created_by'], adminReadable: true },
  { entity: 'Visit', owners: ['created_by'], adminReadable: true },
  { entity: 'Document', owners: ['uploaded_by', 'created_by'], adminReadable: true },
  { entity: 'Message', owners: ['created_by'], adminReadable: true, containsOwners: ['recipients'] },
  { entity: 'TrainingAssignment', owners: ['assigned_to_user_id'], adminReadable: true },
  { entity: 'Timesheet', owners: ['employee_email'], adminReadable: true },
];

const REQUIRED_RELATIONSHIP_FIELDS = {
  Patient: ['first_name', 'last_name', 'date_of_birth', 'status'],
  Visit: ['patient_id', 'visit_date', 'client_request_id'],
  Referral: ['patient_name', 'assigned_to', 'status'],
  Document: ['patient_id', 'uploaded_by', 'file_url'],
  DocumentSignature: ['document_id', 'signer_email', 'status'],
  TrainingAssignment: ['course_id', 'assigned_to_user_id', 'status'],
  Timesheet: ['employee_email', 'pay_period_start', 'pay_period_end', 'status'],
  SmsConsent: ['phone_e164', 'consent_status'],
  SmsMessage: ['to_number', 'from_number', 'status'],
  FaxLog: ['to_number', 'status'],
  ProviderFollowUpToken: ['token', 'referral_id', 'expires_at'],
};

const IDEMPOTENCY_FIELDS = {
  Visit: 'client_request_id',
  Incident: 'client_request_id',
  SmsMessage: 'client_message_id',
  ScheduledSms: 'claimed_by',
  ScheduledSignatureReminder: 'claimed_by',
  IncomingFax: 'claimed_by',
  FaxLog: 'telnyx_fax_id',
};

const DELIVERY_STATUS_FIELDS = {
  FaxLog: ['status'],
  SmsMessage: ['status'],
  DocumentSignature: ['status'],
  ProviderFollowUpToken: ['status'],
  ScheduledSms: ['status'],
  ScheduledSignatureReminder: ['status'],
};

const FINAL_RECORDS = {
  Visit: ['status'],
  OASISAssessment: ['status'],
  Incident: ['status'],
  DocumentSignature: ['status', 'audit_trail'],
  PersonnelCredential: ['status', 'approved_by', 'approved_at'],
  Timesheet: ['status', 'reviewed_by'],
};

function assertField(schema, field) {
  assert.ok(schema.properties?.[field], `${schema.name} must define ${field}`);
}

test('P0-01 high-risk entities define scoped read RLS for patient/document/message/training/payroll records', () => {
  for (const item of HIGH_RISK_ACCESS) {
    const raw = source(`base44/entities/${item.entity}.jsonc`);
    assert.match(raw, /"rls"\s*:/, `${item.entity} must define RLS`);
    assert.match(raw, /"read"\s*:/, `${item.entity} must define read RLS`);
    for (const owner of item.owners) {
      assert.match(raw, new RegExp(`"${owner}"\\s*:\\s*"\\{\\{user\\.email\\}\\}"`), `${item.entity} read RLS must include ${owner}`);
    }
    for (const owner of item.containsOwners || []) {
      assert.match(raw, new RegExp(`"${owner}"\\s*:\\s*\\{\\s*"\\$contains"\\s*:\\s*"\\{\\{user\\.email\\}\\}"`), `${item.entity} read RLS must include ${owner}.$contains`);
    }
    if (item.adminReadable) {
      assert.match(
        raw,
        /"role"\s*:\s*"admin"|"account_type"\s*:\s*"agency_admin"|"account_type"\s*:\s*"super_admin"/,
        `${item.entity} read RLS must include an admin/super-admin path`,
      );
    }
  }
});

test('P0-02 staging E2E requirements are documented and intentionally not faked locally', () => {
  const plan = source('docs/audits/PHASE_0_IMPLEMENTATION_PLAN.md');
  assert.match(plan, /Base44 hosted staging tenant/i);
  assert.match(plan, /Do not mark P0-02 complete/i);
  assert.match(plan, /credentials/i);
});

test('P0-03 relationship/idempotency contract matrix references fields that exist in entity schemas', () => {
  for (const [entityName, fields] of Object.entries(REQUIRED_RELATIONSHIP_FIELDS)) {
    const schema = entity(entityName);
    for (const field of fields) assertField(schema, field);
  }
  for (const [entityName, field] of Object.entries(IDEMPOTENCY_FIELDS)) {
    assertField(entity(entityName), field);
  }
});

test('P0-04 final-record lifecycle candidates expose status and audit/review fields', () => {
  for (const [entityName, fields] of Object.entries(FINAL_RECORDS)) {
    const schema = entity(entityName);
    for (const field of fields) assertField(schema, field);
  }
  const lifecycleSrc = source('src/lib/recordLifecycle.js');
  assert.match(lifecycleSrc, /RECORD_LIFECYCLE_STATUS/);
  assert.match(lifecycleSrc, /createLifecycleAuditEvent/);
});

test('P0-05 outbound delivery entities expose status fields and shared delivery-state helpers exist', () => {
  for (const [entityName, fields] of Object.entries(DELIVERY_STATUS_FIELDS)) {
    const schema = entity(entityName);
    for (const field of fields) assertField(schema, field);
  }
  const deliverySrc = source('src/lib/outboundDeliveryState.js');
  assert.match(deliverySrc, /OUTBOUND_DELIVERY_STATUS/);
  assert.match(deliverySrc, /shouldDeadLetterDelivery/);
  assert.match(deliverySrc, /createDeliveryAttemptEvent/);
});

test('P1-04 provider follow-up public token functions persist expired/submitted token statuses', () => {
  const validate = source('base44/functions/validateFollowUpToken/entry.ts');
  const submit = source('base44/functions/submitFollowUpResponse/entry.ts');
  assert.match(validate, /status:\s*'expired'/, 'validateFollowUpToken must persist status=expired when expiring a token');
  assert.match(submit, /status:\s*'expired'/, 'submitFollowUpResponse must persist status=expired when an expired token is presented');
  assert.match(submit, /status:\s*'delivered'/, 'submitFollowUpResponse must persist status=delivered after successful single-use submission');
});

test('hosted RLS proof worksheet exists and refuses to fake local proof', () => {
  const proof = source('docs/HOSTED-RLS-PROOF.md');
  assert.match(proof, /does not prove tenant isolation by itself/i);
  assert.match(proof, /Do \*\*not\*\* mark LR-01 complete/i);
  assert.match(proof, /Raw HTTP responses/i);
  assert.match(proof, /Cross-tenant/i);
  assert.match(proof, /Repo CI cannot greenlight/i);
  const checklist = source('docs/SECURITY-RLS-CHECKLIST.md');
  assert.match(checklist, /HOSTED-RLS-PROOF\.md/);
});

test('true CAS remains a platform ask; in-repo uses claim+re-read not decorative row_version', () => {
  const cas = source('docs/PLATFORM-CAS.md');
  assert.match(cas, /If-Match/i);
  assert.match(cas, /Do \*\*not\*\* add decorative `row_version`/i);
  const award = source('base44/functions/awardBadgeOnCompletion/entry.ts');
  assert.match(award, /badges_claim_token/);
  assert.match(award, /claimCheck/);
  assert.equal(
    /row_version/.test(award),
    false,
    'awardBadgeOnCompletion must not pretend row_version CAS exists',
  );
});

test('login CSRF pending confirm path is wired for logged-out magic links', () => {
  const trust = source('src/lib/accessTokenTrust.js');
  assert.match(trust, /'pending'/);
  const params = source('src/lib/app-params.js');
  assert.match(params, /base44_pending_access_token/);
  assert.match(params, /confirmPendingAccessToken/);
  const signIn = source('src/components/auth/SignInScreen.jsx');
  assert.match(signIn, /confirmPendingAccessToken/);
  assert.match(signIn, /Continue with this sign-in link/);
});

