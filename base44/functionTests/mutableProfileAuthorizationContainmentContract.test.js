import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSON5 from 'json5';

const root = resolve(import.meta.dirname, '..', '..');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');
const readEntry = (name) => read(`base44/functions/${name}/entry.ts`);

const REVIEWED_FUNCTIONS = [
  'analyzeAndGenerateClinicalTasks',
  'cancelScheduledSms',
  'deduplicatePatients',
  'dispatchScheduledSms',
  'managePhoneNumberPool',
  'manageSmsConsent',
  'preparePDFWithPatientInfo',
  'provisionNurseWorkNumber',
  'recordSmsConsent',
  'runSecurityAudit',
  'scheduleSms',
  'searchPurchaseTelnyxNumbers',
  'sendFax',
  'sendSms',
  'sendTestSms',
  'setNurseDutyStatus',
  'startMaskedCall',
  'updateIncident',
];

test('reviewed privileged functions never authorize from mutable account_type claims', () => {
  const mutableClaim = /\b(?:user|currentUser)\s*(?:(?:\?\.|\.)\s*account_type\b|(?:\?\.)?\s*\[\s*['"]account_type['"]\s*\])/;

  for (const name of REVIEWED_FUNCTIONS) {
    assert.doesNotMatch(
      readEntry(name),
      mutableClaim,
      `${name} must not authorize from the self-editable User.account_type field`,
    );
  }
});

test('provider and platform-administration handlers gate on the protected owner before parsing a request payload', () => {
  const protectedOwnerOnly = [
    'deduplicatePatients',
    'managePhoneNumberPool',
    'manageSmsConsent',
    'provisionNurseWorkNumber',
    'runSecurityAudit',
    'searchPurchaseTelnyxNumbers',
    'sendFax',
    'sendSms',
    'sendTestSms',
    'startMaskedCall',
  ];

  for (const name of protectedOwnerOnly) {
    const source = readEntry(name);
    assert.match(
      source,
      /<<<BEGIN SHARED HELPER: protectedUserAuthz/,
      `${name} must consume the generated protected-owner helper`,
    );

    const handler = source.slice(source.indexOf('Deno.serve'));
    const ownerGate = handler.indexOf('!isProtectedSuperAdmin(user)');
    const bodyParse = handler.indexOf('await req.json');
    assert.notEqual(ownerGate, -1, `${name} must call isProtectedSuperAdmin(user)`);
    assert.notEqual(bodyParse, -1, `${name} must parse its body only after authorization`);
    assert.ok(
      ownerGate < bodyParse,
      `${name} must reject non-owners before consuming a privileged request payload`,
    );
  }
});

test('patient-bearing clinical helpers retain exact creator and assigned-nurse checks', () => {
  const conjunctiveChecks = new Map([
    ['analyzeAndGenerateClinicalTasks', 'patient'],
    ['preparePDFWithPatientInfo', 'claimed'],
    ['recordSmsConsent', 'claimed'],
    ['sendFax', 'claimed'],
  ]);

  for (const [name, patientVar] of conjunctiveChecks) {
    const source = readEntry(name);
    const escaped = patientVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      source,
      new RegExp(`const\\s+isAssigned\\s*=\\s*Array\\.isArray\\(${escaped}\\.assigned_nurses\\)[\\s\\S]{0,160}${escaped}\\.assigned_nurses\\.includes\\(user\\.email\\)`),
      `${name} must derive assignment only from the patient row and authenticated email`,
    );
    assert.match(
      source,
      new RegExp(`!isProtectedSuperAdmin\\(user\\)\\s*&&\\s*${escaped}\\.created_by\\s*!==\\s*user\\.email\\s*&&\\s*!isAssigned`),
      `${name} must reject unless protected owner, immutable creator, or assigned nurse`,
    );
  }

  for (const name of ['scheduleSms', 'sendSms']) {
    const source = readEntry(name);
    assert.match(source, /const\s+isAssigned\s*=\s*Array\.isArray\(claimed\.assigned_nurses\)[\s\S]{0,160}claimed\.assigned_nurses\.includes\(user\.email\)/);
    assert.match(
      source,
      /return\s+isProtectedSuperAdmin\(user\)\s*\|\|\s*claimed\.created_by\s*===\s*user\.email\s*\|\|\s*isAssigned\s*;/,
      `${name} must authorize a chart only by protected owner, immutable creator, or assigned nurse`,
    );
  }

  const call = readEntry('startMaskedCall');
  assert.match(call, /if\s*\(isProtectedSuperAdmin\(user\)\)\s*return true/);
  assert.match(call, /if\s*\(p\.created_by\s*===\s*user\.email\)\s*return true/);
  assert.match(call, /return\s+Array\.isArray\(p\.assigned_nurses\)\s*&&\s*p\.assigned_nurses\.includes\(user\.email\)/);
});

test('legacy creator and assignee paths require one immutable active AgencyMembership', () => {
  const membershipBound = [
    'analyzeAndGenerateClinicalTasks',
    'cancelScheduledSms',
    'preparePDFWithPatientInfo',
    'recordSmsConsent',
    'setNurseDutyStatus',
    'updateIncident',
  ];

  for (const name of membershipBound) {
    const source = readEntry(name);
    const actor = name === 'updateIncident' ? 'currentUser' : 'user';
    assert.match(source, /<<<BEGIN SHARED HELPER: activeMembershipAuthz/);
    assert.match(source, /\{ user_id: userId, status: 'active' \}/);
    assert.match(source, /if \(!Array\.isArray\(rows\) \|\| rows\.length !== 1\) return false/);
    assert.match(source, /String\(row\.user_id \|\| ''\)\.trim\(\) === userId/);
    assert.match(source, /normalizeMembershipEmail\(row\.user_email_normalized\) === userEmail/);

    const handler = source.slice(source.indexOf('Deno.serve'));
    const membershipGate = handler.indexOf(`hasExactActiveAgencyMembership(base44, ${actor})`);
    const bodyParse = handler.indexOf('await req.json');
    assert.ok(membershipGate >= 0, `${name} must check immutable active membership`);
    assert.ok(bodyParse > membershipGate, `${name} must reject inactive legacy actors before parsing the body`);
    assert.match(
      handler.slice(0, bodyParse),
      new RegExp(`!isProtectedSuperAdmin\\(${actor}\\)[\\s\\S]*hasExactActiveAgencyMembership\\(base44, ${actor}\\)`),
      `${name} may bypass membership only for the protected platform owner`,
    );
  }
});

test('record-owner exceptions remain exact and escalation requires the protected owner', () => {
  const cancel = readEntry('cancelScheduledSms');
  assert.match(
    cancel,
    /\{ id: scheduledId, nurse_email: user\.email \}/,
    'non-owner cancellation must scope the service read to the authenticated nurse',
  );
  assert.match(cancel, /candidate\?\.id === scheduledId/);
  assert.match(cancel, /protectedOwner \|\| candidate\?\.nurse_email === user\.email/);
  assert.match(cancel, /if \(rows\.length !== 1 \|\| exactRows\.length !== 1\)/);

  const duty = readEntry('setNurseDutyStatus');
  assert.match(
    duty,
    /target_user_email && target_user_email !== user\.email[\s\S]*if \(!isProtectedSuperAdmin\(user\)\)/,
    'a user may update themself, but changing another user requires the protected owner',
  );

  const incident = readEntry('updateIncident');
  assert.match(incident, /const isAdmin = isProtectedSuperAdmin\(currentUser\)/);
  assert.match(incident, /const isOwner = incident\.created_by === currentUser\.email/);
  assert.match(incident, /if \(!isAdmin && !isOwner\)/);
  assert.match(incident, /typeof body\.incident_id === 'string' \? body\.incident_id\.trim\(\) : ''/);
  assert.match(incident, /\.filter\(\{ id: incidentId \}, undefined, 2\)/);
  assert.match(incident, /rows\.filter\(\(candidate\) => candidate\?\.id === incidentId\)/);
  assert.match(incident, /if \(rows\.length !== 1 \|\| exactRows\.length !== 1\)/);

  const consent = readEntry('recordSmsConsent');
  assert.match(
    consent,
    /if \(!linkedPatientId && !isProtectedSuperAdmin\(user\)\)/,
    'only the protected owner may repair an unlinked consent ledger row',
  );
  assert.match(consent, /typeof body\.patient_id === 'string' \? body\.patient_id\.trim\(\) : null/);
  assert.match(consent, /patientRows\.filter\(\(row\) => row\?\.id === linkedPatientId\)/);
  assert.match(consent, /patient_id:\s*authorizedPatientId/);
  assert.match(
    consent,
    /if \(normalizeE164\(claimed\.phone\) !== phone\)/,
    'consent may only be recorded for the exact normalized phone on the authorized chart',
  );
  const patientAccess = consent.indexOf("if (!isProtectedSuperAdmin(user) && claimed.created_by !== user.email && !isAssigned)");
  const phoneBinding = consent.indexOf('if (normalizeE164(claimed.phone) !== phone)');
  const ledgerRead = consent.indexOf('base44.asServiceRole.entities.SmsConsent');
  assert.ok(
    patientAccess >= 0 && patientAccess < phoneBinding && phoneBinding < ledgerRead,
    'recordSmsConsent must authorize the chart and bind its phone before reading the global consent ledger',
  );
});

test('SmsConsent and ScheduledSms browser access remains fully disabled', () => {
  for (const entity of ['SmsConsent', 'ScheduledSms']) {
    const schema = JSON5.parse(read(`base44/entities/${entity}.jsonc`));
    assert.equal(schema.name, entity);
    for (const operation of ['create', 'read', 'update', 'delete']) {
      assert.equal(
        schema.rls?.[operation],
        false,
        `${entity}.${operation} must stay behind a backend workflow`,
      );
    }
  }
});

test('scheduled SMS creation and dispatch pause before constructing a Base44 client', () => {
  const pausedHandlers = new Map([
    ['scheduleSms', 'SCHEDULED_SMS_CREATION_PAUSED'],
    ['dispatchScheduledSms', 'SCHEDULED_SMS_DISPATCH_PAUSED'],
  ]);

  for (const [name, flag] of pausedHandlers) {
    const source = readEntry(name);
    assert.match(source, new RegExp(`const ${flag} = true;`), `${name} pause must be literal and fail-closed`);

    const handler = source.slice(source.indexOf('Deno.serve'));
    const pauseGate = handler.indexOf(`if (${flag})`);
    const clientCreation = handler.indexOf('createClientFromRequest(req)');
    assert.notEqual(pauseGate, -1, `${name} must check ${flag} in its handler`);
    assert.notEqual(clientCreation, -1, `${name} must retain its dormant implementation`);
    assert.ok(
      pauseGate < clientCreation,
      `${name} must return from its pause gate before SDK construction or any hosted read/write`,
    );
    assert.match(
      handler.slice(pauseGate, clientCreation),
      /status:\s*503/,
      `${name} pause response must report service unavailable`,
    );
  }
});

test('analyzeAndGenerateClinicalTasks authorizes the patient before PHI reads and returns suggestions without Task writes', () => {
  const source = readEntry('analyzeAndGenerateClinicalTasks');
  const handler = source.slice(source.indexOf('Deno.serve'));
  const patientRead = handler.indexOf('entities.Patient');
  const accessGate = handler.indexOf('assertPatientAccess(base44, user, patient)');
  const relatedPhiReads = handler.indexOf('entities.Visit');
  const modelCall = handler.indexOf('base44.integrations.Core.InvokeLLM');

  assert.notEqual(patientRead, -1);
  assert.notEqual(accessGate, -1);
  assert.notEqual(relatedPhiReads, -1);
  assert.notEqual(modelCall, -1);
  assert.ok(patientRead < accessGate && accessGate < relatedPhiReads,
    'patient authorization must complete before visits, alerts, or task context is read');
  assert.ok(accessGate < modelCall, 'patient authorization must complete before sending PHI to the model');
  assert.match(source, /typeof body\.patientId === 'string' \? body\.patientId\.trim\(\) : ''/);
  assert.match(source, /patientRows\.filter\(\(row\) => row\?\.id === patientId\)/);
  assert.match(source, /Visit\.filter\(\{ patient_id: patient\.id \}/);
  assert.match(source, /PatientAlert\.filter\(\{ patient_id: patient\.id/);
  assert.match(source, /Task\.filter\(\{ patient_id: patient\.id/);
  assert.match(source, /rows\.some\(\(row\) => row\?\.patient_id !== patient\.id\)/);
  assert.doesNotMatch(
    source,
    /\b(?:Task|PatientAlert)\s*\.\s*(?:create|update|delete|bulkCreate|bulkUpdate|bulkDelete)\s*\(/,
    'AI clinical analysis may suggest tasks but must not mutate clinical workflow records',
  );
  assert.match(source, /tasks:\s*tasksWithDates/);
});

test('preparePDFWithPatientInfo binds every service-role child read to one exact patient id', () => {
  const source = readEntry('preparePDFWithPatientInfo');
  assert.match(source, /typeof patient_id !== 'string' \|\| !patient_id\.trim\(\) \|\| patient_id\.length > 200/);
  assert.match(source, /patientRows\.filter\(\(row\) => row\?\.id === normalizedPatientId\)/);
  assert.match(source, /Visit\.filter\(\s*\{ patient_id: claimed\.id \}/);
  assert.match(source, /visits\.some\(\(visit\) => visit\?\.patient_id !== claimed\.id\)/);
});
