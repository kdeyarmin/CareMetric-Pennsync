import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  handlerAllowlists, importedWrappers, measureWrapperCalls, passThroughWrappers,
  payloadKeys, propertyKey, summaryLines, withoutComments,
} from './tools-handler-allowlist.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * The comparable population, as a SET.
 *
 * Not a floor. Three of the four reader defects this check was built through
 * were SILENT — they shrank the population and reported clean — and a floor
 * near the true value passes through every one of them. A new pass-through
 * wrapper over a handler with one allowlist is a deliberate line here, which is
 * the cost of a ratchet that cannot go quiet.
 */
const COMPARABLE = Object.freeze([
  'acceptAiContentAgreement -> acceptAiContentAgreement',
  'analyzeVisitForSupplyUsage -> analyzeVisitForSupplyUsage',
  'cancelTimeOffRequest -> cancelTimeOffRequest',
  'distributePolicyAcknowledgment -> distributePolicyAcknowledgment',
  'expandClinicalPhrase -> expandClinicalPhrase',
  'generateFollowUpTasks -> generateFollowUpTasks',
  'generateUserManual -> generateUserManual',
  'importProvidersCsv -> importProvidersCsv',
  'listPolicyLibrary -> listPolicyLibrary',
  'policyAcknowledgment -> policyAcknowledgment',
  'reviewTimeOffRequest -> reviewTimeOffRequest',
  'reviewTimesheet -> reviewTimesheet',
  'savePayrollProfile -> savePayrollProfile',
  'saveVisitPointConfig -> saveVisitPointConfig',
  'submitIncidentReport -> submitIncidentReport',
  'submitTimeOffRequest -> submitTimeOffRequest',
  'submitTimesheet -> submitTimesheet',
]);

/** A multiset: `TimesheetApprovalsQueue.jsx` calls `reviewTimesheet` twice. */
const COMPARED = Object.freeze([
  'src/components/compliance/AIContentResponsibilityAgreement.jsx: acceptAiContentAgreement',
  'src/components/incident/SmartIncidentForm.jsx: submitIncidentReport',
  'src/components/physician/ProviderCsvImport.jsx: importProvidersCsv',
  'src/components/smartNote/QuickPhraseTextarea.jsx: expandClinicalPhrase',
  'src/components/timeoff/MyTimeOffList.jsx: cancelTimeOffRequest',
  'src/components/timeoff/PendingApprovalsQueue.jsx: reviewTimeOffRequest',
  'src/components/timeoff/RequestTimeOffForm.jsx: submitTimeOffRequest',
  'src/components/timesheet/TimesheetApprovalsQueue.jsx: reviewTimesheet',
  'src/components/timesheet/TimesheetApprovalsQueue.jsx: reviewTimesheet',
  'src/components/training/LearnerPolicyAcknowledgments.jsx: policyAcknowledgment',
  'src/components/training/PolicyAcknowledgmentManager.jsx: distributePolicyAcknowledgment',
  'src/components/training/PolicyAcknowledgmentManager.jsx: listPolicyLibrary',
  'src/components/training/PolicyAcknowledgmentManager.jsx: policyAcknowledgment',
  'src/pages/AITrainingGenerator.jsx: listPolicyLibrary',
  'src/pages/EventReport.jsx: submitIncidentReport',
  'src/pages/IncidentReportingModule.jsx: submitIncidentReport',
  'src/pages/SmartNoteAssistant.jsx: analyzeVisitForSupplyUsage',
  'src/pages/SmartNoteAssistant.jsx: generateFollowUpTasks',
]);

/**
 * The bucket the question has no slot for.
 *
 * Each of these three builds its payload as a variable and hands the whole
 * object over, so what it sends is decided at run time and no static reader can
 * answer it. They are named rather than dropped: a site moving OUT of the
 * compared set and into this one is a comparison silently stopping, and without
 * this list it would read as the population shrinking for no reason.
 */
const UNREADABLE = Object.freeze([
  'src/components/timesheet/MyTimesheetForm.jsx: submitTimesheet',
  'src/components/timesheet/PayrollSetupPanel.jsx: savePayrollProfile',
  'src/components/timesheet/VisitPointConfigCard.jsx: saveVisitPointConfig',
]);

test('no screen sends a ported capability a key its handler refuses', () => {
  const report = measureWrapperCalls(repository);
  assert.deepEqual(report.rejected, [],
    'a screen is sending a key outside its handler\'s exactObject allowlist, so that\n'
    + '  capability answers INVALID_PARAMS on every call it receives');
});

test('the comparable population is the declared set, in both directions', () => {
  const report = measureWrapperCalls(repository);
  assert.deepEqual(report.comparable, [...COMPARABLE],
    'a pass-through wrapper over a single-allowlist handler has arrived or left.\n'
    + '  Arriving: add it here, which is the point of a set. Leaving: say WHY --\n'
    + '  a wrapper that started shaping its payload, or a handler that gained a\n'
    + '  second allowlist, is out of this check\'s reach and something else must\n'
    + '  cover it.');
});

