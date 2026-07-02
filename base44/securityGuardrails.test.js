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
  // A user-context Patient read must gate the patient-bound branch (drops the
  // match to undefined when the caller cannot read the patient).
  assert.ok(
    /base44\.entities\.Patient\.filter/.test(src) && /patientBound\s*=\s*undefined/.test(src),
    'expandClinicalPhrase must drop a patient-bound template when the caller cannot read the patient (user-context Patient.filter). Without it, the service-role read + early generic-branch return leaks bound order text for arbitrary patient ids.',
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
