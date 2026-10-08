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
  'analyzeClinicalData',
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
    'managePhoneNumberPool',
    'manageSmsConsent',
    'provisionNurseWorkNumber',
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

test('the patient merge broker admits the platform tier or a membership-backed agency manager before parsing', () => {
  // deduplicatePatients is no longer owner-only: an active agency_admin or
  // manager may merge their own agency's charts. That authority comes from the
  // service-owned membership (withTrustedClaims), never the mutable profile,
  // and is decided before the request payload is read.
  const source = readEntry('deduplicatePatients');
  assert.match(source, /<<<BEGIN SHARED HELPER: protectedUserAuthz/);
  assert.match(source, /<<<BEGIN SHARED HELPER: trustedCallerClaims/);
  const handler = source.slice(source.indexOf('Deno.serve'));
  const claims = handler.indexOf('withTrustedClaims(base44, await base44.auth.me()');
  const gate = handler.indexOf('mergeAuthority(user)');
  const bodyParse = handler.indexOf('await req.json');
  assert.ok(claims !== -1 && gate !== -1 && bodyParse !== -1);
  assert.ok(claims < gate && gate < bodyParse, 'authorize before consuming the merge payload');
  const authority = source.slice(source.indexOf('function mergeAuthority'), source.indexOf('function patientAgency'));
  assert.match(authority, /isProtectedAdmin\(user\)/);
  assert.match(authority, /user\.is_manager === true && claimIdentifier\(user\.agency_id\)/);
  assert.doesNotMatch(authority, /account_type|agency_name|is_approved/);
});

test('security audit authorizes from protected role or service-owned membership, never profile claims', () => {
  // 2026-10-08 owner decision: the audit runs again. Its agency authority is
  // the withTrustedClaims result (a service-owned agency_admin membership),
  // read off the rebuilt claims object rather than the caller's own profile.
  const source = readEntry('runSecurityAudit');
  const authority = source.slice(source.indexOf('async function auditAuthority'), source.indexOf('async function loadCohort'));

  assert.match(source, /<<<BEGIN SHARED HELPER: trustedCallerClaims/);
  assert.match(authority, /if \(user\.role === 'admin'\) return \{ scope: 'platform', agencyId: null \}/);
  assert.match(authority, /const claims = await withTrustedClaims\(base44, user\)/);
  assert.doesNotMatch(authority, /user\.(?:account_type|agency_name|agency_id)/);
  assert.doesNotMatch(source, /SECURITY_AUDIT_PAUSED/);
});

