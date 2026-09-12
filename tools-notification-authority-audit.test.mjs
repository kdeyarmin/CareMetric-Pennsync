import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import {
  AUTHORITY_FIELDS,
  NotificationAuditInputError,
  auditNotificationAuthority,
  validateNotificationAuditSnapshot,
} from './tools-notification-authority-audit.mjs';
import {
  EXPECTED_NOTIFICATION_PRODUCERS,
  NOTIFICATION_SOURCE_EXTENSIONS,
  PRODUCER_AUTHORITY_STATES,
  PRODUCER_CLASSIFICATIONS,
  PRODUCER_EXECUTION_STATES,
  findNotificationProducerCalls,
  inventoryNotificationProducers,
  verifyAuthorityV1Evidence,
} from './tools-notification-producer-inventory.mjs';

const FUNCTIONS_ROOT = fileURLToPath(new URL('./base44/functions/', import.meta.url));

function authorityNotification(overrides = {}) {
  return {
    id: 'notification-a',
    agency_id: 'agency-a',
    recipient_user_id: 'user-a',
    recipient_membership_id: 'membership-a',
    recipient_membership_version: 3,
    authority_version: 1,
    authority_state: 'active',
    version: 1,
    user_email: 'recipient@example.test',
    title: 'Private patient-specific notification',
    message: 'This field must never appear in an audit report.',
    type: 'info',
    priority: 'medium',
    created_date: '2026-09-07T00:00:00.000Z',
    is_read: false,
    read_at: null,
    dismissed: false,
    dismissed_at: null,
    action_url: '/Notifications',
    action_label: 'Open',
    metadata: { patient_id: 'patient-secret' },
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    snapshot_version: 2,
    agencies: [{ id: 'agency-a', status: 'active', legal_name: 'Private agency name' }],
    users: [{
      id: 'user-a',
      email: 'recipient@example.test',
      role: 'user',
      is_active: true,
      is_verified: true,
      disabled: false,
      is_service: false,
    }],
    memberships: [{
      id: 'membership-a',
      agency_id: 'agency-a',
      user_id: 'user-a',
      user_email_normalized: 'recipient@example.test',
      membership_key: 'agency-a:user-a',
      tenant_role: 'office_staff',
      status: 'active',
      version: 3,
      full_name: 'Private staff name',
    }],
    notifications: [authorityNotification()],
    ...overrides,
  };
}

test('tracked producer census is complete, per-call-site, and exposes current blockers', async () => {
  const result = await inventoryNotificationProducers(FUNCTIONS_ROOT);
  assert.deepEqual(result.summary, {
    files_scanned: result.summary.files_scanned,
    producer_files: 30,
    call_sites: 40,
    authority_v1: 6,
    legacy_unmigrated: 34,
    explicitly_quarantined: 0,
    workflow_schedule_quarantined: 12,
    browser_reachable_legacy_unmigrated: 7,
    source_disabled: 2,
    runtime_gated: 6,
    runtime_gated_authority_v1: 3,
    runtime_gated_legacy_unmigrated: 3,
    reachable_legacy_unmigrated: 29,
    unclassified: 0,
    invalid_authority_evidence: 0,
    missing_expected: 0,
  });

  const mixed = result.calls.filter((call) => call.file === 'handleTelnyxStatusWebhook/entry.ts');
  assert.deepEqual(mixed.map((call) => call.authority), [
    PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED,
    PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED,
    PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED,
    PRODUCER_AUTHORITY_STATES.AUTHORITY_V1,
    PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED,
  ]);
  assert.deepEqual(mixed.map((call) => call.classification), [
    PRODUCER_CLASSIFICATIONS.LEGACY_UNMIGRATED,
    PRODUCER_CLASSIFICATIONS.RUNTIME_GATED,
    PRODUCER_CLASSIFICATIONS.RUNTIME_GATED,
    PRODUCER_CLASSIFICATIONS.AUTHORITY_V1,
    PRODUCER_CLASSIFICATIONS.RUNTIME_GATED,
  ]);
});

