// Security guardrail tests — prevent regression of the fixes from the 2026-06-28
// security review (docs/CODE_REVIEW_2026-06-28_DEFERRED.md and the security
// pass). Style mirrors schemaContract.test.js: cheap, near-zero-maintenance
// invariants that turn a re-introduced vulnerability into a failing build rather
// than an invisible production exposure.
//
// Each assertion below pins a SPECIFIC, reviewed fix. When you intentionally
// change one of these surfaces, update the corresponding assertion/allowlist in
// the same PR so the guardrail stays meaningful.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url)); // base44/
const REPO = join(HERE, '..');
const read = (relToRepo) => readFileSync(join(REPO, relToRepo), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

// 1. getApprovedTimeOff is readable by EVERY authenticated user (service-role
//    read, RLS bypassed). It must expose only name/type/dates/half-day — never
//    employee_email, which would hand any user a staff name->email directory.
test('getApprovedTimeOff does not expose employee_email', () => {
  const src = read('base44/functions/getApprovedTimeOff/entry.ts');
  assert.ok(
    !/employee_email\s*:/.test(src),
    'getApprovedTimeOff must NOT return employee_email — the team time-off feed is readable by every authenticated user.',
  );
});

// 2. The referral->SmartNote handoff must pass its PHI-bearing prepopulation
//    payload via same-origin sessionStorage, NOT serialized into the iframe URL
//    query string (URLs leak into history, proxy/access logs, and Referer).
test('ReferralAdmissionNote does not serialize referral PHI into the URL', () => {
  const src = read('src/components/hub-tabs/ReferralAdmissionNote.jsx');
  assert.ok(
    !/referral_data=\$\{encodeURIComponent\(JSON\.stringify/.test(src),
    'ReferralAdmissionNote must pass the prepopulation payload via sessionStorage keyed by referral id — not a URL query param.',
  );
  assert.ok(
    !/patient_id=\$\{referral\.patient_id\}/.test(src),
    'ReferralAdmissionNote must not put patient_id in the iframe URL — pass it via sessionStorage with the prepopulate payload.',
  );
});

// 3. CSV exports must neutralize spreadsheet formula injection on attacker-
//    influenceable free-text. The clinical-report diagnosis cell (from patient
//    primary_diagnosis, populated via referral OCR/AI extraction) must go
//    through escapeCsvField, not be interpolated raw.
test('ReportsCenter clinical CSV escapes the diagnosis cell', () => {
  const src = read('src/components/admin/ReportsCenter.jsx');
  assert.ok(
    !/\+=\s*`\$\{diagnosis\}\s*,/.test(src),
    'ReportsCenter clinical-report CSV must wrap the diagnosis in escapeCsvField (formula-injection guard).',
  );
  assert.ok(
    /escapeCsvField\(\s*diagnosis\s*\)/.test(src),
    'Expected escapeCsvField(diagnosis) in ReportsCenter — the guarded form must be present.',
  );
});

// 4. dangerouslySetInnerHTML is an XSS sink. Confine it to a reviewed allowlist
//    of sinks that are known to sanitize/escape their input, so a NEW sink
//    forces a security review (and an explicit allowlist entry) rather than
//    slipping in unsanitized.
test('dangerouslySetInnerHTML stays within the reviewed, sanitized allowlist', () => {
  const ALLOW = new Set([
    'src/pages/SignDocument.jsx',                       // injects via sanitizeHtml() (DOMPurify)
    'src/components/documents/PDFSearchInterface.jsx',  // highlightText() HTML-escapes text + terms
    'src/components/ui/chart.jsx',                       // shadcn: emits CSS from a dev config, not user data
  ]);
  const offenders = walk(join(REPO, 'src'))
    .filter((p) => /dangerouslySetInnerHTML\s*=\s*\{/.test(readFileSync(p, 'utf8')))
    .map((p) => p.slice(REPO.length + 1).replace(/\\/g, '/'));
  const unexpected = offenders.filter((p) => !ALLOW.has(p));
  assert.deepEqual(
    unexpected,
    [],
    `Unreviewed dangerouslySetInnerHTML sink(s): ${unexpected.join(', ') || '(none)'}. ` +
      'Confirm the injected HTML is sanitized (sanitizeHtml/DOMPurify) and add the file to the allowlist in this test.',
  );
});

// 5. ClinicalLibraryTemplate records can be patient-bound (patient_name +
//    expanded_text order text). Its read RLS must be scoped so an unscoped
//    `.list()` from the phrase picker / library manager cannot ship OTHER users'
//    and OTHER patients' bound-phrase content to the browser. Regression guard for
//    the read-scoping fix. (Raw-regex, mirroring this file's style, to avoid a
//    JSON5 dependency — the schema-well-formedness is covered by schemaContract.)
test('ClinicalLibraryTemplate scopes read RLS (no unscoped patient-bound phrase exposure)', () => {
  const src = read('base44/entities/ClinicalLibraryTemplate.jsonc');
  assert.ok(
    /"rls"\s*:/.test(src) && /"read"\s*:/.test(src),
    'ClinicalLibraryTemplate must define an rls.read policy — without one, any authenticated user can list every template, including other patients\' bound-phrase content.',
  );
  assert.ok(
    /"created_by"\s*:\s*"\{\{user\.email\}\}"/.test(src),
    'ClinicalLibraryTemplate rls.read must scope by created_by ({{user.email}}) so bulk reads stay limited to own + agency-wide (+admin) templates.',
  );
});

// 6. expandClinicalPhrase reads templates via SERVICE ROLE (bypassing RLS) so a
//    teammate-authored patient-bound phrase is reachable. Because RLS is bypassed,
//    a patient-bound match must be re-authorized against patient access — otherwise
//    an authenticated user could POST another patient's id + a known phrase and
//    retrieve that patient's bound order text. This pins the access gate.
test('expandClinicalPhrase re-authorizes patient-bound templates against patient access', () => {
  const src = read('base44/functions/expandClinicalPhrase/entry.ts');
  assert.ok(
    /asServiceRole\.entities\.ClinicalLibraryTemplate\.filter/.test(src),
    'expandClinicalPhrase reads templates via service role — if that changes, revisit this guard.',
  );
  // Explicit patient access must gate the patient-bound branch (drops the
  // match when the caller cannot read the patient). Uses assertPatientAccess
  // so facility admins are agency-scoped — Patient RLS alone is bare role:admin.
  assert.ok(
    /assertPatientAccess/.test(src) && /patientBound\s*=\s*undefined/.test(src),
    'expandClinicalPhrase must drop a patient-bound template when the caller cannot read the patient (assertPatientAccess). Without it, the service-role read + early generic-branch return leaks bound order text for arbitrary patient ids.',
  );
});

// 7. PHI read-scoping (2026-07-02 review): these PHI-bearing entities are read
//    from non-admin report/dashboard surfaces, and without an rls.read policy
//    any authenticated user could bulk-.list() every patient's rows. Each must
//    scope reads to the owning user (+ admin) — the same model as Patient /
//    Visit / ComplianceAudit. Referral must ALSO scope by assigned_to (nurses
//    never create referrals — office staff do — so a created_by-only rule would
//    empty the assigned nurse's referral queue). Raw-regex, mirroring the
//    ClinicalLibraryTemplate guard above.
const PHI_READ_SCOPED_ENTITIES = {
  'OASISUpload': ['created_by'],
  // ADR/audit cases carry beneficiary name + MBI + claim identifiers; reads are
  // creator + admin only (office/admin workflow, no cross-user assignment).
  'AdrAuditCase': ['created_by'],
  'OASISAssessment': ['created_by'],
  'OASISAudit': ['created_by', 'assigned_to'],
  'Referral': ['created_by', 'assigned_to'],
  'NoteConversion': ['nurse_email'],
  'Document': ['uploaded_by', 'created_by'],
  'DischargeSummary': ['generated_by', 'created_by'],
};
for (const [entity, ownerFields] of Object.entries(PHI_READ_SCOPED_ENTITIES)) {
  test(`${entity} scopes read RLS (PHI not bulk-listable by any authenticated user)`, () => {
    const src = read(`base44/entities/${entity}.jsonc`);
    assert.ok(
      /"rls"\s*:/.test(src) && /"read"\s*:/.test(src),
      `${entity} must define an rls.read policy — without one, any authenticated user can list every patient's rows.`,
    );
    for (const field of ownerFields) {
      assert.ok(
        new RegExp(`"${field}"\\s*:\\s*"\\{\\{user\\.email\\}\\}"`).test(src),
        `${entity} rls.read must scope by ${field} ({{user.email}}) so non-admin reads stay limited to the caller's own rows.`,
      );
    }
  });
}

// 8. PersonnelCredential approval must stay out of staff hands. RLS cannot
//    restrict a single FIELD, so while the row was owner-writable an employee
//    could set status='approved' on their own credential. The entity's write
//    rule is admin-only; staff submissions go through submitPersonnelCredential
//    (which pins status=pending_approval) and decisions through the admin-gated
//    reviewPersonnelCredential.
test('PersonnelCredential write RLS is admin-only (no self-approval)', () => {
  const src = read('base44/entities/PersonnelCredential.jsonc');
  const writeBlock = src.slice(src.indexOf('"write"'));
  assert.ok(
    !/"user_id"\s*:\s*"\{\{user\.email\}\}"/.test(writeBlock),
    'PersonnelCredential write RLS must NOT include the owner (user_id) — owner write access lets staff self-approve their own credential (status is a single field; RLS cannot restrict it).',
  );
  assert.ok(
    /"user_condition"\s*:\s*\{\s*"role"\s*:\s*"admin"/.test(writeBlock),
    'PersonnelCredential write RLS must be admin-only.',
  );
  const submitFn = read('base44/functions/submitPersonnelCredential/entry.ts');
  assert.ok(
    /status\s*:\s*'pending_approval'/.test(submitFn),
    "submitPersonnelCredential must pin status to 'pending_approval' on every staff submission.",
  );
});

// 9. scheduleSignatureReminders must QUEUE future reminders (it used to create
//    the signer notifications immediately no matter how far out the reminder
//    time was). A future reminder becomes a ScheduledSignatureReminder row that
//    dispatchScheduledSignatureReminders (cron) delivers when due.
test('scheduleSignatureReminders queues future reminders instead of sending immediately', () => {
  const src = read('base44/functions/scheduleSignatureReminders/entry.ts');
  assert.ok(
    /ScheduledSignatureReminder\.create/.test(src),
    'scheduleSignatureReminders must create a ScheduledSignatureReminder row for a future reminder time.',
  );
  const dispatcher = read('base44/functions/dispatchScheduledSignatureReminders/entry.ts');
  assert.ok(
    /status:\s*'sending',\s*claimed_by/.test(dispatcher),
    'dispatchScheduledSignatureReminders must claim rows (pending->sending with a run token) so overlapping runs cannot double-notify.',
  );
  // The queue rows are consumed by a SERVICE-ROLE dispatcher, so direct client
  // writes must stay admin-only: an owner write rule would let any user queue a
  // reminder for an arbitrary document_id, bypassing scheduleSignatureReminders'
  // ownership/role checks (the scheduling function itself writes via service role).
  const entity = read('base44/entities/ScheduledSignatureReminder.jsonc');
  const writeBlock = entity.slice(entity.indexOf('"write"'));
  assert.ok(
    !/"(created_by|requested_by)"\s*:\s*"\{\{user\.email\}\}"/.test(writeBlock),
    'ScheduledSignatureReminder write RLS must NOT include an owner rule — a direct client create would make the service-role dispatcher notify signers of a document the caller does not control.',
  );
  assert.ok(
    /"user_condition"\s*:\s*\{\s*"role"\s*:\s*"admin"/.test(writeBlock),
    'ScheduledSignatureReminder write RLS must be admin-only.',
  );
});

// 10. Patient.enhanced_notes_history is append-only via the backend function —
//     a browser-side read-modify-write of the array LOSES entries when two
//     saves for the same patient race. persistVisitNote must call
//     appendPatientNoteHistory and never Patient.update the array directly.
test('persistVisitNote appends note history via the atomic backend function', () => {
  const src = read('src/components/smartNote/persistVisitNote.js');
  assert.ok(
    /appendPatientNoteHistory/.test(src),
    'persistVisitNote must route note-history writes through appendPatientNoteHistory.',
  );
  assert.ok(
    !/Patient\.update\([^)]*enhanced_notes_history/s.test(src),
    'persistVisitNote must not read-modify-write enhanced_notes_history from the client — concurrent saves lose entries.',
  );
});

// 11. Scheduled/internal functions run as service role and are exposed as plain
//     HTTP endpoints. They must all use the shared scheduler-auth helper
//     (admin session OR x-internal-secret), and must not regress to the old
//     "reject authenticated non-admin only" fail-open gate.
const SCHEDULER_AUTH_FILES = [
  'base44/functions/autoApproveInvitedUser/entry.ts',
  'base44/functions/autoEndDutyDay/entry.ts',
  'base44/functions/autoEnrollAnnualPlans/entry.ts',
  'base44/functions/autoRetryFailedFaxes/entry.ts',
  'base44/functions/checkAdrDeadlines/entry.ts',
  'base44/functions/checkExpiredInvitations/entry.ts',
  'base44/functions/checkPendingSignatureRequests/entry.ts',
  'base44/functions/checkStaleFollowUpRequests/entry.ts',
  'base44/functions/computeOutcomeMeasures/entry.ts',
  'base44/functions/dispatchScheduledSignatureReminders/entry.ts',
  'base44/functions/dispatchScheduledSms/entry.ts',
  'base44/functions/monitorComplianceRisks/entry.ts',
  'base44/functions/pollFaxStatuses/entry.ts',
  'base44/functions/processAnnualEducationRenewals/entry.ts',
  'base44/functions/processInboundFaxes/entry.ts',
  'base44/functions/processScheduledFaxes/entry.ts',
  'base44/functions/processScheduledFaxesByPriority/entry.ts',
  'base44/functions/processTrainingRenewals/entry.ts',
  'base44/functions/redriveFailedSms/entry.ts',
  'base44/functions/scheduledGuidelineSync/entry.ts',
  'base44/functions/sendAutomatedSignatureReminders/entry.ts',
  'base44/functions/sendCredentialRenewalReminders/entry.ts',
  'base44/functions/sendDocumentReminderEmails/entry.ts',
  'base44/functions/sendExpirationNotifications/entry.ts',
  'base44/functions/sendPersonnelExpirationNotifications/entry.ts',
  'base44/functions/sendRenewalReminders/entry.ts',
  'base44/functions/sendTrainingNotifications/entry.ts',
  'base44/functions/syncFaxStatuses/entry.ts',
  'base44/functions/syncTrainingVideoStatuses/entry.ts',
  'base44/functions/triggerCorrectiveActionPlan/entry.ts',
];
for (const file of SCHEDULER_AUTH_FILES) {
  test(`${file} uses the shared scheduler auth helper`, () => {
    const src = read(file);
    assert.ok(
      /<<<BEGIN SHARED HELPER: schedulerAuth/.test(src),
      `${file} must use the shared schedulerAuth helper so the whole cron family stays in sync.`,
    );
    assert.ok(
      /getSchedulerAuthError\(req,\s*(me|user)\)/.test(src),
      `${file} must gate privileged cron/internal execution with getSchedulerAuthError(req, user).`,
    );
    assert.ok(
      !/if \((me|user) && !isAdmin\)|if \(me && !isAdminLike\(me\)\)/.test(src),
      `${file} must not rely on the old fail-open cron gate that only rejected authenticated non-admin callers.`,
    );
  });
}

// 12. notifySignerOfPackage is an unauthenticated entity trigger that mints a
//     30-day signer-portal bearer token. It must claim the signer_notified_at
//     idempotency marker before doing that privileged work, so a trigger
//     re-fire (or a re-POST of a real package id) cannot re-mint and re-email
//     portal links indefinitely.
test('notifySignerOfPackage claims the signer_notified_at idempotency marker', () => {
  const src = read('base44/functions/notifySignerOfPackage/entry.ts');
  assert.ok(
    /if \(pkg\.signer_notified_at\)/.test(src),
    'notifySignerOfPackage must skip packages whose signer has already been notified.',
  );
  assert.ok(
    /DocumentPackage\.update\(pkg\.id,\s*\{\s*signer_notified_at:/.test(src),
    'notifySignerOfPackage must claim signer_notified_at before minting the signer token.',
  );
  const entity = read('base44/entities/DocumentPackage.jsonc');
  assert.ok(
    /"signer_notified_at"/.test(entity),
    'DocumentPackage must define the signer_notified_at idempotency field.',
  );
});

// 13. validateSignerToken is a public endpoint whose access tracking stores
//     caller-controlled values (x-forwarded-for, user-agent). The arrays must
//     stay capped so a client cycling spoofed values cannot grow the token
//     record without bound.
test('validateSignerToken caps its ip/user-agent access tracking', () => {
  const src = read('base44/functions/validateSignerToken/entry.ts');
  assert.ok(
    /MAX_TRACKED_ENTRIES/.test(src) && /\.slice\(-MAX_TRACKED_ENTRIES\)/.test(src),
    'validateSignerToken must cap ip_addresses/user_agents (slice(-MAX_TRACKED_ENTRIES)) — they store caller-controlled header values on a public endpoint.',
  );
});

// 13b. Signer tokens must snapshot package document membership at mint so a
//      later add/swap of DocumentSignature ids cannot expand the PHI the
//      public signing link can read or sign.
test('signer tokens snapshot document_ids at mint and intersect on validate/submit', () => {
  const mint = read('base44/functions/generateSignerToken/entry.ts');
  const validate = read('base44/functions/validateSignerToken/entry.ts');
  const submit = read('base44/functions/submitSignerSignature/entry.ts');
  const entity = read('base44/entities/DocumentPackageToken.jsonc');
  assert.ok(
    /document_ids:\s*mintedDocumentIds/.test(mint) || /document_ids:\s*mintedDocumentIds/.test(mint.replace(/\s+/g, ' ')),
    'generateSignerToken must persist document_ids from the package at mint time.',
  );
  assert.ok(
    /document_ids/.test(mint) && /document_signatures/.test(mint),
    'generateSignerToken must snapshot package document_signatures into document_ids.',
  );
  assert.ok(
    /tokenRecord\.document_ids/.test(validate) && /snapshot/.test(validate),
    'validateSignerToken must intersect live membership with the mint-time document_ids snapshot.',
  );
  // Empty arrays are valid snapshots (package had no docs at mint). Treating
  // `snapshot.length > 0` as "no snapshot" would expand PHI if docs are added later.
  assert.ok(
    !/snapshot\s*&&\s*snapshot\.length\s*>\s*0/.test(validate)
    && !/snapshot\s*&&\s*snapshot\.length\s*>\s*0/.test(submit),
    'Empty document_ids snapshots must still intersect (do not fall back to live membership).',
  );
  assert.ok(
    /snapshot\s*!==\s*null/.test(validate) && /snapshot\s*!==\s*null/.test(submit),
    'validate/submit must distinguish absent snapshot from empty array via !== null.',
  );
  assert.ok(
    /tokenRecord\.document_ids/.test(submit) && /allowedIds/.test(submit),
    'submitSignerSignature must require document_id ∈ snapshot ∩ live package membership.',
  );
  assert.ok(
    /"document_ids"/.test(entity),
    'DocumentPackageToken must define the document_ids snapshot field.',
  );
});

// Codex P1/P2 regression locks (PR review on deep-app-review).
test('Codex review: SoR and FaxRetry stay in scope across loops', () => {
  const monitor = read('base44/functions/monitorComplianceRisks/entry.ts');
  const autoRetry = read('base44/functions/autoRetryFailedFaxes/entry.ts');
  assert.ok(
    /dischargedIsSoR\s*=\s*await agencyIsSystemOfRecord/.test(monitor),
    'monitorComplianceRisks must resolve SoR per discharged patient (not reuse loop-local flag).',
  );
  assert.ok(
    /if\s*\(\s*agencyName\s*\)\s*\{[\s\S]*?sorCache\.set\(\s*key\s*,\s*false\s*\)/.test(monitor),
    'monitorComplianceRisks must fail closed on keyed AgencySettings miss.',
  );
  assert.ok(
    /dueFaxes\.push\(\s*\{\s*fax\s*,\s*cfg\s*,\s*c\s*\}\s*\)/.test(autoRetry)
    && /for\s*\(\s*const\s*\{\s*fax\s*,\s*cfg\s*,\s*c\s*\}\s*of\s*dueFaxes\s*\)/.test(autoRetry),
    'autoRetryFailedFaxes must carry cfg/c into the dispatch loop.',
  );
});

test('Codex review: follow-up claim before finalize; invitation fail-closed', () => {
  const followUp = read('base44/functions/submitFollowUpResponse/entry.ts');
  const userMgmt = read('base44/functions/userManagement/entry.ts');
  assert.ok(
    /submit_claimed_by:\s*claimToken/.test(followUp)
    && /Referral\.update/.test(followUp)
    && /submitted_at:\s*now/.test(followUp),
    'submitFollowUpResponse must claim, merge Referral, then set terminal fields.',
  );
  const claimIdx = followUp.indexOf('submit_claimed_by: claimToken');
  const mergeIdx = followUp.indexOf('Referral.update');
  const terminalIdx = followUp.indexOf("status: 'delivered'");
  assert.ok(
    claimIdx >= 0 && mergeIdx > claimIdx && terminalIdx > mergeIdx,
    'Terminal follow-up fields must be stamped after the Referral merge.',
  );
  assert.ok(
    /async function resendInvitation[\s\S]*account_type === 'agency_admin' && !String\(currentUser\.agency_name/.test(userMgmt)
    && /async function cancelInvitation[\s\S]*account_type === 'agency_admin' && !String\(currentUser\.agency_name/.test(userMgmt),
    'resend/cancelInvitation must deny agency_admin without agency_name before scoped checks.',
  );
});

test('Codex review: scheduleSms auth, digests, fax sender agency, audit cohort', () => {
  const sms = read('base44/functions/scheduleSms/entry.ts');
  const digest = read('base44/functions/sendCredentialRenewalReminders/entry.ts');
  const batch = read('base44/functions/sendBatchFax/entry.ts');
  const retry = read('base44/functions/retryFailedFax/entry.ts');
  const timesheet = read('base44/functions/submitTimesheet/entry.ts');
  const audit = read('base44/functions/runSecurityAudit/entry.ts');
  assert.ok(
    /canAccessPatient\(match\)/.test(sms),
    'scheduleSms must authorize every phone-resolved patient before linking.',
  );
  assert.ok(
    /i\.agency_name === admin\.agency_name/.test(digest)
    && /never unscoped/.test(digest),
    'Agency credential digests must exclude unscoped items.',
  );
  assert.ok(
    /senderAgency/.test(batch) && /senderEmail/.test(batch),
    'sendBatchFax must resolve AgencySettings from the attributed sender.',
  );
  assert.ok(
    /senderAgency/.test(retry) && /originalFax\.sent_by/.test(retry),
    'retryFailedFax must resolve fax settings from the original sender agency.',
  );
  assert.ok(
    /legacy\.length === 1/.test(timesheet) && /VisitPointConfig/.test(timesheet),
    'submitTimesheet must adopt a single unscoped VisitPointConfig legacy row.',
  );
  assert.ok(
    /filter\(\{\s*agency_name:\s*agency/.test(audit)
    && /filter\(\{\s*created_by:\s*email/.test(audit)
    && /status:\s*503/.test(audit)
    && /status:\s*422/.test(audit),
    'runSecurityAudit must query agency cohort first and fail on incomplete/empty reads.',
  );
});

// 14. submitDocumentSignatures must authorize with the platform's real role
//     model (role 'admin' + account_type agency/super admin). 'clinician' and
//     'nurse_manager' are not role values in this platform — branches keyed on
//     them silently never fire, masking the intended authorization behavior.
test('submitDocumentSignatures uses the real admin role model', () => {
  const src = read('base44/functions/submitDocumentSignatures/entry.ts');
  assert.ok(
    !/===\s*'clinician'|===\s*'nurse_manager'/.test(src),
    "submitDocumentSignatures must not gate on nonexistent role values ('clinician'/'nurse_manager').",
  );
  assert.ok(
    /account_type === 'agency_admin'/.test(src) && /account_type === 'super_admin'/.test(src),
    'submitDocumentSignatures must accept the agency_admin/super_admin account types like the rest of the backend.',
  );
});

// 15. Every backend function that dials/texts/faxes a destination must gate it
//     through the SHARED isAllowedDestination helper (generated from the
//     frontend costControls.js). Hand-maintained inline copies are exactly how
//     the malformed-+1 bypass drifted in before.
for (const fn of ['sendSms', 'sendFax', 'sendBatchFax', 'startMaskedCall', 'dispatchScheduledSms', 'autoRetryFailedFaxes']) {
  test(`${fn} consumes the shared isAllowedDestination helper`, () => {
    const src = read(`base44/functions/${fn}/entry.ts`);
    assert.ok(
      src.includes('<<<BEGIN SHARED HELPER: isAllowedDestination'),
      `${fn} must inline isAllowedDestination via the shared-helper markers (npm run sync:shared-helpers), not a hand-maintained copy.`,
    );
    assert.ok(
      /isAllowedDestination\(/.test(src.split('<<<END SHARED HELPER: isAllowedDestination>>>')[1] || ''),
      `${fn} must actually call isAllowedDestination on its destination number.`,
    );
  });
}

// 16. Telehealth guest join tokens are bearer capabilities for live A/V access.
//     They must be stored HASHED at rest (join_token_hash) — the create flows
//     must never persist the plaintext token (the old invite_link pattern), and
//     the backend must validate guests against the hash.
test('telehealth join tokens are hashed at rest, never persisted in plaintext', () => {
  const backend = read('base44/functions/createTelehealthToken/entry.ts');
  assert.ok(
    /join_token_hash/.test(backend),
    'createTelehealthToken must validate guest tokens against session.join_token_hash.',
  );
  const entity = read('base44/entities/TelehealthSession.jsonc');
  assert.ok(
    /"join_token_hash"/.test(entity),
    'TelehealthSession must define the join_token_hash field.',
  );
  for (const file of ['src/pages/Telehealth.jsx', 'src/components/telehealth/PatientTelehealthPanel.jsx']) {
    const src = read(file);
    assert.ok(
      !/invite_link:/.test(src),
      `${file} must not persist a plaintext invite_link on session create — store join_token_hash and keep the raw link in-tab (rememberJoinLink).`,
    );
    assert.ok(
      /join_token_hash:\s*await hashJoinToken/.test(src),
      `${file} must persist only the hashed join token at session create.`,
    );
  }
});

// 17. Operational logs from backend service-role functions must not include
//     direct patient/staff identifiers. Console output can be retained outside
//     the app UI, so diagnostics should be aggregate/status-only unless a
//     reviewed, redacted logging helper is introduced.
test('backend service-role console logs do not include direct identifiers', () => {
  const sensitiveConsoleLine =
    /console\.(?:log|warn|error)\([^\n]*(?:\b\w+\.email\b|\$\{[^}]*\.(?:id|email|telnyx_fax_id)[^}]*\}|\$\{(?:patientId|templateId|patient_id|visitId)\}|log_id\s*:)/;

  const offenders = walk(join(REPO, 'base44/functions'))
    .filter((p) => p.endsWith('/entry.ts'))
    .flatMap((p) => {
      const rel = p.slice(REPO.length + 1).replace(/\\/g, '/');
      return readFileSync(p, 'utf8')
        .split('\n')
        .map((line, idx) => ({ rel, line, lineNo: idx + 1 }))
        .filter(({ line }) => sensitiveConsoleLine.test(line))
        .map(({ rel: file, lineNo, line }) => `${file}:${lineNo}: ${line.trim()}`);
    });

  assert.deepEqual(
    offenders,
    [],
    `Backend console logs must stay aggregate/status-only; direct emails, patient/fax/signature ids, and downstream provider ids can leak identifiers into retained logs.\n${offenders.join('\n')}`,
  );
});

// 18. Agency-scoped gates written as `!== 'super_admin' && user.agency_name`
//     are fail-OPEN when account_type is agency_admin and agency_name is empty
//     (the && short-circuits and the caller is treated as platform-wide). Every
//     such function must refuse that shape via agencyAdminMissingAgencyResponse
//     or an equivalent inline `agency_admin && !….agency_name` check.
test('functions with agency_name scope gates refuse agency_admin without agency_name', () => {
  const openGate =
    /account_type\s*!==\s*['"]super_admin['"]\s*&&\s*\w+\.agency_name/;
  // Must be a CALL site or inline check — not merely the helper function definition.
  const closedGate =
    /_agencyAdminGate\s*=\s*agencyAdminMissingAgencyResponse\s*\(|return\s+agencyAdminMissingAgencyResponse\s*\(|account_type\s*===\s*['"]agency_admin['"]\s*&&\s*!\s*\w+\.agency_name|account_type\s*===\s*['"]agency_admin['"]\s*&&\s*!String\(\w+\.agency_name/;

  const offenders = [];
  for (const entry of readdirSync(join(REPO, 'base44/functions'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let src;
    try {
      src = readFileSync(join(REPO, 'base44/functions', entry.name, 'entry.ts'), 'utf8');
    } catch {
      continue;
    }
    if (!openGate.test(src)) continue;
    if (!closedGate.test(src)) offenders.push(entry.name);
  }

  assert.deepEqual(
    offenders,
    [],
    'These functions scope by agency_name but do not refuse agency_admin without '
      + 'agency_name (fail-open to platform-wide). Inline requireAgencyAdminAgency '
      + 'or `if (user.account_type === \'agency_admin\' && !user.agency_name) return 403`:\n  '
      + offenders.join('\n  '),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Function-audit release pass (2026-08-15). Each assertion pins a specific
//     fix from that audit so a regression fails the build instead of silently
//     shipping. Same cheap-regex style as the guards above.
// ─────────────────────────────────────────────────────────────────────────────

// A direct provider Messages-API call must send a REAL model id, never the
// Base44 InvokeLLM sentinel 'automatic' (which 404s on api.anthropic.com and
// made every SOAP-note / fax-cover-sheet generation silently fail).
for (const fn of ['transcribeAndGenerateSOAPNote', 'generateFaxCoverPage']) {
  test(`${fn} does not send model:'automatic' to the direct Anthropic API`, () => {
    const src = read(`base44/functions/${fn}/entry.ts`);
    assert.ok(/api\.anthropic\.com/.test(src), `${fn} is expected to call the Anthropic Messages API directly.`);
    assert.ok(
      !/model:\s*['"]automatic['"]/.test(src),
      `${fn} must use a real Anthropic model id — 'automatic' is a Base44 InvokeLLM convention and 404s on the direct API.`,
    );
  });
}

// gradeTrainingAttempt must derive the pass mark from the ADMIN-OWNED course,
// not solely from the learner-writable TrainingAssignment row — otherwise a
// learner sets passing_score_required:1 and mints a compliance certificate.
test('gradeTrainingAttempt derives the pass mark from the course, not the learner-writable assignment', () => {
  const src = read('base44/functions/gradeTrainingAttempt/entry.ts');
  assert.ok(
    /Number\(course\?\.passing_score/.test(src) && /Math\.max\(courseFloorScore/.test(src),
    'gradeTrainingAttempt passing score must floor at the course passing_score (Math.max(courseFloor, assignment value)).',
  );
  assert.ok(
    !/const passingScore = assignment\.passing_score_required \|\| course/.test(src),
    'gradeTrainingAttempt must not take the pass mark straight off the learner-writable assignment.passing_score_required.',
  );
});

// generateTrainingCertificate must refuse when ANY supplied identifier — record
// id, course id, or module NAME — matches no owned certificate/completion, so a
// caller cannot mint a certificate for a module they never completed.
test('generateTrainingCertificate refuses an unmatched requested module (no body-only minting)', () => {
  const src = read('base44/functions/generateTrainingCertificate/entry.ts');
  assert.ok(
    /else if \(recordId \|\| moduleId \|\| requestedModule\)/.test(src),
    'generateTrainingCertificate must 403 when recordId || moduleId || requestedModule matches no owned record.',
  );
});

// sendSms must authorize a phone-resolved patient before linking the message to
// its chart (canAccessPatient), mirroring scheduleSms.
test('sendSms access-gates the phone-resolved patient', () => {
  const src = read('base44/functions/sendSms/entry.ts');
  assert.ok(
    /resolvePatientId\(base44, destination, canAccessPatient\)/.test(src),
    'sendSms must pass canAccessPatient into resolvePatientId so a foreign-agency chart with the same number cannot be linked.',
  );
});

// submitPersonnelCredential ownsRecord must scope agency admins to their own
// agency, not accept a bare isAdminLike (cross-tenant credential tamper).
test('submitPersonnelCredential scopes credential ownership by agency', () => {
  const src = read('base44/functions/submitPersonnelCredential/entry.ts');
  assert.ok(
    !/const ownsRecord = \(rec\) => rec && \(rec\.user_id === user\.email \|\| isAdminLike\(user\)\)/.test(src),
    'submitPersonnelCredential ownsRecord must not grant edit to any isAdminLike caller regardless of agency.',
  );
  assert.ok(
    /String\(rec\.agency_name \|\| ''\)\.trim\(\) === agency/.test(src),
    'submitPersonnelCredential must require an agency-scoped admin to match the credential agency.',
  );
});

// getTeamTrainingReadiness must scope every non-platform-admin (educators and
// supervisors included) to their own agency.
test('getTeamTrainingReadiness scopes non-platform-admins to their agency', () => {
  const src = read('base44/functions/getTeamTrainingReadiness/entry.ts');
  assert.ok(
    /if \(!isPlatformAdmin\) \{/.test(src),
    'getTeamTrainingReadiness must scope every non-platform-admin caller, not only admin account types.',
  );
});

// handleTelnyxStatusWebhook ringdown backup list must be agency-filtered so a
// patient call is never bridged to another agency's nurse cell.
test('handleTelnyxStatusWebhook ringdown is agency-scoped', () => {
  const src = read('base44/functions/handleTelnyxStatusWebhook/entry.ts');
  assert.ok(
    /otherOnDutyCells\(base44, config, nurse\.email, nurse\.agency_name\)/.test(src),
    'otherOnDutyCells must receive the primary nurse agency and filter cells to it.',
  );
});

// dispatchScheduledSms must resolve agency config PER ROW (from the sending
// nurse), never a single unhinted getAgencyConfig(base44) that reports
// smsEnabled:false in multi-tenant and destroys the reminder queue each tick.
test('dispatchScheduledSms resolves agency config per row', () => {
  const src = read('base44/functions/dispatchScheduledSms/entry.ts');
  assert.ok(
    !/const \{ smsEnabled, settings \} = await getAgencyConfig\(base44\);/.test(src),
    'dispatchScheduledSms must not resolve one unhinted agency config for the whole batch.',
  );
  assert.ok(
    /resolveRowConfig\(row\.nurse_email\)/.test(src),
    'dispatchScheduledSms must resolve config per row from the sending nurse.',
  );
});

// autoRetryFailedFaxes must classify a non-OK Telnyx response instead of
// terminal-failing every queued fax on the first provider error, and must
// re-gate the stored destination through isAllowedDestination.
test('autoRetryFailedFaxes classifies provider errors and re-gates the destination', () => {
  const src = read('base44/functions/autoRetryFailedFaxes/entry.ts');
  assert.ok(
    /classifyFaxFailure\(String\(status\), errText\)/.test(src),
    'autoRetryFailedFaxes must classify the non-OK Telnyx status (transient 401/403/429/5xx reschedule) rather than always exhausting.',
  );
  assert.ok(
    /isAllowedDestination\(fax\.to_number, faxLine\.settings\)/.test(src),
    'autoRetryFailedFaxes must re-validate the stored to_number against the cost-control allowlist before dispatch.',
  );
});

// AI report generators must assertPatientAccess after the patient load so a
// facility admin (bare role:admin RLS is platform-wide) cannot pull another
// agency's chart into an LLM prompt.
for (const file of [
  'base44/functions/generateDischargeSummary/entry.ts',
  'base44/functions/generateMessageSuggestions/entry.ts',
  'base44/functions/generatePatientEducation/entry.ts',
  'base44/functions/summarizeMessageThread/entry.ts',
  'base44/functions/generateFaxCoverPage/entry.ts',
  'base44/functions/messagingAssistant/entry.ts',
  'base44/functions/getPatientContext/entry.ts',
  'base44/functions/processCompletedVisit/entry.ts',
]) {
  test(`${file} gates patient PHI with assertPatientAccess`, () => {
    const src = read(file);
    assert.ok(
      /async function assertPatientAccess\(/.test(src),
      `${file} must define assertPatientAccess (HOSTED-RLS-PROOF §5b residual).`,
    );
    assert.ok(
      /assertPatientAccess\(base44,\s*user,\s*patient\)/.test(src),
      `${file} must call assertPatientAccess after loading the patient.`,
    );
  });
}

// getDashboardData must ship recent completed visits (and care plans) so
// RealTimePatientAlerts can compute overdue / high-risk / goal alerts — today's
// visits alone make "No visit in N days" impossible.
test('getDashboardData returns recentCompletedVisits and carePlans for alerts', () => {
  const src = read('base44/functions/getDashboardData/entry.ts');
  assert.ok(
    /recentCompletedVisits/.test(src) && /fetchAlertContext/.test(src),
    'getDashboardData must fetch recentCompletedVisits via fetchAlertContext.',
  );
  assert.ok(
    /CarePlan\.filter/.test(src),
    'getDashboardData must include active care plans for goal-deadline alerts.',
  );
});

// autoEndDutyDay must honor per-agency auto_off_duty_hour / duty_timezone and
// not flip every on_duty user the moment the cron fires.
test('autoEndDutyDay respects per-agency auto-off hour', () => {
  const src = read('base44/functions/autoEndDutyDay/entry.ts');
  assert.ok(
    /isPastAutoOffHour\(settings,\s*now\)/.test(src),
    'autoEndDutyDay must gate flips on isPastAutoOffHour per agency settings.',
  );
  assert.ok(
    /isStaleDutyDay\(/.test(src),
    'autoEndDutyDay must also flip overnight-stale duty_on_since toggles.',
  );
  assert.ok(
    /auto_off_duty_enabled === false/.test(src),
    'autoEndDutyDay must skip agencies that disabled auto-off.',
  );
});

// updateIncident patch path must write a UserActivity audit trail (parity with
// transitionIncident) so compliance review sees field edits.
test('updateIncident patchIncident records a UserActivity audit', () => {
  const src = read('base44/functions/updateIncident/entry.ts');
  assert.ok(
    /action:\s*'incident_patched'/.test(src),
    'patchIncident must create UserActivity with action incident_patched.',
  );
  assert.ok(
    /audit_recorded/.test(src),
    'patchIncident must surface audit_recorded like transitionIncident.',
  );
});

// assignAnnualLearningPlan must prefetch enrollments/assignments into Sets
// (parity with autoEnrollAnnualPlans) — O(users×courses) live filters time out.
test('assignAnnualLearningPlan prefetches enrollment and assignment Sets', () => {
  const src = read('base44/functions/assignAnnualLearningPlan/entry.ts');
  assert.ok(
    /enrolledSet\.add\(/.test(src) && /assignedSet\.add\(/.test(src),
    'assignAnnualLearningPlan must prefetch into enrolledSet/assignedSet.',
  );
  assert.ok(
    /PlanEnrollment\.filter\(\{\s*plan_id:\s*planId\s*\}/.test(src),
    'assignAnnualLearningPlan must prefetch PlanEnrollment once per plan.',
  );
});

// HighRiskPatientsWidget must read scoped PatientAlert rows — PatientRiskAssessment
// was never written and used non-existent overall_* fields.
test('HighRiskPatientsWidget uses getScopedPatientAlerts', () => {
  const src = read('src/components/dashboard/HighRiskPatientsWidget.jsx');
  assert.ok(
    /getScopedPatientAlerts/.test(src),
    'HighRiskPatientsWidget must fetch via getScopedPatientAlerts.',
  );
  assert.ok(
    !/PatientRiskAssessment\.list/.test(src),
    'HighRiskPatientsWidget must not read the unused PatientRiskAssessment entity.',
  );
  assert.ok(
    !/overall_risk_level/.test(src),
    'HighRiskPatientsWidget must not filter on non-schema overall_risk_level.',
  );
});