test('clinical data analysis decides chart access from trusted rows and predicts no risk', () => {
  // Released by the owner on 2026-10-08. Its old gate trusted the self-editable
  // account_type claim; now chart access is callerMayAccessPatient (membership
  // and the care-team table) before any record or model call, and the owner's
  // removal of risk prediction holds: no readmission or deterioration scores.
  const source = readEntry('analyzeClinicalData');
  const own = source.slice(source.lastIndexOf('// <<<END SHARED HELPER'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const handler = own.slice(own.indexOf('Deno.serve('));
  assert.match(source, /<<<BEGIN SHARED HELPER: patientCareTeamAccess/);
  assert.ok(handler.indexOf('await loadAccessiblePatient(') > 0);
  assert.ok(handler.indexOf('await loadAccessiblePatient(') < handler.indexOf('extractEvents('));
  assert.doesNotMatch(own, /account_type|agency_name|assigned_nurses/);
  assert.doesNotMatch(own, /readmission|predictive_analytics|deterioration_risk|risk_score/i);
  assert.doesNotMatch(own, /\.create\(|\.update\(|updateMany/);
  assert.match(own, /'Cache-Control':\s*'no-store'/);
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

  // scheduleSms left this list on 2026-10-08: it now authorizes a chart by
  // agency, agency-wide role, chart creator id, or an active care-team
  // assignment (pinned in 'scheduleSms authorizes from protected sources').
  for (const name of ['sendSms']) {
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
  const consentHandler = consent.slice(consent.indexOf('Deno.serve'));
  const patientAccess = consentHandler.indexOf("if (!isProtectedSuperAdmin(user) && claimed.created_by !== user.email && !isAssigned)");
  const phoneBinding = consentHandler.indexOf('if (normalizeE164(claimed.phone) !== phone)');
  const telecomBinding = consentHandler.indexOf('resolveActiveTelnyxSmsBinding(base44');
  const ledgerRead = consentHandler.indexOf('loadLatestScopedSmsConsent(base44');
  assert.ok(
    patientAccess >= 0 && patientAccess < phoneBinding
      && phoneBinding < telecomBinding && telecomBinding < ledgerRead,
    'recordSmsConsent must authorize the chart and bind its phone and tenant before reading the scoped consent ledger',
  );
});

test('SmsConsent stays service-only; ScheduledSms is readable only by the nurse who scheduled it', () => {
  const consent = JSON5.parse(read('base44/entities/SmsConsent.jsonc'));
  for (const operation of ['create', 'read', 'update', 'delete']) {
    assert.equal(consent.rls?.[operation], false, `SmsConsent.${operation} must stay behind a backend workflow`);
  }
  // Scheduled texting was released 2026-10-08. The browser may read its own
  // queue; creating goes through scheduleSms and canceling through
  // cancelScheduledSms, so no browser write rule exists.
  const scheduled = JSON5.parse(read('base44/entities/ScheduledSms.jsonc'));
  assert.deepEqual(scheduled.rls, {
    read: {
      $or: [
        { 'data.nurse_email': '{{user.email}}' },
        { created_by: '{{user.email}}' },
        { user_condition: { role: 'admin' } },
      ],
    },
    create: false,
    update: false,
    delete: false,
  });
});

test('scheduleSms authorizes from protected sources, never from mutable profile fields', () => {
  const source = readEntry('scheduleSms');
  const handler = source.slice(source.indexOf('Deno.serve'));
  assert.doesNotMatch(source, /SCHEDULED_SMS_CREATION_PAUSED/);
  // Caller: the protected owner or one active service-owned membership.
  assert.match(handler, /await withTrustedClaims\(base44, await base44\.auth\.me\(\)\)/);
  assert.match(handler, /user\.role === 'user' && claimIdentifier\(user\.agency_id\)/);
  assert.ok(handler.indexOf("code: 'agency_membership_required'") < handler.indexOf('await req.json()'),
    'membership is required before the body is read');
  // Sending line: a service-owned outbound binding in the caller's agency.
  assert.match(handler, /resolveActiveTelnyxSmsBinding\(base44, \{[\s\S]*?requireOutbound: true/);
  assert.match(handler, /smsAuthority\.agencyId !== memberAgencyId/);
  assert.match(handler, /const fromNumber = smsAuthority\.destinationE164;/);
  // Consent: the scoped ledger, never a phone-only row.
  assert.match(handler, /loadLatestScopedSmsConsent\(base44, smsAuthority, destination\)/);
  assert.doesNotMatch(handler, /SmsConsent\s*\.filter\(\{ phone_e164/);
  // Patient: same agency, then agency-wide role, chart creator or an active
  // care-team assignment. The retired nurse-list and creator-email checks are gone.
  assert.match(handler, /claimed\.agency_id !== agencyId/);
  assert.match(source, /PatientCareTeamAssignment\.filter\(\{[\s\S]*?status: 'active'/);
  assert.doesNotMatch(source, /assigned_nurses|claimed\.created_by ===/);
});

test('dispatchScheduledSms re-proves the line, the membership and scoped consent at send time', () => {
  const source = readEntry('dispatchScheduledSms');
  const handler = source.slice(source.indexOf('Deno.serve'));
  assert.doesNotMatch(source, /SCHEDULED_SMS_DISPATCH_PAUSED/);
  assert.match(handler, /getSchedulerAuthError\(req, me\)/);
  assert.match(handler, /resolveActiveTelnyxSmsBinding\(base44, \{[\s\S]*?requireOutbound: true/);
  assert.match(handler, /AgencyMembership[\s\S]*?status: 'active'/);
  assert.match(handler, /loadLatestScopedSmsConsent\(base44, lineAuthority, row\.to_number\)/);
  assert.doesNotMatch(handler, /SmsConsent\s*\.filter\(\{ phone_e164/);
  const consent = handler.indexOf('loadLatestScopedSmsConsent(base44, lineAuthority');
  const send = handler.indexOf('await sendTelnyx(');
  assert.ok(consent > 0 && consent < send, 'consent is checked before every provider send');
});

test('analyzeAndGenerateClinicalTasks authorizes the patient before PHI reads and returns suggestions without Task writes', () => {
  const source = readEntry('analyzeAndGenerateClinicalTasks');
  const handler = source.slice(source.indexOf('Deno.serve'));
  const patientRead = handler.indexOf('entities.Patient');
  const accessGate = handler.indexOf('assertPatientAccess(base44, user, patient)');
  const relatedPhiReads = handler.indexOf('entities.Visit');
  const modelCall = handler.indexOf('base44.asServiceRole.integrations.Core.InvokeLLM');

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