test('workflow schedule quarantine is not mistaken for endpoint containment', async () => {
  const quarantine = JSON5.parse(await readFile(
    new URL('./base44/workflow-quarantine/pennsync2-main-2026-09-07.jsonc', import.meta.url),
    'utf8',
  ));
  const quarantinedTargets = new Set(quarantine.workflows
    .filter((row) => row.state === 'quarantined')
    .map((row) => row.target));
  const expectedEntries = Object.entries(EXPECTED_NOTIFICATION_PRODUCERS);
  for (const [file, entries] of expectedEntries) {
    const functionName = file.split('/')[0];
    if (entries.some((entry) => (
      entry.workflow_schedule === 'quarantined'
    ))) assert.ok(quarantinedTargets.has(functionName), functionName);
    for (const entry of entries.filter((candidate) => candidate.workflow_schedule === 'quarantined')) {
      assert.equal(entry.execution, PRODUCER_EXECUTION_STATES.REACHABLE_OR_UNKNOWN, functionName);
      assert.equal(entry.classification, PRODUCER_CLASSIFICATIONS.LEGACY_UNMIGRATED, functionName);
    }
  }

  const testAutomations = await readFile(
    new URL('./base44/functions/testAutomations/entry.ts', import.meta.url),
    'utf8',
  );
  for (const target of [
    'sendPersonnelExpirationNotifications',
    'sendTrainingNotifications',
    'sendExpirationNotifications',
  ]) assert.match(testAutomations, new RegExp(`'${target}'`), target);
  assert.match(testAutomations, /functions\.invoke\(fnName, \{\}\)/);
  const systemHealthPanel = await readFile(
    new URL('./src/components/admin/SystemHealthPanel.jsx', import.meta.url),
    'utf8',
  );
  assert.match(systemHealthPanel, /queryFn:[^]*testAutomations[^]*refetchInterval:\s*300000/);
  const adminOperations = await readFile(
    new URL('./src/pages/AdminOperations.jsx', import.meta.url),
    'utf8',
  );
  assert.match(adminOperations, /TabsContent\s+value="system-health"[^]*<SystemHealthPanel\s*\/>/);
  const inventory = await inventoryNotificationProducers(FUNCTIONS_ROOT);
  assert.equal(inventory.summary.browser_reachable_legacy_unmigrated, 7);
});

test('source-disable and runtime-gate classifications have repository evidence', async () => {

  const completedVisit = await readFile(
    new URL('./base44/functions/processCompletedVisit/entry.ts', import.meta.url),
    'utf8',
  );
  const monitor = await readFile(
    new URL('./base44/functions/monitorClinicalDataForCarePlanUpdates/entry.ts', import.meta.url),
    'utf8',
  );
  assert.match(completedVisit, /const PROCESS_COMPLETED_VISIT_PAUSED = true;[\s\S]*if \(PROCESS_COMPLETED_VISIT_PAUSED\)[\s\S]*status: 503/);
  assert.match(monitor, /Deno\.serve[\s\S]*legacy_patient_service_writer_paused[\s\S]*status: 503[\s\S]*Notification\.create/);

  for (const [name, releaseConstant] of [
    ['checkStaleFollowUpRequests', 'WORKFLOW_RELEASE_CHECK_STALE_FOLLOW_UP_REQUESTS'],
    ['pollFaxStatuses', 'WORKFLOW_RELEASE_POLL_FAX_STATUSES'],
    ['processInboundFaxes', 'WORKFLOW_RELEASE_PROCESS_INBOUND_FAXES'],
  ]) {
    const source = await readFile(new URL(`./base44/functions/${name}/entry.ts`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`${releaseConstant}[\\s\\S]*enabled-v1[\\s\\S]*status: 503`), name);
  }
  const telnyx = await readFile(
    new URL('./base44/functions/handleTelnyxStatusWebhook/entry.ts', import.meta.url),
    'utf8',
  );
  assert.match(telnyx, /const INBOUND_PATIENT_SMS_ROUTING_PAUSED = true;/);
  assert.match(telnyx, /const INBOUND_PATIENT_CALL_ROUTING_PAUSED = true;/);
  assert.match(telnyx, /message\.received[^]*INBOUND_PATIENT_SMS_ROUTING_PAUSED[^]*inboundRoutingPausedResponse/);
  assert.match(telnyx, /INBOUND_PATIENT_CALL_ROUTING_PAUSED[^]*isInboundPatientCallEvent[^]*inboundRoutingPausedResponse/);
});