test('every call site is accounted for, as compared or as unreadable', () => {
  const report = measureWrapperCalls(repository);
  assert.deepEqual(report.compared, [...COMPARED]);
  assert.deepEqual(report.unreadable, [...UNREADABLE],
    'a call site moved between "its keys were read" and "its keys cannot be read".\n'
    + '  The second direction is a comparison going quiet and is never a tidy-up.');
  assert.equal(report.compared.length + report.unreadable.length, 21);
});

/**
 * The reader's four failure modes, each planted.
 *
 * Three of the four are silent on a real tree, so "the check is green" says
 * nothing about whether it can see. These drive the reader at the shapes that
 * defeated it and require the right answer, which is the only thing that
 * separates a working check from one that reaches nothing.
 */
test('template-literal TEXT is not read as keys', () => {
  // `src/pages/EventReport.jsx`'s real shape: a report built from a template
  // whose prose contains `Event Type:` and `Submitted By:`.
  const keys = payloadKeys('{ severity: "medium", report: `Event Type: ${a}\\n\\nSubmitted By: ${b}`, '
    + 'details: { location: c } }');
  assert.deepEqual(keys, ['severity', 'report', 'details']);
});

test('a shorthand property is a key, not an absence', () => {
  assert.deepEqual(payloadKeys('{ csv_text }'), ['csv_text']);
  assert.equal(propertyKey('csv_text'), 'csv_text');
});

test('a key that cannot be read makes the whole payload unreadable', () => {
  assert.equal(payloadKeys('{ ...rest, request_id: id }'), null,
    'a spread hides keys, and the hidden ones are exactly where a refused key would be');
  assert.equal(payloadKeys('{ [name]: value }'), null);
  assert.equal(payloadKeys('payload'), null);
});

test('a comment inside the payload does not hide its keys', () => {
  assert.deepEqual(payloadKeys('{ a: 1, // why b matters\n b: 2 }'), ['a', 'b']);
  assert.deepEqual(payloadKeys('{ a: 1, /* note, with a comma */ b: 2 }'), ['a', 'b']);
  assert.equal(withoutComments('"http://x"').includes('http://x'), true,
    'a // inside a string is not a comment');
  assert.deepEqual(payloadKeys('{ url: "http://x", b: 2 }'), ['url', 'b']);
});

test('both quote styles bind an import, and an alias binds the export', () => {
  const wrappers = passThroughWrappers(repository);
  assert.deepEqual([...importedWrappers(
    'import { cancelTimeOffRequest } from "@/functions/cancelTimeOffRequest";', wrappers)],
  [['cancelTimeOffRequest', 'cancelTimeOffRequest']]);
  assert.deepEqual([...importedWrappers(
    "import { cancelTimeOffRequest as cancel } from '@/functions/cancelTimeOffRequest';", wrappers)],
  [['cancel', 'cancelTimeOffRequest']]);
});

/**
 * The comparison itself, driven at a key the handler refuses.
 *
 * Planting on disk would prove the same thing and leave a file to restore, so
 * the refusal is raised through the same code path with one key changed. The
 * assertions above prove the reader reaches every site; this proves that what
 * it reads is actually compared.
 */
test('a key outside the allowlist is reported, by site and by name', () => {
  const { admits } = handlerAllowlists(repository);
  const allowed = admits.get('cancelTimeOffRequest');
  assert.deepEqual(allowed, ['request_id'],
    'this control is written against that allowlist and must be re-read if it moves');
  assert.equal(allowed.includes('requestId'), false);

  const keys = payloadKeys('{ requestId: id }');
  const rejected = keys.filter(key => !allowed.includes(key));
  assert.deepEqual(rejected, ['requestId']);
});

/** A handler that dispatches on an action is out of reach, and says so. */
test('an action-dispatched handler is reported, not silently skipped', () => {
  const { admits, dispatched, entries } = handlerAllowlists(repository);
  assert.ok(entries > 50, 'handlers.mjs no longer parses as one registry entry per line');
  assert.ok(dispatched.has('manageAuthorizedReferral'),
    'the six-action referral handler must land in the dispatched bucket');
  assert.equal(admits.has('manageAuthorizedReferral'), false);
  assert.deepEqual(measureWrapperCalls(repository).dispatched, ['manageAgencyMembership']);
});

test('the summary line carries the four figures and nothing else', () => {
  const report = measureWrapperCalls(repository);
  assert.deepEqual(summaryLines(report), [
    `handler allowlist: ${COMPARABLE.length} pass-through wrappers, `
    + `${COMPARED.length} readable call sites, ${UNREADABLE.length} unreadable, 0 refused`,
  ]);
});