test('source inventory covers mixed JS/TS extensions, aliases, bracket access, and bulkCreate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notification-producers-'));
  try {
    const expectations = {};
    for (const [index, extension] of NOTIFICATION_SOURCE_EXTENSIONS.entries()) {
      const file = `producer-${index}${extension}`;
      const source = index === 0
        ? 'const inbox = sdk.entities.Notification; inbox.create(payload);'
        : index === 1
          ? 'const { Notification: inbox } = entities; inbox.bulkCreate(rows);'
          : 'service.entities["Notification"].create(payload);';
      await writeFile(join(directory, file), source);
      expectations[file] = [{
        method: index === 1 ? 'bulkCreate' : 'create',
        authority: PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED,
        execution: PRODUCER_EXECUTION_STATES.REACHABLE_OR_UNKNOWN,
        classification: PRODUCER_CLASSIFICATIONS.LEGACY_UNMIGRATED,
      }];
    }
    await writeFile(join(directory, 'ignored.test.ts'), 'entities.Notification.create(payload);');
    await writeFile(join(directory, 'not-a-call.js'), `
      // entities.Notification.create(payload);
      const prose = 'Notification.create(payload)';
      const cleaned = prose.replace(/["']/g, '');
      const markup = \`text \${cleaned ? \`nested \${cleaned}\` : ''}\`;
      void markup;
    `);
    const result = await inventoryNotificationProducers(directory, expectations);
    assert.equal(result.summary.call_sites, NOTIFICATION_SOURCE_EXTENSIONS.length);
    assert.equal(result.summary.producer_files, NOTIFICATION_SOURCE_EXTENSIONS.length);
    assert.equal(result.summary.unclassified, 0);
    assert.equal(result.summary.missing_expected, 0);
    assert.equal(result.calls.some((call) => call.method === 'bulkCreate'), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('mixed call sites are classified independently and v1 evidence fails closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notification-mixed-'));
  try {
    const source = `
      entities.Notification.create(legacyPayload);
      entities.Notification.create({
        agency_id: agency.id,
        recipient_user_id: user.id,
        recipient_membership_id: membership.id,
        recipient_membership_version: membership.version,
        authority_version: 1,
        authority_state: 'active',
        version: 1,
        user_email: user.email,
      });
    `;
    await writeFile(join(directory, 'mixed.ts'), source);
    const expectations = {
      'mixed.ts': [
        {
          method: 'create',
          authority: PRODUCER_AUTHORITY_STATES.LEGACY_UNMIGRATED,
          execution: PRODUCER_EXECUTION_STATES.REACHABLE_OR_UNKNOWN,
          classification: PRODUCER_CLASSIFICATIONS.LEGACY_UNMIGRATED,
        },
        {
          method: 'create',
          authority: PRODUCER_AUTHORITY_STATES.AUTHORITY_V1,
          execution: PRODUCER_EXECUTION_STATES.REACHABLE_OR_UNKNOWN,
          classification: PRODUCER_CLASSIFICATIONS.AUTHORITY_V1,
          evidence: { kind: 'call-argument' },
        },
      ],
    };
    const result = await inventoryNotificationProducers(directory, expectations);
    assert.deepEqual(result.calls.map((call) => call.classification), [
      PRODUCER_CLASSIFICATIONS.LEGACY_UNMIGRATED,
      PRODUCER_CLASSIFICATIONS.AUTHORITY_V1,
    ]);
    assert.equal(result.summary.invalid_authority_evidence, 0);

    const regressed = source.replace("authority_state: 'active'", "authority_state: 'invalidated'");
    await writeFile(join(directory, 'mixed.ts'), regressed);
    const failed = await inventoryNotificationProducers(directory, expectations);
    assert.equal(failed.summary.invalid_authority_evidence, 1);
    assert.equal(failed.calls[1].evidence_reason, 'authority_literals_invalid');

    await writeFile(join(directory, 'mixed.ts'), `${source}\nentities.Notification.create(unknownPayload);`);
    const unknown = await inventoryNotificationProducers(directory, expectations);
    assert.equal(unknown.summary.unclassified, 1);
    assert.equal(unknown.calls[2].evidence_reason, 'producer_not_classified');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('lexer excludes comments, literals, regexes, and unrelated object properties', () => {
  const calls = findNotificationProducerCalls(`
    // entities.Notification.create(commentOnly);
    const example = "Notification.bulkCreate(notCode)";
    const inbox = entities['Notification'];
    inbox.create(payload);
  `);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'create');
  const interpolated = findNotificationProducerCalls(
    'const label = `result: ${entities.Notification.create(payload)}`;',
  );
  assert.equal(interpolated.length, 1);
  assert.equal(interpolated[0].method, 'create');

  const methodAlias = findNotificationProducerCalls(
    'const createNotice = entities.Notification.create; createNotice(payload);',
  );
  assert.equal(methodAlias.length, 1);
  assert.equal(methodAlias[0].method, 'create');
  assert.equal(findNotificationProducerCalls(
    'const value = { Notification: helper }; helper.create(payload);',
  ).length, 0);
  assert.equal(findNotificationProducerCalls(
    'const matcher = () => /Notification.create(payload)/;',
  ).length, 0);

  for (const assignedAlias of [
    'let createNotice; createNotice = entities.Notification.create; createNotice(payload);',
    'const first = entities.Notification.create; const second = first; second(payload);',
    'let inbox; inbox = entities.Notification; inbox.create(payload);',
  ]) assert.equal(findNotificationProducerCalls(assignedAlias).length, 1, assignedAlias);
  assert.equal(findNotificationProducerCalls(
    'const inbox = config.Notification; inbox.create(payload);',
  ).length, 0);
  assert.equal(findNotificationProducerCalls(
    'config.Notification.create(payload);',
  ).length, 0);
});

test('authority evidence is top-level and bound to the actual create argument', () => {
  const expectation = {
    classification: PRODUCER_CLASSIFICATIONS.AUTHORITY_V1,
    evidence: {
      kind: 'factory-binding',
      name: 'expectedNotification',
      argumentPath: ['notification'],
      payloadPath: [],
    },
  };
  const authorityObject = `{
    agency_id: agency.id,
    recipient_user_id: user.id,
    recipient_membership_id: membership.id,
    recipient_membership_version: membership.version,
    user_email: user.email,
    authority_version: 1,
    authority_state: 'active',
    version: 1,
  }`;
  const authorityEntries = authorityObject.slice(1, -1).replace(/,\s*$/, '');
  const disconnected = findNotificationProducerCalls(`
    function expectedNotification() { return ${authorityObject}; }
    const notification = legacyPayload;
    entities.Notification.create(notification);
  `)[0];
  const disconnectedResult = verifyAuthorityV1Evidence(disconnected, expectation);
  assert.equal(disconnectedResult.ok, false);
  assert.equal(disconnectedResult.reason, 'authority_factory_not_bound_to_call');

  const nested = findNotificationProducerCalls(`
    entities.Notification.create({ metadata: ${authorityObject} });
  `)[0];
  const nestedResult = verifyAuthorityV1Evidence(nested, {
      classification: PRODUCER_CLASSIFICATIONS.AUTHORITY_V1,
      evidence: { kind: 'call-argument' },
    });
  assert.equal(nestedResult.ok, false);
  assert.equal(nestedResult.reason, 'authority_fields_incomplete');

  const duplicateAuthority = findNotificationProducerCalls(`
    entities.Notification.create({
      ${authorityEntries},
      authority_version: 2,
    });
  `)[0];
  const duplicateResult = verifyAuthorityV1Evidence(duplicateAuthority, {
    classification: PRODUCER_CLASSIFICATIONS.AUTHORITY_V1,
    evidence: { kind: 'call-argument' },
  });
  assert.equal(duplicateResult.ok, false);
  assert.equal(duplicateResult.reason, 'authority_fields_ambiguous');

  const spreadOverride = findNotificationProducerCalls(`
    entities.Notification.create({
      ${authorityEntries},
      ...legacyPayload,
    });
  `)[0];
  const spreadResult = verifyAuthorityV1Evidence(spreadOverride, {
    classification: PRODUCER_CLASSIFICATIONS.AUTHORITY_V1,
    evidence: { kind: 'call-argument' },
  });
  assert.equal(spreadResult.ok, false);
  assert.equal(spreadResult.reason, 'authority_object_spread');
});

test('factory evidence rejects altered bindings, compound RHS, and alternate returns', () => {
  const fields = `{
    agency_id: agency.id,
    recipient_user_id: user.id,
    recipient_membership_id: membership.id,
    recipient_membership_version: membership.version,
    user_email: user.email,
    authority_version: 1,
    authority_state: 'active',
    version: 1,
  }`;
  const expectation = {
    classification: PRODUCER_CLASSIFICATIONS.AUTHORITY_V1,
    evidence: {
      kind: 'factory-binding',
      name: 'makeNotification',
      argumentPath: ['spec', 'payload'],
      payloadPath: ['payload'],
    },
  };
  for (const source of [
    `
      function makeNotification() { return { payload: ${fields} }; }
      const spec = makeNotification();
      spec.payload = legacyPayload;
      entities.Notification.create(spec.payload);
    `,
    `
      function makeNotification() { return { payload: ${fields} }; }
      const spec = makeNotification() && legacyPayload;
      entities.Notification.create(spec.payload);
    `,
    `
      function makeNotification() {
        if (condition) return { payload: ${fields} };
        return { payload: legacyPayload };
      }
      const spec = makeNotification();
      entities.Notification.create(spec.payload);
    `,
    `
      function makeNotification() { return { payload: ${fields} }; }
      function unrelatedScope() { const spec = makeNotification(); }
      function producerScope() { entities.Notification.create(spec.payload); }
    `,
  ]) {
    const call = findNotificationProducerCalls(source)[0];
    assert.equal(verifyAuthorityV1Evidence(call, expectation).ok, false);
  }
});

test('aggregate audit separates current, invalidated, stale, legacy, malformed, and unknown rows', () => {
  const input = snapshot({
    notifications: [
      authorityNotification(),
      authorityNotification({ id: 'notification-invalidated', authority_state: 'invalidated' }),
      authorityNotification({ id: 'notification-stale', recipient_membership_version: 2 }),
      {
        id: 'notification-legacy',
        user_email: 'patient@example.test',
        title: 'Private legacy title',
        message: 'Private legacy message',
      },
      authorityNotification({
        id: 'notification-malformed',
        recipient_membership_id: null,
        user_email: ' Not-Canonical@Example.Test ',
      }),
      authorityNotification({ id: 'notification-future', authority_version: 2 }),
    ],
  });
  const before = structuredClone(input);
  const report = auditNotificationAuthority(input);
  assert.deepEqual(input, before, 'the input snapshot is not mutated');
  assert.equal(report.mode, 'dry-run-only');
  assert.equal(report.mutations_performed, 0);
  assert.equal(report.contains_row_values, false);
  assert.equal(report.backfill_authorized, false);
  assert.equal(report.producer_cutover_verified_by_this_tool, false);
  assert.equal(report.producer_cutover_required_before_backfill, true);
  assert.equal(report.row_review_required, true);
  assert.deepEqual(report.categories, {
    authority_v1_current_active: 1,
    authority_v1_invalidated_retained: 1,
    authority_v1_stale_or_unverifiable: 1,
    legacy_unmigrated: 1,
    malformed_authority_v1: 1,
    unsupported_authority_version: 1,
  });
  assert.equal(report.findings.membership_revision_mismatch, 1);
  assert.equal(report.findings.authority_version_missing, 1);
  assert.equal(report.findings.notification_authority_fields_invalid, 1);
  assert.equal(report.findings.notification_email_noncanonical, 1);
  assert.equal(report.findings.authority_version_unsupported, 1);
  const serialized = JSON.stringify(report);
  for (const privateValue of [
    'patient-secret',
    'recipient@example.test',
    'Private patient-specific notification',
    'Private legacy message',
    'Private staff name',
    'Private agency name',
  ]) assert.doesNotMatch(serialized, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('active authority requires one exact current agency and membership binding', () => {
  const duplicateMembership = snapshot({
    memberships: [snapshot().memberships[0], structuredClone(snapshot().memberships[0])],
  });
  const ambiguous = auditNotificationAuthority(duplicateMembership);
  assert.equal(ambiguous.categories.authority_v1_stale_or_unverifiable, 1);
  assert.equal(ambiguous.findings.membership_ambiguous_or_missing, 1);

  const distinctMembershipIds = snapshot({
    memberships: [
      snapshot().memberships[0],
      { ...snapshot().memberships[0], id: 'membership-b' },
    ],
  });
  const duplicateBinding = auditNotificationAuthority(distinctMembershipIds);
  assert.equal(duplicateBinding.categories.authority_v1_stale_or_unverifiable, 1);
  assert.equal(duplicateBinding.findings.membership_ambiguous_or_missing, 1);

  const invalidRole = auditNotificationAuthority(snapshot({
    memberships: [{ ...snapshot().memberships[0], tenant_role: 'not-a-real-role' }],
  }));
  assert.equal(invalidRole.categories.authority_v1_stale_or_unverifiable, 1);
  assert.equal(invalidRole.findings.membership_tenant_role_invalid, 1);

  const revoked = snapshot({
    memberships: [{ ...snapshot().memberships[0], status: 'revoked' }],
    agencies: [{ id: 'agency-a', status: 'inactive' }],
  });
  const stale = auditNotificationAuthority(revoked);
  assert.equal(stale.categories.authority_v1_stale_or_unverifiable, 1);
  assert.equal(stale.findings.membership_inactive, 1);
  assert.equal(stale.findings.agency_inactive, 1);
});

test('authority audit rejects unavailable users, invalid rows, and unbound invalidated rows', () => {
  const unavailable = auditNotificationAuthority(snapshot({
    users: [{ ...snapshot().users[0], disabled: true }],
  }));
  assert.equal(unavailable.categories.authority_v1_stale_or_unverifiable, 1);
  assert.equal(unavailable.findings.user_unavailable, 1);

  const malformedRow = auditNotificationAuthority(snapshot({
    notifications: [authorityNotification({ type: 'not-a-type', created_date: 'not-an-instant' })],
  }));
  assert.equal(malformedRow.categories.malformed_authority_v1, 1);
  assert.equal(malformedRow.findings.notification_row_integrity_invalid, 1);

  const unboundInvalidated = auditNotificationAuthority(snapshot({
    memberships: [],
    users: [],
    notifications: [authorityNotification({ authority_state: 'invalidated' })],
  }));
  assert.equal(unboundInvalidated.categories.authority_v1_invalidated_retained, 0);
  assert.equal(unboundInvalidated.categories.authority_v1_stale_or_unverifiable, 1);
  assert.equal(unboundInvalidated.row_review_required, true);
  assert.equal(unboundInvalidated.findings.membership_ambiguous_or_missing, 1);
  assert.equal(unboundInvalidated.findings.user_ambiguous_or_missing, 1);
});

test('duplicate notification identities and dedupe keys require row review', () => {
  const duplicateIdentity = auditNotificationAuthority(snapshot({
    notifications: [authorityNotification(), authorityNotification()],
  }));
  assert.equal(duplicateIdentity.categories.authority_v1_stale_or_unverifiable, 2);
  assert.equal(duplicateIdentity.findings.notification_identity_duplicate, 2);
  assert.equal(duplicateIdentity.row_review_required, true);

  const duplicateDedupe = auditNotificationAuthority(snapshot({
    notifications: [
      authorityNotification({ id: 'notification-a', dedupe_key: 'workflow:a' }),
      authorityNotification({ id: 'notification-b', dedupe_key: 'workflow:a' }),
    ],
  }));
  assert.equal(duplicateDedupe.categories.authority_v1_stale_or_unverifiable, 2);
  assert.equal(duplicateDedupe.findings.notification_dedupe_collision, 2);
});

test('audit input shape is exact and bounded collections are required', () => {
  assert.throws(
    () => validateNotificationAuditSnapshot({ ...snapshot(), extra: [] }),
    NotificationAuditInputError,
  );
  assert.throws(
    () => validateNotificationAuditSnapshot({ ...snapshot(), notifications: null }),
    NotificationAuditInputError,
  );
  assert.throws(
    () => validateNotificationAuditSnapshot({ ...snapshot(), snapshot_version: 1 }),
    NotificationAuditInputError,
  );
  assert.deepEqual(AUTHORITY_FIELDS, [
    'agency_id', 'recipient_user_id', 'recipient_membership_id',
    'recipient_membership_version', 'authority_version', 'authority_state',
    'version', 'user_email',
  ]);
});

test('CLI is read-only, aggregate-only, and rejects mutation-shaped options', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notification-audit-'));
  const inputPath = join(directory, 'private-snapshot.json');
  try {
    const input = snapshot();
    await writeFile(inputPath, JSON.stringify(input));
    const audit = spawnSync(process.execPath, [
      fileURLToPath(new URL('./tools-notification-authority-audit.mjs', import.meta.url)),
      '--input',
      inputPath,
    ], { encoding: 'utf8' });
    assert.equal(audit.status, 0, audit.stderr);
    const report = JSON.parse(audit.stdout);
    assert.equal(report.mutations_performed, 0);
    assert.equal(report.backfill_authorized, false);
    assert.equal(report.producer_cutover_verified_by_this_tool, false);
    assert.equal(report.producer_cutover_required_before_backfill, true);
    assert.equal(report.row_review_required, false);
    assert.doesNotMatch(audit.stdout, /patient-secret|recipient@example\.test|Private/);

    const packageAudit = spawnSync('pnpm', [
      '--silent',
      'run',
      'audit:notification-authority',
    ], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      // Corepack's Windows pnpm launcher is a command shim, not a native executable.
      shell: process.platform === 'win32',
      encoding: 'utf8',
      env: {
        ...process.env,
        NOTIFICATION_AUTHORITY_SNAPSHOT_PATH: inputPath,
      },
    });
    assert.equal(packageAudit.status, 0, packageAudit.stderr);
    assert.doesNotMatch(`${packageAudit.stdout}\n${packageAudit.stderr}`, /private-snapshot|notification-a|recipient@example\.test|Private/);

    const rejected = spawnSync(process.execPath, [
      fileURLToPath(new URL('./tools-notification-authority-audit.mjs', import.meta.url)),
      '--apply',
      inputPath,
    ], { encoding: 'utf8' });
    assert.equal(rejected.status, 64);
    assert.equal(rejected.stdout, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('audit implementation has no network, datastore, mutation, or raw-row logging primitive', async () => {
  const source = await readFile(
    new URL('./tools-notification-authority-audit.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  assert.doesNotMatch(source, /@base44|base44\.|\.entities\.|Notification\.(?:create|update|delete|bulkCreate)/);
  assert.doesNotMatch(source, /\b(?:appendFile|createWriteStream|writeFile|rm|unlink|rename)\b/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn|info)/);
  assert.doesNotMatch(source, /JSON\.stringify\((?:snapshot|row|input|parsed)\b/);
});

test('migration runbook makes producer cutover an explicit prerequisite to backfill', async () => {
  const runbook = await readFile(
    new URL('./docs/PENNSYNC_DATA_MIGRATION_RUNBOOK_2026-09-03.md', import.meta.url),
    'utf8',
  );
  assert.match(runbook, /Notification migration is a producer-cutover-first operation/);
  assert.match(runbook, /legacy\s+service-role producer can persist a row that is invisible/);
  assert.match(runbook, /zero\s+reachable legacy-unmigrated calls\s+before planning a backfill/);
  assert.match(runbook, /workflow schedules[\s\S]*operational annotation, not\s+endpoint containment/);
  assert.match(runbook, /System Health panel[\s\S]*immediately and every five minutes/);
  assert.match(runbook, /snapshot_version: 2[\s\S]*`agencies`, `users`, `memberships`, and `notifications`/);
  assert.match(runbook, /NOTIFICATION_AUTHORITY_SNAPSHOT_PATH[\s\S]*pnpm --silent run audit:notification-authority/);
  assert.doesNotMatch(runbook, /pnpm run audit:notification-authority -- --input/);
  assert.match(runbook, /same-method legacy calls[\s\S]*without proving their semantic\s+identity/);
  assert.match(runbook, /assigned\/chained[\s\S]*method-alias forms/);
  assert.match(runbook, /config\.Notification[\s\S]*not treated as a producer/);
  assert.match(runbook, /rejects top-level\s+spreads or duplicate authority keys/);
  assert.match(runbook, /static contract, not whole-program data-flow\s+analysis/);
  assert.match(runbook, /backfill_authorized: false/);
  assert.match(runbook, /does not authorize one/);
  const producerCutover = runbook.indexOf('**Cut over producers before touching rows.**');
  const backfill = runbook.indexOf('**Backfill only after Steps 1–7 are signed off**');
  assert.ok(producerCutover >= 0 && backfill > producerCutover);
});
